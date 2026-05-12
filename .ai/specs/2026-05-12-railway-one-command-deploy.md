# Railway One-Command Deployment from the Open Mercato CLI

> Status: **Draft / Pending Implementation**
> Scope: Open Source edition. No enterprise overlay.
> Related but distinct: `apps/docs/docs/installation/railway.mdx` (legacy Deploy-on-Railway button) — flagged as outdated; this spec supersedes it.

## TLDR

After running `create-mercato-app` and `git init`, a user should be able to run a **single command** — `mercato deploy railway` — and end up with a deployed, healthy Open Mercato instance at a public Railway URL printed to stdout. No dashboard clicks, no copy-paste of template URLs, no manual Postgres/Redis provisioning.

The command:

1. Authenticates to Railway via a Personal Access Token (PAT) read from `RAILWAY_TOKEN` or an interactive prompt.
2. Drives the **Railway public GraphQL API** at `https://backboard.railway.com/graphql/v2` directly for as many steps as possible — project create, environment create, plugin (Postgres/Redis) provisioning, variable upsert, deployment trigger, domain provisioning, status polling, log streaming.
3. Falls back to shelling out to the `railway` CLI **only** for steps the public API does not cover today — specifically "deploy from local source" (`railway up`) if our verification confirms the GraphQL `serviceInstanceDeploy*` mutations cannot accept a local tarball without a connected git source. See **Open Decision A** in the Risks section.
4. Ships a minimal, repo-owned Railway configuration inside the `create-mercato-app` template (`railway.toml`, `Dockerfile`, `scripts/railway-start.sh`, `scripts/railway-healthcheck.ts`) so the build/run contract is committed to user code, not hidden in a Railway-side template we no longer control.
5. Persists Railway resource IDs (project, environment, service, plugins) in `.mercato/railway.json` inside the user's repo so re-runs are **idempotent** — the second invocation updates the existing project rather than creating a duplicate.
6. Prints the live URL, the Railway dashboard URL, and a short post-deploy checklist.

The spec is honest about uncertainty. Every Railway API operation that we have not personally verified against a live Railway account during spec authoring is annotated `// VERIFY`. The implementation PR's first phase is "verify all `// VERIFY` markers against a current Railway introspection before writing the production code."

## Overview

### Why now

Open Mercato already publishes a Railway Deploy button at `https://railway.com/deploy/TKvo95` (referenced in `apps/docs/docs/installation/railway.mdx`). That template is unmaintained, points at a stale stack, and — most importantly — depends on a Railway-hosted template definition we no longer own or control. New adopters either get a stale deploy or no deploy at all.

A first-class CLI command shifts the deployment contract **into our own repo**. The Railway config (services, build commands, env-var matrix, healthcheck) lives in the scaffolded template and follows the user's app's lifecycle. Deployment becomes a code review concern, not a one-time external configuration.

### Why not just rebuild the Railway template

The legacy template approach (`railway.com/deploy/<id>` button) suffers from three structural problems we want to leave behind:

1. **Single-tenant config blob.** A Railway template is one fixed graph of services + env vars. Customizing it (e.g., adding a worker service, swapping Postgres for an external DB) requires forking the template, not changing app code.
2. **Out-of-band update cadence.** Updating the template requires a Railway dashboard session by whoever owns the template account. There is no PR, no review, no changelog.
3. **No idempotent re-deploy.** "Deploy on Railway" always creates a *new* project. There is no path to push an update to an existing user-owned project from the same source.

A CLI-driven flow fixes all three: the config is code, the deploy is repeatable from a local working tree, and the user always owns the resulting Railway project from the first call.

### What's still informational, not committed

We **describe** the conceptual Railway template shape (services, env-var matrix, build/run contract) in this spec so the implementer has a clear target. We do **not** assume the existing `railway.com/deploy/TKvo95` template definition still works or can be inspected. The implementation PR builds the Railway service graph from scratch via API calls.

### External References

None for spec authoring. Implementation must verify against:
- Railway public API reference: `https://docs.railway.com/reference/public-api`
- Railway CLI source / docs: `https://docs.railway.com/reference/cli-api`
- Railway templates documentation (for nomenclature alignment only): `https://docs.railway.com/reference/templates`

URLs are listed for context; the implementer must re-verify they still resolve and reflect current schema before relying on them.

## Problem Statement

### P1 — There is no one-command deploy from a fresh `create-mercato-app` repo

Today a user who runs `npx create-mercato-app my-shop && cd my-shop && git init` has no automated path from "I have an app on disk" to "I have a deployed app at a URL." Their options are:

- **Manual Railway dashboard.** Create project → add services → wire env vars → connect GitHub → push to deploy. ~15 manual steps, easy to misconfigure.
- **Deploy button** (legacy). Opens a Railway template we no longer maintain.
- **`railway` CLI by hand.** Requires the user to know which services to provision, which env vars to set, which build/start commands to configure.

There is no first-class Open Mercato CLI flow that subsumes all of this.

### P2 — The legacy Railway docs reference resources we no longer control

`apps/docs/docs/installation/railway.mdx` links to a template (`railway.com/deploy/TKvo95`) whose owner credentials and update workflow are not part of this repo. We cannot reproduce or evolve the template from this codebase. Users following that doc may land on a deploy that uses outdated dependencies or missing modules.

### P3 — Deployment config drifts when it lives outside the repo

When the Railway service graph lives in a Railway-hosted template, every change to the app's build/run contract (new env var, new worker service, new healthcheck) requires a coordinated edit in two places. Drift is inevitable. We want the Railway config in the repo, versioned and reviewed.

### P4 — Re-deploy is not idempotent

Even when users do figure out a working Railway setup, "re-run the same flow on a future day" tends to either (a) create a duplicate project or (b) require the user to manually navigate to the existing project. A CLI that persists resource IDs locally and does **upsert** semantics removes that friction.

## Proposed Solution

> The proposed solution is organized as five sections — **Command surface**, **Architecture**, **Data Models**, **API Contracts**, and **End-to-end flow**. The canonical `.ai/specs/AGENTS.md` headings (Architecture, Data Models, API Contracts) are explicit anchors below so a reviewer can map this spec onto the standard structure; their content lives in the named subsections referenced from each anchor.

