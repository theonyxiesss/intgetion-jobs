import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { createApp } from "../../server/app";

const serviceToken = "test-jobs-token";
const handle = createApp({ serviceToken });
const listPublicJobs = (request: Request) => {
  const url = new URL(request.url);
  return handle(
    new Request(`http://jobs/v1/jobs${url.search}`, {
      headers: { authorization: `Bearer ${serviceToken}` },
    }),
  );
};
import { jobSearchQuery } from "./schemas/search";
import { getVisibleCompany, searchJobs } from "./service";

const userId = randomUUID();
const companyId = randomUUID();
const suspendedCompanyId = randomUUID();
const jobId = randomUUID();
const secondJobId = randomUUID();
const hiddenJobId = randomUUID();
const web3JobId = randomUUID();
const searchToken = companyId.slice(0, 8);
beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("4A integration tests require a loopback database");
  }
  const db = getDb();
  await db.execute(
    sql`insert into public.users(id,auth_uid,terms_accepted_at,terms_version) values (${userId},${randomUUID()},now(),'4a-integration')`,
  );
  await db.execute(
    sql`insert into public.companies(id,name,slug,status,created_by) values (${companyId},'4A Search Test',${`4a-search-${companyId.slice(0, 8)}`},'verified',${userId})`,
  );
  await db.execute(
    sql`insert into public.companies(id,name,slug,status,created_by) values (${suspendedCompanyId},'4A Suspended Test',${`4a-suspended-${suspendedCompanyId.slice(0, 8)}`},'suspended',${userId})`,
  );
  await db.execute(sql`insert into public.jobs(id,company_id,title,description,category,work_format,employment_type,application_method,status,published_at,expires_at) values
    (${jobId},${companyId},${`Integration search ${searchToken} engineer`},'Integration test role description long enough for all schema constraints and public full-text search.','engineering','remote','full_time','internal','published',now(),now()+interval '30 days'),
    (${secondJobId},${companyId},${`Integration search ${searchToken} engineer two`},'Integration test role description long enough for all schema constraints and public full-text search.','engineering','remote','full_time','internal','published',now()-interval '1 second',now()+interval '30 days'),
    (${hiddenJobId},${suspendedCompanyId},${`Integration search ${searchToken} hidden`},'Integration test role description long enough for all schema constraints and public full-text search.','engineering','remote','full_time','internal','published',now(),now()+interval '30 days'),
    (${web3JobId},${companyId},${`Integration search ${searchToken} web3`},'Integration test role description long enough for all schema constraints and public full-text search.','engineering','remote','full_time','internal','published',now(),now()+interval '30 days')`);
  await db.execute(
    sql`update public.jobs set sectors = '{web3}' where id = ${web3JobId}`,
  );
  await db.execute(sql`
    insert into public.jobs(id,company_id,title,description,category,work_format,employment_type,application_method,status,published_at,expires_at)
    select md5('4a-perf-' || ${companyId}::text || '-' || n)::uuid, ${companyId}, ${`4aperf${companyId.slice(0, 8)}`} || ' engineer ' || n,
      'Performance seed role for measuring public job listing latency across five thousand published records.',
      'engineering','remote','full_time','internal','published',now() - (n || ' seconds')::interval,now() + interval '30 days'
    from generate_series(1,5000) n on conflict(id) do nothing
  `);
});
afterAll(async () => {
  await getDb().execute(
    sql`delete from public.companies where id in (${companyId},${suspendedCompanyId})`,
  );
  await getDb().execute(sql`delete from public.users where id=${userId}`);
});

describe("public search database integration", () => {
  it("finds seeded published rows and emits an opaque next page cursor", async () => {
    const result = await searchJobs(
      jobSearchQuery.parse({
        q: `Integration search ${searchToken} engineer`,
        limit: 1,
        sort: "relevance",
      }),
    );
    expect(result.items.map((job) => job.id)).toContain(jobId);
    expect(result.items).toHaveLength(1);
    expect(result.items.map((job) => job.id)).not.toContain(hiddenJobId);
    expect(result.nextCursor).toBeTruthy();
    expect(result.items[0]).not.toHaveProperty("riskScore");
    expect(
      await getVisibleCompany(`4a-suspended-${suspendedCompanyId.slice(0, 8)}`),
    ).toBeNull();
  });

  it("keeps GET /api/jobs server-side p95 below 500ms with 5,000 seeded rows", async () => {
    const samples: number[] = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await listPublicJobs(
        new Request(
          `http://127.0.0.1:3000/api/jobs?q=4aperf${companyId.slice(0, 8)}&limit=20`,
        ),
      );
      expect(response.status).toBe(200);
      const metric = response.headers
        .get("server-timing")
        ?.match(/jobs;dur=([\d.]+)/)?.[1];
      expect(metric).toBeDefined();
      samples.push(Number(metric));
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(`GET /api/jobs seeded-5000 server p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(500);
  });

  it("returns a web3 job for sector=web3 within the same p95 budget", async () => {
    const found = await searchJobs(
      jobSearchQuery.parse({ sector: "web3", limit: 20 }),
    );
    expect(found.items.map((job) => job.id)).toContain(web3JobId);
    const samples: number[] = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await listPublicJobs(
        new Request("http://127.0.0.1:3000/api/jobs?sector=web3&limit=20"),
      );
      expect(response.status).toBe(200);
      const metric = response.headers
        .get("server-timing")
        ?.match(/jobs;dur=([\d.]+)/)?.[1];
      expect(metric).toBeDefined();
      samples.push(Number(metric));
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(`GET /api/jobs sector=web3 server p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(500);
  });
});
