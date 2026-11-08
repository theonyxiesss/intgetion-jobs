import { jobsPorts } from "../../../ports";
import { createJob } from "../repo/jobs-repo";
import { hirePublishesNow } from "../schemas/hire";
import type { CreateJobInput } from "../schemas";
import { transitionOwnedJob } from "./notify-job";

type PosterCompany = { id: string; origin: string; role: string };

/** The company a Team member may post into. An owner wins over another poster. */
export function pickPosterCompany(
  companies: readonly PosterCompany[],
): string | null {
  const posters = companies.filter(
    (company) =>
      company.origin === "internal" &&
      (company.role === "owner" ||
        company.role === "admin" ||
        company.role === "recruiter"),
  );
  return (
    (posters.find((company) => company.role === "owner") ?? posters[0])?.id ??
    null
  );
}

export type TeamJobBrief = {
  title: string;
  criteria: string;
  category: CreateJobInput["category"];
  employmentType: CreateJobInput["employmentType"];
  skills?: string[];
};

/** A described hire becomes one remote job people apply to on this site. */
export function teamJobFields(
  companyId: string,
  brief: TeamJobBrief,
): CreateJobInput {
  return {
    companyId,
    title: brief.title.trim(),
    description: brief.criteria.trim(),
    category: brief.category,
    employmentType: brief.employmentType,
    workFormat: "remote",
    applicationMethod: "internal",
    skills: (brief.skills ?? [])
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((name) => ({ name, weight: 2 as const })),
    languages: [],
    minOverlapHours: 3,
  };
}

/**
 * Team plan only (D411). The job waits for an admin, same as the hire form,
 * unless this person is a platform admin.
 */
export async function queueTeamJobBrief(userId: string, brief: TeamJobBrief) {
  const companyId = pickPosterCompany(await jobsPorts().companiesForUser(userId));
  if (!companyId) return { posted: false as const, reason: "company" as const };
  if (!(await jobsPorts().companyHasActiveTeam(companyId)))
    return { posted: false as const, reason: "plan" as const };
  const user = await jobsPorts().activeUser(userId);
  if (!user) return { posted: false as const, reason: "account" as const };
  const created = await createJob(user, null, teamJobFields(companyId, brief));
  const queued = await transitionOwnedJob(created.id, "publish", user.id);
  if (!hirePublishesNow(user.platformRole)) {
    return {
      posted: true as const,
      status: queued.status,
      title: queued.title,
    };
  }
  const live = await transitionOwnedJob(queued.id, "approve", user.id, "admin");
  return { posted: true as const, status: live.status, title: live.title };
}
