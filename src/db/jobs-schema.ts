import { sql } from "drizzle-orm";
import {
  check,
  bigint,
  char,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  applicationMethod,
  cefrLevel,
  employmentType,
  jobSeniority,
  jobSource,
  jobStatus,
  salaryBasis,
  salaryPeriod,
  skillLevel,
  workFormat,
} from "./enums";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull(),
    createdBy: uuid("created_by"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    fts: tsvector("fts").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')`,
    ),
    category: text("category").notNull(),
    workFormat: workFormat("work_format").notNull().default("remote"),
    employmentType: employmentType("employment_type").notNull(),
    seniority: jobSeniority("seniority"),
    sectors: text("sectors").array().notNull().default([]),
    perks: text("perks").array().notNull().default([]),
    experienceMin: smallint("experience_min"),
    experienceMax: smallint("experience_max"),
    location: text("location"),
    locationCountry: char("location_country", { length: 2 }),
    countryRestrictions: char("country_restrictions", { length: 2 }).array(),
    timezoneRequired: text("timezone_required"),
    workHoursStart: time("work_hours_start"),
    workHoursEnd: time("work_hours_end"),
    minOverlapHours: smallint("min_overlap_hours").notNull().default(3),
    salaryMin: bigint("salary_min", { mode: "bigint" }),
    salaryMax: bigint("salary_max", { mode: "bigint" }),
    salaryCurrency: char("salary_currency", { length: 3 }),
    salaryPeriod: salaryPeriod("salary_period"),
    salaryBasis: salaryBasis("salary_basis"),
    applicationMethod: applicationMethod("application_method").notNull(),
    applicationUrl: text("application_url"),
    applicationEmail: text("application_email"),
    source: jobSource("source").notNull().default("internal"),
    status: jobStatus("status").notNull().default("draft"),
    riskScore: smallint("risk_score").notNull().default(0),
    riskFlags: jsonb("risk_flags")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    jobsAlertSentAt: timestamp("jobs_alert_sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jobs_company_status_idx").on(table.companyId, table.status),
    index("jobs_status_expiry_idx").on(table.status, table.expiresAt),
    check(
      "jobs_title_length_check",
      sql`char_length(${table.title}) between 3 and 140`,
    ),
    check(
      "jobs_description_length_check",
      sql`char_length(${table.description}) between 50 and 20000`,
    ),
  ],
);

export const jobSkills = pgTable(
  "job_skills",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull(),
    weight: smallint("weight").notNull(),
    minLevel: skillLevel("min_level"),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.skillId] }),
    index("job_skills_skill_job_idx").on(table.skillId, table.jobId),
    check("job_skills_weight_check", sql`${table.weight} between 1 and 3`),
  ],
);

export const jobLanguages = pgTable(
  "job_languages",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    lang: char("lang", { length: 2 }).notNull(),
    minLevel: cefrLevel("min_level").notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.lang] })],
);

export const jobStatusHistory = pgTable(
  "job_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    fromStatus: jobStatus("from_status"),
    toStatus: jobStatus("to_status").notNull(),
    actorId: uuid("actor_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_status_history_job_created_idx").on(
      table.jobId,
      table.createdAt,
    ),
  ],
);

/** One editable hire listing shared by Spoki, Telegram and the hire form (D494). */
export const jobDrafts = pgTable(
  "job_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique(),
    draft: jsonb("draft")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    submittedJobId: uuid("submitted_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    status: text("status")
      .$type<"draft" | "submitting" | "submitted">()
      .notNull()
      .default("draft"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_drafts_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);
