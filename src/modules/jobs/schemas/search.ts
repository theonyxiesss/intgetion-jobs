import { z } from "zod";
import {
  EMPLOYMENT_TYPES,
  JOB_CATEGORIES,
  PERKS,
  SECTORS,
  SENIORITY_LEVELS,
} from "@intgetion/taxonomy/catalog";
import { isValidTimeZone } from "@intgetion/kit";

const csv = (schema: z.ZodType<string>) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(schema).max(20).optional(),
  );

/** Repeated query keys (`sector=web3&sector=defi`) or one comma list. */
const repeated = (schema: z.ZodType<string>) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const source = Array.isArray(value) ? value : [value];
    const items = source
      .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }, z.array(schema).max(20).optional());
export const jobSearchQuery = z
  .object({
    q: z.string().trim().max(200).optional(),
    category: z.enum(JOB_CATEGORIES).optional(),
    sector: repeated(z.enum(SECTORS)),
    seniority: repeated(z.enum(SENIORITY_LEVELS)),
    perk: repeated(z.enum(PERKS)),
    highPay: z.enum(["1", "true"]).optional(),
    nonTechnical: z.enum(["1", "true"]).optional(),
    skills: csv(z.string().uuid()),
    workFormat: csv(z.enum(["remote", "hybrid", "onsite"])),
    employmentType: csv(z.enum(EMPLOYMENT_TYPES)),
    tzOverlapWith: z.string().refine(isValidTimeZone).optional(),
    minOverlap: z.coerce.number().int().min(0).max(12).default(3),
    salaryMin: z
      .string()
      .regex(/^(0|[1-9]\d{0,17})$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    period: z.enum(["hour", "month", "year"]).optional(),
    basis: z.enum(["gross", "net"]).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    source: z.enum(["internal", "imported"]).optional(),
    postedWithin: z.enum(["1", "7", "30"]).transform(Number).optional(),
    sort: z.enum(["relevance", "newest", "salary"]).default("newest"),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((value, ctx) => {
    if (value.salaryMin && !(value.currency && value.period && value.basis))
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "salary_metadata_required",
      });
  });
export type JobSearchQuery = z.infer<typeof jobSearchQuery>;
