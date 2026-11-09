import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB = "11111111-1111-4111-8111-111111111111";
const COMPANY = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";

const service = vi.hoisted(() => ({
  searchJobs: vi.fn(async () => ({ items: [], nextCursor: null })),
  getJobForPublic: vi.fn(async (): Promise<unknown> => null),
  findOwnedJob: vi.fn(async () => ({ companyId: "44444444-4444-4444-8444-444444444444", status: "draft" })),
  transitionOwnedJob: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  toJobDto: vi.fn((job: unknown) => job),
  createJob: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
}));
const ports = vi.hoisted(() => ({
  activeUser: vi.fn(async (id: string) => ({ id, platformRole: "user" })),
  findMemberRole: vi.fn(async (): Promise<string | null> => "recruiter"),
}));

vi.mock("../modules/jobs/service", async (orig) => ({
  ...(await orig<typeof import("../modules/jobs/service")>()),
  ...service,
}));
vi.mock("../ports", async (orig) => {
  const real = await orig<typeof import("../ports")>();
  return { ...real, jobsPorts: () => ports };
});

const { createApp } = await import("./app");

const TOKEN = "test-jobs-token";
const handle = createApp({ serviceToken: TOKEN });

function call(path: string, init: RequestInit & { user?: string; role?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.user) headers.set("x-user-id", init.user);
  if (init.role) headers.set("x-user-role", init.role);
  return handle(new Request(`http://jobs${path}`, { ...init, headers }));
}

beforeEach(() => vi.clearAllMocks());

describe("jobs service HTTP", () => {
  it("refuses a wrong token", async () => {
    const response = await handle(
      new Request("http://jobs/v1/jobs", { headers: { authorization: "Bearer nope" } }),
    );
    expect(response.status).toBe(401);
  });

  it("searches publicly, times the search and rejects bad filters", async () => {
    const ok = await call("/v1/jobs?limit=20");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("server-timing")).toMatch(/^jobs;dur=/);
    expect((await call("/v1/jobs?limit=5000")).status).toBe(400);
  });

  it("answers 404 for a missing or invalid job", async () => {
    expect((await call(`/v1/jobs/${JOB}`)).status).toBe(404);
    expect((await call("/v1/jobs/not-a-uuid")).status).toBe(404);
  });

  it("lets only a recruiter change a job's status", async () => {
    ports.findMemberRole.mockResolvedValueOnce("member");
    expect((await call(`/v1/jobs/${JOB}/publish`, { method: "POST", user: USER })).status).toBe(404);
    expect(service.transitionOwnedJob).not.toHaveBeenCalled();
    expect((await call(`/v1/jobs/${JOB}/publish`, { method: "POST", user: USER })).status).toBe(200);
    expect(service.transitionOwnedJob).toHaveBeenCalledWith(JOB, "publish", USER);
    expect((await call(`/v1/jobs/${JOB}/approve`, { method: "POST", user: USER })).status).toBe(404);
  });

  it("keeps admin approval for admins", async () => {
    expect((await call(`/v1/admin/jobs/${JOB}/approve`, { method: "POST", user: USER })).status).toBe(403);
    const ok = await call(`/v1/admin/jobs/${JOB}/approve`, { method: "POST", user: USER, role: "admin" });
    expect(ok.status).toBe(200);
    expect(service.transitionOwnedJob).toHaveBeenCalledWith(JOB, "approve", USER, "admin");
  });

  it("refuses a create from an inactive account before reading the body", async () => {
    ports.activeUser.mockResolvedValueOnce(null as never);
    const response = await call("/v1/jobs", { method: "POST", user: USER, body: "{}" });
    expect(response.status).toBe(401);
    expect(service.createJob).not.toHaveBeenCalled();
    void COMPANY;
  });
});
