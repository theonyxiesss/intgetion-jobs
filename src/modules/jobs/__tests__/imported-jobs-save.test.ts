import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  previous: null as Row | null,
  skillRows: [] as { skillId: string }[],
  selectCalls: [] as unknown[],
  updates: [] as unknown[],
  inserts: [] as { table: unknown; values: unknown }[],
  deletes: 0,
  returningArgs: [] as unknown[],
}));

vi.mock("@intgetion/kit", () => {
  const tx = {
    select(columns?: unknown) {
      state.selectCalls.push(columns);
      const isSkills =
        columns !== undefined &&
        Object.keys(columns as object).join() === "skillId";
      return {
        from: () => ({
          where: () =>
            isSkills
              ? Promise.resolve(state.skillRows)
              : {
                  limit: () =>
                    Promise.resolve(state.previous ? [state.previous] : []),
                },
        }),
      };
    },
    update: () => ({
      set: (values: unknown) => {
        state.updates.push(values);
        return {
          where: () => ({
            returning: (cols: unknown) => {
              state.returningArgs.push(cols);
              return Promise.resolve([
                { id: "job-1", status: "published" as const },
              ]);
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        state.inserts.push({ table, values });
        const result = Promise.resolve(undefined) as Promise<undefined> & {
          returning: (cols: unknown) => Promise<unknown[]>;
        };
        result.returning = (cols: unknown) => {
          state.returningArgs.push(cols);
          return Promise.resolve([
            { id: "job-1", status: "published" as const },
          ]);
        };
        return result;
      },
    }),
    delete: () => ({
      where: () => {
        state.deletes += 1;
        return Promise.resolve();
      },
    }),
  };
  return {
    getDb: () => ({ transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) }),
  };
});

import { jobStatusHistory } from "../../../db";
import { saveImportedJob, type ImportedJobWrite } from "../service/imported-jobs";

const input: ImportedJobWrite = {
  jobId: "job-1",
  companyId: "company-1",
  title: "Backend Engineer",
  description: "Build things.",
  category: "engineering" as ImportedJobWrite["category"],
  employmentType: "full_time" as ImportedJobWrite["employmentType"],
  timeZone: null,
  skillIds: ["s1", "s2"],
  applyUrl: "https://example.com/apply",
  expiresAt: null,
  status: "published",
  reason: "import",
};

const md5 = (text: string) =>
  createHash("md5").update(text, "utf8").digest("hex");

function storedRow(over: Row = {}): Row {
  return {
    id: "job-1",
    source: "imported",
    status: "published",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    companyId: "company-1",
    title: "Backend Engineer",
    descriptionMd5: md5("Build things."),
    category: "engineering",
    employmentType: "full_time",
    sectors: [],
    seniority: null,
    perks: [],
    workFormat: "remote",
    location: null,
    locationCountry: null,
    countryRestrictions: null,
    timezoneRequired: null,
    applicationUrl: "https://example.com/apply",
    expiresAt: null,
    riskScore: 0,
    riskFlags: [],
    ...over,
  };
}

beforeEach(() => {
  state.previous = storedRow();
  state.skillRows = [{ skillId: "s1" }, { skillId: "s2" }];
  state.selectCalls = [];
  state.updates = [];
  state.inserts = [];
  state.deletes = 0;
  state.returningArgs = [];
});

describe("saveImportedJob light save", () => {
  it("does not write anything when nothing changed", async () => {
    const saved = await saveImportedJob(input);
    expect(saved).toEqual({ id: "job-1", status: "published" });
    expect(Object.keys(saved).sort()).toEqual(["id", "status"]);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  it("reads the previous row without description or fts", async () => {
    await saveImportedJob(input);
    const columns = state.selectCalls[0] as Record<string, unknown>;
    expect(columns).toBeDefined();
    expect(columns).not.toHaveProperty("description");
    expect(columns).not.toHaveProperty("fts");
    expect(columns).toHaveProperty("descriptionMd5");
  });

  it("writes when the description changes by one character", async () => {
    await saveImportedJob({ ...input, description: "Build thing." });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ description: "Build thing." });
  });

  it("writes when the skill set changes and the text does not", async () => {
    state.skillRows = [{ skillId: "s1" }];
    const saved = await saveImportedJob(input);
    expect(state.updates).toHaveLength(1);
    expect(state.deletes).toBe(1);
    expect(Object.keys(saved).sort()).toEqual(["id", "status"]);
  });

  it("writes status history only when the status changes", async () => {
    state.previous = storedRow({ status: "expired" });
    await saveImportedJob(input);
    const history = state.inserts.filter((i) => i.table === jobStatusHistory);
    expect(history).toHaveLength(1);
  });

  it("returns only id and status when it writes", async () => {
    const saved = await saveImportedJob({ ...input, title: "Other" });
    expect(Object.keys(saved).sort()).toEqual(["id", "status"]);
    expect(Object.keys(state.returningArgs[0] as object).sort()).toEqual([
      "id",
      "status",
    ]);
  });
});
