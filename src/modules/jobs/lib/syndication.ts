/**
 * Which imported jobs may leave the site through the Telegram channel and
 * the RSS feeds (D412). Remotive and Himalayas forbid passing their jobs to
 * third-party sites; Remote OK's notice says nothing either way, so it stays
 * off. Jobicy lists newsletters and job boards among allowed uses. Snapshot
 * and fixture sources never go out. Our own jobs always may.
 */
export const SYNDICATED_IMPORT_SOURCES: readonly string[] = ["Jobicy"];

export function canSyndicateImportedSource(
  name: string | null | undefined,
): boolean {
  return typeof name === "string" && SYNDICATED_IMPORT_SOURCES.includes(name);
}

/** A job from search results may go into a feed (D412). */
export function canSyndicateJob(job: {
  source: { type: string; name: string | null };
}): boolean {
  return (
    job.source.type !== "imported" ||
    canSyndicateImportedSource(job.source.name)
  );
}
