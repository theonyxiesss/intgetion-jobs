# INTGETION Jobs Service

Jobs for INTGETION JOB LIST: the job lifecycle (create, edit, publish, pause, close, extend, admin approve/reject/remove), status history, saved drafts, risk score, skills and languages, Team-plan jobs, imported jobs from feeds, FX rates for salary comparison, skill backfill, and the public read side — search with filters and full text, job pages, promoted jobs, company job lists, catalog counts, sitemap entries and RSS building.

Runs as its own HTTP process with its own tables and migration. Developed separately; the platform is not wired to it yet.

Not here (they stay in the platform): the paid hire flow (`hire-post`, which creates a company, a job and a shared profile in one step, and confirming a draft into it), the Telegram channel alert of new jobs, and all job UI.

## Run

```bash
npm install
cp .env.example .env   # fill in values
npm run migrate        # job tables only
npm run dev            # http://localhost:4080
```

Checks: `npm run typecheck`, `npm test`. Integration tests (including a p95 < 500 ms search check on 5,000 rows) run only when `DATABASE_URL` is set.

## How callers talk to it

Every request except `GET /health` needs `Authorization: Bearer <JOBS_SERVICE_TOKEN>`. Routes acting for a person need `x-user-id`; platform admins add `x-user-role: admin` (the platform checked the session); the risk score reads `x-user-email` when present. The caller is checked before the body. Search answers carry `server-timing: jobs;dur=…`. Errors are `{ "error": { "code", "message", "details?" } }`. Public rate limiting and caching headers are the platform's job.

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | — | `{ ok }` |
| GET | `/v1/jobs?…filters&locale` | public | search (no viewer) |
| POST | `/v1/jobs/search` | platform | `{ query, locale, signedIn, hiddenJobIds, hiddenCompanyIds, syndicatedOnly? }` |
| GET | `/v1/jobs/promoted?locale` | public | promoted hire jobs |
| POST | `/v1/jobs/by-ids` | module | `{ ids, locale }` |
| GET | `/v1/jobs/:id?locale` | public / member / admin | job page; unpublished only for members and admins |
| GET | `/v1/jobs/:id/closed-context` | public | category and skills of a closed job |
| GET | `/v1/companies/:id/jobs?locale` | public | published jobs of a company |
| GET | `/v1/catalog/count`, `/v1/catalog/skills?locale`, `/v1/sitemap?limit`, `/v1/demand` | public | catalog numbers, skill options, sitemap rows, demand |
| POST | `/v1/jobs` | recruiter | create (201); limited per company |
| GET | `/v1/me/jobs?companyId` | person | own company jobs |
| PATCH | `/v1/jobs/:id` | recruiter | edit; an unverified company's edit goes back to review |
| POST | `/v1/jobs/:id/(publish\|pause\|close\|extend)` | recruiter | status change |
| GET / PATCH | `/v1/me/job-draft`, POST `/v1/me/job-draft/reset` | person | the saved hire form draft |
| POST | `/v1/team-jobs` | person | Team-plan job from a brief |
| POST | `/v1/admin/jobs/:id/(approve\|reject\|remove\|republish)` | admin | moderation decisions |
| POST | `/v1/admin/companies/:id/pause-jobs` | admin | pause a company's published jobs |
| POST | `/v1/imported-jobs`, `/v1/imported-jobs/expire` | ingestion | write or expire feed jobs |
| POST | `/v1/tasks/expire-jobs`, `/v1/tasks/fx-rates`, `/v1/tasks/job-skills`; GET `/v1/tasks/expiring-jobs` | scheduler | expiry, ECB rates, skill backfill, expiring list |

Recruiter = owner, admin or recruiter of the job's company (asked from companies).

## What it calls

| Service | Calls |
|---|---|
| taxonomy | `POST /v1/skills/normalize`, `POST /v1/skills/extract` |
| companies | `GET /v1/companies/:id/members/:userId/role`, `GET /v1/me/companies` |
| billing | `GET /v1/promoted-jobs`, `GET /v1/companies/:id/active-team` |
| notifications | `POST /v1/notify` (`job.closed`; failures logged, never block) |
| platform (`PLATFORM_URL`, `PLATFORM_CALLBACK_TOKEN`) | `GET /api/internal/jobs/active-user/:id` (`{ id, platformRole }` or 404), `POST /api/internal/jobs/rate-limit` (`{ bucket, key }` → 2xx or 429), `POST /api/internal/jobs/moderation-queue`, `GET /api/internal/jobs/:id/active-candidates` (`{ candidateIds }`), `POST /api/internal/jobs/:id/match`, `POST /api/internal/jobs/indexnow` (`{ paths }`) |

Queueing for review happens inside the job transaction; an in-process adapter writes with that transaction.

## Data

Tables owned by jobs: `jobs`, `job_skills`, `job_languages`, `job_status_history`, `job_drafts`, `fx_rates`, and types `job_status`, `job_source`, `application_method`, `cefr_level` (shared ones — `employment_type`, `work_format`, `job_seniority`, `salary_*`, `skill_level` — are created only when missing). One migration, `migrations/0006_jobs.sql`, generated from a schema dump of a database migrated to the latest platform state; a dump of the result matches the platform exactly. On a live database it changes nothing; checked against a non-superuser owner with rows present.

Reads (never writes): `companies` and `company_members` (companies), `skills` (taxonomy), `import_sources` and `job_sources` (ingestion), `users.created_at` for the risk score. Needs `pg_trgm` from taxonomy and `public.set_updated_at`. CI applies `test/sql/pre/*` (platform helpers and the real companies migration), runs the migration, then `test/sql/post/*` (ingestion tables that reference jobs).

## Packages inside

- `.` — service functions, `toJobDto`, `buildRss`, `setJobsPorts`
- `./schemas` — `createJobInput`, `patchJobInput`, `jobFields`
- `./ports` — `setJobsPorts()`
- `./server` — `createApp()` HTTP handler

Depends on `@intgetion/kit` (v0.3.1), `@intgetion/taxonomy` (v0.3.0, marker vocabulary) and `@intgetion/companies` (v0.1.1, company marks and free-email rules) by git tag.
