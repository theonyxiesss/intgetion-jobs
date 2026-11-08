import type { JobRow } from "../repo/jobs-repo";
import { publicHttpUrl } from "@intgetion/companies";
import { toMoneyDto } from "@intgetion/kit";

export function toJobDto(job: JobRow) {
  const moneyInfo = {
    currency: job.salaryCurrency,
    period: job.salaryPeriod,
    basis: job.salaryBasis,
  };
  return {
    id: job.id,
    companyId: job.companyId,
    title: job.title,
    description: job.description,
    category: job.category,
    workFormat: job.workFormat,
    employmentType: job.employmentType,
    seniority: job.seniority,
    sectors: job.sectors ?? [],
    perks: job.perks ?? [],
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    location: job.location,
    locationCountry: job.locationCountry?.trim() ?? null,
    countryRestrictions:
      job.countryRestrictions?.map((country) => country.trim()) ?? null,
    timezoneRequired: job.timezoneRequired,
    workHoursStart: job.workHoursStart,
    workHoursEnd: job.workHoursEnd,
    minOverlapHours: job.minOverlapHours,
    salaryMin:
      job.salaryMin === null ||
      !moneyInfo.currency ||
      !moneyInfo.period ||
      !moneyInfo.basis
        ? null
        : toMoneyDto(
            job.salaryMin,
            moneyInfo.currency,
            moneyInfo.period,
            moneyInfo.basis,
          ),
    salaryMax:
      job.salaryMax === null ||
      !moneyInfo.currency ||
      !moneyInfo.period ||
      !moneyInfo.basis
        ? null
        : toMoneyDto(
            job.salaryMax,
            moneyInfo.currency,
            moneyInfo.period,
            moneyInfo.basis,
          ),
    applicationMethod: job.applicationMethod,
    applicationUrl: publicHttpUrl(job.applicationUrl),
    applicationEmail: job.applicationEmail,
    status: job.status,
    // risk_score and risk_flags never leave the server (5.3).
    publishedAt: job.publishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
