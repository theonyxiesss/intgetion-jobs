import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { jobSearchQuery } from "./schemas/search";
import { searchJobs } from "./service";

/**
 * D484 in the query: a third-party reader gets own jobs and open sources
 * even when the newest jobs of a search come from closed sources.
 */

const userId = randomUUID();
const companyId = randomUUID();
const token = `synd${companyId.slice(0, 8)}`;
const internalJobId = randomUUID();
const jobicyJobId = randomUUID();
const closedJobIds = Array.from({ length: 6 }, () => randomUUID());
const createdSourceIds: string[] = [];
const description =
  "Integration test role description long enough for all schema constraints and public full-text search.";

async function sourceId(name: string): Promise<string> {
  const db = getDb();
  const created = await db.execute<{ id: string }>(sql`
    insert into public.import_sources(name, kind) values (${name}, 'api')
    on conflict (name) do nothing returning id
  `);
  if (created[0]) {
    createdSourceIds.push(created[0].id);
    return created[0].id;
  }
  const existing = await db.execute<{ id: string }>(
    sql`select id from public.import_sources where name = ${name}`,
  );
  return existing[0]!.id;
}

async function insertJob(
  id: string,
  title: string,
  age: number,
  imported: boolean,
) {
  await getDb().execute(sql`
    insert into public.jobs(id, company_id, title, description, category, work_format, employment_type, application_method, application_url, source, status, published_at, expires_at)
    values (${id}, ${companyId}, ${title}, ${description}, 'legal', 'remote', 'full_time',
      ${imported ? "external_url" : "internal"}, ${imported ? "https://example.com/apply" : null},
      ${imported ? "imported" : "internal"}, 'published', now() - (${age} || ' seconds')::interval, now() + interval '30 days')
  `);
}

async function linkSource(jobId: string, source: string, external: string) {
  await getDb().execute(sql`
    insert into public.job_sources(job_id, import_source_id, external_id, source_url, is_primary)
    values (${jobId}, ${source}, ${external}, ${`https://example.com/${external}`}, true)
  `);
}

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("D484 integration tests require a loopback database");
  }
  const db = getDb();
  await db.execute(
    sql`insert into public.users(id,auth_uid,terms_accepted_at,terms_version) values (${userId},${randomUUID()},now(),'d484-integration')`,
  );
  await db.execute(
    sql`insert into public.companies(id,name,slug,status,created_by) values (${companyId},'D484 Search Test',${`d484-${companyId.slice(0, 8)}`},'verified',${userId})`,
  );
  const jobicy = await sourceId("Jobicy");
  const remotive = await sourceId("Remotive");
  // Oldest: our own job. Then Jobicy. Newest: six from a closed source.
  await insertJob(internalJobId, `${token} own role`, 300, false);
  await insertJob(jobicyJobId, `${token} jobicy role`, 200, true);
  await linkSource(jobicyJobId, jobicy, `${token}-jobicy`);
  for (const [index, id] of closedJobIds.entries()) {
    await insertJob(id, `${token} closed role ${index}`, index, true);
    await linkSource(id, remotive, `${token}-closed-${index}`);
  }
});

afterAll(async () => {
  const db = getDb();
  await db.execute(sql`delete from public.companies where id = ${companyId}`);
  await db.execute(sql`delete from public.users where id = ${userId}`);
  for (const id of createdSourceIds) {
    await db.execute(sql`delete from public.import_sources where id = ${id}`);
  }
});

describe("syndicated-only search (D484)", () => {
  it("returns own and open-source jobs although closed ones are newer", async () => {
    const { items } = await searchJobs(
      jobSearchQuery.parse({ q: token, limit: 2 }),
      "en",
      { hidden: null, syndicatedOnly: true },
    );
    expect(items.map((job) => job.id).sort()).toEqual(
      [internalJobId, jobicyJobId].sort(),
    );
    for (const job of items) {
      expect(job.source.name ?? "internal").not.toBe("Remotive");
    }
  });

  it("without the flag the newest closed jobs fill the page (the site view)", async () => {
    const { items } = await searchJobs(
      jobSearchQuery.parse({ q: token, limit: 2 }),
    );
    expect(items.map((job) => job.id)).toEqual(closedJobIds.slice(0, 2));
  });

  it("never returns a closed source, whatever the limit", async () => {
    const { items } = await searchJobs(
      jobSearchQuery.parse({ q: token, limit: 20 }),
      "en",
      { hidden: null, syndicatedOnly: true },
    );
    const ids = items.map((job) => job.id);
    for (const id of closedJobIds) expect(ids).not.toContain(id);
    expect(ids).toEqual(expect.arrayContaining([internalJobId, jobicyJobId]));
  });
});
