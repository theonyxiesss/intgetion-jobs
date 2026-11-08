import { z } from "zod";
import { EMPLOYMENT_TYPES } from "@intgetion/taxonomy/catalog";
import { publicHttpUrl } from "@intgetion/companies";
import { currencyExponent } from "@intgetion/kit";
import { SKILL_CATEGORIES } from "@intgetion/taxonomy/catalog";
import type { CreateJobInput } from "./index";

const majorUnits = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,12})$/);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** A platform admin posting from this form goes live. Everyone else waits. */
export function hirePublishesNow(platformRole: string): boolean {
  return platformRole === "admin";
}

/** `coinbase.com` becomes `https://coinbase.com`. */
export function withHttpScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** `@name` or `name` becomes a public profile URL. Empty stays empty. */
export function socialProfileUrl(
  kind: "x" | "telegram",
  raw: string | undefined,
): string | null {
  const handle = raw?.trim().replace(/^@/, "") ?? "";
  if (!handle) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) return null;
  return kind === "x" ? `https://x.com/${handle}` : `https://t.me/${handle}`;
}

export function majorUnitsToMinor(amount: string, currency: string): string {
  const exponent = currencyExponent(currency);
  return (BigInt(amount) * BigInt(10) ** BigInt(exponent)).toString();
}

export const hireInput = z
  .object({
    companyId: z.string().uuid().nullable().optional(),
    companyName: z.string().trim().min(2).max(160),
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(50).max(20000),
    category: z.enum(SKILL_CATEGORIES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    location: optionalText(200),
    salaryMin: majorUnits,
    salaryMax: majorUnits,
    salaryCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/),
    salaryPeriod: z.enum(["month", "year"]),
    countries: z
      .array(z.string().regex(/^[A-Za-z]{2}$/))
      .max(100)
      .optional(),
    applicationMethod: z.enum(["internal", "email", "external_url"]),
    applicationEmail: z.string().trim().email().max(320).optional(),
    applicationUrl: optionalText(2048),
    website: optionalText(2048),
    xHandle: optionalText(40),
    telegram: optionalText(40),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    questions: z.array(z.string().trim().max(300)).max(3).optional(),
  })
  .superRefine((value, context) => {
    const currency = value.salaryCurrency.toUpperCase();
    const min = BigInt(majorUnitsToMinor(value.salaryMin, currency));
    const max = BigInt(majorUnitsToMinor(value.salaryMax, currency));
    if (min > max) {
      context.addIssue({
        code: "custom",
        path: ["salaryMax"],
        message: "salary_range_invalid",
      });
    }
    if (value.applicationMethod === "email" && !value.applicationEmail) {
      context.addIssue({
        code: "custom",
        path: ["applicationEmail"],
        message: "application_email_required",
      });
    }
    if (value.applicationMethod === "external_url") {
      const url = publicHttpUrl(withHttpScheme(value.applicationUrl ?? ""));
      if (!url) {
        context.addIssue({
          code: "custom",
          path: ["applicationUrl"],
          message: "application_url_required",
        });
      }
    }
    if (value.website && !publicHttpUrl(withHttpScheme(value.website))) {
      context.addIssue({
        code: "custom",
        path: ["website"],
        message: "http_url_required",
      });
    }
    if (value.xHandle?.trim() && !socialProfileUrl("x", value.xHandle)) {
      context.addIssue({
        code: "custom",
        path: ["xHandle"],
        message: "handle_invalid",
      });
    }
    if (
      value.telegram?.trim() &&
      !socialProfileUrl("telegram", value.telegram)
    ) {
      context.addIssue({
        code: "custom",
        path: ["telegram"],
        message: "handle_invalid",
      });
    }
    const description = descriptionWithQuestions(
      value.description,
      value.questions ?? [],
    );
    if (description.length > 20000) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "description_too_long",
      });
    }
  });

export type HireInput = z.infer<typeof hireInput>;

export function descriptionWithQuestions(
  description: string,
  questions: readonly string[],
): string {
  const lines = questions
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (lines.length === 0) return description.trim();
  return `${description.trim()}\n\n${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
}

/** Fields the existing job writer already accepts. Salary is minor units. */
export function hireToJobFields(
  input: HireInput,
  companyId: string,
): CreateJobInput {
  const currency = input.salaryCurrency.toUpperCase();
  const location = input.location?.trim() || null;
  const countries = [
    ...new Set((input.countries ?? []).map((code) => code.toUpperCase())),
  ];
  return {
    companyId,
    title: input.title.trim(),
    description: descriptionWithQuestions(
      input.description,
      input.questions ?? [],
    ),
    category: input.category,
    employmentType: input.employmentType,
    workFormat: location ? "onsite" : "remote",
    location,
    countryRestrictions: countries.length ? countries : null,
    salaryMin: majorUnitsToMinor(input.salaryMin, currency),
    salaryMax: majorUnitsToMinor(input.salaryMax, currency),
    salaryCurrency: currency,
    salaryPeriod: input.salaryPeriod,
    salaryBasis: "gross",
    applicationMethod: input.applicationMethod,
    applicationEmail:
      input.applicationMethod === "email"
        ? input.applicationEmail!.toLowerCase()
        : null,
    applicationUrl:
      input.applicationMethod === "external_url"
        ? publicHttpUrl(withHttpScheme(input.applicationUrl ?? ""))
        : null,
    skills: [],
    languages: [],
    minOverlapHours: 3,
  };
}
