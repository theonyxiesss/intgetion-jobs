import { describe, expect, it } from "vitest";
import { workHoursOverlap } from "@intgetion/kit";
import { parseEcbCsv } from "../service/fx-rates";
import {
  cursorDecode,
  salaryDecision,
  toPublicJobDto,
} from "../service/public-search";
import { jobSearchQuery } from "../schemas/search";

describe("public job search contract", () => {
  it("validates supported filters and rejects incomplete salary filters", () => {
    expect(
      jobSearchQuery.parse({
        q: "engineer",
        workFormat: "remote,hybrid",
        postedWithin: "7",
        limit: "50",
      }),
    ).toMatchObject({
      workFormat: ["remote", "hybrid"],
      postedWithin: 7,
      limit: 50,
    });
    for (const raw of [
      { category: "invalid" },
      { workFormat: "other" },
      { employmentType: "other" },
      { tzOverlapWith: "UTC+3" },
      { country: "USA" },
      { source: "unknown" },
      { postedWithin: "2" },
      { sort: "random" },
      { limit: "51" },
      { skills: "not-a-uuid" },
      { salaryMin: "1000" },
    ])
      expect(jobSearchQuery.safeParse(raw).success).toBe(false);
    expect(
      jobSearchQuery.safeParse({
        salaryMin: "1000",
        currency: "USD",
        period: "month",
        basis: "gross",
      }).success,
    ).toBe(true);
    const allFilters = jobSearchQuery.parse({
      q: "staff engineer",
      category: "engineering",
      skills: "123e4567-e89b-12d3-a456-426614174000",
      workFormat: "remote,hybrid",
      employmentType: "full_time,contract",
      tzOverlapWith: "Europe/Berlin",
      minOverlap: "4",
      salaryMin: "100000",
      currency: "USD",
      period: "year",
      basis: "net",
      country: "DE",
      source: "internal",
      postedWithin: "30",
      sort: "relevance",
      cursor: "eyJvayI6dHJ1ZX0",
      limit: "50",
    });
    expect(allFilters).toMatchObject({
      category: "engineering",
      minOverlap: 4,
      country: "DE",
      source: "internal",
      postedWithin: 30,
      sort: "relevance",
      limit: 50,
    });
  });

  it("decodes valid cursors and rejects malformed values", () => {
    expect(
      cursorDecode(
        Buffer.from(
          JSON.stringify({
            publishedAt: "2026-01-01T00:00:00.000Z",
            id: "123e4567-e89b-12d3-a456-426614174000",
          }),
        ).toString("base64url"),
      ),
    ).toMatchObject({ id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(() => cursorDecode("junk")).toThrow("invalid_cursor");
  });

  it("DTO is an explicit public allowlist and contains no risk or private contact keys", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const row = {
      job: {
        id: "j",
        companyId: "c",
        createdBy: "private",
        title: "Engineer",
        description: "A sufficiently long job description",
        category: "engineering",
        workFormat: "remote",
        employmentType: "full_time",
        experienceMin: null,
        experienceMax: null,
        location: null,
        locationCountry: null,
        countryRestrictions: null,
        timezoneRequired: null,
        workHoursStart: null,
        workHoursEnd: null,
        minOverlapHours: 3,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryBasis: null,
        applicationMethod: "internal",
        applicationUrl: null,
        applicationEmail: "private@example.com",
        source: "internal",
        status: "published",
        riskScore: 0,
        riskFlags: [],
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
        importedAt: null,
        fts: "",
      },
      company: {
        id: "c",
        name: "Acme",
        slug: "acme",
        logoPath: null,
        websiteUrl: "https://acme.example",
        linkedinUrl: null,
        telegramUrl: null,
        xUrl: null,
        description: "Widgets",
        status: "verified",
        isTrusted: false,
      },
      sourceName: null,
      sourceUrl: null,
    } as never;
    const dto = toPublicJobDto(row);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "applicationMethod",
        "applicationUrl",
        "category",
        "company",
        "countryRestrictions",
        "description",
        "employmentType",
        "experienceMax",
        "experienceMin",
        "id",
        "languages",
        "location",
        "locationCountry",
        "minOverlapHours",
        "perks",
        "promoted",
        "publishedAt",
        // Public end date, Google JobPosting validThrough (D211).
        "expiresAt",
        "salaryComparable",
        "salaryMax",
        "salaryMin",
        "sectors",
        "seniority",
        "skills",
        "skillsMore",
        "source",
        "timezoneRequired",
        "title",
        "workFormat",
        "workHoursEnd",
        "workHoursStart",
      ].sort(),
    );
    expect(dto.company).toMatchObject({
      websiteUrl: "https://acme.example",
      linkedinUrl: null,
      telegramUrl: null,
      xUrl: null,
      description: "Widgets",
    });
    expect(dto).not.toHaveProperty("riskScore");
    expect(dto).not.toHaveProperty("riskFlags");
    expect(dto).not.toHaveProperty("createdBy");
  });

  it("uses IANA-aware work-hour overlap across DST dates", () => {
    const result = workHoursOverlap({
      candidate: {
        timeZone: "Europe/Berlin",
        start: "09:00",
        end: "17:00",
        workDays: [1, 2, 3, 4, 5],
      },
      job: { timeZone: "America/New_York", start: "09:00", end: "17:00" },
      from: new Date("2026-03-23T00:00:00Z"),
      days: 14,
    });
    expect(result.workingDayCount).toBeGreaterThan(0);
    expect(result.averageOverlapMinutes).toBeGreaterThanOrEqual(0);
    const midnight = workHoursOverlap({
      candidate: {
        timeZone: "Europe/Berlin",
        start: "22:00",
        end: "02:00",
        workDays: [1, 2, 3, 4, 5],
      },
      job: { timeZone: "UTC", start: "00:00", end: "03:00" },
      from: new Date("2026-03-23T00:00:00Z"),
      days: 1,
    });
    expect(midnight.averageOverlapMinutes).toBeGreaterThan(0);
  });

  it("parses ECB observation data without converting rate precision to floating point", () => {
    expect(
      parseEcbCsv(
        "FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nD,USD,EUR,SP00,A,2026-10-02,1.1723\nD,GBP,EUR,SP00,A,2026-10-01,0.8721",
      ),
    ).toEqual({
      asOf: "2026-10-02",
      eurRates: {
        USD: { value: "1.1723", asOf: "2026-10-02" },
        GBP: { value: "0.8721", asOf: "2026-10-01" },
        EUR: { value: "1", asOf: "2026-10-02" },
      },
    });
    expect(() => parseEcbCsv("bad\nrow")).toThrow();
  });

  it("keeps salary-neutral jobs but filters comparable jobs below the requested minimum", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    const row = {
      job: {
        salaryMin: BigInt(8000),
        salaryMax: BigInt(9000),
        salaryCurrency: "USD",
        salaryPeriod: "month",
        salaryBasis: "gross",
      },
    } as never;
    const filter = jobSearchQuery.parse({
      salaryMin: "10000",
      currency: "USD",
      period: "month",
      basis: "gross",
    });
    expect(salaryDecision(row, filter, [], now)).toEqual({
      include: false,
      comparable: true,
    });
    const missing = {
      job: {
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryBasis: null,
      },
    } as never;
    expect(salaryDecision(missing, filter, [], now)).toEqual({
      include: true,
      comparable: false,
    });
    const differentBasis = {
      job: {
        salaryMin: BigInt(12000),
        salaryMax: null,
        salaryCurrency: "USD",
        salaryPeriod: "month",
        salaryBasis: "net",
      },
    } as never;
    expect(salaryDecision(differentBasis, filter, [], now)).toEqual({
      include: true,
      comparable: false,
    });
    const hourly = {
      job: {
        salaryMin: BigInt(1500),
        salaryMax: null,
        salaryCurrency: "USD",
        salaryPeriod: "hour",
        salaryBasis: "gross",
      },
    } as never;
    expect(salaryDecision(hourly, filter, [], now)).toEqual({
      include: true,
      comparable: false,
    });
  });
});
