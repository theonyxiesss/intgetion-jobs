import { SYNDICATED_IMPORT_SOURCES } from "../lib/syndication";
import { HIGH_PAY_USD_YEAR } from "@intgetion/taxonomy/catalog";
import { publicHttpUrl } from "@intgetion/companies";
import {
  compareSalaries,
  jobSalaryReference,
  toMoneyDto,
  type FxRate,
} from "@intgetion/kit";
import { workHoursOverlap } from "@intgetion/kit";
import { jobsPorts } from "../../../ports";
import * as repo from "../repo/public-search-repo";
import type { JobSearchQuery } from "../schemas/search";

type PublicRow = Omit<
  Awaited<ReturnType<typeof repo.searchPublicJobs>>[number],
  "searchRank"
> & { searchRank?: number };
type Requirements = {
  skills: Array<{ id: string; nameEn: string; nameRu: string }>;
  languages: Array<{ lang: string; minLevel: string }>;
};
function cursorEncode(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function cursorDecode(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      publishedAt?: unknown;
      id?: unknown;
      sort?: unknown;
      rank?: unknown;
      salary?: unknown;
    };
    if (
      typeof value.publishedAt !== "string" ||
      typeof value.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    )
      throw new Error();
    if (!Number.isFinite(Date.parse(value.publishedAt))) throw new Error();
    if (
      value.sort !== undefined &&
      !["newest", "relevance", "salary"].includes(String(value.sort))
    )
      throw new Error();
    if (
      value.rank !== undefined &&
      (typeof value.rank !== "number" || !Number.isFinite(value.rank))
    )
      throw new Error();
    if (
      value.salary !== undefined &&
      value.salary !== null &&
      (typeof value.salary !== "string" || !/^\d+$/.test(value.salary))
    )
      throw new Error();
    return {
      publishedAt: value.publishedAt,
      id: value.id,
      sort: value.sort as string | undefined,
      rank: value.rank as number | undefined,
      salary: value.salary as string | null | undefined,
    };
  } catch {
    throw new Error("invalid_cursor");
  }
}

export function toPublicJobDto(
  row: PublicRow,
  requirements: Requirements = { skills: [], languages: [] },
  locale = "en",
) {
  const { job, company } = row;
  const info = {
    currency: job.salaryCurrency,
    period: job.salaryPeriod,
    basis: job.salaryBasis,
  };
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    category: job.category,
    workFormat: job.workFormat,
    employmentType: job.employmentType,
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    location: job.location,
    locationCountry: job.locationCountry?.trim() ?? null,
    countryRestrictions: job.countryRestrictions?.map((v) => v.trim()) ?? null,
    timezoneRequired: job.timezoneRequired,
    workHoursStart: job.workHoursStart,
    workHoursEnd: job.workHoursEnd,
    minOverlapHours: job.minOverlapHours,
    salaryMin:
      job.salaryMin === null || !info.currency || !info.period || !info.basis
        ? null
        : toMoneyDto(job.salaryMin, info.currency, info.period, info.basis),
    salaryMax:
      job.salaryMax === null || !info.currency || !info.period || !info.basis
        ? null
        : toMoneyDto(job.salaryMax, info.currency, info.period, info.basis),
    salaryComparable: null as boolean | null,
    applicationMethod:
      job.source === "imported" ? "external_url" : job.applicationMethod,
    applicationUrl: publicHttpUrl(
      job.source === "imported" ? row.sourceUrl : job.applicationUrl,
    ),
    source:
      job.source === "imported"
        ? {
            type: "imported",
            name: row.sourceName,
            url: publicHttpUrl(row.sourceUrl),
          }
        : { type: "internal", name: null, url: null },
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      logoPath: company.logoPath,
      websiteUrl: company.websiteUrl ?? null,
      linkedinUrl: company.linkedinUrl ?? null,
      telegramUrl: company.telegramUrl ?? null,
      xUrl: company.xUrl ?? null,
      description: company.description ?? null,
      status: company.status,
      isTrusted: company.isTrusted,
    },
    skills: requirements.skills.slice(0, 6).map((skill) => ({
      id: skill.id,
      name: locale === "ru" ? skill.nameRu : skill.nameEn,
    })),
    skillsMore: Math.max(0, requirements.skills.length - 6),
    languages: requirements.languages,
    seniority: job.seniority,
    sectors: job.sectors ?? [],
    perks: job.perks ?? [],
    publishedAt: job.publishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    promoted: false,
  };
}

