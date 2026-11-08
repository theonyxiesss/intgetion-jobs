import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  companies,
  companyMembers,
  jobLanguages,
  jobSkills,
  jobStatusHistory,
  jobs,
} from "../../../db";
import { isSensitiveSector } from "@intgetion/taxonomy/catalog";
import { notFound } from "@intgetion/kit";
import { jobsPorts, type JobUser as CurrentUser } from "../../../ports";
import type { CreateJobInput, PatchJobInput } from "../schemas";
import {
  hasScamPattern,
  isFreeEmailDomain,
  scoreJobRisk,
} from "../service/risk-score";
import {
  transitionJob,
  type JobAction,
  type JobStatus,
} from "../service/status-machine";

export type JobRow = typeof jobs.$inferSelect;
type CompanyRow = Pick<
  typeof companies.$inferSelect,
  "id" | "domain" | "status" | "origin"
>;
type SkillLevel = "novice" | "intermediate" | "advanced" | "expert";

function host(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function getRisk(
  user: CurrentUser,
  email: string | null | undefined,
  company: CompanyRow,
  input: Pick<
    CreateJobInput,
    | "title"
    | "description"
    | "applicationUrl"
    | "salaryMax"
    | "salaryCurrency"
    | "salaryPeriod"
    | "salaryBasis"
    | "category"
    | "sectors"
  >,
  tx = getDb(),
  newJob = false,
) {
  const [creator] = await tx.execute<{ created_at: Date }>(
    sql`select created_at from public.users where id = ${user.id}`,
  );
  const [countRow] = await tx.execute<{ count: number }>(
    sql`select count(*)::int as count from public.jobs where company_id = ${company.id} and created_at >= now() - interval '24 hours'`,
  );
  const [similar] = await tx.execute<{ exists: boolean }>(
    sql`select exists(select 1 from public.jobs where company_id <> ${company.id} and public.skill_similarity(description, ${input.description}) >= 0.9) as exists`,
  );
  let salaryOutlier = false;
  if (
    input.salaryMax &&
    input.salaryCurrency &&
    input.salaryPeriod &&
    input.salaryBasis
  ) {
    const [median] = await tx.execute<{ outlier: boolean | null }>(sql`
      select ${BigInt(input.salaryMax)}::numeric > percentile_cont(0.5) within group (order by salary_max::numeric) * 3 as outlier
      from public.jobs where category = ${input.category} and salary_max is not null
        and salary_currency = ${input.salaryCurrency} and salary_period = ${input.salaryPeriod} and salary_basis = ${input.salaryBasis}
    `);
    salaryOutlier = Boolean(median?.outlier);
  }
  const appHost = host(input.applicationUrl);
  const companyHost =
    company.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const mismatch = Boolean(
    appHost &&
    companyHost &&
    appHost !== companyHost &&
    !appHost.endsWith(`.${companyHost}`),
  );
  return scoreJobRisk({
    creatorAgeHours: creator
      ? (Date.now() - new Date(creator.created_at).getTime()) / 3_600_000
      : 0,
    freeEmailDomain: isFreeEmailDomain(email),
    companyJobsLast24Hours: Number(countRow?.count ?? 0) + Number(newJob),
    similarDescriptionInOtherCompany: Boolean(similar?.exists),
    applicationDomainMismatch: mismatch,
    scamPattern: hasScamPattern(`${input.title}\n${input.description}`),
    salaryOutlier,
    sensitiveSector: isSensitiveSector(input.sectors ?? []),
  });
}

type DbTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
async function resolveSkills(
  skills: CreateJobInput["skills"] | PatchJobInput["skills"] = [],
) {
  const resolved: {
    skillId: string;
    weight: 1 | 2 | 3;
    minLevel: SkillLevel | null;
  }[] = [];
  for (const item of skills ?? []) {
    const normalized =
      !item.skillId && item.name
        ? await jobsPorts().normalizeSkill(item.name, "user")
        : null;
    const skillId =
      item.skillId ??
      (normalized?.result === "matched" ? normalized.skillId : undefined);
    if (skillId)
      resolved.push({
        skillId,
        weight: item.weight,
        minLevel: item.minLevel ?? null,
      });
  }
  return resolved;
}

async function replaceRequirements(
  tx: DbTransaction,
  jobId: string,
  input:
    | Pick<CreateJobInput, "skills" | "languages">
    | Pick<PatchJobInput, "skills" | "languages">,
  resolvedSkills: Awaited<ReturnType<typeof resolveSkills>> = [],
) {
  if (input.skills !== undefined) {
    await tx.delete(jobSkills).where(eq(jobSkills.jobId, jobId));
    if (resolvedSkills.length)
      await tx
        .insert(jobSkills)
        .values(resolvedSkills.map((item) => ({ jobId, ...item })));
  }
  if (input.languages !== undefined) {
    await tx.delete(jobLanguages).where(eq(jobLanguages.jobId, jobId));
    if (input.languages.length)
      await tx.insert(jobLanguages).values(
        input.languages.map((item) => ({
          jobId,
          lang: item.lang,
          minLevel: item.minLevel,
        })),
      );
  }
}

function jobValues(input: Partial<CreateJobInput>) {
  const values = { ...input };
  delete values.skills;
  delete values.languages;
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  if (values.salaryMin !== undefined)
    result.salaryMin =
      values.salaryMin == null ? null : BigInt(values.salaryMin);
  if (values.salaryMax !== undefined)
    result.salaryMax =
      values.salaryMax == null ? null : BigInt(values.salaryMax);
  if (values.salaryCurrency !== undefined)
    result.salaryCurrency = values.salaryCurrency?.toUpperCase() ?? null;
  if (values.locationCountry !== undefined)
    result.locationCountry = values.locationCountry?.toUpperCase() ?? null;
  if (values.countryRestrictions !== undefined)
    result.countryRestrictions =
      values.countryRestrictions?.map((country) => country.toUpperCase()) ??
      null;
  if (values.applicationEmail !== undefined)
    result.applicationEmail = values.applicationEmail?.toLowerCase() ?? null;
  return result as Partial<typeof jobs.$inferInsert>;
}

export async function createJob(
  user: CurrentUser,
  email: string | null | undefined,
  input: CreateJobInput,
) {
  const db = getDb();
  const [company] = await db
    .select({
      id: companies.id,
      domain: companies.domain,
      status: companies.status,
      origin: companies.origin,
    })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);
  if (!company || company.origin === "imported") throw notFound();
  await jobsPorts().rateLimit(
    company.status === "verified" ? "jobCreateVerified" : "jobCreateUnverified",
    company.id,
  );
  const risk = await getRisk(user, email, company, input, db, true);
  const resolvedSkills = await resolveSkills(input.skills);
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({
        ...jobValues(input),
        companyId: company.id,
        createdBy: user.id,
        riskScore: risk.score,
        riskFlags: risk.flags,
      } as typeof jobs.$inferInsert)
      .returning();
    if (!job) throw new Error("Job insert returned no row");
    await replaceRequirements(tx, job.id, input, resolvedSkills);
    await tx.insert(jobStatusHistory).values({
      jobId: job.id,
      fromStatus: null,
      toStatus: "draft",
      actorId: user.id,
      reason: "created",
    });
    return job;
  });
}

