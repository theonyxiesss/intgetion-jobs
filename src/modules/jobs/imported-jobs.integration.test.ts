import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { saveImportedJob, type ImportedJobWrite } from "./service";

if (!process.env.DATABASE_URL) {
  throw new Error("Integration tests need DATABASE_URL.");
}

const userId = randomUUID();
const companyId = randomUUID();
const skillA = randomUUID();
const skillB = randomUUID();
const tag = companyId.slice(0, 8);
let jobId: string | undefined;

const base: ImportedJobWrite = {
  companyId,
  title: "Light Save Engineer",
  description: "Original description of the light save integration job.",
  category: "engineering" as ImportedJobWrite["category"],
  employmentType: "full_time" as ImportedJobWrite["employmentType"],
  timeZone: null,
  skillIds: [skillA],
  applyUrl: "https://example.com/apply/light-save",
  expiresAt: null,
  status: "published",
  reason: "integration",
};

async function snapshot() {
  const db = getDb();
  const [row] = await db.execute<{ updated_at: string }>(
    sql`select updated_at::text as updated_at from public.jobs where id = ${jobId!}`,
  );
  const [history] = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from public.job_status_history where job_id = ${jobId!}`,
  );
  return { updatedAt: row!.updated_at, history: Number(history!.n) };
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`
    insert into public.users (id, auth_uid, terms_accepted_at, terms_version)
    values (${userId}, ${randomUUID()}, now(), 'integration')
  `);
  await db.execute(sql`
    insert into public.companies (id, name, slug, domain, status, created_by)
    values (${companyId}, 'Light Save Company', ${`light-save-${tag}`}, ${`light-save-${tag}.example.com`}, 'verified', ${userId})
  `);
  await db.execute(sql`
    insert into public.skills (id, slug, name_en, name_ru, category, is_active)
    values (${skillA}, ${`ls-a-${tag}`}, 'LS A', 'LS A', 'engineering', true),
           (${skillB}, ${`ls-b-${tag}`}, 'LS B', 'LS B', 'engineering', true)
  `);
});

afterAll(async () => {
  const db = getDb();
  if (jobId) await db.execute(sql`delete from public.jobs where id = ${jobId}`);
  await db.execute(sql`delete from public.skills where id in (${skillA}, ${skillB})`);
  await db.execute(sql`delete from public.companies where id = ${companyId}`);
  await db.execute(sql`delete from public.users where id = ${userId}`);
});

describe("saveImportedJob light save", () => {
  it("creates the job and returns exactly id and status", async () => {
    const saved = await saveImportedJob(base);
    jobId = saved.id;
    expect(Object.keys(saved).sort()).toEqual(["id", "status"]);
    expect(saved.status).toBe("published");
  });

  it("does not touch updated_at or history when saved again unchanged", async () => {
    const before = await snapshot();
    const saved = await saveImportedJob({ ...base, jobId });
    expect(Object.keys(saved).sort()).toEqual(["id", "status"]);
    expect(await snapshot()).toEqual(before);
  });

  it("writes when the description changes by one character", async () => {
    const before = await snapshot();
    await saveImportedJob({ ...base, jobId, description: "Original description of the light save integration job!" });
    expect((await snapshot()).updatedAt).not.toBe(before.updatedAt);
  });

  it("writes when only the skill set changes", async () => {
    const description = "Original description of the light save integration job!";
    const before = await snapshot();
    await saveImportedJob({ ...base, jobId, description, skillIds: [skillA, skillB] });
    expect((await snapshot()).updatedAt).not.toBe(before.updatedAt);
    const rows = await getDb().execute<{ n: string }>(
      sql`select count(*)::text as n from public.job_skills where job_id = ${jobId!}`,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });
});