const HIGH_PAY_MINOR = BigInt(HIGH_PAY_USD_YEAR) * BigInt(100);

/** Upper bound of a gross year/month range, in USD, at or above the preset. */
export function meetsHighPay(
  row: PublicRow,
  rates: readonly FxRate[],
  now: Date,
): boolean {
  const { job } = row;
  const amount = job.salaryMax ?? job.salaryMin;
  const currency = job.salaryCurrency?.trim();
  if (
    amount === null ||
    !currency ||
    !job.salaryPeriod ||
    job.salaryBasis !== "gross" ||
    job.salaryPeriod === "hour"
  ) {
    return false;
  }
  const comparison = compareSalaries(
    {
      amountMinor: amount,
      currency,
      period: job.salaryPeriod,
      basis: "gross",
    },
    {
      amountMinor: HIGH_PAY_MINOR,
      currency: "USD",
      period: "year",
      basis: "gross",
    },
    rates,
    now,
  );
  return (
    comparison.comparable &&
    comparison.jobMonthlyMinor >= comparison.candMonthlyMinor
  );
}

export function salaryDecision(
  row: PublicRow,
  query: JobSearchQuery,
  rates: readonly FxRate[],
  now: Date,
) {
  if (!query.salaryMin || !query.currency || !query.period || !query.basis)
    return { include: true, comparable: null };
  const { job } = row;
  if (!job.salaryCurrency || !job.salaryPeriod || !job.salaryBasis)
    return { include: true, comparable: false };
  const reference = jobSalaryReference(job.salaryMin, job.salaryMax);
  if (reference === null) return { include: true, comparable: false };
  const comparison = compareSalaries(
    {
      amountMinor: reference,
      currency: job.salaryCurrency,
      period: job.salaryPeriod,
      basis: job.salaryBasis,
    },
    {
      amountMinor: BigInt(query.salaryMin),
      currency: query.currency,
      period: query.period,
      basis: query.basis,
    },
    rates,
    now,
  );
  if (!comparison.comparable) return { include: true, comparable: false };
  return {
    include: comparison.jobMonthlyMinor >= comparison.candMonthlyMinor,
    comparable: true,
  };
}

export interface SearchViewer {
  /** Hidden jobs and companies of the logged-in viewer (4B, section 7).
   * Structurally identical to feedback's HiddenSets, imported nowhere to
   * keep the module dependency one-way. */
  hidden: {
    hiddenJobIds: ReadonlySet<string>;
    hiddenCompanyIds: ReadonlySet<string>;
  } | null;
  /**
   * A third party reads the results (an outside assistant over MCP): own
   * jobs and imports whose source allows other sites only (D412, D484).
   * Filtered in the query, so a page is never emptied by closed sources.
   */
  syndicatedOnly?: boolean;
}

