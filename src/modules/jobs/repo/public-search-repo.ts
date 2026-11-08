import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  companies,
  fxRates,
  importSources,
  jobLanguages,
  jobSkills,
  jobSources,
  jobs,
  skills,
} from "../../../db";

/** Published jobs and the companies that have at least one (homepage telemetry). */
export async function countPublicCatalog() {
  const db = getDb();
  const [jobsRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    );
  const [companiesRow] = await db
    .select({ n: sql<number>`count(distinct ${companies.id})::int` })
    .from(companies)
    .innerJoin(jobs, eq(jobs.companyId, companies.id))
    .where(
      and(
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    );
  return { jobs: jobsRow?.n ?? 0, companies: companiesRow?.n ?? 0 };
}

/** Published jobs grouped by category, busiest first. */
export async function publishedCategoryCounts(limit: number) {
  const rows = await getDb()
    .select({
      category: jobs.category,
      n: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    )
    .groupBy(jobs.category)
    .orderBy(desc(sql`count(*)`), jobs.category)
    .limit(limit);
  return rows.map((row) => ({
    category: row.category,
    count: Number(row.n),
  }));
}

export async function getFxRates() {
  return getDb()
    .select({
      currency: fxRates.currency,
      rateToUsd: fxRates.rateToUsd,
      asOf: fxRates.asOf,
    })
    .from(fxRates)
    .where(gte(fxRates.asOf, sql`current_date - interval '8 days'`));
}
export async function listSearchSkillOptions(locale: string) {
  return getDb()
    .select({
      id: skills.id,
      name: locale === "ru" ? skills.nameRu : skills.nameEn,
    })
    .from(skills)
    .where(eq(skills.isActive, true))
    .orderBy(skills.nameEn)
    .limit(200);
}

export async function searchPublicJobs(query: {
  q?: string;
  category?: string;
  sector?: string[];
  seniority?: string[];
  perk?: string[];
  nonTechnical?: boolean;
  workFormat?: string[];
  employmentType?: string[];
  country?: string;
  source?: string;
  /** Own jobs plus imports from these sources only (D412, D484). */
  syndicatedSources?: readonly string[];
  postedWithin?: number;
  cursor?: {
    publishedAt: string;
    id: string;
    sort?: string;
    rank?: number;
    salary?: string | null;
  };
  limit: number;
  sort: string;
  skills?: string[];
}) {
  const predicates = [
    eq(jobs.status, "published" as const),
    sql`${companies.status} not in ('suspended','rejected')`,
  ];
  if (query.category) predicates.push(eq(jobs.category, query.category));
  if (query.nonTechnical)
    predicates.push(sql`${jobs.category} not in ('engineering', 'data')`);
  if (query.sector?.length)
    predicates.push(
      sql`${jobs.sectors} && array[${sql.join(
        query.sector.map((sector) => sql`${sector}`),
        sql`, `,
      )}]::text[]`,
    );
  if (query.seniority?.length)
    predicates.push(inArray(jobs.seniority, query.seniority as never[]));
  if (query.perk?.length)
    predicates.push(
      sql`${jobs.perks} && array[${sql.join(
        query.perk.map((perk) => sql`${perk}`),
        sql`, `,
      )}]::text[]`,
    );
  if (query.workFormat?.length)
    predicates.push(inArray(jobs.workFormat, query.workFormat as never[]));
  if (query.employmentType?.length)
    predicates.push(
      inArray(jobs.employmentType, query.employmentType as never[]),
    );
  if (query.country)
    predicates.push(
      sql`(${jobs.locationCountry} = ${query.country} or ${query.country} = any(${jobs.countryRestrictions}))`,
    );
  if (query.source)
    predicates.push(eq(jobs.source, query.source as "internal" | "imported"));
  if (query.syndicatedSources)
    predicates.push(
      query.syndicatedSources.length
        ? sql`(${jobs.source} = 'internal' or ${inArray(importSources.name, [...query.syndicatedSources])})`
        : eq(jobs.source, "internal"),
    );
  if (query.postedWithin)
    predicates.push(
      gte(
        jobs.publishedAt,
        sql`now() - (${query.postedWithin}::text || ' days')::interval`,
      ),
    );
  if (query.q)
    predicates.push(
      sql`${jobs.fts} @@ websearch_to_tsquery('simple', ${query.q})`,
    );
  if (query.cursor) {
    if (query.sort === "salary")
      predicates.push(
        sql`(coalesce(${jobs.salaryMax}, ${jobs.salaryMin}, -1), ${jobs.publishedAt}, ${jobs.id}) < (coalesce(${query.cursor.salary}::bigint, -1), ${query.cursor.publishedAt}::timestamptz, ${query.cursor.id}::uuid)`,
      );
    else if (
      query.sort === "relevance" &&
      query.q &&
      query.cursor.rank !== undefined
    )
      predicates.push(
        sql`(ts_rank(${jobs.fts}, websearch_to_tsquery('simple', ${query.q})), ${jobs.publishedAt}, ${jobs.id}) < (${query.cursor.rank}::real, ${query.cursor.publishedAt}::timestamptz, ${query.cursor.id}::uuid)`,
      );
    else
      predicates.push(
        sql`(${jobs.publishedAt}, ${jobs.id}) < (${query.cursor.publishedAt}::timestamptz, ${query.cursor.id}::uuid)`,
      );
  }
  if (query.skills?.length)
    predicates.push(
      ...query.skills.map(
        (skillId) =>
          sql`exists (select 1 from public.job_skills js where js.job_id=${jobs.id} and js.skill_id=${skillId}::uuid)`,
      ),
    );
  const order =
    query.sort === "relevance" && query.q
      ? sql`ts_rank(${jobs.fts}, websearch_to_tsquery('simple', ${query.q})) desc, ${jobs.publishedAt} desc, ${jobs.id} desc`
      : query.sort === "salary"
        ? sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) desc nulls last, ${jobs.publishedAt} desc, ${jobs.id} desc`
        : desc(jobs.publishedAt);
  const rows = await getDb()
    .select({
      job: jobs,
      company: companies,
      sourceName: importSources.name,
      sourceUrl: jobSources.sourceUrl,
      searchRank: query.q
        ? sql<number>`ts_rank(${jobs.fts}, websearch_to_tsquery('simple', ${query.q}))`
        : sql<number>`0`,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(
      jobSources,
      // One source per job on public pages (D71).
      and(eq(jobSources.jobId, jobs.id), eq(jobSources.isPrimary, true)),
    )
    .leftJoin(importSources, eq(importSources.id, jobSources.importSourceId))
    .where(and(...predicates))
    .orderBy(order)
    .limit(query.limit + 1);
  return rows;
}

export async function getPublicJobById(id: string) {
  const [row] = await getDb()
    .select({
      job: jobs,
      company: companies,
      sourceName: importSources.name,
      sourceUrl: jobSources.sourceUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(
      jobSources,
      // One source per job on public pages (D71).
      and(eq(jobSources.jobId, jobs.id), eq(jobSources.isPrimary, true)),
    )
    .leftJoin(importSources, eq(importSources.id, jobSources.importSourceId))
    .where(
      and(
        eq(jobs.id, id),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getJobRequirements(ids: string[]) {
  if (!ids.length) return { skillRows: [], languageRows: [] };
  const [skillRows, languageRows] = await Promise.all([
    getDb()
      .select({
        jobId: jobSkills.jobId,
        id: skills.id,
        nameEn: skills.nameEn,
        nameRu: skills.nameRu,
      })
      .from(jobSkills)
      .innerJoin(skills, eq(skills.id, jobSkills.skillId))
      .where(inArray(jobSkills.jobId, ids)),
    getDb()
      .select({
        jobId: jobLanguages.jobId,
        lang: jobLanguages.lang,
        minLevel: jobLanguages.minLevel,
      })
      .from(jobLanguages)
      .where(inArray(jobLanguages.jobId, ids)),
  ]);
  return { skillRows, languageRows };
}

export async function listCompanyPublicJobs(companyId: string, limit = 20) {
  return getDb()
    .select({
      job: jobs,
      company: companies,
      sourceName: importSources.name,
      sourceUrl: jobSources.sourceUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(
      jobSources,
      // One source per job on public pages (D71).
      and(eq(jobSources.jobId, jobs.id), eq(jobSources.isPrimary, true)),
    )
    .leftJoin(importSources, eq(importSources.id, jobSources.importSourceId))
    .where(
      and(
        eq(jobs.companyId, companyId),
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    )
    .orderBy(desc(jobs.publishedAt))
    .limit(limit);
}

export async function getPublicCompanyBySlug(slug: string) {
  const [company] = await getDb()
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.slug, slug),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    )
    .limit(1);
  return company ?? null;
}

/** Published rows for explicit ids, in arbitrary order (used by /saved-jobs). */
export async function listPublicJobsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select({
      job: jobs,
      company: companies,
      sourceName: importSources.name,
      sourceUrl: jobSources.sourceUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(
      jobSources,
      and(eq(jobSources.jobId, jobs.id), eq(jobSources.isPrimary, true)),
    )
    .leftJoin(importSources, eq(importSources.id, jobSources.importSourceId))
    .where(
      and(
        inArray(jobs.id, ids),
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended','rejected')`,
      ),
    );
}

/** Sitemap rows (D210): published jobs of visible companies, and those companies. */
export async function listSitemapRows(limit: number) {
  const jobRows = await getDb().execute<{ id: string; updated_at: string }>(sql`
    select j.id, j.updated_at
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.status = 'published'
      and c.status not in ('suspended', 'rejected')
    order by j.published_at desc nulls last
    limit ${limit}
  `);
  const companyRows = await getDb().execute<{
    slug: string;
    updated_at: string;
  }>(sql`
    select c.slug, max(j.updated_at) as updated_at
    from public.companies c
    join public.jobs j on j.company_id = c.id and j.status = 'published'
    where c.status not in ('suspended', 'rejected')
    group by c.slug
    limit ${limit}
  `);
  return {
    jobs: jobRows.map((row) => ({
      id: row.id,
      updatedAt: new Date(row.updated_at),
    })),
    companies: companyRows.map((row) => ({
      slug: row.slug,
      updatedAt: new Date(row.updated_at),
    })),
  };
}
