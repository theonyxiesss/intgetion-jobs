import { describe, expect, it } from "vitest";
import {
  hasScamPattern,
  isFreeEmailDomain,
  scoreJobRisk,
} from "../service/risk-score";

const clean = {
  creatorAgeHours: 48,
  freeEmailDomain: false,
  companyJobsLast24Hours: 1,
  similarDescriptionInOtherCompany: false,
  applicationDomainMismatch: false,
  scamPattern: false,
  salaryOutlier: false,
};

describe("job risk-score 14.3", () => {
  it("scores all seven flags using their specified weights", () => {
    expect(
      scoreJobRisk({
        ...clean,
        creatorAgeHours: 2,
        freeEmailDomain: true,
        companyJobsLast24Hours: 5,
        similarDescriptionInOtherCompany: true,
        applicationDomainMismatch: true,
        scamPattern: true,
        salaryOutlier: true,
      }),
    ).toEqual({
      score: 17,
      flags: [
        "new_creator",
        "free_email",
        "company_job_burst",
        "similar_job_description",
        "application_domain_mismatch",
        "scam_pattern",
        "salary_outlier",
      ],
    });
  });

  it("adds two points for a sensitive sector without changing the other weights", () => {
    expect(scoreJobRisk({ ...clean, sensitiveSector: true })).toEqual({
      score: 2,
      flags: ["sensitive_sector"],
    });
  });

  it("leaves boundary values unflagged and detects common free email domains", () => {
    expect(
      scoreJobRisk({
        ...clean,
        creatorAgeHours: 24,
        companyJobsLast24Hours: 4,
        salaryOutlier: false,
      }),
    ).toEqual({ score: 0, flags: [] });
    expect(isFreeEmailDomain("person@GMAIL.com")).toBe(true);
    expect(isFreeEmailDomain("person@example.org")).toBe(false);
  });

  it("detects explicit scam patterns without flagging ordinary job prose", () => {
    expect(
      hasScamPattern("We guarantee income after a small upfront fee"),
    ).toBe(true);
    expect(hasScamPattern("Build and maintain our analytics platform")).toBe(
      false,
    );
    expect(hasScamPattern("Для трудоустройства нужна предоплата")).toBe(true);
  });
});
