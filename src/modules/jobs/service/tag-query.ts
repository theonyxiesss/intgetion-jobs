import { eq } from "drizzle-orm";
import type { CatalogTag } from "@intgetion/taxonomy/catalog";
import { getDb } from "@intgetion/kit";
import { skills } from "../../../db";

/** URL fields a tag page forces on top of the visitor's other filters. */
export async function tagSearchOverrides(
  tag: CatalogTag,
): Promise<Record<string, string> | null> {
  if (tag.kind === "for-you") return null;
  if (tag.kind === "remote") return { workFormat: "remote" };
  if (tag.kind === "non-technical") return { nonTechnical: "1" };
  if (tag.kind === "sector") return { sector: tag.sector };
  if (tag.kind === "category") return { category: tag.category };
  if (tag.kind === "seniority") return { seniority: tag.seniority };
  if (tag.kind === "employment") return { employmentType: tag.employment };
  if (tag.kind === "high-paying") return { highPay: "1", sort: "salary" };
  if (tag.kind === "region")
    return {
      tzOverlapWith: tag.region.timezone,
      minOverlap: String(tag.region.minOverlap),
    };
  const [row] = await getDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, tag.skillSlug))
    .limit(1);
  return row ? { skills: row.id } : null;
}
