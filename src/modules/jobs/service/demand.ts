import * as repo from "../repo/public-search-repo";

/** What Spoki may say about open jobs. Counts come from published rows only. */
export function demandSummary(
  rows: readonly { category: string; count: number }[],
): string {
  if (rows.length === 0) return "No published jobs right now.";
  const lines = rows.map((row) => `${row.category}: ${row.count}`).join("\n");
  return `Published jobs by category, highest first:\n${lines}`;
}

export async function publishedDemand(limit = 5) {
  return repo.publishedCategoryCounts(limit);
}