### Command surface

A single new top-level command on the `mercato` CLI (the existing `packages/cli` bin):

```
mercato deploy railway [options]
```

Why `mercato deploy railway` and not `create-mercato-app --deploy railway`:

- `create-mercato-app` is a one-shot scaffolder. Deployment is a recurring operation (deploy + redeploy + status). Coupling it to scaffolding would force users to re-scaffold to redeploy.
- The `mercato` bin already runs inside scaffolded apps and has access to the app's `package.json`, `.env`, modules registry, and generated config. Deployment naturally belongs there.
- Future-proofing: `mercato deploy <provider>` is the natural namespace for non-Railway providers (Fly, Render, Coolify, etc.) when those specs land.

Optional follow-up sugar (out of scope here): `create-mercato-app --deploy railway` may pass through to `mercato deploy railway` at the end of scaffolding once the deploy command is stable. Tracked, not built in this spec.

### Flags

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `--project <name>` | string | derived from `package.json` `name` | Railway project name. If a `.mercato/railway.json` exists, this flag is ignored unless `--force-rename` is also passed. |
| `--env <name>` | string | `production` | Railway environment name. Multiple invocations with different `--env` values create sibling environments under the same project. |
| `--service <name>` | string | `mercato-app` | Service name for the Next.js app. |
| `--worker` | boolean flag | true | Provision a secondary service running the queue worker. `--no-worker` disables. |
| `--region <id>` | string | Railway default | Railway region. `// VERIFY` accepted region IDs against Railway API. |
| `--env-file <path>` | string | `.env.production` if present, else `.env` | Local env file whose entries are uploaded as Railway service variables. Keys matching the protected pattern (see Security) are auto-generated when missing. |
| `--domain <fqdn>` | string | (none) | Attach a custom domain (requires user to own DNS). When omitted, a Railway-provided `*.up.railway.app` subdomain is provisioned. |
| `--token <value>` | string | `RAILWAY_TOKEN` env | Override token source. Logged-redacted; never echoed verbatim. |
| `--non-interactive` | boolean | false (true when `CI=true`) | Disable any interactive prompt. Fails fast if a required input is missing. |
| `--dry-run` | boolean | false | Plan only. Prints the GraphQL operations and env-var diff that *would* execute, exits 0. No mutations to Railway. |
| `--cleanup` | boolean | false | Delete the Railway project recorded in `.mercato/railway.json` (after explicit confirmation when interactive). |
| `--write-env` | boolean | false | After successful deploy, write any auto-generated secrets back to the local env file. Default off — secrets live only on Railway. |
| `--force-rename` | boolean | false | Allow `--project` to overwrite the project name on an already-recorded project. |
| `--verbose` | boolean | false | Print each GraphQL operation (request + redacted response). |

The set is small on purpose. Anything else (multi-region, multi-service custom topology, separate Redis instance per env) requires a follow-up spec.

### Credential handling

The CLI reads its Railway PAT from, in order of precedence:

1. `--token <value>` flag.
2. `RAILWAY_TOKEN` environment variable.
3. A file at `~/.config/open-mercato/railway.json` with `{ "token": "<value>" }` (mode `0600`).
4. Interactive prompt — only when stdin is a TTY *and* `--non-interactive` is not set. The prompt shows a one-line instruction: "Create a token at https://railway.com/account/tokens (Account Settings → Tokens), paste here."

After a successful interactive prompt, the CLI offers to persist the token to `~/.config/open-mercato/railway.json`. Default answer is **no**; persisting is opt-in. The file is created with mode `0600` and is **never** committed because it lives in the user's home directory, not the repo.

The token is never logged. `--verbose` redacts it to `Bearer ****` in any echoed request line.

### Idempotency contract

The CLI persists Railway resource identifiers in **two** locations:

- `.mercato/railway.json` (committed by default — see gitignore note below) records: `projectId`, `environmentId`, `serviceId`, `workerServiceId` (when `--worker`), `pluginIds` (postgres + redis), `domainId`, `lastDeployId`, and the CLI version that wrote them. Includes a `schemaVersion` so future CLI versions can migrate the file safely.
- `~/.config/open-mercato/railway.json` (per-user, not committed) records only the auth token.

**Important — template `.gitignore` interaction.** `packages/create-app/template/gitignore` (and the legacy `apps/mercato/.gitignore`) already contains a blanket `.mercato/` rule that hides the entire directory from git. To make committing `.mercato/railway.json` actually work, the scaffolded template MUST include an allowlist entry alongside the existing rule:

```gitignore
.mercato/
!.mercato/railway.json
```

The implementation PR MUST update `packages/create-app/template/gitignore` accordingly. Without the allowlist line, `.mercato/railway.json` would be silently untracked and re-runs from a fresh clone would create a duplicate Railway project — exactly the failure mode this state file is meant to prevent.

Whether to commit `.mercato/railway.json` at all is a real call. Recommended default: **commit it**. Reasons: it contains no secrets, only opaque Railway IDs; committing it lets the next teammate run `mercato deploy railway` and update the *same* project rather than create a duplicate. Add an explicit `--no-track` CLI flag for users who prefer to keep it untracked (it tells the CLI to skip the allowlist line and write a `.mercato/railway.json.local` instead). The spec implementer MUST add a section to the user docs explaining the tradeoff.

On every run, the CLI:

