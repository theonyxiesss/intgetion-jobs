import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { jobSkills, jobs } from "../../../db";

/** Published jobs that have no skills yet, oldest first (D290). */
export async function listJobsWithoutSkills(
  limit: number,
): Promise<{ id: string; text: string }[]> {
  return getDb()
    .select({
      id: jobs.id,
      text: sql<string>`${jobs.title} || ' ' || ${jobs.description}`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "published"),
        sql`not exists (select 1 from public.job_skills js where js.job_id = ${jobs.id})`,
      ),
    )
    .orderBy(jobs.createdAt)
    .limit(limit);
}

/** Attaches the found skills. Weight 2 — guessed from text, not stated (D290). */
export async function attachJobSkills(
  jobId: string,
  skillIds: readonly string[],
): Promise<void> {
  if (skillIds.length === 0) return;
  await getDb()
    .insert(jobSkills)
    .values(skillIds.map((skillId) => ({ jobId, skillId, weight: 2 })))
    .onConflictDoNothing();
}