export async function findOwnedJob(jobId: string, userId: string) {
  const [row] = await getDb()
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(
      companyMembers,
      and(
        eq(companyMembers.companyId, jobs.companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.source, "internal"),
        eq(companies.origin, "internal"),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return { ...row.job, company: row.company };
}

export async function listJobsForUser(userId: string, companyId?: string) {
  return getDb()
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(
      companyMembers,
      and(
        eq(companyMembers.companyId, jobs.companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(jobs.source, "internal"),
        eq(companies.origin, "internal"),
        companyId ? eq(jobs.companyId, companyId) : undefined,
      ),
    )
    .orderBy(desc(jobs.updatedAt));
}

export async function updateJob(
  jobId: string,
  input: PatchJobInput,
  user: CurrentUser,
  email?: string | null,
) {
  const db = getDb();
  const [before] = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.source, "internal"),
        eq(companies.origin, "internal"),
      ),
    )
    .limit(1);
  if (!before) throw notFound();
  const risk = await getRisk(user, email, before.company, {
    ...before.job,
    ...input,
  } as CreateJobInput);
  const resolvedSkills =
    input.skills === undefined ? [] : await resolveSkills(input.skills);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ job: jobs, company: companies })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.source, "internal"),
          eq(companies.origin, "internal"),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw notFound();
    const nextStatus = transitionJob({
      status: existing.job.status,
      action: "edit",
      actor: "member",
      companyStatus: existing.company.status,
      riskScore: risk.score,
      sensitiveSector: isSensitiveSector(input.sectors ?? existing.job.sectors),
      source: existing.job.source,
    });
    const [updated] = await tx
      .update(jobs)
      .set({
        ...jobValues(input),
        riskScore: risk.score,
        riskFlags: risk.flags,
        status: nextStatus,
      })
      .where(eq(jobs.id, jobId))
      .returning();
    if (!updated) throw notFound();
    await replaceRequirements(tx, jobId, input, resolvedSkills);
    if (nextStatus !== existing.job.status) {
      await tx.insert(jobStatusHistory).values({
        jobId,
        fromStatus: existing.job.status,
        toStatus: nextStatus,
        actorId: user.id,
        reason: "unverified_company_job_edit",
      });
      await jobsPorts().enqueueModeration(
        {
          entityType: "job",
          entityId: jobId,
          reason: "unverified_company_job_edit",
          riskFlags: risk.flags,
        },
        tx,
      );
    }
    return updated;
  });
}

