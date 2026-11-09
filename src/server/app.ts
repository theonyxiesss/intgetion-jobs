import { z, ZodError } from "zod";
import {
  HttpError,
  httpErrorResponse,
  notFound,
  reportError,
  validationError,
} from "@intgetion/kit";
import { SECTORS, PERKS, SENIORITY_LEVELS } from "@intgetion/taxonomy/catalog";
import * as jobs from "../modules/jobs/service";
import { createJobInput, patchJobInput } from "../modules/jobs/schemas";
import { jobSearchQuery } from "../modules/jobs/schemas/search";
import { jobsPorts } from "../ports";
import { isUuid, optionalCaller, requireCaller, requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const RECRUITER_ROLES = new Set(["owner", "admin", "recruiter"]);
const MEMBER_ACTIONS = new Set(["publish", "pause", "close", "extend"]);
const ADMIN_ACTIONS = new Set(["approve", "reject"]);
const MAX_JSON = 256 * 1024;

const uuid = z.string().uuid();
const searchBody = z
  .object({
    query: z.record(z.string(), z.unknown()).default({}),
    locale: z.string().max(8).default("en"),
    hiddenJobIds: z.array(uuid).max(5000).default([]),
    hiddenCompanyIds: z.array(uuid).max(5000).default([]),
    syndicatedOnly: z.boolean().optional(),
    signedIn: z.boolean().default(false),
  })
  .strict();
const draftPatchBody = z
  .object({ draftId: uuid.optional(), patch: z.record(z.string(), z.unknown()) })
  .strict();
const draftResetBody = z.object({ draftId: uuid.optional() }).strict();
const byIdsBody = z.object({ ids: z.array(uuid).max(200), locale: z.string().max(8).default("en") }).strict();
const teamBody = z
  .object({
    title: z.string().min(1).max(160),
    criteria: z.string().min(1).max(5000),
    category: z.string().max(40),
    employmentType: z.string().max(40),
    skills: z.array(z.string().max(80)).max(30).optional(),
  })
  .strict();
const importedBody = z
  .object({
    jobId: uuid.optional(),
    companyId: uuid,
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(100_000),
    category: z.string().max(40),
    employmentType: z.string().max(40),
    timeZone: z.string().max(64).nullable(),
    skillIds: z.array(uuid).max(50),
    sectors: z.array(z.enum(SECTORS)).max(10).optional(),
    seniority: z.enum(SENIORITY_LEVELS).nullable().optional(),
    perks: z.array(z.enum(PERKS)).max(20).optional(),
    workFormat: z.enum(["remote", "hybrid", "onsite"]).optional(),
    location: z.string().max(300).nullable().optional(),
    countries: z.array(z.string().length(2)).max(50).optional(),
    applyUrl: z.string().url().max(2000),
    expiresAt: z.coerce.date().nullable(),
    status: z.string().max(40),
    reason: z.string().max(200),
  })
  .strict();
const expireImportedBody = z
  .object({ jobIds: z.array(uuid).max(5000), reason: z.string().max(200).optional() })
  .strict();
const adminRemoveBody = z.object({ reason: z.string().min(1).max(500) }).strict();
const pauseCompanyBody = z.object({ reason: z.string().min(1).max(500) }).strict();

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw validationError({ body: "invalid json" });
  }
  return schema.parse(json);
}

function idParam(value: string | undefined): string {
  if (!value || !isUuid(value)) throw notFound();
  return value;
}

function locale(url: URL): string {
  return url.searchParams.get("locale")?.slice(0, 8) || "en";
}

function searchParamsToObject(params: URLSearchParams): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set(params.keys())]
      .filter((key) => key !== "locale")
      .map((key) => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]),
  );
}

function parseSearch(raw: Record<string, unknown>) {
  const parsed = jobSearchQuery.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid search filters", parsed.error.flatten());
  }
  return parsed.data;
}

