import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import {
  setJobsPorts,
  createJob,
  listJobsForUser,
  transitionOwnedJob,
  updateJob,
} from "./service";

const ownerId = randomUUID();
const outsiderId = randomUUID();
const companyId = randomUUID();
const secondCompanyId = randomUUID();
const companySlug = `job-it-${companyId.slice(0, 8)}`;
const secondCompanySlug = `job-it-${secondCompanyId.slice(0, 8)}`;
const jobIds: string[] = [];
const user = {
  id: ownerId,
  authUid: randomUUID(),
  platformRole: "user",
  createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
};
const queued: { entityId: string; reason: string; tx: unknown }[] = [];
const indexed: string[] = [];
const matched: string[] = [];
const notices: { type: string; recipientIds: readonly string[] }[] = [];

setJobsPorts({
  activeUser: async (id) => (id === ownerId ? { id, platformRole: "user" } : null),
  rateLimit: async () => {},
  enqueueModeration: async (input, tx) => {
    queued.push({ entityId: input.entityId, reason: input.reason, tx });
  },
  extractSkillIds: async () => [],
  normalizeSkill: async (raw) => ({ result: "suggested", suggestionId: randomUUID(), normalized: raw, occurrences: 1 }),
  findMemberRole: async () => null,
  companiesForUser: async () => [],
  promotedHireJobIds: async () => [],
  companyHasActiveTeam: async () => false,
  activeCandidateIds: async () => [outsiderId],
  enqueueMatchJob: async (jobId) => {
    matched.push(jobId);
  },
  notify: async (type, recipientIds) => {
    notices.push({ type, recipientIds });
  },
  submitToIndexNow: async (paths) => {
    indexed.push(...paths);
  },
});

async function seed() {
  await getDb().execute(sql`
    insert into public.users (id, auth_uid, terms_accepted_at, terms_version, created_at)
    values (${ownerId}, ${user.authUid}, now(), 'integration', ${user.createdAt.toISOString()}),
           (${outsiderId}, ${randomUUID()}, now(), 'integration', now())
  `);
  await getDb().execute(sql`
    insert into public.companies (id, name, slug, domain, status, created_by)
    values (${companyId}, 'Jobs Integration Company', ${companySlug}, 'jobs-integration.example.com', 'verified', ${ownerId})
  `);
  await getDb().execute(sql`
    insert into public.companies (id, name, slug, domain, status, created_by)
    values (${secondCompanyId}, 'Second Jobs Integration Company', ${secondCompanySlug}, 'jobs-integration-2.example.com', 'verified', ${ownerId})
  `);
  await getDb().execute(
    sql`insert into public.company_members (company_id, user_id, role) values (${companyId}, ${ownerId}, 'owner'), (${secondCompanyId}, ${ownerId}, 'owner')`,
  );
}

beforeAll(seed);
afterAll(async () => {
  const db = getDb();
  if (jobIds.length) {
    const ids = sql.join(
      jobIds.map((id) => sql`${id}`),
      sql`, `,
    );
    await db.execute(sql`delete from public.jobs where id in (${ids})`);
  }
  await db.execute(
    sql`delete from public.companies where id in (${companyId}, ${secondCompanyId})`,
  );
  await db.execute(
    sql`delete from public.users where id in (${ownerId}, ${outsiderId})`,
  );
});

describe("jobs CRUD and status history in Postgres", () => {
  it("creates, edits, publishes, pauses, extends, closes and records each transition", async () => {
    const input = {
      companyId,
      title: "Integration Test Engineer",
      description:
        "Build and maintain reliable backend services with a collaborative remote team.",
      category: "engineering" as const,
      workFormat: "remote" as const,
      employmentType: "full_time" as const,
      minOverlapHours: 3,
      applicationMethod: "internal" as const,
      skills: [],
      languages: [],
    };
    const created = await createJob(
      user,
      "owner@jobs-integration.example.com",
      input,
    );
    jobIds.push(created.id);
    expect(created.status).toBe("draft");
    expect(
      (await listJobsForUser(ownerId, companyId)).map(({ job }) => job.id),
    ).toContain(created.id);
    expect(await listJobsForUser(ownerId, secondCompanyId)).toEqual([]);
    expect(await listJobsForUser(outsiderId, companyId)).toEqual([]);
    const edited = await updateJob(
      created.id,
      { title: "Senior Integration Test Engineer" },
      user,
      "owner@jobs-integration.example.com",
    );
    expect(edited.title).toBe("Senior Integration Test Engineer");
    expect(
      (await transitionOwnedJob(created.id, "publish", ownerId)).status,
    ).toBe("pending_moderation");
    expect(
      (await transitionOwnedJob(created.id, "approve", ownerId, "admin"))
        .status,
    ).toBe("published");
    expect(
      (await transitionOwnedJob(created.id, "pause", ownerId)).status,
    ).toBe("paused");
    expect(
      (await transitionOwnedJob(created.id, "extend", ownerId)).status,
    ).toBe("pending_moderation");
    expect(
      (await transitionOwnedJob(created.id, "approve", ownerId, "admin"))
        .status,
    ).toBe("published");
    expect(
      (await transitionOwnedJob(created.id, "close", ownerId)).status,
    ).toBe("closed");
    const history = await getDb().execute<{ to_status: string }>(
      sql`select to_status from public.job_status_history where job_id = ${created.id} order by created_at`,
    );
    expect(history.map((row) => row.to_status)).toEqual([
      "draft",
      "pending_moderation",
      "published",
      "paused",
      "pending_moderation",
      "published",
      "closed",
    ]);
  });
});
