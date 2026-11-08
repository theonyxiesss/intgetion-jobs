import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { EMPLOYMENT_TYPES } from "@intgetion/taxonomy/catalog";
import { getDb } from "@intgetion/kit";
import { jobDrafts } from "../../../db";
import {
  HttpError,
  notFound,
  unauthenticated,
  validationError,
} from "@intgetion/kit";
import { SKILL_CATEGORIES } from "@intgetion/taxonomy/catalog";
import { hireInput } from "../schemas/hire";

export type JobDraft = Record<string, unknown>;
export type JobDraftView = {
  id: string;
  draft: JobDraft;
  missingRequired: string[];
  formMissingRequired: string[];
  status: "draft" | "submitting" | "submitted";
  submittedJobId: string | null;
};

const chatRequired = [
  "companyName",
  "title",
  "description",
  "category",
  "employmentType",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
  "applicationMethod",
] as const;

/** What a job listing needs from the chat; Spoki shows progress (D523). */
export const JOB_DRAFT_REQUIRED: readonly string[] = chatRequired;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const patchSchema = z
  .object({
    companyName: z.string().trim().min(2).max(160).nullable().optional(),
    title: z.string().trim().min(3).max(140).nullable().optional(),
    description: z.string().trim().min(50).max(20000).nullable().optional(),
    category: z.enum(SKILL_CATEGORIES).nullable().optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
    location: optionalText(200),
    salaryMin: z
      .string()
      .regex(/^(0|[1-9]\d{0,12})$/)
      .nullable()
      .optional(),
    salaryMax: z
      .string()
      .regex(/^(0|[1-9]\d{0,12})$/)
      .nullable()
      .optional(),
    salaryCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .nullable()
      .optional(),
    salaryPeriod: z.enum(["month", "year"]).nullable().optional(),
    countries: z
      .array(z.string().regex(/^[A-Za-z]{2}$/))
      .max(100)
      .nullable()
      .optional(),
    applicationMethod: z
      .enum(["internal", "email", "external_url"])
      .nullable()
      .optional(),
    applicationEmail: z.string().trim().email().max(320).nullable().optional(),
    applicationUrl: optionalText(2048),
    website: optionalText(2048),
    xHandle: optionalText(40),
    telegram: optionalText(40),
    firstName: z.string().trim().min(1).max(80).nullable().optional(),
    lastName: z.string().trim().min(1).max(80).nullable().optional(),
    questions: z.array(z.string().trim().max(300)).max(3).nullable().optional(),
  })
  .strict();

export function mergeJobDraft(current: JobDraft, patch: JobDraft): JobDraft {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ),
  };
}

export function missingJobDraftFields(draft: JobDraft): string[] {
  return chatRequired.filter((key) => {
    const value = draft[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/** Only these non-contact facts are available to the model in draft context. */
export function jobDraftForModel(draft: JobDraft): JobDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([key]) =>
        ![
          "applicationEmail",
          "applicationUrl",
          "website",
          "xHandle",
          "telegram",
          "firstName",
          "lastName",
        ].includes(key),
    ),
  );
}

export function missingJobFormFields(draft: JobDraft): string[] {
  const parsed = hireInput.safeParse(draft);
  if (parsed.success) return [];
  return [
    ...new Set(
      parsed.error.issues
        .map((issue) => String(issue.path[0] ?? "form"))
        .filter((key) => key !== "companyId"),
    ),
  ];
}

async function owned(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(jobDrafts)
    .where(and(eq(jobDrafts.id, id), eq(jobDrafts.userId, userId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function readJobDraft(
  userId: string | null,
  draftId?: string,
): Promise<JobDraftView> {
  if (!userId) throw unauthenticated();
  const db = getDb();
  let row = draftId ? await owned(userId, draftId) : undefined;
  if (!row) {
    [row] = await db
      .select()
      .from(jobDrafts)
      .where(eq(jobDrafts.userId, userId))
      .orderBy(desc(jobDrafts.updatedAt))
      .limit(1);
  }
  if (!row) {
    [row] = await db
      .insert(jobDrafts)
      .values({ userId, draft: {} })
      .returning();
  }
  const draft = (row.draft ?? {}) as JobDraft;
  return {
    id: row.id,
    draft,
    missingRequired: missingJobDraftFields(draft),
    formMissingRequired: missingJobFormFields(draft),
    status: row.status,
    submittedJobId: row.submittedJobId,
  };
}

export async function patchJobDraft(
  userId: string | null,
  input: { draftId?: string; patch: JobDraft },
): Promise<JobDraftView> {
  if (!userId) throw unauthenticated();
  const parsed = patchSchema.safeParse(input.patch);
  if (!parsed.success)
    throw validationError(
      parsed.error.issues.map((issue) => ({
        path: String(issue.path[0] ?? "patch"),
        problem: "invalid",
      })),
    );
  const view = await readJobDraft(userId, input.draftId);
  const [row] = await getDb()
    .select()
    .from(jobDrafts)
    .where(and(eq(jobDrafts.id, view.id), eq(jobDrafts.userId, userId)))
    .limit(1);
  if (!row) throw notFound();
  if (row.status !== "draft")
    throw new HttpError(
      409,
      "CONFLICT",
      "This job draft is no longer editable",
    );
  const draft = mergeJobDraft(row.draft as JobDraft, parsed.data);
  await getDb()
    .update(jobDrafts)
    .set({ draft, updatedAt: new Date() })
    .where(and(eq(jobDrafts.id, row.id), eq(jobDrafts.userId, userId)));
  return {
    id: row.id,
    draft,
    missingRequired: missingJobDraftFields(draft),
    formMissingRequired: missingJobFormFields(draft),
    status: "draft",
    submittedJobId: null,
  };
}

export async function resetJobDraft(userId: string | null, draftId?: string) {
  if (!userId) throw unauthenticated();
  const view = await readJobDraft(userId, draftId);
  await getDb()
    .update(jobDrafts)
    .set({
      draft: {},
      status: "draft",
      submittedJobId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobDrafts.id, view.id), eq(jobDrafts.userId, userId)));
  return readJobDraft(userId, view.id);
}

export function validateJobDraftPatch(patch: JobDraft) {
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}
