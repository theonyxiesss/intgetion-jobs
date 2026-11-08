import { describe, expect, it } from "vitest";
import { catalogTag } from "@intgetion/taxonomy/catalog";
import { tagSearchOverrides } from "../service/tag-query";

describe("tag page filters (D295)", () => {
  it("turns a region into the existing time-zone overlap filter", async () => {
    const tag = catalogTag("europe");
    expect(tag).not.toBeNull();
    await expect(tagSearchOverrides(tag!)).resolves.toEqual({
      tzOverlapWith: "Europe/Berlin",
      minOverlap: "4",
    });
  });

  it("keeps «for you» out of the catalog pages", async () => {
    const tag = catalogTag("for-you");
    await expect(tagSearchOverrides(tag!)).resolves.toBeNull();
  });
});