async function runSearch(query: ReturnType<typeof parseSearch>, lang: string, viewer: Parameters<typeof jobs.searchJobs>[2]) {
  const started = performance.now();
  try {
    const result = await jobs.searchJobs(query, lang, viewer);
    const serverMs = performance.now() - started;
    return Response.json(result, {
      headers: { "cache-control": "no-store", "server-timing": `jobs;dur=${serverMs.toFixed(1)}` },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") {
      throw new HttpError(400, "VALIDATION_ERROR", "Invalid page cursor");
    }
    throw error;
  }
}

/** Platform admins pass `x-user-role: admin`; the platform checked the session. */
function isAdmin(request: Request): boolean {
  return request.headers.get("x-user-role") === "admin";
}

function requireAdmin(request: Request): string {
  const { userId } = requireCaller(request);
  if (!isAdmin(request)) throw new HttpError(403, "FORBIDDEN", "Admins only");
  return userId;
}

async function actorFor(request: Request) {
  const { userId } = requireCaller(request);
  const user = await jobsPorts().activeUser(userId);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Account is not active");
  return user;
}

async function requireRecruiter(companyId: string, userId: string) {
  const role = await jobsPorts().findMemberRole(companyId, userId);
  if (!role || !RECRUITER_ROLES.has(role)) throw notFound();
}

type Result = unknown | Response;
type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[], url: URL) => Promise<Result>;
};