export async function transitionOwnedJob(
  jobId: string,
  action: JobAction,
  actorId: string,
  role: "member" | "admin" | "system" = "member",
  reason?: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: jobs, company: companies })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.source, "internal"),
          eq(companies.origin, "internal"),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw notFound();
    const nextStatus = transitionJob({
      status: row.job.status,
      action,
      actor: role,
      companyStatus: row.company.status,
      riskScore: row.job.riskScore,
      sensitiveSector: isSensitiveSector(row.job.sectors),
      source: row.job.source,
      reason,
    });
    const now = new Date();
    const [updated] = await tx
      .update(jobs)
      .set({
        status: nextStatus,
        ...(nextStatus === "published"
          ? {
              publishedAt: now,
              expiresAt: new Date(now.getTime() + 30 * 86400000),
            }
          : {}),
      })
      .where(eq(jobs.id, jobId))
      .returning();
    if (!updated) throw notFound();
    await tx.insert(jobStatusHistory).values({
      jobId,
      fromStatus: row.job.status,
      toStatus: nextStatus,
      actorId: actorId || null,
      reason: reason ?? action,
    });
    if (nextStatus === "pending_moderation") {
      await jobsPorts().enqueueModeration(
        {
          entityType: "job",
          entityId: jobId,
          reason: "job_publish_review",
          riskFlags: row.job.riskFlags,
        },
        tx,
      );
    }
    return updated;
  });
}

/** Published jobs that expire within the next three days (section 15). */
export async function listJobsExpiring(now = new Date()) {
  const until = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return getDb()
    .select({
      id: jobs.id,
      title: jobs.title,
      createdBy: jobs.createdBy,
      expiresAt: jobs.expiresAt,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "published"),
        gt(jobs.expiresAt, now),
        lte(jobs.expiresAt, until),
      ),
    );
}

export async function expireJobs(now = new Date()) {
  const rows = await getDb().execute<{ id: string; status: JobStatus }>(sql`
    with expired as (
      update public.jobs set status = 'expired'
      where status = 'published' and expires_at <= ${now.toISOString()} and source = 'internal'
      returning id
    ), history as (
      insert into public.job_status_history (job_id, from_status, to_status, actor_id, reason)
      select id, 'published', 'expired', null, 'expired_by_cron' from expired returning job_id
    ) select id, 'expired'::public.job_status as status from expired
  `);
  return rows.length;
}
