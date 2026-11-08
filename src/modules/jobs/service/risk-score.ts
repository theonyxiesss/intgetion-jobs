import { isFreeEmailDomain as isFreeDomain } from "@intgetion/companies";
export type RiskInput = {
  creatorAgeHours: number;
  freeEmailDomain: boolean;
  companyJobsLast24Hours: number;
  similarDescriptionInOtherCompany: boolean;
  applicationDomainMismatch: boolean;
  scamPattern: boolean;
  salaryOutlier: boolean;
  sensitiveSector?: boolean;
};

const SCAM_PATTERNS = [
  /\bpay\s+to\s+apply\b/i,
  /\bcrypto\s+deposit\b/i,
  /\bwire\s+transfer\b/i,
  /\bguaranteed\s+income\b/i,
  /\bupfront\s+fee\b/i,
  /предоплат[ауы]/i,
  /гарантированн\w+\s+доход/i,
  /оплат\w+\s+обучени/i,
  /комисси\w+\s+за\s+трудоустройств/i,
  /перевед\w+\s+средств/i,
];

export function isFreeEmailDomain(email: string | null | undefined): boolean {
  return isFreeDomain(email);
}

export function hasScamPattern(text: string): boolean {
  return SCAM_PATTERNS.some((pattern) => pattern.test(text));
}

export function scoreJobRisk(input: RiskInput): {
  score: number;
  flags: string[];
} {
  const flags: string[] = [];
  if (input.creatorAgeHours < 24) flags.push("new_creator");
  if (input.freeEmailDomain) flags.push("free_email");
  if (input.companyJobsLast24Hours >= 5) flags.push("company_job_burst");
  if (input.similarDescriptionInOtherCompany)
    flags.push("similar_job_description");
  if (input.applicationDomainMismatch)
    flags.push("application_domain_mismatch");
  if (input.scamPattern) flags.push("scam_pattern");
  if (input.salaryOutlier) flags.push("salary_outlier");
  if (input.sensitiveSector) flags.push("sensitive_sector");
  const weights: Record<string, number> = {
    new_creator: 2,
    free_email: 2,
    company_job_burst: 3,
    similar_job_description: 3,
    application_domain_mismatch: 1,
    scam_pattern: 4,
    salary_outlier: 2,
    sensitive_sector: 2,
  };
  return { score: flags.reduce((sum, flag) => sum + weights[flag]!, 0), flags };
}
