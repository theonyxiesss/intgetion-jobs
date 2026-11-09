import { HttpError, logger } from "@intgetion/kit";
import type { JobsPorts } from "../ports";

export type Endpoint = { url: string; token: string };

export type RemoteConfig = {
  platform: Endpoint;
  taxonomy: Endpoint;
  companies: Endpoint;
  billing: Endpoint;
  notifications: Endpoint;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Ports answered by the extracted services (taxonomy, companies, billing,
 * notifications) and by the platform for the rest (auth, limits, moderation,
 * applications, matching, IndexNow) until those modules move out.
 */
export function httpJobsPorts(config: RemoteConfig): JobsPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 5000;
  const json = { "content-type": "application/json" };

  async function call(to: Endpoint, path: string, init: RequestInit = {}) {
    return doFetch(`${to.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${to.token}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  async function ok(to: Endpoint, path: string, init: RequestInit = {}) {
    const response = await call(to, path, init);
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response;
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: json, body: JSON.stringify(body) });

  return {
    async activeUser(userId) {
      const response = await call(config.platform, `/api/internal/jobs/active-user/${encodeURIComponent(userId)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`active-user answered ${response.status}`);
      return (await response.json()) as { id: string; platformRole: string };
    },
    async rateLimit(bucket, key) {
      const path = "/api/internal/jobs/rate-limit";
      const response = await call(config.platform, path, post({ bucket, key }));
      if (response.status === 429) {
        throw new HttpError(429, "RATE_LIMITED", "Too many requests", undefined, {
          "retry-after": response.headers.get("retry-after") ?? "60",
        });
      }
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    },
    async enqueueModeration(input) {
      await ok(config.platform, "/api/internal/jobs/moderation-queue", post(input));
    },
    async normalizeSkill(raw, source) {
      return (await ok(config.taxonomy, "/v1/skills/normalize", post({ raw, source }))).json();
    },
    async extractSkillIds(text) {
      const response = await ok(config.taxonomy, "/v1/skills/extract", post({ text }));
      return ((await response.json()) as { skillIds: string[] }).skillIds;
    },
    async findMemberRole(companyId, userId) {
      const path = `/v1/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/role`;
      const response = await call(config.companies, path);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return ((await response.json()) as { role: string | null }).role;
    },
    async companiesForUser(userId) {
      const response = await ok(config.companies, "/v1/me/companies", { headers: { "x-user-id": userId } });
      return ((await response.json()) as { companies: { id: string; origin: string; role?: string }[] }).companies.map(
        (company) => ({ id: company.id, origin: company.origin, role: company.role ?? "member" }),
      );
    },
    async promotedHireJobIds() {
      const response = await ok(config.billing, "/v1/promoted-jobs");
      return ((await response.json()) as { jobIds: string[] }).jobIds;
    },
    async companyHasActiveTeam(companyId) {
      const response = await ok(config.billing, `/v1/companies/${encodeURIComponent(companyId)}/active-team`);
      return ((await response.json()) as { active: boolean }).active;
    },
    async activeCandidateIds(jobId) {
      const response = await ok(config.platform, `/api/internal/jobs/${encodeURIComponent(jobId)}/active-candidates`);
      return ((await response.json()) as { candidateIds: string[] }).candidateIds;
    },
    async enqueueMatchJob(jobId) {
      await ok(config.platform, `/api/internal/jobs/${encodeURIComponent(jobId)}/match`, { method: "POST" });
    },
    async notify(type, recipientIds, payload) {
      try {
        await ok(config.notifications, "/v1/notify", post({ type, recipientIds, payload }));
      } catch (error) {
        logger.error({ err: error, type }, "jobs: notify failed");
      }
    },
    async submitToIndexNow(paths) {
      await ok(config.platform, "/api/internal/jobs/indexnow", post({ paths }));
    },
  };
}
