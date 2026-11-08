import { jobsPorts } from "../../../ports";
import * as repo from "../repo/skill-backfill-repo";

/**
 * Fills in skills for published jobs that have none (D290). Imported jobs
 * arrive without a skill list, which leaves skill pages, filters and the
 * match score blind. Taxonomy finds the skills; jobs stores them. Returns how
 * much was done, so a scheduler can stop early.
 */
export async function backfillJobSkills(
  batch = 200,
): Promise<{ jobs: number; attached: number }> {
  const pending = await repo.listJobsWithoutSkills(batch);
  if (pending.length === 0) return { jobs: 0, attached: 0 };
  let attached = 0;
  for (const job of pending) {
    const skillIds = await jobsPorts().extractSkillIds(job.text);
    if (skillIds.length === 0) continue;
    await repo.attachJobSkills(job.id, skillIds);
    attached += skillIds.length;
  }
  return { jobs: pending.length, attached };
}
