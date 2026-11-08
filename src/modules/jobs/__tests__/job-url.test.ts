import { describe, expect, it } from "vitest";
import { createCompanyInput } from "@intgetion/companies";
import { jobFields } from "../schemas";

describe("http job and company links", () => {
  it("rejects an apply address that is not http or https", () => {
    const parsed = jobFields.shape.applicationUrl.safeParse(
      "javascript:alert(1)",
    );
    expect(parsed.success).toBe(false);
    expect(
      jobFields.shape.applicationUrl.safeParse("https://example.com/apply")
        .success,
    ).toBe(true);
  });

  it("rejects a company site that is not http or https", () => {
    const parsed = createCompanyInput.safeParse({
      name: "Acme",
      websiteUrl: "javascript:alert(1)",
    });
    expect(parsed.success).toBe(false);
  });
});
