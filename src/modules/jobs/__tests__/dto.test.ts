import { describe, expect, it } from "vitest";
import { toJobDto } from "../api/dto";
import type { JobRow } from "../repo/jobs-repo";

const at = new Date("2026-10-03T10:00:00Z");

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  createdBy: "33333333-3333-4333-8333-333333333333",
  title: "Backend engineer",
  description: "Build APIs.",
  category: "engineering",
  workFormat: "remote",
  employmentType: "full_time",
  experienceMin: 3,
  experienceMax: null,
  location: null,
  locationCountry: null,
  countryRestrictions: null,
  timezoneRequired: "Europe/Berlin",
  workHoursStart: "09:00:00",
  workHoursEnd: "18:00:00",
  minOverlapHours: 3,
  salaryMin: BigInt(500000),
  salaryMax: BigInt(700000),
  salaryCurrency: "EUR",
  salaryPeriod: "month",
  salaryBasis: "gross",
  applicationMethod: "internal",
  applicationUrl: null,
  applicationEmail: null,
  source: "internal",
  status: "draft",
  riskScore: 5,
  riskFlags: ["scam_pattern"],
  publishedAt: null,
  expiresAt: null,
  importedAt: null,
  createdAt: at,
  updatedAt: at,
} as unknown as JobRow;

describe("toJobDto (5.3)", () => {
  it("never returns risk data or the creator", () => {
    const dto = toJobDto(row) as Record<string, unknown>;
    for (const key of ["riskScore", "riskFlags", "createdBy"]) {
      expect(dto, key).not.toHaveProperty(key);
    }
    const text = JSON.stringify(dto, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(text).not.toContain("scam_pattern");
    expect(text).not.toContain(String(row.createdBy));
  });

  it("serializes salary as money DTOs with string amounts", () => {
    const dto = toJobDto(row) as Record<string, unknown>;
    const values = Object.values(dto).filter(
      (value): value is { amountMinor: unknown } =>
        typeof value === "object" && value !== null && "amountMinor" in value,
    );
    expect(values.length).toBeGreaterThan(0);
    for (const money of values) {
      expect(typeof money.amountMinor).toBe("string");
    }
  });
});
