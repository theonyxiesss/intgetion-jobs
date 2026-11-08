import { describe, expect, it } from "vitest";
import {
  pickRelatedJobs,
  type RelatedJobCandidate,
  type RelatedJobSeed,
} from "../service/related-jobs";

const current: RelatedJobSeed = {
  id: "self",
  category: "engineering",
  skillIds: ["react"],
  companyId: "acme",
};

function job(
  partial: Partial<RelatedJobCandidate> & Pick<RelatedJobCandidate, "id">,
): RelatedJobCandidate {
  return {
    category: "design",
    skillIds: [],
    companyId: "other",
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("pickRelatedJobs", () => {
  it("excludes the current id and prefers category, then skill, then company", () => {
    const picked = pickRelatedJobs(current, [
      job({
        id: "self",
        category: "engineering",
        skillIds: ["react"],
        companyId: "acme",
        publishedAt: "2026-10-12T00:00:00.000Z",
      }),
      job({
        id: "latest",
        category: "product",
        publishedAt: "2026-10-12T00:00:00.000Z",
      }),
      job({
        id: "company",
        companyId: "acme",
        publishedAt: "2026-10-11T00:00:00.000Z",
      }),
      job({
        id: "skill",
        skillIds: ["react"],
        publishedAt: "2026-06-01T00:00:00.000Z",
      }),
      job({
        id: "category-old",
        category: "engineering",
        publishedAt: "2026-02-01T00:00:00.000Z",
      }),
      job({
        id: "category-new",
        category: "engineering",
        publishedAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);
    expect(picked.map((item) => item.id)).toEqual([
      "category-new",
      "category-old",
      "skill",
      "company",
    ]);
    expect(picked.map((item) => item.id)).not.toContain("self");
    expect(picked.map((item) => item.id)).not.toContain("latest");
  });

  it("caps overlap at 4", () => {
    const picked = pickRelatedJobs(current, [
      job({
        id: "c1",
        category: "engineering",
        publishedAt: "2026-05-01T00:00:00.000Z",
      }),
      job({
        id: "c2",
        category: "engineering",
        publishedAt: "2026-04-01T00:00:00.000Z",
      }),
      job({
        id: "c3",
        category: "engineering",
        publishedAt: "2026-03-01T00:00:00.000Z",
      }),
      job({
        id: "c4",
        category: "engineering",
        publishedAt: "2026-02-01T00:00:00.000Z",
      }),
      job({
        id: "c5",
        category: "engineering",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
      job({
        id: "newest",
        category: "product",
        publishedAt: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    expect(picked).toHaveLength(4);
    expect(picked.map((item) => item.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("fills from the latest other published jobs when fewer than 3 overlap", () => {
    const picked = pickRelatedJobs(current, [
      job({
        id: "category",
        category: "engineering",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
      job({ id: "new", publishedAt: "2026-10-03T00:00:00.000Z" }),
      job({ id: "mid", publishedAt: "2026-10-02T00:00:00.000Z" }),
      job({ id: "old", publishedAt: "2026-10-01T00:00:00.000Z" }),
      job({ id: "older", publishedAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(picked.map((item) => item.id)).toEqual([
      "category",
      "new",
      "mid",
      "old",
    ]);
  });

  it("returns nothing when no other job is published", () => {
    expect(pickRelatedJobs(current, [])).toEqual([]);
    expect(
      pickRelatedJobs(current, [
        job({
          id: "self",
          category: "engineering",
          skillIds: ["react"],
          companyId: "acme",
        }),
      ]),
    ).toEqual([]);
  });
});
