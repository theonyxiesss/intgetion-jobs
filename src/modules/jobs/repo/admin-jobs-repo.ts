import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { companies, jobStatusHistory, jobs } from "../../../db";
import { HttpError, notFound } from "@intgetion/kit";

/** Admin views of jobs (10A): every source and status, with the company. */
const adminJobColumns = {
  id: jobs.id,
  title: jobs.title,
  status: jobs.status,
  source: jobs.source,
  riskScore: jobs.riskScore,
  riskFlags: jobs.riskFlags,
  companyId: companies.id,
  companyName: companies.name,
  companyStatus: companies.status,
  createdAt: jobs.createdAt,
  createdBy: jobs.createdBy,
};

export type AdminJobRow = {
  id: string;
  title: string;
  status: (typeof jobs.$inferSelect)["status"];
  source: (typeof jobs.$inferSelect)["source"];
  riskScore: number;
  riskFlags: unknown;
  companyId: string;
  companyName: string;
  companyStatus: (typeof companies.$inferSelect)["status"];
  createdAt: Date;
  createdBy: string | null;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listJobsForAdmin(input: {
  limit: number;
  cursor?: { createdAt: Date; id: string };
  q?: string;
  status?: AdminJobRow["status"];
  source?: AdminJobRow["source"];
}): Promise<AdminJobRow[]> {
  const filters = [
    input.q ? ilike(jobs.title, `%${escapeLike(input.q)}%`) : undefined,
    input.status ? eq(jobs.status, input.status) : undefined,
    input.source ? eq(jobs.source, input.source) : undefined,
    input.cursor
      ? or(
          lt(jobs.createdAt, input.cursor.createdAt),
          and(
            eq(jobs.createdAt, input.cursor.createdAt),
            lt(jobs.id, input.cursor.id),
          ),
        )
      : undefined,
  ].filter((filter): filter is SQL => filter !== undefined);
  return getDb()
    .select(adminJobColumns)
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(input.limit);
}

export async function findJobsForAdmin(ids: string[]): Promise<AdminJobRow[]> {
  if (!ids.length) return [];
  return getDb()
    .select(adminJobColumns)
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(inArray(jobs.id, ids));
}

/**
 * Admin removal of any job, internal or imported (section 7
 * `POST /api/admin/jobs/:id/remove`). A removed job stays removed.
 */
export async function removeJobByAdmin(
  jobId: string,
  adminId: string,
  reason: string,
) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!row) throw notFound();
    if (row.status === "removed") {
      throw new HttpError(409, "INVALID_TRANSITION", "Job is already removed");
    }
    await tx
      .update(jobs)
      .set({ status: "removed", updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), ne(jobs.status, "removed")));
    await tx.insert(jobStatusHistory).values({
      jobId,
      fromStatus: row.status,
      toStatus: "removed",
      actorId: adminId,
      reason,
    });
    return { from: row.status, to: "removed" as const };
  });
}

/**
 * An admin overrules the automatic scam rejection of an imported job
 * (false positive): removed → published, risk cleared (D74, 14.4).
 */
export async function republishImportedJob(jobId: string, adminId: string) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ status: jobs.status, source: jobs.source })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!row || row.source !== "imported") throw notFound();
    if (row.status !== "removed") return null;
    const now = new Date();
    await tx
      .update(jobs)
      .set({
        status: "published",
        publishedAt: now,
        riskScore: 0,
        riskFlags: [],
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));
    await tx.insert(jobStatusHistory).values({
      jobId,
      fromStatus: "removed",
      toStatus: "published",
      actorId: adminId,
      reason: "moderation_approved",
    });
    return { from: "removed" as const, to: "published" as const };
  });
}

/**
 * 14.5 auto-pause: every published job of the company becomes `paused`,
 * with history. Returns the paused job ids.
 */
export async function pausePublishedJobsOfCompany(
  companyId: string,
  actorId: string,
  reason: string,
): Promise<string[]> {
  return getDb().transaction(async (tx) => {
    const paused = await tx
      .update(jobs)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(jobs.companyId, companyId), eq(jobs.status, "published")))
      .returning({ id: jobs.id });
    if (paused.length) {
      await tx.insert(jobStatusHistory).values(
        paused.map((row) => ({
          jobId: row.id,
          fromStatus: "published" as const,
          toStatus: "paused" as const,
          actorId,
          reason,
        })),
      );
    }
    return paused.map((row) => row.id);
  });
}