const routes: Route[] = [
  // --- public reading
  {
    method: "GET",
    pattern: /^\/v1\/jobs$/,
    run: async (_request, _params, url) =>
      runSearch(parseSearch(searchParamsToObject(url.searchParams)), locale(url), { hidden: null }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/jobs\/search$/,
    run: async (request) => {
      const body = await parseBody(request, searchBody);
      return runSearch(parseSearch(body.query), body.locale, {
        hidden: body.signedIn
          ? { hiddenJobIds: new Set(body.hiddenJobIds), hiddenCompanyIds: new Set(body.hiddenCompanyIds) }
          : null,
        syndicatedOnly: body.syndicatedOnly,
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/jobs\/promoted$/,
    run: async (_request, _params, url) => ({ jobs: await jobs.listPromotedJobs(locale(url)) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/jobs\/by-ids$/,
    run: async (request) => {
      const { ids, locale: lang } = await parseBody(request, byIdsBody);
      return { jobs: await jobs.listPublicJobsByIds(ids, lang) };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/jobs\/([^/]+)$/,
    run: async (request, [id], url) => {
      const caller = optionalCaller(request);
      const job = await jobs.getJobForPublic(idParam(id), {
        userId: caller?.userId,
        isAdmin: isAdmin(request),
        locale: locale(url),
      });
      if (!job) throw notFound();
      return { job };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/jobs\/([^/]+)\/closed-context$/,
    run: async (_request, [id]) => {
      const context = await jobs.getClosedJobContext(idParam(id));
      if (!context) throw notFound();
      return context;
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)\/jobs$/,
    run: async (_request, [id], url) => ({
      jobs: await jobs.listPublishedJobsForCompany(idParam(id), locale(url)),
    }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/catalog\/count$/,
    run: async () => jobs.countPublicCatalog(),
  },
  {
    method: "GET",
    pattern: /^\/v1\/catalog\/skills$/,
    run: async (_request, _params, url) => ({ skills: await jobs.listSearchSkillOptions(locale(url)) }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/sitemap$/,
    run: async (_request, _params, url) => {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20_000) || 20_000, 50_000);
      return { entries: await jobs.listSitemapEntries(limit) };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/demand$/,
    run: async () => ({ categories: await jobs.publishedDemand() }),
  },
  // --- recruiters
  {
    method: "POST",
    pattern: /^\/v1\/jobs$/,
    run: async (request) => {
      const user = await actorFor(request);
      const input = await parseBody(request, createJobInput);
      await requireRecruiter(input.companyId, user.id);
      const job = await jobs.createJob(user, request.headers.get("x-user-email"), input);
      return Response.json({ job: jobs.toJobDto(job) }, { status: 201 });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/jobs$/,
    run: async (request, _params, url) => {
      const { userId } = requireCaller(request);
      const companyId = url.searchParams.get("companyId") ?? undefined;
      if (companyId && !isUuid(companyId)) throw notFound();
      return { jobs: await jobs.listJobsForUser(userId, companyId) };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/v1\/jobs\/([^/]+)$/,
    run: async (request, [id]) => {
      const user = await actorFor(request);
      const jobId = idParam(id);
      const existing = await jobs.findOwnedJob(jobId, user.id);
      await requireRecruiter(existing.companyId, user.id);
      if (!["draft", "paused", "pending_moderation", "published"].includes(existing.status)) {
        throw new HttpError(409, "INVALID_TRANSITION", "This job cannot be edited in its current state");
      }
      const input = await parseBody(request, patchJobInput);
      const job = await jobs.updateJob(jobId, input, user, request.headers.get("x-user-email"));
      return { job: jobs.toJobDto(job) };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/jobs\/([^/]+)\/(publish|pause|close|extend)$/,
    run: async (request, [id, action]) => {
      const { userId } = requireCaller(request);
      const jobId = idParam(id);
      if (!action || !MEMBER_ACTIONS.has(action)) throw notFound();
      const existing = await jobs.findOwnedJob(jobId, userId);
      await requireRecruiter(existing.companyId, userId);
      const job = await jobs.transitionOwnedJob(jobId, action as jobs.JobAction, userId);
      return { job: jobs.toJobDto(job) };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/job-draft$/,
    run: async (request, _params, url) => {
      const { userId } = requireCaller(request);
      const id = url.searchParams.get("id") ?? undefined;
      if (id && !isUuid(id)) throw notFound();
      return jobs.readJobDraft(userId, id);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/v1\/me\/job-draft$/,
    run: async (request) => {
      const { userId } = requireCaller(request);
      return jobs.patchJobDraft(userId, await parseBody(request, draftPatchBody));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/me\/job-draft\/reset$/,
    run: async (request) => {
      const { userId } = requireCaller(request);
      const { draftId } = await parseBody(request, draftResetBody);
      return jobs.resetJobDraft(userId, draftId);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/team-jobs$/,
    run: async (request) => {
      const { userId } = requireCaller(request);
      const brief = await parseBody(request, teamBody);
      return jobs.queueTeamJobBrief(userId, brief as jobs.TeamJobBrief);
    },
  },
  // --- admins
  {
    method: "POST",
    pattern: /^\/v1\/admin\/jobs\/([^/]+)\/(approve|reject)$/,
    run: async (request, [id, action]) => {
      const adminId = requireAdmin(request);
      if (!action || !ADMIN_ACTIONS.has(action)) throw notFound();
      const job = await jobs.transitionOwnedJob(idParam(id), action as jobs.JobAction, adminId, "admin");
      return { job: jobs.toJobDto(job) };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/jobs\/([^/]+)\/remove$/,
    run: async (request, [id]) => {
      const adminId = requireAdmin(request);
      const { reason } = await parseBody(request, adminRemoveBody);
      return { job: await jobs.removeJobByAdmin(idParam(id), adminId, reason) };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/jobs\/([^/]+)\/republish$/,
    run: async (request, [id]) => {
      const adminId = requireAdmin(request);
      return { job: await jobs.republishImportedJob(idParam(id), adminId) };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/companies\/([^/]+)\/pause-jobs$/,
    run: async (request, [id]) => {
      const adminId = requireAdmin(request);
      const { reason } = await parseBody(request, pauseCompanyBody);
      return { pausedJobIds: await jobs.pausePublishedJobsOfCompany(idParam(id), adminId, reason) };
    },
  },
  // --- ingestion
  {
    method: "POST",
    pattern: /^\/v1\/imported-jobs$/,
    run: async (request) => {
      const input = await parseBody(request, importedBody);
      return jobs.saveImportedJob(input as jobs.ImportedJobWrite);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/imported-jobs\/expire$/,
    run: async (request) => {
      const { jobIds, reason } = await parseBody(request, expireImportedBody);
      return { expired: await jobs.expireImportedJobs(jobIds, reason) };
    },
  },
  // --- schedulers
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/expire-jobs$/,
    run: async () => ({ ok: true, expired: await jobs.expireJobs() }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/tasks\/expiring-jobs$/,
    run: async () => ({ jobs: await jobs.listJobsExpiring() }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/fx-rates$/,
    run: async () => ({ ok: true, ...(await jobs.refreshFxRates()) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/job-skills$/,
    run: async () => ({ ok: true, ...(await jobs.backfillJobSkills()) }),
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) {
    return httpErrorResponse(validationError(error.issues));
  }
  reportError(error, "jobs-service");
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal error" } },
    { status: 500 },
  );
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        const result = await route.run(request, match.slice(1), url);
        if (result instanceof Response) return result;
        return Response.json(result, { headers: { "cache-control": "no-store" } });
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
