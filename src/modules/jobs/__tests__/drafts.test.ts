import { describe, expect, it } from "vitest";
import {
  jobDraftForModel,
  mergeJobDraft,
  missingJobDraftFields,
  missingJobFormFields,
} from "../service/drafts";

describe("shared job draft (D494)", () => {
  it("merges only supplied values and ignores nulls", () => {
    expect(
      mergeJobDraft(
        { title: "Designer", description: "A role" },
        { title: "Senior designer", description: null, salaryMin: "60000" },
      ),
    ).toEqual({
      title: "Senior designer",
      description: "A role",
      salaryMin: "60000",
    });
  });

  it("reports only absent public brief facts and lets the form own contact gaps", () => {
    const draft = {
      companyName: "Example",
      title: "Designer",
      description: "Create useful product experiences for our customers.",
      category: "design",
      employmentType: "full_time",
    };
    expect(missingJobDraftFields(draft)).toEqual([
      "salaryMin",
      "salaryMax",
      "salaryCurrency",
      "salaryPeriod",
      "applicationMethod",
    ]);
    expect(missingJobFormFields(draft)).toContain("firstName");
  });

  it("never exposes application contacts or manager names to the model", () => {
    expect(
      jobDraftForModel({
        title: "Designer",
        applicationEmail: "private@example.test",
        applicationUrl: "https://private.example.test/apply",
        website: "https://company.example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        applicationMethod: "internal",
      }),
    ).toEqual({ title: "Designer", applicationMethod: "internal" });
  });
});
