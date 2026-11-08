import { and, eq, inArray } from "drizzle-orm";
import {
  isSensitiveSector,
  type Perk,
  type Sector,
  type Seniority,
} from "@intgetion/taxonomy/catalog";
import { getDb } from "@intgetion/kit";
import { jobSkills, jobStatusHistory, jobs } from "../../../db";

export type ImportedJobStatus = "published" | "expired" | "removed";

export type ImportedJobWrite = {
  /** Existing imported job to update (same source or a merged duplicate). */
  jobId?: string;
  companyId: string;
  title: string;
  description: string;
  category: (typeof jobs.$inferInsert)["category"];
  employmentType: NonNullable<(typeof jobs.$inferInsert)["employmentType"]>;
  timeZone: string | null;
  skillIds: string[];
  sectors?: Sector[];
  seniority?: Seniority | null;
  perks?: Perk[];
  /** D416: as the source states it; remote with no country otherwise. */
  workFormat?: "remote" | "hybrid" | "onsite";
  location?: string | null;
  countries?: string[];
  applyUrl: string;
  expiresAt: Date | null;
  status: ImportedJobStatus;
  reason: string;
};

type JobStatus = (typeof jobs.$inferSelect)["status"];

/** A person's decision (an admin, the production cleanup) a feed never undoes. */
const HELD_STATUSES: readonly JobStatus[] = ["removed", "closed", "paused"];

/**
 * The status a feed record leaves behind (D412). Removed, closed and paused
 * jobs stay as they are. A sensitive sector waits for an admin, unless the
 * job is already published (approved before) or already waiting.
 */
export function importedStatusAfterFeed(input: {
  previous: JobStatus | null;
  next: ImportedJobStatus;
  sensitive: boolean;
}): JobStatus | null {
  const { previous, next } = input;
  if (previous && HELD_STATUSES.includes(previous)) return null;
  if (next !== "published") return next;
  if (previous === "pending_moderation") return "pending_moderation";
  if (input.sensitive && previous !== "published") return "pending_moderation";
  return "published";
}

/**
 * D416: an office or hybrid job is in its first country; a remote job is
 * open to the listed countries. A non-remote job keeps its location text
 * (the jobs table requires one).
 */
export function importedPlace(input: {
  workFormat?: "remote" | "hybrid" | "onsite";
  location?: string | null;
  countries?: string[];
}) {
  const countries = (input.countries ?? []).filter((code) =>
    /^[A-Z]{2}$/.test(code),
  );
  const location = input.location?.trim() || null;
  const workFormat =
    input.workFormat && input.workFormat !== "remote" && location
      ? input.workFormat
      : ("remote" as const);
  return workFormat === "remote"
    ? {
        workFormat,
        location,
        locationCountry: null,
        countryRestrictions: countries.length ? countries : null,
      }
    : {
        workFormat,
        location,
        locationCountry: countries[0] ?? null,
        countryRestrictions: countries.length > 1 ? countries : null,
      };
}

/**
 * Writes normalized ingestion output (8A). Only imported jobs: an internal
 * job is never overwritten, and employers cannot edit these (D9). A job a
 * person removed, closed or paused is left untouched (D412).
 */
export async function saveImportedJob(input: ImportedJobWrite) {
  return getDb().transaction(async (tx) => {
    const [previous] = input.jobId
      ? await tx.select().from(jobs).where(eq(jobs.id, input.jobId)).limit(1)
      : [];
    if (previous && previous.source !== "imported") {
      throw new Error("Imported jobs cannot overwrite an internal job");
    }
    const status = importedStatusAfterFeed({
      previous: previous?.status ?? null,
      next: input.status,
      sensitive: isSensitiveSector(input.sectors ?? []),
    });
    if (previous && status === null) return previous;
    if (status === null) throw new Error("A new imported job needs a status");
    const now = new Date();
    const removed = status === "removed";
    const values = {
      companyId: input.companyId,
      title: input.title,
      description: input.description,
      category: input.category,
      employmentType: input.employmentType,
      sectors: input.sectors ?? [],
      seniority: input.seniority ?? null,
      perks: input.perks ?? [],
      ...importedPlace(input),
      timezoneRequired: input.timeZone,
      applicationMethod: "external_url" as const,
      applicationUrl: input.applyUrl,
      source: "imported" as const,
      status,
      publishedAt:
        status === "published" ? (previous?.publishedAt ?? now) : null,
      expiresAt: input.expiresAt,
      importedAt: now,
      createdBy: null,
      riskScore: removed ? 4 : 0,
      riskFlags: removed ? [input.reason] : [],
    };
    const [job] = previous
      ? await tx
          .update(jobs)
          .set({ ...values, updatedAt: now })
          .where(eq(jobs.id, previous.id))
          .returning()
      : await tx.insert(jobs).values(values).returning();
    if (!job) throw new Error("Imported job write returned no row");

    await tx.delete(jobSkills).where(eq(jobSkills.jobId, job.id));
    const skillIds = [...new Set(input.skillIds)];
    if (skillIds.length) {
      await tx
        .insert(jobSkills)
        .values(
          skillIds.map((skillId) => ({ jobId: job.id, skillId, weight: 2 })),
        );
    }
    if (!previous || previous.status !== job.status) {
      await tx.insert(jobStatusHistory).values({
        jobId: job.id,
        fromStatus: previous?.status ?? null,
        toStatus: job.status,
        actorId: null,
        reason: input.reason,
      });
    }
    return job;
  });
}

/** 13.4, D412: published imported jobs their sources no longer list become expired. */
export async function expireImportedJobs(
  jobIds: string[],
  reason = "missing_from_source_runs",
) {
  if (!jobIds.length) return 0;
  return getDb().transaction(async (tx) => {
    const expired = await tx
      .update(jobs)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          inArray(jobs.id, jobIds),
          eq(jobs.source, "imported"),
          eq(jobs.status, "published"),
        ),
      )
      .returning({ id: jobs.id });
    for (const row of expired) {
      await tx.insert(jobStatusHistory).values({
        jobId: row.id,
        fromStatus: "published",
        toStatus: "expired",
        actorId: null,
        reason,
      });
    }
    return expired.length;
  });
}