export async function searchJobs(
  query: JobSearchQuery,
  locale = "en",
  viewer: SearchViewer = { hidden: null },
) {
  const cursor = cursorDecode(query.cursor);
  if (cursor?.sort && cursor.sort !== query.sort)
    throw new Error("invalid_cursor");
  const fetchLimit = Math.min(
    250,
    query.limit *
      (query.tzOverlapWith || query.salaryMin || query.highPay ? 5 : 1) +
      1,
  );
  const rows = await repo.searchPublicJobs({
    ...query,
    nonTechnical: query.nonTechnical !== undefined,
    ...(viewer.syndicatedOnly
      ? { syndicatedSources: SYNDICATED_IMPORT_SOURCES }
      : {}),
    cursor,
    limit: fetchLimit,
  });
  const fx = query.salaryMin || query.highPay ? await repo.getFxRates() : [];
  const rates: FxRate[] = fx.map((r) => ({
    currency: r.currency.trim(),
    rateToUsd: r.rateToUsd,
    asOf: r.asOf,
  }));
  const now = new Date();
  const filtered: Array<{ row: PublicRow; comparable: boolean | null }> = [];
  for (const row of rows) {
    if (
      viewer.hidden?.hiddenJobIds.has(row.job.id) ||
      viewer.hidden?.hiddenCompanyIds.has(row.company.id)
    ) {
      continue;
    }
    const salary = salaryDecision(row, query, rates, now);
    if (!salary.include) continue;
    if (query.highPay && !meetsHighPay(row, rates, now)) continue;
    if (query.tzOverlapWith) {
      const overlap = workHoursOverlap({
        candidate: {
          timeZone: query.tzOverlapWith,
          start: "09:00",
          end: "18:00",
          workDays: [1, 2, 3, 4, 5],
        },
        job: {
          timeZone: row.job.timezoneRequired ?? "UTC",
          start: row.job.workHoursStart?.slice(0, 5) ?? undefined,
          end: row.job.workHoursEnd?.slice(0, 5) ?? undefined,
        },
        from: now,
        days: 14,
      });
      if (overlap.averageOverlapMinutes < query.minOverlap * 60) continue;
    }
    filtered.push({ row, comparable: salary.comparable });
    if (filtered.length >= query.limit + 1) break;
  }
  const selected = filtered.slice(0, query.limit);
  const requirements = await repo.getJobRequirements(
    selected.map(({ row }) => row.job.id),
  );
  let promotedIds = new Set<string>();
  try {
    promotedIds = new Set(await jobsPorts().promotedHireJobIds());
  } catch {
    promotedIds = new Set();
  }
  const items = selected.map(({ row, comparable }) => {
    const skills = requirements.skillRows.filter(
      (skill) => skill.jobId === row.job.id,
    );
    const languages = requirements.languageRows
      .filter((language) => language.jobId === row.job.id)
      .map(({ lang, minLevel }) => ({ lang: lang.trim(), minLevel }));
    return {
      ...toPublicJobDto(row, { skills, languages }, locale),
      salaryComparable: comparable,
      promoted: promotedIds.has(row.job.id),
    };
  });
  const cursorRow =
    filtered.length > query.limit
      ? selected.at(-1)?.row
      : rows.length > fetchLimit
        ? rows.at(-1)
        : undefined;
  const cursorJob = cursorRow?.job;
  const nextCursor = cursorJob?.publishedAt
    ? cursorEncode({
        publishedAt: cursorJob.publishedAt.toISOString(),
        id: cursorJob.id,
        sort: query.sort,
        ...(query.sort === "salary"
          ? {
              salary:
                (cursorJob.salaryMax ?? cursorJob.salaryMin)?.toString() ??
                null,
            }
          : {}),
        ...(query.sort === "relevance" && query.q
          ? { rank: cursorRow?.searchRank }
          : {}),
      })
    : null;
  return { items, nextCursor };
}

