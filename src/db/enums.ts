import { pgEnum } from "drizzle-orm/pg-core";

export const jobStatus = pgEnum("job_status", [
  "draft",
  "pending_moderation",
  "published",
  "paused",
  "expired",
  "closed",
  "removed",
]);
export const jobSource = pgEnum("job_source", ["internal", "imported"]);
export const applicationMethod = pgEnum("application_method", ["internal", "external_url", "email"]);
export const cefrLevel = pgEnum("cefr_level", ["A1", "A2", "B1", "B2", "C1", "C2", "native"]);
/** Shared with candidates. */
export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
]);
export const jobSeniority = pgEnum("job_seniority", ["internship", "entry", "mid", "senior", "lead"]);
export const salaryPeriod = pgEnum("salary_period", ["hour", "month", "year"]);
export const salaryBasis = pgEnum("salary_basis", ["gross", "net"]);
export const skillLevel = pgEnum("skill_level", ["novice", "intermediate", "advanced", "expert"]);
export const workFormat = pgEnum("work_format", ["remote", "hybrid", "onsite"]);
/** Owned by companies; used by the read-only companies view. */
export const companyStatus = pgEnum("company_status", [
  "unverified",
  "pending_verification",
  "verified",
  "rejected",
  "suspended",
]);
export const companyOrigin = pgEnum("company_origin", ["internal", "imported"]);
export const companySize = pgEnum("company_size", [
  "s1_10",
  "s11_50",
  "s51_200",
  "s201_1000",
  "s1000_plus",
]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "recruiter", "member"]);
