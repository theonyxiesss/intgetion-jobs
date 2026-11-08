import { jobSearchQuery } from "../schemas/search";
import { searchJobs } from "./public-search";

type Viewer = Parameters<typeof searchJobs>[2];

/** Published jobs like this one (D242), the job itself excluded. */
export async function findSimilarJobs(
  job: { id: string; category: string; skills: { id: string }[] },
  locale: string,
  viewer: Viewer = { hidden: null },
  limit = 4,
) {
  const base = { category: job.category, limit: String(limit + 1) };
  // Category plus the main skill first; the category alone tops it up.
  const queries = job.skills[0]
    ? [{ ...base, skills: job.skills[0].id }, base]
    : [base];
  const found = new Map<
    string,
    Awaited<ReturnType<typeof searchJobs>>["items"][number]
  >();
  for (const raw of queries) {
    const parsed = jobSearchQuery.safeParse(raw);
    if (!parsed.success) continue;
    const result = await searchJobs(parsed.data, locale, viewer);
    for (const item of result.items) {
      if (item.id !== job.id && !found.has(item.id)) found.set(item.id, item);
    }
    if (found.size >= limit) break;
  }
  return [...found.values()].slice(0, limit);
}