/** Hire jobs inside the 7-day promoted window, newest payment first. */
export async function listPromotedJobs(
  locale = "en",
  viewer: SearchViewer = { hidden: null },
) {
  let ids: string[] = [];
  try {
    ids = await jobsPorts().promotedHireJobIds();
  } catch {
    return [];
  }
  const visible = ids.filter((id) => !viewer.hidden?.hiddenJobIds.has(id));
  if (visible.length === 0) return [];
  const rows = await repo.listPublicJobsByIds(visible);
  const requirements = await repo.getJobRequirements(visible);
  const order = new Map(visible.map((id, index) => [id, index]));
  return rows
    .filter(
      (row) =>
        row.job.source === "internal" &&
        !viewer.hidden?.hiddenCompanyIds.has(row.company.id),
    )
    .map((row) => {
      const skills = requirements.skillRows.filter(
        (skill) => skill.jobId === row.job.id,
      );
      const languages = requirements.languageRows
        .filter((language) => language.jobId === row.job.id)
        .map(({ lang, minLevel }) => ({ lang: lang.trim(), minLevel }));
      return {
        ...toPublicJobDto(row, { skills, languages }, locale),
        promoted: true,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function countPublicCatalog() {
  return repo.countPublicCatalog();
}

export async function getJobForPublic(
  id: string,
  options: { userId?: string; isAdmin?: boolean; locale?: string } = {},
) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await repo.getPublicJobById(id);
  if (!row) return null;
  if (row.job.status !== "published") {
    if (
      !options.userId ||
      !(
        options.isAdmin ||
        (await jobsPorts().findMemberRole(row.company.id, options.userId))
      )
    )
      return null;
  }
  const req = await repo.getJobRequirements([row.job.id]);
  return toPublicJobDto(
    row,
    {
      skills: req.skillRows,
      languages: req.languageRows.map(({ lang, minLevel }) => ({
        lang: lang.trim(),
        minLevel,
      })),
    },
    options.locale,
  );
}

export async function listPublishedJobsForCompany(
  companyId: string,
  locale = "en",
  viewer: SearchViewer = { hidden: null },
) {
  const rows = await repo.listCompanyPublicJobs(companyId);
  const visible = viewer.hidden
    ? rows.filter(
        (row) =>
          !viewer.hidden!.hiddenJobIds.has(row.job.id) &&
          !viewer.hidden!.hiddenCompanyIds.has(row.company.id),
      )
    : rows;
  const req = await repo.getJobRequirements(visible.map(({ job }) => job.id));
  return visible.map((row) =>
    toPublicJobDto(
      row,
      {
        skills: req.skillRows.filter((skill) => skill.jobId === row.job.id),
        languages: req.languageRows
          .filter((language) => language.jobId === row.job.id)
          .map(({ lang, minLevel }) => ({ lang: lang.trim(), minLevel })),
      },
      locale,
    ),
  );
}

export async function listPublicJobsByIds(ids: string[], locale = "en") {
  const rows = await repo.listPublicJobsByIds(ids);
  const req = await repo.getJobRequirements(rows.map(({ job }) => job.id));
  return rows.map((row) =>
    toPublicJobDto(
      row,
      {
        skills: req.skillRows.filter((skill) => skill.jobId === row.job.id),
        languages: req.languageRows
          .filter((language) => language.jobId === row.job.id)
          .map(({ lang, minLevel }) => ({ lang: lang.trim(), minLevel })),
      },
      locale,
    ),
  );
}

export async function getVisibleCompany(slug: string) {
  return repo.getPublicCompanyBySlug(slug);
}
export async function listSearchSkillOptions(locale: string) {
  return repo.listSearchSkillOptions(locale);
}

/** Sitemap entries (D210); a sitemap file holds at most 50 000 URLs. */
export async function listSitemapEntries(limit = 20_000) {
  return repo.listSitemapRows(limit);
}

/**
 * A job that was public and is not any more (D292): what is needed to offer
 * the visitor something else. Null for a job that was never published, so a
 * draft never leaks through the 404 page.
 */
export async function getClosedJobContext(
  id: string,
): Promise<{ category: string; skillIds: string[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await repo.getPublicJobById(id);
  if (!row || row.job.status === "published" || !row.job.publishedAt) {
    return null;
  }
  const { skillRows } = await repo.getJobRequirements([row.job.id]);
  return {
    category: row.job.category,
    skillIds: skillRows.map((skill) => skill.id),
  };
}
