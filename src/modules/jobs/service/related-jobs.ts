import { jobSearchQuery } from "../schemas/search";
import { listPublishedJobsForCompany, searchJobs } from "./public-search";

type Viewer = Parameters<typeof searchJobs>[2];
type CatalogJob = Awaited<ReturnType<typeof searchJobs>>["items"][number];

export type RelatedJobSeed = {
  id: string;
  category: string;
  skillIds: readonly string[];
  companyId: string;
};

export type RelatedJobCandidate = RelatedJobSeed & {
  publishedAt: string | null;
};

const RELATED_CAP = 4;
/** Overlap below this is topped up from the newest other published jobs. */
const RELATED_MIN_OVERLAP = 3;

/**
 * 0 same category, 1 a shared skill, 2 the same company, 3 no overlap.
 * Category wins when a job matches more than one.
 */
export function relatedJobTier(
  current: RelatedJobSeed,
  job: RelatedJobCandidate,
): number {
  if (job.category === current.category) return 0;
  if (job.skillIds.some((id) => current.skillIds.includes(id))) return 1;
  if (job.companyId === current.companyId) return 2;
  return 3;
}

function byNewest(a: RelatedJobCandidate, b: RelatedJobCandidate): number {
  const at = a.publishedAt ?? "";
  const bt = b.publishedAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/** Other published jobs to link, or [] when this is the only one. */
export function pickRelatedJobs<T extends RelatedJobCandidate>(
  current: RelatedJobSeed,
  candidates: readonly T[],
  limit = RELATED_CAP,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const job of candidates) {
    if (job.id === current.id || seen.has(job.id)) continue;
    seen.add(job.id);
    unique.push(job);
  }
  if (unique.length === 0) return [];
  const ranked = [...unique].sort((a, b) => {
    const tier = relatedJobTier(current, a) - relatedJobTier(current, b);
    return tier === 0 ? byNewest(a, b) : tier;
  });
  const overlap = ranked.filter((job) => relatedJobTier(current, job) < 3);
  const chosen =
    overlap.length >= RELATED_MIN_OVERLAP
      ? overlap
      : [
          ...overlap,
          ...ranked.filter((job) => relatedJobTier(current, job) === 3),
        ];
  return chosen.slice(0, limit);
}

type RankedJob = CatalogJob & RelatedJobCandidate;

function overlapCount(current: RelatedJobSeed, jobs: Iterable<RankedJob>) {
  let count = 0;
  for (const job of jobs) {
    if (relatedJobTier(current, job) < 3) count += 1;
  }
  return count;
}

/**
 * Published jobs to show under this one (D394). Queries run one after another
 * (D247). Imported jobs are included; the caller does not add JobPosting.
 */
export async function findRelatedPublishedJobs(
  job: {
    id: string;
    category: string;
    skills: { id: string }[];
    company: { id: string };
  },
  locale: string,
  viewer: Viewer = { hidden: null },
  limit = RELATED_CAP,
): Promise<CatalogJob[]> {
  const current: RelatedJobSeed = {
    id: job.id,
    category: job.category,
    skillIds: job.skills.map((skill) => skill.id),
    companyId: job.company.id,
  };
  const found = new Map<string, RankedJob>();

  const remember = (
    items: CatalogJob[],
    extraSkillIds: readonly string[] = [],
  ) => {
    for (const item of items) {
      if (item.id === current.id) continue;
      const prev = found.get(item.id);
      const skillIds = [
        ...new Set([
          ...(prev?.skillIds ?? []),
          ...item.skills.map((skill) => skill.id),
          ...extraSkillIds,
        ]),
      ];
      found.set(item.id, {
        ...(prev ?? item),
        skillIds,
        companyId: item.company.id,
      });
    }
  };

  const search = async (raw: Record<string, string>) => {
    const parsed = jobSearchQuery.safeParse(raw);
    if (!parsed.success) return [];
    return (await searchJobs(parsed.data, locale, viewer)).items;
  };

  remember(
    await search({
      category: job.category,
      limit: String(limit + 1),
      sort: "newest",
    }),
  );

  for (const skillId of current.skillIds) {
    if (overlapCount(current, found.values()) >= limit) break;
    remember(
      await search({
        skills: skillId,
        limit: String(limit + 1),
        sort: "newest",
      }),
      [skillId],
    );
  }

  if (overlapCount(current, found.values()) < limit) {
    const companyJobs = await listPublishedJobsForCompany(
      job.company.id,
      locale,
      viewer,
    );
    remember(
      companyJobs.map((item) => ({
        ...item,
        salaryComparable: null,
        promoted: false,
      })),
    );
  }

  if (overlapCount(current, found.values()) < RELATED_MIN_OVERLAP) {
    remember(await search({ limit: String(limit + 1), sort: "newest" }));
  }

  return pickRelatedJobs(current, [...found.values()], limit);
}
