import type { NormalizeSkillResult, SkillSource } from "@intgetion/taxonomy";

/** Who is acting; the platform signs the person in and passes these. */
export type JobUser = { id: string; platformRole: string };

export type CompanyForUser = { id: string; origin: string; role: string };

export type JobsPorts = {
  /** platform (auth): an active account by id, or null. */
  activeUser: (userId: string) => Promise<JobUser | null>;
  /** platform: count one hit; throws a 429 HttpError when over the limit. */
  rateLimit: (bucket: string, key: string) => Promise<void>;
  /**
   * moderation: put a job on the review queue. Called inside the job
   * transaction; an in-process adapter writes with `tx`.
   */
  enqueueModeration: (
    input: { entityType: "job"; entityId: string; reason: string; riskFlags: unknown },
    tx?: unknown,
  ) => Promise<void>;
  /** taxonomy: free text to a catalog skill. */
  normalizeSkill: (raw: string, source: SkillSource) => Promise<NormalizeSkillResult>;
  /** taxonomy: catalog skill ids named in a text (D290). */
  extractSkillIds: (text: string) => Promise<string[]>;
  /** companies: membership role and the person's companies. */
  findMemberRole: (companyId: string, userId: string) => Promise<string | null>;
  companiesForUser: (userId: string) => Promise<CompanyForUser[]>;
  /** billing: promoted hire jobs and the team plan. */
  promotedHireJobIds: () => Promise<string[]>;
  companyHasActiveTeam: (companyId: string) => Promise<boolean>;
  /** applications: candidates with an open application, told when a job closes. */
  activeCandidateIds: (jobId: string) => Promise<string[]>;
  /** matching: recompute matches for a newly published job. */
  enqueueMatchJob: (jobId: string) => Promise<void>;
  /** notifications: deliver a notice; failures are logged, never thrown. */
  notify: (type: string, recipientIds: readonly string[], payload: unknown) => Promise<void>;
  /** platform (seo): tell search engines a page changed; fire and forget. */
  submitToIndexNow: (paths: string[]) => Promise<void>;
};

let ports: JobsPorts | null = null;

export function setJobsPorts(next: JobsPorts): void {
  ports = next;
}

export function jobsPorts(): JobsPorts {
  if (!ports) throw new Error("jobs ports are not configured");
  return ports;
}
