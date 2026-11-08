import { HttpError } from "@intgetion/kit";

export type JobStatus =
  | "draft"
  | "pending_moderation"
  | "published"
  | "paused"
  | "expired"
  | "closed"
  | "removed";
export type JobAction =
  | "publish"
  | "pause"
  | "close"
  | "extend"
  | "approve"
  | "reject"
  | "expire"
  | "remove"
  | "edit";
export type JobActor = "member" | "admin" | "system";

export const JOB_TRANSITIONS: Record<
  JobAction,
  Partial<Record<JobStatus, JobStatus>>
> = {
  publish: { draft: "published" },
  pause: { published: "paused" },
  close: { published: "closed", paused: "closed" },
  extend: { paused: "published", expired: "published" },
  approve: { pending_moderation: "published" },
  reject: { pending_moderation: "draft" },
  expire: { published: "expired" },
  remove: {
    draft: "removed",
    pending_moderation: "removed",
    published: "removed",
    paused: "removed",
    expired: "removed",
    closed: "removed",
  },
  edit: {
    draft: "draft",
    pending_moderation: "pending_moderation",
    published: "published",
    paused: "paused",
  },
};

export function transitionJob(input: {
  status: JobStatus;
  action: JobAction;
  actor: JobActor;
  companyStatus?:
    | "unverified"
    | "pending_verification"
    | "verified"
    | "rejected"
    | "suspended";
  riskScore?: number;
  /** igaming / memecoins stay in the queue even for a verified company (D205). */
  sensitiveSector?: boolean;
  source?: "internal" | "imported";
  reason?: string;
}): JobStatus {
  if (input.source === "imported" && input.actor === "member") {
    throw new HttpError(404, "NOT_FOUND", "Job not found");
  }
  const isAdminAction =
    input.action === "approve" ||
    input.action === "reject" ||
    input.action === "remove";
  if (
    (isAdminAction && input.actor !== "admin") ||
    (input.action === "expire" && input.actor !== "system") ||
    (!isAdminAction && input.action !== "expire" && input.actor !== "member")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Role cannot transition this job");
  }
  if (input.action === "reject" && !input.reason?.trim())
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "A rejection reason is required",
    );
  const next = JOB_TRANSITIONS[input.action][input.status];
  if (!next)
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Cannot ${input.action} a ${input.status} job`,
    );
  if (input.action === "publish" || input.action === "extend") {
    if (input.actor !== "member")
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only a company member can publish or extend a job",
      );
    if (
      input.companyStatus === "rejected" ||
      input.companyStatus === "suspended"
    )
      throw new HttpError(403, "FORBIDDEN", "This company cannot publish jobs");
    // D391: a member never puts an internal job on the public list.
    // Only an admin `approve` does. Imported jobs do not use this action.
    return "pending_moderation";
  }
  if (
    input.action === "edit" &&
    input.status === "published" &&
    (input.sensitiveSector ||
      input.companyStatus !== "verified" ||
      (input.riskScore ?? 0) >= 4)
  )
    return "pending_moderation";
  return next;
}