1. Reads `.mercato/railway.json` if present.
2. For each recorded ID, issues a `project { id }` / `service { id }` / `environment { id }` lookup against the Railway API to confirm the resource still exists and is owned by the authenticated PAT's account.
3. For any missing resource, recreates it and updates the file.
4. For any drifted name (e.g., user passed `--project foo` but the recorded project's name is `bar`), either renames (when `--force-rename` is set) or fails with a clear message pointing the user at `--cleanup` or `--force-rename`.

### Resource scoping

By default the deploy uses the PAT owner's **personal Railway account** as the workspace. A future flag `--workspace <id>` (out of scope here) will allow team workspaces. The implementer MUST confirm the API surface for listing workspaces and use the personal workspace as default. `// VERIFY` Railway workspace API shape.

## Architecture

The architecture spans two concerns: (1) how the CLI talks to Railway's API, and (2) what the deployed Railway project graph looks like. Both are detailed below, and the spec's per-flow state machine is documented under **End-to-end flow**.

- **CLI → Railway integration** — see *Railway integration approach* immediately below.
- **Deployed project graph** — see *Railway template & project structure*.
- **Per-step state machine and resumability** — see *End-to-end flow*.

### Railway integration approach

#### Endpoint and auth

- Base URL: `https://backboard.railway.com/graphql/v2`
- Auth header: `Authorization: Bearer <RAILWAY_TOKEN>`
- Content-Type: `application/json`
- Each request body is a JSON `{ "query": "...", "variables": {...}, "operationName": "..." }` blob.

The CLI maintains a thin typed GraphQL client (single file) that:

- Sends the operation.
- Surfaces `errors[].message` to the user verbatim when present.
- Retries idempotent reads (introspection, lookups) with exponential backoff on 5xx and on Railway-side `INTERNAL_ERROR`.
- Never retries mutations automatically. Mutation failures bubble up; idempotency is recovered by the per-step state file, not by blind retry.

#### Operations used

The list below is the **target set**. Each is `// VERIFY` and the implementer must confirm each operation name, argument shape, and return shape against a current Railway introspection before writing the wire format. We deliberately do not paste long inline GraphQL strings into this spec since they will drift.

| Step | Operation kind | Operation name (`// VERIFY`) | Purpose |
|------|----------------|------------------------------|---------|
| Auth check | query | `me` | Confirm token validity, capture user id. |
| Workspace list | query | `me { workspaces }` | Default to personal workspace. |
| Project lookup | query | `project(id: $id)` | Confirm recorded `projectId` still exists. |
| Project create | mutation | `projectCreate(input: { name, description })` | Idempotent: only called if no `projectId` recorded. |
| Project list | query | `projects(filter: { name: $name })` | Pre-create dedupe by name. |
| Environment lookup | query | `environment(id: $id)` | Confirm recorded env. |
| Environment create | mutation | `environmentCreate(input: { projectId, name })` | Created only if not recorded. |
| Plugin (Postgres) | mutation | `pluginCreate(input: { projectId, name: "postgresql" })` | Provision managed Postgres. `// VERIFY` whether Railway still exposes Postgres as a "plugin" or has migrated to "database services." |
| Plugin (Redis) | mutation | `pluginCreate(input: { projectId, name: "redis" })` | Provision managed Redis. Same `// VERIFY` note. |
| Service create | mutation | `serviceCreate(input: { projectId, name, source })` | Create app service. `source` accepts either `{ repo, branch }` (GitHub) or — `// VERIFY` — a local-source variant. See Open Decision A. |
| Variable upsert | mutation | `variableCollectionUpsert(input: { projectId, environmentId, serviceId, variables: [...] })` | Bulk env-var apply. `// VERIFY` exact name; older docs called it `variableUpsert` per-key. |
| Deployment trigger | mutation | `serviceInstanceDeploy(input: { serviceId, environmentId })` | Start a build/deploy. `// VERIFY` mutation name (also seen as `deploymentTrigger`). |
| Deployment status | query | `deployment(id: $id) { status, url, logs }` | Polled every 5s (capped). `// VERIFY` whether logs are returned in this query or via a separate `deploymentLogs` subscription/query. |
| Deployment logs | query/subscription | `deploymentLogs(deploymentId: $id, ...)` | Streaming logs to stdout. WebSocket subscription if available; HTTP poll fallback. `// VERIFY`. |
| Domain provision | mutation | `serviceDomainCreate(input: { serviceId, environmentId })` | Provision `*.up.railway.app` subdomain. `// VERIFY`. |
| Custom domain | mutation | `customDomainCreate(input: { serviceId, environmentId, domain })` | When `--domain` is set. |
| Cleanup | mutation | `projectDelete(input: { id })` | `--cleanup` flag. |

#### When the API is insufficient: `railway` CLI fallback

If `// VERIFY` confirms that the Railway public API cannot accept a local-source tarball for build (i.e., `serviceCreate` / `serviceInstanceDeploy` both require a connected git source), the implementation MUST take **one** of two paths and document which it chose:

- **Path A — GitHub auto-create.** Require `GH_TOKEN` (or fall back to `gh auth status`). Create a private GitHub repo under the user's account, push the current branch, then call `serviceCreate` with `source: { repo, branch }`. Users without `gh` installed get a clear error pointing at `https://cli.github.com`.
- **Path B — `railway` CLI shell-out.** Detect the `railway` binary on `PATH`. If absent, the CLI offers to install it (npm: `@railway/cli`) or instructs the user to install it. Then shell out: `railway link --project <id> --environment <id> --service <id>` followed by `railway up --service <id>`. Stream stdout/stderr to the user.

**Recommendation:** Path B (local source via `railway up`) is the better default UX (no GitHub dependency for users who don't want their app code on GitHub yet). Path A is the better default for CI environments where a `railway` binary can't be assumed. The implementation MUST auto-detect: if `railway` is on `PATH` and the user is on an interactive TTY, prefer Path B; otherwise Path A with a clear `GH_TOKEN` requirement message.

Both paths converge on the same post-deploy state: a service exists, a deployment is triggered, the CLI polls until success/failure, and the rest of the flow (variables, domain, logs) runs identically via the GraphQL API. The fallback is contained to the "trigger first build" step.

`// VERIFY` Whether Railway has shipped a public "source upload" API since this spec was written. If it has, both Path A and Path B are obsolete and we revert to pure API.

## Railway template & project structure

> **Informational only.** We do not have access to the prior Railway-hosted template at `railway.com/deploy/TKvo95`. The shapes below describe what the implementation PR should construct via API calls from a clean slate.

### Service graph

A successful deploy creates the following Railway resources under one project:

```
project: <project-name>
├── environment: production
│   ├── plugin: postgresql            (managed)
│   ├── plugin: redis                 (managed)
│   ├── service: mercato-app          (Next.js app)
│   │   ├── domain: <random>.up.railway.app  (or --domain)
│   │   └── healthcheck: /api/healthz
│   └── service: mercato-worker       (only when --worker)
└── (additional environments via --env staging, etc.)
```

Optional future services not built in this spec:

- `mercato-cron` — a service running scheduled jobs via `node-cron` or Railway's native cron triggers.
- Object-storage proxy — only if the user explicitly opts in to S3-compatible storage (`--object-storage` flag, out of scope).

### Required environment variables (matrix)

The CLI computes and injects the following env-var set into each Railway service. Values come from three sources: (1) auto-derived from Railway-injected variables (`DATABASE_URL`, `REDIS_URL`), (2) auto-generated secrets, (3) the user's local `--env-file`.

| Variable | Source | Default | Notes |
|----------|--------|---------|-------|
| `DATABASE_URL` | Railway Postgres plugin | (auto) | Railway injects `PGHOST`, `PGUSER`, etc.; CLI binds the canonical `DATABASE_URL` reference variable using `${{ Postgres.DATABASE_URL }}` syntax. `// VERIFY` exact Railway reference-var syntax. |
| `REDIS_URL` | Railway Redis plugin | (auto) | Same `${{ Redis.REDIS_URL }}` reference. |
| `NODE_ENV` | static | `production` | |
| `NEXT_TELEMETRY_DISABLED` | static | `1` | Avoid telemetry in CI. |
| `NEXT_PUBLIC_APP_URL` | derived | `https://<domain>` | Computed after domain provisioning; updated on `--domain` change. |
| `APP_URL` | derived | same as above | Server-side mirror. |
| `OM_AI_PROVIDER` | env-file | `openai` (matches repo default) | Honors `OM_AI_PROVIDER` from the local env file. |
| `OM_AI_MODEL` | env-file | `gpt-5-mini` (matches repo default) | Honors `OM_AI_MODEL` from the local env file. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | env-file | (none) | CLI requires at least one to be present in `--env-file`. Fails fast if all three are missing and `--non-interactive` is set; prompts in TTY mode. |
| `SESSION_SECRET` | auto-gen | 64-byte hex | Generated once per project, stored on Railway. Only written back locally if `--write-env` is set. |
| `ENCRYPTION_KEY` | auto-gen | 32-byte base64 | Same handling. Used by `findWithDecryption` helpers per `BACKWARD_COMPATIBILITY.md` encryption contract. |
| `JWT_SECRET` | auto-gen | 64-byte hex | Same handling. |
| `PORT` | Railway-injected | (auto) | Railway sets this; the app's start script must respect it. |

The CLI's env-var module computes the final variable set as a pure function of `(env-file contents, recorded state, Railway-injected references)` and runs a single `variableCollectionUpsert`. This makes the operation diff-able under `--dry-run`.

The CLI MUST refuse to upload any variable whose **value** matches the user's PAT or any obvious credential pattern that is not in the allowlist — defense in depth against accidental token leakage.

### Build configuration: Nixpacks vs. Dockerfile

**Decision: Dockerfile in the template.**

Justification:

- The Open Mercato monorepo (and its scaffolded standalone apps) has non-trivial build steps: `yarn generate`, optional `yarn build:packages`, Next.js standalone output, and module discovery via the generated `.mercato/` directory. Nixpacks' default Next.js detection misses the generate step.
- A committed `Dockerfile` is reviewable, reproducible offline, and survives Railway-side Nixpacks default changes.
- The template already ships a `Dockerfile` (verified in `packages/create-app/template/Dockerfile`), so this aligns with the existing scaffolding.

`railway.toml` in the template root declares:

```toml
# // VERIFY exact railway.toml schema — Railway has rotated this format in the past.
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/healthz"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
startCommand = "./scripts/railway-start.sh"
```

The worker service (when `--worker`) uses the same Dockerfile but a different start command: `./scripts/railway-worker.sh`. The script runs the queue worker via the `mercato` CLI. As of this spec, the current command is `yarn mercato queue worker --all` (verified against `packages/cli/src/mercato.ts`); the lazy auto-spawn supervisor introduced by the recent queue-supervisor work (`packages/cli/src/lib/queue-worker-supervisor.ts`) is a candidate replacement when `OM_AUTO_SPAWN_WORKERS_LAZY=true`. The implementation PR MUST pick one (see Decision E) and `// VERIFY` against the current `packages/queue/AGENTS.md` before shipping.

### Start scripts

Two scripts ship in the template:

- `scripts/railway-start.sh` (app service):
  1. `yarn db:migrate` — apply pending migrations on every boot. Idempotent.
  2. `if [ ! -d ".mercato/generated" ]; then yarn generate; fi` — re-run module generation if missing (e.g., first cold boot after a fresh image).
  3. Start the Next.js server. The repo's current `apps/mercato/next.config.ts` does NOT set `output: 'standalone'` (verified at spec time), so the default start command is `exec yarn workspace @open-mercato/app start` (which calls `next start`). The implementation PR SHOULD add `output: 'standalone'` to the scaffolded template's `next.config.ts` to shrink deploy images — when it does, the start line changes to `exec node apps/mercato/.next/standalone/server.js`. Pick one and document the choice; do not assume standalone output exists.

- `scripts/railway-worker.sh` (worker service): runs the queue worker entry point. The exact command must match the worker contract declared in `packages/queue/AGENTS.md`.

Both scripts must `set -euo pipefail` and forward `SIGTERM` to the child process so Railway's graceful-shutdown windows work.

### Healthcheck endpoint

The template ships `app/api/healthz/route.ts` (or equivalent) returning:

```
GET /api/healthz
200 { "status": "ok", "db": "up", "redis": "up", "ts": "<ISO>" }
503 { "status": "degraded", "db": "down" | "up", "redis": "down" | "up", "ts": "<ISO>" }
```

The endpoint:

- Pings the DB with `SELECT 1` via the existing ORM connection pool (no new connection per request).
- Pings Redis with a `PING` via the existing cache client.
- Times out each ping at 1500 ms; on timeout marks that backend as `down`.
- Never queries tenant data — pure infrastructure check. No auth, no organization scoping.

Railway uses this for the deployment-success signal and for runtime health monitoring. `healthcheckTimeout = 60` gives the app a generous boot window for the first deploy (migrations + generation).

### Volume requirements

The legacy doc at `apps/docs/docs/installation/railway.mdx` mentions a `/app/apps/mercato/storage` volume for attachments. The implementation PR MUST decide whether to:

- **Ship volume by default** — call the Railway volume-create mutation as part of the flow. `// VERIFY` Railway volume API.
- **Make it opt-in** — `--volume` flag, off by default.

**Recommendation:** opt-in (`--volume <mountPath>`). Users who do not yet have attachment-heavy workflows shouldn't pay for storage they don't use. The CLI prints a clear warning when running without a volume: "Attachments uploaded to this deployment will be lost on redeploy. Re-run with `--volume /app/storage` to enable persistent storage."

## Data Models

**No DB schema, no MikroORM entities, no migration files.** This feature is a CLI tool that talks to an external service; it does not persist any application-level data in the Open Mercato database.

Two local-filesystem state files are introduced, documented in detail elsewhere in this spec:

- `.mercato/railway.json` — per-repo Railway resource identifiers (`projectId`, `environmentId`, `serviceId`, `workerServiceId`, `pluginIds`, `domainId`, `lastDeployId`, `schemaVersion`, CLI version). See *Proposed Solution → Idempotency contract*. Committed by default via an allowlist line in `packages/create-app/template/gitignore`.
- `~/.config/open-mercato/railway.json` — per-user Railway PAT (`{ "token": "..." }`). Mode `0600`. See *Security & secrets → Token storage*.

Both files use a `schemaVersion` integer so future CLI versions can detect and migrate older shapes. The implementation PR MUST define `schemaVersion: 1` in the first release and document the migration policy.

## API Contracts

This spec exposes no new HTTP API routes inside the Open Mercato app — the CLI is a pure outbound caller against Railway's public API.

- **Outbound (Railway public GraphQL):** the full list of operations the CLI calls is enumerated under *Architecture → Railway integration approach → Operations used*. Every operation is marked `// VERIFY` against current Railway introspection.
- **New healthcheck route added by the implementation PR:** `GET /api/healthz` — see *Railway template & project structure → Healthcheck endpoint* for the response contract. Returns `200 { status: "ok", db, redis, ts }` or `503 { status: "degraded", ... }`. No auth, no tenant scoping. Used by Railway's healthcheck and by future ops dashboards.

## End-to-end flow

The single command runs the following steps in order. State transitions are documented so an interrupted run can resume by re-reading `.mercato/railway.json`.

### Step 0 — Local prerequisites

1. Confirm `git` is on `PATH` and the cwd is a git repo (`git rev-parse --git-dir`).
2. Confirm the working tree is clean (`git status --porcelain`). If dirty: fail in `--non-interactive`; warn + prompt in TTY.
3. Confirm Node ≥ the version pinned in the template's `package.json` `engines.node`.
4. Confirm a `package.json` exists at the cwd root and declares an Open Mercato app (look for `@open-mercato/*` dependencies).
5. Confirm a `--env-file` resolves to an existing file. If neither `.env.production` nor `.env` exists, fail with a clear message.

**Persisted state:** none.

### Step 1 — Authenticate with Railway

Resolve token per the precedence in **Credential handling** above. Call the `me` query to validate the token; capture `viewer.id` and `viewer.email`. On 401, print "Token rejected. Generate a new one at https://railway.com/account/tokens" and exit non-zero.

**API call:** `query me { me { id email } }` (`// VERIFY` field names).

**Persisted state:** none (token may be written to `~/.config/open-mercato/railway.json` only after explicit consent).

### Step 2 — Resolve workspace

Call `workspaces` query. Default to the personal workspace unless `--workspace` is supplied. Capture `workspaceId`.

**API call:** `query workspaces { me { workspaces { id name } } }` (`// VERIFY`).

**Persisted state:** `workspaceId` cached in memory for the run.

### Step 3 — Create or look up the project

If `.mercato/railway.json` has a `projectId`, look it up (`query project($id)`). On 404 (project deleted by user out-of-band), prompt to recreate or exit.

Else call `projectCreate(input: { name, workspaceId })`. The `name` is `--project` or derived from `package.json.name`. Pre-check via `projects(filter: { name })` to surface a friendly "a project with this name already exists" error rather than a generic Railway constraint violation.

**Persisted state:** `projectId` written to `.mercato/railway.json` after success.

### Step 4 — Create or look up the environment

`--env` (default `production`). Same lookup-then-create dance.

**Persisted state:** `environmentId`.

### Step 5 — Provision managed Postgres + Redis

For each plugin (`postgresql`, `redis`), if not already recorded:

1. `pluginCreate(input: { projectId, name })` — `// VERIFY` whether Railway still calls these "plugins" or has renamed to "database services."
2. Poll plugin status until `PROVISIONED` (cap: 120 s).
3. Record `pluginIds`.

The plugins expose connection variables (`DATABASE_URL`, `REDIS_URL`) as Railway reference variables. The CLI does **not** copy those values into its own variable upserts; instead, the service's variables include reference syntax (`${{ Postgres.DATABASE_URL }}`). `// VERIFY` the exact reference-var syntax (Railway has used `${{Postgres.DATABASE_URL}}`, `${{shared.DATABASE_URL}}`, and `${{ Postgres.DATABASE_URL }}` in different docs).

**Persisted state:** `pluginIds.postgres`, `pluginIds.redis`.

### Step 6 — Create the app service (and optional worker)

Decision point — see **Railway integration approach → When the API is insufficient**.

- If the GraphQL API supports `serviceCreate` with a local-source upload variant: use it directly.
- Else if `railway` CLI is on `PATH` and stdin is a TTY: create the service shell via API, then shell out to `railway up` for the first build upload.
- Else (CI mode, no `railway` CLI): require `GH_TOKEN`. Create a private GitHub repo via `gh api` calls, push the current branch, then call `serviceCreate(input: { source: { repo, branch } })`.

For `--worker`, repeat with a second service named `mercato-worker`, same Dockerfile, different `startCommand`.

**Persisted state:** `serviceId`, optionally `workerServiceId`, optionally `githubRepoUrl` (when Path A was taken).

### Step 7 — Compute and upload env vars

1. Load `--env-file`.
2. Auto-generate any missing protected secrets (`SESSION_SECRET`, `ENCRYPTION_KEY`, `JWT_SECRET`).
3. Compute the merged variable set per the matrix in **Required environment variables**.
4. Issue a single `variableCollectionUpsert` per service (app, optional worker). `// VERIFY` whether the API requires one upsert per service or supports cross-service bulk upserts.
5. Under `--dry-run`, print a diff: `+ ADD <key>`, `~ CHANGE <key>`, `- REMOVE <key>`, with values redacted to first 3 + last 3 chars.

**Persisted state:** none beyond the run (Railway is the source of truth for env-var state).

### Step 8 — Trigger deployment and stream logs

For each service: call the deployment-trigger mutation (`// VERIFY` exact name). Capture `deploymentId`. Poll `deployment(id)` every 5 s up to 15 min cap (configurable via `--timeout`). Stream logs concurrently — prefer WebSocket subscription if available, else HTTP poll.

Log output is prefixed `[mercato-app]` / `[mercato-worker]` so a user with `--worker` can distinguish streams.

On `FAILED` status, surface the last 100 log lines, print a clear "deployment failed" message, leave Railway state intact (so the user can inspect in the dashboard), and exit non-zero.

**Persisted state:** `lastDeployId` per service.

### Step 9 — Provision domain

For the app service only:

- If `--domain <fqdn>` was supplied: `customDomainCreate(input: { serviceId, environmentId, domain })`. Print the DNS records the user must add (CNAME or A) and **wait** for verification (capped at 5 min, `--no-wait-domain` to skip). On timeout without verification, print the records and exit zero with a "DNS not yet propagated" warning — the deploy itself is still successful.
- Else: `serviceDomainCreate(input: { serviceId, environmentId })` to allocate a `*.up.railway.app` subdomain.

Capture the resulting hostname and update `NEXT_PUBLIC_APP_URL` / `APP_URL` env vars (re-upsert), then trigger a final redeploy of the app service so the new URLs take effect.

**Persisted state:** `domainId`, `appUrl`.

### Step 10 — Print summary

stdout (machine-parseable last lines so CI can grep):

```
Open Mercato deployed to Railway

  Project:     https://railway.com/project/<projectId>
  Environment: production
  App URL:     https://<appUrl>
  Health:      https://<appUrl>/api/healthz
  Worker:      mercato-worker (running)   # only if --worker

  State recorded in .mercato/railway.json
  Token cached in ~/.config/open-mercato/railway.json   # only if user consented

Next steps:
  - Sign in at https://<appUrl>/backend
  - Set up DNS for your custom domain (if applicable)
  - Run `mercato deploy railway --env staging` to deploy a second environment
```

Final line — always — is exactly:

```
DEPLOY_URL=https://<appUrl>
```

so wrapping shell scripts can capture the URL with one `grep`.

## Failure handling

### Per-step resumability

Every step persists its result before the next step starts. A crash between Step 5 and Step 6 leaves `pluginIds` recorded; re-running the CLI skips Step 5 entirely. A crash between Step 7 and Step 8 leaves `serviceId` recorded; re-running re-uploads env vars (idempotent) and re-triggers the deploy.

The CLI prints, at the start of each step, "Step N: <description>" so an interrupted run's logs make the resume point obvious.

### Log streaming

- WebSocket subscription preferred. URL pattern: `wss://backboard.railway.com/graphql/v2` (`// VERIFY`).
- HTTP poll fallback: `query deploymentLogs($id, $after)` every 2 s, paging by cursor.
- Logs are written to stdout in real time. On `--dry-run`, log streaming is skipped (nothing was triggered).

### Timeouts and retries

| Operation | Timeout | Retry policy |
|-----------|---------|--------------|
| Token validation (`me`) | 10 s | 1 retry on 5xx |
| Project/env/service lookups | 10 s each | 1 retry on 5xx |
| Mutations (create/upsert/deploy/cleanup) | 30 s | **no retry** — surface error, let user re-run |
| Plugin provisioning poll | 120 s wall | poll every 5 s |
| Deployment poll | 900 s wall (configurable via `--timeout`) | poll every 5 s |
| Domain DNS verification | 300 s wall | poll every 10 s |

When a wall timeout is hit, the CLI exits non-zero with a clear message including the last-known state and the next step the user can take ("Re-run the command to resume from <step>").

### Cleanup

`mercato deploy railway --cleanup` issues `projectDelete(input: { id: <recorded> })` after explicit confirmation in TTY mode (or immediate execution under `--non-interactive`). Then deletes `.mercato/railway.json`. The user-config token file is **never** touched by `--cleanup`.

A future flag `--cleanup --keep-database` may preserve the Postgres plugin and detach it from the project. Out of scope here.

## Security & secrets

### Token storage

- `~/.config/open-mercato/railway.json` is created with mode `0600`. The CLI refuses to read it if the perms are wider (e.g., world-readable).
- The token is never written to repo files, never to `.mercato/railway.json`, never to CLI logs even under `--verbose`.
- The token is redacted (`Bearer ****`) in any `--verbose` output.
- On Windows the equivalent path is `%APPDATA%\open-mercato\railway.json`. NTFS permissions are not as tight as POSIX `0600`; document this gap and recommend users on Windows scope their PAT narrowly.

### Auto-generated secrets

`SESSION_SECRET`, `ENCRYPTION_KEY`, `JWT_SECRET` are generated **on the user's machine** (using `crypto.randomBytes`) and uploaded to Railway. They are not echoed to stdout, not written to local files, and not persisted in `.mercato/railway.json`. The only place they live is Railway's variable storage.

`--write-env` opts the user into writing them to the local env file as well, useful for matching production locally — but the file is the user's responsibility to keep out of version control.

### Threat model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Leaked `RAILWAY_TOKEN` | High — full project takeover, data exfiltration | Recommend scoped/per-project tokens when Railway supports them. Document token rotation. Refuse to use tokens with overly permissive scopes when detectable. |
| `.mercato/railway.json` in a public repo | Low — only opaque IDs, no secrets | Acceptable to commit by default. Document the `--no-track` opt-out. |
| `--write-env` writes secrets to local file | Medium — user error can commit secrets | Default off. When set, prepend a `# DO NOT COMMIT` warning to the file. CLI verifies `.gitignore` covers the env file before writing; refuses to write if it doesn't. |
| MITM on the GraphQL connection | Low — HTTPS only | TLS-only client. Refuse non-HTTPS endpoints. |
| Compromised Railway plugin (e.g., upstream Postgres image vulnerability) | Out of our control | Document Railway's responsibility; recommend users monitor their Railway project dashboard. |
| CLI executed in a hostile working tree (malicious `package.json` scripts triggered by `yarn install` during validation) | Medium | The CLI does NOT run `yarn install` during deploy. Build runs server-side on Railway in an isolated container. |
| Accidental upload of a developer secret as a Railway env var | Medium | Variable-value scanner refuses upload of patterns matching the user's own PAT or obvious credentials (e.g., `sk-`, `xoxb-`, `gh[pousr]_` prefixes) unless `--allow-secret-passthrough` is set. |

## Testing strategy

### Unit tests (mandatory; CI-gated)

Target: `packages/cli/__tests__/deploy/railway/`.

- **Command parser** — every flag combination, error messages for conflicting flags.
- **Env-var computation** — pure function that takes `(env-file contents, recorded state, Railway-injected reference variable names)` and returns the merged variable set. Snapshot tests for the diff format under `--dry-run`.
- **Idempotency state machine** — given a synthetic `.mercato/railway.json` at every possible partial state, assert the CLI takes the right next step.
- **Token resolver** — precedence order, perm checks on the user-config file, redaction in error messages.
- **GraphQL client** — request shape, error surfacing, retry policy. Mocked transport.

### Integration tests (gated, optional)

Target: `.ai/qa/` (Playwright TS) — but the integration test does **not** drive a browser; it drives the CLI binary against a real Railway sandbox.

- Skipped unless `RAILWAY_INTEGRATION_TOKEN` is set in CI.
- Creates a project with a unique slug (timestamp-suffixed), deploys a no-op fixture app, verifies the URL responds 200 on `/api/healthz`, then runs `--cleanup`.
- Has a hard wall timeout of 15 min.
- Logs a clear "INTEGRATION_SKIPPED" message when the token is absent so CI dashboards do not show false negatives.

### What we cannot test in CI

- Custom-domain DNS verification (depends on real DNS).
- Free-tier resource limits on Railway (depends on the account's plan).
- Long-running deploy success on large projects (CI budget too tight).

The `--dry-run` mode is the substitute. Every PR that touches deploy logic must include a `--dry-run` snapshot test capturing the planned GraphQL operations.

### Manual verification checklist (for the implementation PR's reviewer)

The implementation PR's reviewer must, on a non-trivial fresh Railway account:

1. Run `mercato deploy railway --dry-run` on a freshly-scaffolded app. Confirm the planned operations match the spec.
2. Run `mercato deploy railway` and verify a URL is printed.
3. `curl <url>/api/healthz` returns 200.
4. Re-run `mercato deploy railway`. Confirm no duplicate project is created.
5. Run `mercato deploy railway --env staging` and confirm a second environment exists under the same project.
6. Run `mercato deploy railway --cleanup` and confirm the project disappears from the Railway dashboard.

## Documentation deliverables

The implementation PR ships:

- **New user doc** at `apps/docs/docs/deployment/railway.mdx`. Contents (outline):
  - One-command quickstart.
  - Token setup (link to `https://railway.com/account/tokens`).
  - Flag reference table.
  - Env-var matrix.
  - Idempotency contract & re-deploy semantics.
  - Troubleshooting (token rejected, plugin stuck, deploy failed, DNS not propagated).
  - Cost note (Railway free trial → paid plan).
- **Task Router row** in root `AGENTS.md` mapping "Deploy a freshly-scaffolded Open Mercato app to Railway with one CLI command" to this spec and the new doc page. (Added in *this* PR pointing at the spec only; updated in the implementation PR to also point at the doc.)
- **Banner update** on the existing `apps/docs/docs/installation/railway.mdx` flagging the template button as unmaintained and pointing readers at the new spec / forthcoming doc. (Added in this PR.)
- **Removal/redirect** of the legacy `installation/railway.mdx` is **deferred** to a follow-up cleanup PR after the new doc page is published and indexed.

## Integration Coverage

For the implementation PR (not this spec PR), the following integration tests must exist:

| Path / surface | Test name | Notes |
|----------------|-----------|-------|
| `mercato deploy railway --dry-run` | `cli/deploy/railway/dry-run.spec.ts` | Snapshot of planned GraphQL ops. Mock Railway transport. |
| `mercato deploy railway` (happy path) | `cli/deploy/railway/full-deploy.integration.spec.ts` | Gated by `RAILWAY_INTEGRATION_TOKEN`. |
| `mercato deploy railway` (resume after partial state) | `cli/deploy/railway/resume.spec.ts` | Synthetic `.mercato/railway.json` fixtures. |
| `mercato deploy railway --cleanup` | `cli/deploy/railway/cleanup.integration.spec.ts` | Gated. |
| Token-resolver precedence | `cli/deploy/railway/token-resolver.spec.ts` | Unit. |
| Env-var computation | `cli/deploy/railway/env-vars.spec.ts` | Unit, snapshot. |
| Healthcheck endpoint | `apps/mercato/__tests__/healthz.spec.ts` (or template equivalent) | Verifies DB/Redis ping logic. |

UI paths: none — this is a CLI-only feature.

## Migration & Backward Compatibility

This spec is **additive**:

- New CLI command (`mercato deploy railway`). No existing command is renamed or removed.
- New optional files in the scaffolded template (`railway.toml`, `scripts/railway-start.sh`, `scripts/railway-worker.sh`, `app/api/healthz/route.ts`). Existing apps that don't use Railway are unaffected.
- New state file `.mercato/railway.json`. Doesn't conflict with any existing path.
- New user-config file `~/.config/open-mercato/railway.json`. Per-user, doesn't conflict.

**BC contract surfaces touched:** none. No frozen or stable APIs are changed.

**Deprecation:** the legacy `installation/railway.mdx` doc is flagged but not deleted in this PR. A follow-up cleanup PR may either rewrite it (recommending the new CLI flow) or remove it after a one-minor-version deprecation window per `BACKWARD_COMPATIBILITY.md`.

**No DB migrations.**

**No event-ID changes.**

**No ACL feature additions** (deployment is a developer-side action, not a tenant-side action).

## Risks & Impact Review

### Risk: Railway public API drift

- **Severity:** High while the spec is being implemented; medium long-term.
- **Affected area:** Every Railway GraphQL operation listed in **Operations used**.
- **Mitigation:** Each operation is marked `// VERIFY`. The implementation PR's first phase MUST be a verification step — introspect the live Railway schema, fix mismatches, and capture the verified schema fingerprint in `.ai/runs/` so future maintainers can detect drift.
- **Residual risk:** Railway may break the schema after we ship. We add a CLI-level error that surfaces the raw GraphQL error message and links to `https://docs.railway.com/reference/public-api` so users can self-diagnose without an Open Mercato release.

### Risk: "Deploy from local source" not in the public API

- **Severity:** Medium — affects the single-command UX promise.
- **Affected area:** Step 6 of the end-to-end flow.
- **Mitigation:** Document both Path A (GitHub auto-create) and Path B (shell out to `railway up`). Default selection is automatic based on the user's environment. The spec is honest that the implementer must verify which one is actually possible.
- **Residual risk:** Both paths add a dependency (GitHub or `railway` CLI). If both are unavailable in the user's environment, the deploy fails with a clear "please install one of these" message. There is no third option until Railway ships a public source-upload API.

### Risk: Outdated legacy Railway docs continue to mislead users

- **Severity:** Low — banner mitigates.
- **Affected area:** `apps/docs/docs/installation/railway.mdx`.
- **Mitigation:** Banner update lands with this spec PR. Full rewrite or removal lands with the implementation PR.
- **Residual risk:** A user with a cached doc page may still follow the legacy template. Acceptable.

### Risk: Cost surprise for users on Railway's free trial

- **Severity:** Low — informational.
- **Affected area:** Post-deploy user experience.
- **Mitigation:** The CLI prints a one-line cost note in the post-deploy summary: "Note: Open Mercato requires Railway's Hobby plan or higher (~$5/month base) due to memory requirements." Documented in the new docs page.
- **Residual risk:** Users still surprised. Acceptable — same as any cloud deploy.

### Risk: Token-leak via accidental commit of `~/.config/open-mercato/railway.json`

- **Severity:** Low — file lives outside the repo by default.
- **Affected area:** User's filesystem.
- **Mitigation:** File location is in `$HOME`, not in the repo. `0600` perms.
- **Residual risk:** A user who moves the file into their repo for any reason. Documented as a footgun in the docs page.

### Risk: CLI bugs cause Railway resource leakage (orphaned projects)

- **Severity:** Medium.
- **Affected area:** Railway billing.
- **Mitigation:** `--cleanup` flag. The integration test always cleans up after itself, even on assertion failure (via a `finally` block).
- **Residual risk:** A crash between Step 3 and Step 4 leaves an empty project. Documented; `--cleanup` covers it.

### Risk: User runs deploy from a hostile / shared machine

- **Severity:** Medium.
- **Affected area:** Token cache file.
- **Mitigation:** `0600` perms; `--token` flag lets users avoid the cache entirely.
- **Residual risk:** Same as any local credential store. Out of our scope.

## Final Compliance Report

- **Spec format** — TLDR, Overview, Problem Statement, Proposed Solution (CLI + Railway + Template + Flow), Failure Handling, Security, Testing, Documentation, Integration Coverage, Migration/BC, Risks, Final Compliance, Changelog. ✓
- **AGENTS.md alignment** — references the CLI package (`packages/cli`), the create-app template (`packages/create-app/template`), and the docs app (`apps/docs/docs`). ✓
- **BC contract** — no contract surface changed. Additive only. ✓
- **Naming** — `mercato deploy railway` aligns with future provider namespace `mercato deploy <provider>`. ✓
- **Testing requirements** — unit-test-mandatory + gated-integration-test pattern matches `.ai/qa/AGENTS.md`. ✓
- **Security defaults** — fail-closed: no token in env → fail in CI mode; no envfile → fail; no AI key → fail. ✓
- **Honest uncertainty** — every Railway-API operation marked `// VERIFY` where we have not personally confirmed the current schema. ✓

## Open Decisions (for the implementation PR)

These are deliberately left open by this spec; the implementation PR resolves them with evidence:

- **Decision A — Local source upload.** Confirm whether Railway's public GraphQL API supports source upload without a connected git repo. If yes, neither Path A nor Path B is needed. If no, the implementation defaults to Path B (shell out to `railway up`) and falls back to Path A (GitHub auto-create) only in non-TTY environments.
- **Decision B — Volume default.** Confirm the recommended default for the attachments volume. Spec recommends opt-in via `--volume`.
- **Decision C — Track `.mercato/railway.json` or not.** Spec recommends commit-by-default. The implementation PR may revise after dogfooding.
- **Decision D — `railway.toml` vs. `railway.json`.** Pick one. Spec uses `railway.toml` as the example; the implementer must confirm Railway's current preferred format.
- **Decision E — Worker entry command.** Confirm against `packages/queue/AGENTS.md` what the exact command line is to run the queue worker headlessly.
- **Decision F — `pluginCreate` vs. service-backed databases.** Railway has migrated some database offerings from "plugin" to "service" over time. The implementer must confirm the current API shape and adjust Step 5 accordingly.

## Changelog

- 2026-05-12 — Initial spec authored under `auto-create-pr` (slug `railway-one-command-deploy`). Honors the user-flagged constraint that `apps/docs/docs/installation/railway.mdx` and `railway.com/deploy/TKvo95` are outdated and not assumed to be accessible. Every Railway GraphQL operation is marked `// VERIFY`. Status: **Draft / Pending Implementation**.
