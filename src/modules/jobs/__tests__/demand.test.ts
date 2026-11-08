import { describe, expect, it } from "vitest";
import { demandSummary } from "../service/demand";

describe("published demand", () => {
  it("names categories by open-job count, highest first", () => {
    expect(
      demandSummary([
        { category: "engineering", count: 12 },
        { category: "design", count: 4 },
      ]),
    ).toBe(
      "Published jobs by category, highest first:\nengineering: 12\ndesign: 4",
    );
  });

  it("does not invent a ranking when nothing is published", () => {
    expect(demandSummary([])).toBe("No published jobs right now.");
  });
});
