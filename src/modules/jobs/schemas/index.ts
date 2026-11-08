import { z } from "zod";
import { publicHttpUrl } from "@intgetion/companies";
import { isValidTimeZone } from "@intgetion/kit";
import {
  EMPLOYMENT_TYPES,
  MAX_JOB_PERKS,
  MAX_JOB_SECTORS,
  PERKS,
  SECTORS,
  SENIORITY_LEVELS,
} from "@intgetion/taxonomy/catalog";
import { SKILL_CATEGORIES } from "@intgetion/taxonomy/catalog";

const minor = z
  .string()
  .regex(/^(0|[1-9]\d{0,17})$/)
  .nullable()
  .optional();
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const skillInput = z
  .object({
    skillId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(500).optional(),
    weight: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    minLevel: z
      .enum(["novice", "intermediate", "advanced", "expert"])
      .nullable()
      .optional(),
  })
  .refine(
    (value) => Boolean(value.skillId || value.name),
    "skillId or name is required",
  );
const languageInput = z.object({
  lang: z.string().regex(/^[a-z]{2}$/),
  minLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
});
const ianaTimezone = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimeZone, "invalid_iana_timezone");

export const jobFields = z.object({
  companyId: z.string().uuid(),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(50).max(20000),
  category: z.enum(SKILL_CATEGORIES),
  workFormat: z.enum(["remote", "hybrid", "onsite"]).default("remote"),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITY_LEVELS).nullable().optional(),
  sectors: z.array(z.enum(SECTORS)).max(MAX_JOB_SECTORS).optional(),
  perks: z.array(z.enum(PERKS)).max(MAX_JOB_PERKS).optional(),
  experienceMin: z.number().int().min(0).max(60).nullable().optional(),
  experienceMax: z.number().int().min(0).max(60).nullable().optional(),
  location: optionalText(200),
  locationCountry: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .optional(),
  countryRestrictions: z
    .array(z.string().regex(/^[A-Za-z]{2}$/))
    .max(100)
    .nullable()
    .optional(),
  timezoneRequired: ianaTimezone.nullable().optional(),
  workHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  workHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  minOverlapHours: z.number().int().min(0).max(12).default(3),
  salaryMin: minor,
  salaryMax: minor,
  salaryCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  salaryPeriod: z.enum(["hour", "month", "year"]).nullable().optional(),
  salaryBasis: z.enum(["gross", "net"]).nullable().optional(),
  applicationMethod: z.enum(["internal", "external_url", "email"]),
  applicationUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => publicHttpUrl(value) !== null, "http_url_required")
    .nullable()
    .optional(),
  applicationEmail: z.string().email().max(320).nullable().optional(),
  skills: z.array(skillInput).max(50).default([]),
  languages: z.array(languageInput).max(20).default([]),
});

export const createJobInput = jobFields
  .refine((value) => value.workFormat === "remote" || Boolean(value.location), {
    path: ["location"],
    message: "location_required_for_onsite_or_hybrid",
  })
  .refine(
    (value) =>
      value.experienceMin == null ||
      value.experienceMax == null ||
      value.experienceMin <= value.experienceMax,
    {
      path: ["experienceMax"],
      message: "experience_range_invalid",
    },
  )
  .refine(
    (value) =>
      value.salaryMin == null ||
      value.salaryMax == null ||
      BigInt(value.salaryMin) <= BigInt(value.salaryMax),
    {
      path: ["salaryMax"],
      message: "salary_range_invalid",
    },
  )
  .refine(
    (value) =>
      (value.salaryMin == null && value.salaryMax == null) ||
      Boolean(value.salaryCurrency && value.salaryPeriod && value.salaryBasis),
    {
      path: ["salaryCurrency"],
      message: "salary_metadata_required",
    },
  )
  .refine(
    (value) =>
      value.applicationMethod !== "external_url" ||
      Boolean(value.applicationUrl),
    {
      path: ["applicationUrl"],
      message: "application_url_required",
    },
  )
  .refine(
    (value) =>
      value.applicationMethod !== "email" || Boolean(value.applicationEmail),
    {
      path: ["applicationEmail"],
      message: "application_email_required",
    },
  );

export const patchJobInput = jobFields
  .omit({ companyId: true })
  .partial()
  .extend({
    skills: jobFields.shape.skills.optional(),
    languages: jobFields.shape.languages.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.experienceMin != null &&
      value.experienceMax != null &&
      value.experienceMin > value.experienceMax
    ) {
      context.addIssue({
        code: "custom",
        path: ["experienceMax"],
        message: "experience_range_invalid",
      });
    }
    if (
      value.salaryMin != null &&
      value.salaryMax != null &&
      BigInt(value.salaryMin) > BigInt(value.salaryMax)
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryMax"],
        message: "salary_range_invalid",
      });
    }
    if (
      (value.salaryMin != null || value.salaryMax != null) &&
      (!value.salaryCurrency || !value.salaryPeriod || !value.salaryBasis)
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryCurrency"],
        message: "salary_metadata_required",
      });
    }
    if (value.workFormat && value.workFormat !== "remote" && !value.location) {
      context.addIssue({
        code: "custom",
        path: ["location"],
        message: "location_required_for_onsite_or_hybrid",
      });
    }
    if (value.applicationMethod === "external_url" && !value.applicationUrl) {
      context.addIssue({
        code: "custom",
        path: ["applicationUrl"],
        message: "application_url_required",
      });
    }
    if (value.applicationMethod === "email" && !value.applicationEmail) {
      context.addIssue({
        code: "custom",
        path: ["applicationEmail"],
        message: "application_email_required",
      });
    }
  });

export type CreateJobInput = z.infer<typeof createJobInput>;
export type PatchJobInput = z.infer<typeof patchJobInput>;
