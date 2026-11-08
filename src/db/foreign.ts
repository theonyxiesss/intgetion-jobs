import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companyOrigin, companySize, companyStatus, memberRole } from "./enums";

/*
 * Read-only views of tables other modules own: companies (companies),
 * skills (taxonomy), import_sources and job_sources (ingestion).
 * Jobs never writes them.
 */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    domain: text("domain"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    telegramUrl: text("telegram_url"),
    xUrl: text("x_url"),
    description: text("description"),
    logoPath: text("logo_path"),
    country: text("country"),
    size: companySize("size"),
    legalName: text("legal_name"),
    registrationNumber: text("registration_number"),
    status: companyStatus("status").notNull().default("unverified"),
    origin: companyOrigin("origin").notNull().default("internal"),
    isTrusted: boolean("is_trusted").notNull().default(false),
    trustedAt: timestamp("trusted_at", { withTimezone: true }),
    /** Morning briefs about candidates (D368); owner or admin switches it. */
    agentBriefsEnabled: boolean("agent_briefs_enabled")
      .notNull()
      .default(false),
    /** IANA zone for the employer brief slot; NULL means `europe` (0040). */
    timezone: text("timezone"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("companies_domain_idx")
      .on(table.domain)
      .where(sql`${table.domain} is not null`),
    index("companies_status_idx").on(table.status),
  ],
);

export const companyMembers = pgTable(
  "company_members",
  {
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.userId] })],
);

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  nameEn: text("name_en").notNull(),
  nameRu: text("name_ru").notNull(),
  category: text("category").notNull(),
  isActive: boolean("is_active").notNull(),
});

export const importSources = pgTable("import_sources", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  url: text("url"),
  enabled: boolean("enabled").notNull(),
  republishAllowed: boolean("republish_allowed").notNull(),
  config: jsonb("config").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
});

export const jobSources = pgTable(
  "job_sources",
  {
    jobId: uuid("job_id").notNull(),
    importSourceId: uuid("import_source_id").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    isPrimary: boolean("is_primary").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importSourceId, table.externalId] }),
    index("job_sources_job_idx").on(table.jobId),
    uniqueIndex("job_sources_primary_idx").on(table.jobId).where(sql`${table.isPrimary}`),
  ],
);
