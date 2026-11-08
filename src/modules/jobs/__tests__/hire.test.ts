import { describe, expect, it } from "vitest";
import {
  descriptionWithQuestions,
  hireInput,
  hirePublishesNow,
  hireToJobFields,
  majorUnitsToMinor,
  socialProfileUrl,
} from "../schemas/hire";

const base = {
  companyName: "CryptoCoin",
  title: "Solidity Engineer",
  description:
    "Build and review smart contracts for a remote protocol team that ships every week.",
  category: "engineering" as const,
  employmentType: "full_time" as const,
  salaryMin: "90000",
  salaryMax: "140000",
  salaryCurrency: "USD",
  salaryPeriod: "year" as const,
  applicationMethod: "email" as const,
  applicationEmail: "jobs@example.com",
  firstName: "Vitalik",
  lastName: "Buterin",
};

describe("hire form (D391)", () => {
  it("turns a blank location into remote and stores salary in minor units", () => {
    const parsed = hireInput.parse(base);
    const job = hireToJobFields(parsed, "11111111-1111-4111-8111-111111111111");
    expect(job.workFormat).toBe("remote");
    expect(job.location).toBeNull();
    expect(job.salaryMin).toBe(majorUnitsToMinor("90000", "USD"));
    expect(job.salaryMin).toBe("9000000");
    expect(job.salaryBasis).toBe("gross");
    expect(job.applicationEmail).toBe("jobs@example.com");
  });

  it("keeps a filled location and appends up to three questions", () => {
    const parsed = hireInput.parse({
      ...base,
      location: "Berlin",
      applicationMethod: "internal",
      applicationEmail: undefined,
      questions: ["  Why this role? ", "", "A second question"],
    });
    const job = hireToJobFields(parsed, "11111111-1111-4111-8111-111111111111");
    expect(job.workFormat).toBe("onsite");
    expect(job.location).toBe("Berlin");
    expect(
      job.description.endsWith("1. Why this role?\n2. A second question"),
    ).toBe(true);
    expect(
      descriptionWithQuestions("Hello there, this is long enough.", []),
    ).toBe("Hello there, this is long enough.");
  });

  it("rejects a reversed salary and a missing apply target", () => {
    expect(
      hireInput.safeParse({ ...base, salaryMin: "200", salaryMax: "10" })
        .success,
    ).toBe(false);
    expect(
      hireInput.safeParse({
        ...base,
        applicationMethod: "external_url",
        applicationUrl: "",
      }).success,
    ).toBe(false);
    expect(hirePublishesNow("admin")).toBe(true);
    expect(hirePublishesNow("user")).toBe(false);
    expect(socialProfileUrl("telegram", "@vitalik")).toBe(
      "https://t.me/vitalik",
    );
    expect(socialProfileUrl("x", "ab")).toBeNull();
  });
});
