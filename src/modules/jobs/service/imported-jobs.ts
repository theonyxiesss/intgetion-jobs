import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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

/** Columns read back from an existing job: never description or fts, which
 * are most of a row (Supabase egress quota). The description is compared by
 * its md5. */
const previousColumns = {
  id: jobs.id,
  source: jobs.source,
  status: jobs.status,
  publishedAt: jobs.publishedAt,
  companyId: jobs.companyId,
  title: jobs.title,
  descriptionMd5: sql<string>`md5(${jobs.description})`,
  category: jobs.category,
  employmentType: jobs.employmentType,
  sectors: jobs.sectors,
  seniority: jobs.seniority,
  perks: jobs.perks,
  workFormat: jobs.workFormat,
  location: jobs.location,
  locationCountry: jobs.locationCountry,
  countryRestrictions: jobs.countryRestrictions,
  timezoneRequired: jobs.timezoneRequired,
  applicationUrl: jobs.applicationUrl,
  expiresAt: jobs.expiresAt,
  riskScore: jobs.riskScore,
  riskFlags: jobs.riskFlags,
};

const md5 = (text: string) =>
  createHash("md5").update(text, "utf8").digest("hex");

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return (a ?? null) === (b ?? null);
}

export type SavedImportedJob = { id: string; status: JobStatus };

/**
 * Writes normalized ingestion output (8A). Only imported jobs: an internal
 * job is never overwritten, and employers cannot edit these (D9). A job a
 * person removed, closed or paused is left untouched (D412). A job whose
 * content, status and skills did not change is not rewritten: feeds repeat
 * the same records every run.
 */
export async function saveImportedJob(
  input: ImportedJobWrite,
): Promise<SavedImportedJob> {
  return getDb().transaction(async (tx) => {
    const [previous] = input.jobId
      ? await tx
          .select(previousColumns)
          .from(jobs)
          .where(eq(jobs.id, input.jobId))
          .limit(1)
      : [];
    if (previous && previous.source !== "imported") {
      throw new Error("Imported jobs cannot overwrite an internal job");
    }
    const status = importedStatusAfterFeed({
      previous: previous?.status ?? null,
      next: input.status,
      sensitive: isSensitiveSector(input.sectors ?? []),
    });
    if (previous && status === null) {
      return { id: previous.id, status: previous.status };
    }
    if (status === null) throw new Error("A new imported job needs a status");
    const now = new Date();
    const removed = status === "removed";
    const content = {
      companyId: input.companyId,
      title: input.title,
      category: input.category,
      employmentType: input.employmentType,
      sectors: input.sectors ?? [],
      seniority: input.seniority ?? null,
      perks: input.perks ?? [],
      ...importedPlace(input),
      timezoneRequired: input.timeZone,
      applicationUrl: input.applyUrl,
      status,
      expiresAt: input.expiresAt,
      riskScore: removed ? 4 : 0,
      riskFlags: removed ? [input.reason] : [],
    };
    const skillIds = [...new Set(input.skillIds)];

    if (previous) {
      const unchanged =
        previous.descriptionMd5 === md5(input.description) &&
        (Object.keys(content) as (keyof typeof content)[]).every((key) =>
          same(previous[key], content[key]),
        );
      if (unchanged) {
        const current = await tx
          .select({ skillId: jobSkills.skillId })
          .from(jobSkills)
          .where(eq(jobSkills.jobId, previous.id));
        const currentIds = new Set(current.map((row) => row.skillId));
        const skillsSame =
          currentIds.size === skillIds.length &&
          skillIds.every((id) => currentIds.has(id));
        if (skillsSame) return { id: previous.id, status: previous.status };
      }
    }

    const values = {
      ...content,
      description: input.description,
      applicationMethod: "external_url" as const,
      source: "imported" as const,
      publishedAt:
        status === "published" ? (previous?.publishedAt ?? now) : null,
      importedAt: now,
      createdBy: null,
    };
    const saved = { id: jobs.id, status: jobs.status };
    const [job] = previous
      ? await tx
          .update(jobs)
          .set({ ...values, updatedAt: now })
          .where(eq(jobs.id, previous.id))
          .returning(saved)
      : await tx.insert(jobs).values(values).returning(saved);
    if (!job) throw new Error("Imported job write returned no row");

    await tx.delete(jobSkills).where(eq(jobSkills.jobId, job.id));
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
