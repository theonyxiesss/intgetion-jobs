import { formatMoneyDto } from "@intgetion/kit";
import { siteUrl } from "@intgetion/kit";
import { canSyndicateJob } from "../lib/syndication";
import { PRODUCT_NAME } from "@intgetion/kit";
import type { JobSearchQuery } from "../schemas/search";
import { searchJobs } from "./public-search";
import { buildRss, type RssChannel } from "./rss";
import { intlLocale } from "@intgetion/kit";

/** Last 50 published jobs for an RSS channel. No personalization. */
export async function renderJobFeed(
  query: JobSearchQuery,
  locale: string,
  channel: Pick<RssChannel, "title" | "description" | "selfPath">,
) {
  const result = await searchJobs(
    { ...query, limit: 50, cursor: undefined },
    locale,
  );
  const money = intlLocale(locale);
  const xml = buildRss(
    {
      title: channel.title,
      description: channel.description,
      siteUrl: siteUrl(),
      locale,
      selfPath: channel.selfPath,
    },
    // D412: imported jobs only from sources that allow third-party sites.
    result.items.filter(canSyndicateJob).map((job) => ({
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      publishedAt: job.publishedAt,
      salary: job.salaryMin ? formatMoneyDto(job.salaryMin, money) : null,
      categories: job.sectors,
    })),
  );
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=600",
    },
  });
}

export function catalogFeedTitle(locale: string) {
  const word =
    (
      {
        ru: "вакансии",
        es: "empleos",
        "pt-BR": "vagas",
        de: "Jobs",
        fr: "offres",
        it: "offerte",
      } as Record<string, string>
    )[locale] ?? "jobs";
  return `${PRODUCT_NAME}: ${word}`;
}
