# Railway One-Command Deployment from the Open Mercato CLI

> Status: **Implemented / Live Deployment Flow Validated**
> Scope: Open Source edition. No enterprise overlay.
> Related but distinct: `apps/docs/docs/installation/railway.mdx` (legacy Deploy-on-Railway button) — flagged as outdated; this spec supersedes it.

## TLDR

After running `create-mercato-app` and `git init`, a user should be able to run a **single command** — `mercato deploy railway` — and end up with a deployed, healthy Open Mercato instance at a public Railway URL printed to stdout. No dashboard clicks, no copy-paste of template URLs, no manual Postgres/Redis provisioning.

The command:

1. Authenticates to Railway via an Account token read from `RAILWAY_API_TOKEN`, `--token`, a local cache file, or an interactive prompt.
2. Drives the **Railway public GraphQL API** at `https://backboard.railway.com/graphql/v2` directly for supported operations — project/environment/service creation, database template deployment, variable upsert, deployment/domain operations, status polling, and log streaming.
3. Supports both source paths requested in issue #2414:
   - Git-backed deploy when a usable Railway-supported remote repository exists.
   - Local-source deploy through the supported `railway up` CLI path when no usable remote exists or the user explicitly requests it.
   The default `--source auto` mode prefers Git when available and falls back to local upload, preserving the original `create-mercato-app` + `git init` one-command flow.
4. Ships a minimal, repo-owned Railway configuration inside the `create-mercato-app` template (`railway.toml`, `railway.worker.toml`, `Dockerfile`, `scripts/railway-start.sh`, `scripts/railway-worker.sh`, and `src/app/api/healthz/route.ts`) so the build/run contract is committed to user code, not hidden in a Railway-side template we no longer control.
5. Persists Railway resource IDs (project, environments, services, database services, domains, source metadata) in `.mercato/railway.json` inside the user's repo so re-runs are **idempotent** — the second invocation updates the existing project rather than creating a duplicate.
6. Prints the live URL, the Railway dashboard URL, and a short post-deploy checklist.

Phase 0 has been completed against Railway CLI `v4.66.1` and a live Railway Public API schema on 2026-06-03. The implementation PR should still keep schema drift visible with a fresh schema fingerprint, but the operation table below reflects the verified shapes from that run.

## Implementation Status

Implemented on 2026-06-05:

- Bootstrap-free `mercato deploy railway` command with `auto|git|local` source modes, dry run, cleanup, resumable state, token handling, secret redaction, and protected variable computation.
- Railway GraphQL project, environment, template database, service, variable, deployment, domain, region, and volume operations with lookup-before-retry handling for ambiguous mutations.
- Standalone template Railway configuration, separate app/worker deploy contracts, local-upload ignore contract, and coarse DB/Redis healthcheck backed by an additive cache-strategy probe.
- Railway deployment documentation, legacy guide redirect, CLI discovery entry, focused unit tests, and a metadata-gated live integration test.

Local validation completed with focused CLI tests, CLI/create-app typechecks and builds, docs build, all package builds, shell syntax checks, and built-CLI dry-run smoke coverage. A live Railway run on 2026-06-06 created managed Postgres, Redis, and the app service, verified resource reuse across repeated runs, returned HTTP 200 with the coarse health payload, and deleted the test project successfully. Because repository version `0.6.4` was not yet published to npm, the live scaffold used the current `develop` packages plus a temporary backward-compatible cache probe; the release-artifact run remains gated until the implementation packages are published.

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
| `--source <mode>` | `auto` \| `git` \| `local` | `auto` | Source strategy. `auto` prefers Git-backed deploy when a usable Railway-supported remote exists, otherwise falls back to local upload via `railway up`. |
| `--region <id>` | string | Railway default | Railway region. Accepted values are resolved from `regions(projectId)` and validated before mutation. |
| `--env-file <path>` | string | `.env.production` if present, else `.env` | Local env file whose entries are uploaded as Railway service variables. Keys matching the protected pattern (see Security) are auto-generated when missing. |
| `--domain <fqdn>` | string | (none) | Attach a custom domain (requires user to own DNS). When omitted, a Railway-provided `*.up.railway.app` subdomain is provisioned. |
| `--no-wait-domain` | boolean | false | Skip waiting for custom-domain DNS verification after printing required records. |
| `--volume <mountPath>` | string | (none) | Opt into a persistent Railway volume for attachments/storage. |
| `--token <value>` | string | `RAILWAY_API_TOKEN` env | Override Account token source. Logged-redacted; never echoed verbatim. |
| `--non-interactive` | boolean | false (true when `CI=true`) | Disable any interactive prompt. Fails fast if a required input is missing. |
| `--dry-run` | boolean | false | Plan only. Prints the GraphQL operations and env-var diff that *would* execute, exits 0. No mutations to Railway. |
| `--cleanup` | boolean | false | Delete the Railway project recorded in `.mercato/railway.json` (after explicit confirmation when interactive). |
| `--yes` | boolean | false | Confirm destructive prompts in non-interactive mode. Required with `--cleanup --non-interactive`. |
| `--write-env` | boolean | false | After successful deploy, write any auto-generated secrets back to the local env file. Default off — secrets live only on Railway. |
| `--no-track` | boolean | false | Keep Railway state local-only by writing `.mercato/railway.json.local` instead of committed `.mercato/railway.json`. |
| `--force-rename` | boolean | false | Allow `--project` to overwrite the project name on an already-recorded project. |
| `--timeout <seconds>` | number | `900` | Deployment poll timeout. |
| `--allow-secret-passthrough <key>` | repeatable string | none | Allow one specific env var key to bypass the accidental-secret value scanner. Never disables the scanner globally. |
| `--verbose` | boolean | false | Print each GraphQL operation (request + redacted response). |

The set is small on purpose. Anything else (multi-region replicas, multi-service custom topology, separate Redis instance per env) requires a follow-up spec.

### Source strategy

`--source auto` is the default and is deliberately not a hard "Git always" default. It implements the maintainer direction from issue #2414: support both Git-backed and non-Git deploys, while treating the repo-backed path as the common path.

| Mode | Behavior |
|------|----------|
| `auto` | Detect a usable Railway-supported Git remote and branch. If present, configure Railway with `source: { repo, branch }`. If absent, use local upload via `railway up`. |
| `git` | Require a usable Railway-supported Git remote/branch and fail clearly when missing or inaccessible to Railway. This is the CI-friendly path because Railway can rebuild from the connected repo. |
| `local` | Require the Railway CLI on `PATH`, create/link the service, then run `railway up --service <service> --environment <env> --detach --json`. This preserves one-command deploy after only `git init`. |

The CLI does **not** create a GitHub repository automatically in v1. If `--source git` is requested without a usable Railway-supported remote, or Railway rejects access to the repo, the command prints the exact Git/Railway connection action the user must take, then exits non-zero. Auto-creating private repos is useful but has separate auth, naming, ownership, and cleanup semantics; it should be a follow-up spec after the core Railway deploy is stable.

### Credential handling

The CLI reads its Railway **Account token** from, in order of precedence:

1. `--token <value>` flag.
2. `RAILWAY_API_TOKEN` environment variable.
3. A file at `~/.config/open-mercato/railway.json` with `{ "token": "<value>" }` (mode `0600`).
4. Interactive prompt — only when stdin is a TTY *and* `--non-interactive` is not set. The prompt shows a one-line instruction: "Create a token at https://railway.com/account/tokens (Account Settings → Tokens), paste here."

After a successful interactive prompt, the CLI offers to persist the token to `~/.config/open-mercato/railway.json`. Default answer is **no**; persisting is opt-in. The file is created with mode `0600` and is **never** committed because it lives in the user's home directory, not the repo.

The token is never logged. `--verbose` redacts it to `Bearer ****` in any echoed request line. The `--token` flag is supported for automation escape hatches, but docs should prefer `RAILWAY_API_TOKEN` or the interactive prompt because command-line arguments can be captured by shell history and process-list tooling on some systems.

Railway also uses `RAILWAY_TOKEN` for project-scoped tokens in other contexts. This command must not treat `RAILWAY_TOKEN` as the primary account/workspace token. If only `RAILWAY_TOKEN` is present, the CLI may print a compatibility hint, but account/workspace operations should require `RAILWAY_API_TOKEN`, `--token`, the cache file, or an interactive Account token.

### Idempotency contract

The CLI persists Railway resource identifiers in **two** locations:

- `.mercato/railway.json` (committed by default — see gitignore note below) records: `projectId`, `workspaceId`, per-environment IDs, app/worker service IDs, database service IDs, domain IDs, source metadata, last deployment IDs, and the CLI version that wrote them. Includes a `schemaVersion` so future CLI versions can migrate the file safely.
- `~/.config/open-mercato/railway.json` (per-user, not committed) records only the auth token.

**Important — template `.gitignore` interaction.** `packages/create-app/template/gitignore` (and the legacy `apps/mercato/.gitignore`) already contains a blanket `.mercato/` rule that hides the entire directory from git. To make committing `.mercato/railway.json` actually work, the scaffolded template MUST include an allowlist entry alongside the existing rule:

```gitignore
.mercato/*
!.mercato/railway.json
```

The implementation PR MUST update `packages/create-app/template/gitignore` accordingly. A bare `.mercato/` ignore rule is not sufficient because Git will not re-include files inside an ignored directory. Without the allowlist pattern above, `.mercato/railway.json` would be silently untracked and re-runs from a fresh clone would create a duplicate Railway project — exactly the failure mode this state file is meant to prevent.

Whether to commit `.mercato/railway.json` at all is a real call. Recommended default: **commit it**. Reasons: it contains no secrets, only opaque Railway IDs; committing it lets the next teammate run `mercato deploy railway` and update the *same* project rather than create a duplicate. Add an explicit `--no-track` CLI flag for users who prefer to keep it untracked (it tells the CLI to skip the allowlist line and write a `.mercato/railway.json.local` instead). The spec implementer MUST add a section to the user docs explaining the tradeoff.

The state file stores one record per Railway environment because `mercato deploy railway --env staging` should create a sibling environment, not overwrite production metadata. Shape:

```json
{
  "schemaVersion": 1,
  "provider": "railway",
  "projectId": "project-id",
  "workspaceId": "workspace-id",
  "projectName": "my-shop",
  "environments": {
    "production": {
      "environmentId": "environment-id",
      "appServiceId": "service-id",
      "workerServiceId": "service-id",
      "postgresServiceId": "service-id",
      "redisServiceId": "service-id",
      "domainId": "domain-id",
      "appUrl": "https://example.up.railway.app",
      "source": {
        "mode": "git",
        "repo": "owner/repo",
        "branch": "main"
      },
      "lastDeployIds": {
        "app": "deployment-id",
        "worker": "deployment-id"
      }
    }
  },
  "writtenBy": {
    "cliVersion": "x.y.z"
  }
}
```

No secrets, rendered database URLs, passwords, or tokens are ever written to this file.

On every run, the CLI:

1. Reads `.mercato/railway.json` if present.
2. For each recorded ID, issues a `project { id }` / `service { id }` / `environment { id }` lookup against the Railway API to confirm the resource still exists and is owned by the authenticated Account token's workspace.
3. For any missing resource, recreates it and updates the file.
4. For any drifted name (e.g., user passed `--project foo` but the recorded project's name is `bar`), either renames (when `--force-rename` is set) or fails with a clear message pointing the user at `--cleanup` or `--force-rename`.

### Resource scoping

By default the deploy uses the Account token owner's first accessible Railway workspace returned by `me { workspaces { id name } }`. A future flag `--workspace <id>` may allow explicit team-workspace selection; it is out of scope for v1 unless implementation work proves it is needed for reliable Git-backed deploys. The selected `workspaceId` is persisted in `.mercato/railway.json`.

## Architecture

The architecture spans two concerns: (1) how the CLI talks to Railway's API, and (2) what the deployed Railway project graph looks like. Both are detailed below, and the spec's per-flow state machine is documented under **End-to-end flow**.

- **CLI → Railway integration** — see *Railway integration approach* immediately below.
- **Deployed project graph** — see *Railway template & project structure*.
- **Per-step state machine and resumability** — see *End-to-end flow*.

### Railway integration approach

#### Endpoint and auth

- Base URL: `https://backboard.railway.com/graphql/v2`
- Auth header: `Authorization: Bearer <account-token>`
- Content-Type: `application/json`
- Each request body is a JSON `{ "query": "...", "variables": {...}, "operationName": "..." }` blob.

The CLI maintains a thin typed GraphQL client (single file) that:

- Sends the operation.
- Surfaces `errors[].message` to the user verbatim when present.
- Retries idempotent reads (introspection, lookups) with exponential backoff on 5xx and on Railway-side `INTERNAL_ERROR`.
- Never retries mutations automatically. Mutation failures bubble up; idempotency is recovered by the per-step state file, not by blind retry.

#### Operations used

The list below reflects the Phase 0 live verification completed on 2026-06-03 against Railway CLI `v4.66.1` and the live Public API schema. The implementation should keep operation strings local to the CLI package and include a schema-fingerprint fixture so future drift is easy to spot.

| Step | Operation kind | Operation shape | Purpose |
|------|----------------|-----------------|---------|
| Auth/workspaces | query | `me { id name email workspaces { id name } }` | Validate token and select a workspace. Do not log email unless needed for UX. |
| Project lookup | query | `project(id: String!)` | Confirm recorded `projectId` still exists. |
| Project list | query | `projects(workspaceId, userId, first, after, includeDeleted)` | Pre-create dedupe. No name filter exists; filter by name client-side. |
| Project create | mutation | `projectCreate(input: ProjectCreateInput!): Project!` | Create project with `name`, `description`, and `workspaceId`. Validate/truncate names before mutation. |
| Environment lookup | query | `environment(id: String!, projectId: String)` | Confirm recorded environment. |
| Environment list | query | `environments(projectId: String!, isEphemeral, first, after)` | Name-based lookup before create/retry. |
| Environment create | mutation | `environmentCreate(input: EnvironmentCreateInput!): Environment!` | Create `--env`; use lookup before retry after ambiguous transport failures. |
| Region list | query | `regions(projectId: String): [Region!]!` | Resolve/validate `--region`. |
| Database template detail | query | `template(code: "postgres" \| "redis")` | Fetch template ID and serialized config. Shape follows Railway CLI `TemplateDetail`. |
| Database template deploy | mutation | `templateDeployV2(input: TemplateDeployV2Input!): TemplateDeployPayload!` | Provision Postgres/Redis as template-backed services. `pluginCreate` is deprecated and must not be used for new databases. |
| Service create | mutation | `serviceCreate(input: ServiceCreateInput!): Service!` | Create app/worker service. `ServiceSourceInput` supports `repo` and `image`, not local tarballs. |
| Variable upsert | mutation | `variableCollectionUpsert(input: VariableCollectionUpsertInput!): Boolean!` | Upsert variables for one service. `serviceId` is singular; call once per service. |
| Deployment trigger | mutation | `serviceInstanceDeployV2(environmentId: String!, serviceId: String!, commitSha: String): String!` | Trigger Git-backed redeploy. Do not trust returned string as the newly-created deployment ID; query latest deployment after triggering. |
| Deployment status | query | `deployment(id: String!) { id status staticUrl url serviceId environmentId }` | Poll deployment state. `staticUrl` may contain the public host when `url` is null. |
| Logs | query/subscription | `buildLogs(deploymentId, limit, filter)` and `deploymentLogs(deploymentId, limit, filter)` | Stream build/runtime logs. WebSocket subscriptions use `wss://backboard.railway.com/graphql/v2` with `graphql-transport-ws`; HTTP query polling is the fallback. |
| Railway domain | mutation | `serviceDomainCreate(input: ServiceDomainCreateInput!): ServiceDomain!` | Provision `*.up.railway.app`; input supports `environmentId`, `serviceId`, `targetPort`. |
| Custom domain | mutation | `customDomainCreate(input: CustomDomainCreateInput!): CustomDomain!` | Attach custom domain; input requires `projectId`, `environmentId`, `serviceId`, `domain`, optional `targetPort`. |
| Volume | mutation | `volumeCreate(input: VolumeCreateInput!): Volume!` | Optional attachment storage volume. |
| Cleanup | mutation | `projectDelete(id: String!): Boolean!` | Delete recorded project. No input object. |

#### Source upload paths

Railway's Public GraphQL schema does not expose local-source upload. `ServiceSourceInput` contains `repo` and `image` only, and `serviceInstanceDeploy*` mutations do not accept a tarball. The official Railway CLI implements `railway up` by creating a gzip tarball and posting it to a separate Railway HTTP upload endpoint:

```
POST https://backboard.railway.com/project/{projectId}/environment/{environmentId}/up?serviceId={serviceId}
Content-Type: application/gzip
```

The Open Mercato CLI should not call that undocumented endpoint directly in v1. It should shell out to the supported Railway CLI for `--source local` and require the Railway binary to be installed. This delegates upload-endpoint drift to Railway's own CLI, while Open Mercato still owns a preflight archive-safety check before invoking it.

Both supported source paths converge after service creation:

- **Git-backed (`git`)** — configure `serviceCreate(input.source.repo, branch)` when a usable Railway-supported remote exists. Railway owns future rebuilds from that repo.
- **Local upload (`local`)** — create/link the service, set variables, then run `railway up --service <name> --environment <env> --detach --json`. Poll with GraphQL/CLI after the upload returns.

In `auto`, choose `git` when a Railway-supported remote and current branch can be resolved; otherwise choose `local`. The dry-run output must show the selected source mode and the reason.

For `local`, the CLI MUST refuse to continue if the effective upload archive would include obvious local secrets or bulky local-only directories. The implementation should use Railway CLI behavior where possible, but preflight must independently check the repo ignore state for at least:

- `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- `.mercato/railway.json.local`
- `.git/`, `node_modules/`, local database files, and package-manager caches

The scaffolded template should include a `.railwayignore` (or equivalent documented ignore contract if Railway changes the file name) that excludes these paths. If an env file is intentionally needed for runtime config, its values should be uploaded through `variableCollectionUpsert`; the env file itself should not be part of the source archive.

## Railway template & project structure

> **Informational only.** We do not have access to the prior Railway-hosted template at `railway.com/deploy/TKvo95`. The shapes below describe what the implementation PR should construct via API calls from a clean slate.

### Service graph

A successful deploy creates the following Railway resources under one project:

```
project: <project-name>
├── environment: production
│   ├── service: Postgres             (template-backed database)
│   ├── service: Redis                (template-backed database)
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
| `DATABASE_URL` | Railway Postgres service | `${{Postgres.DATABASE_URL}}` | Reference variable. Do not copy rendered database URLs into app variables. |
| `REDIS_URL` | Railway Redis service | `${{Redis.REDIS_URL}}` | Reference variable. Redis variables may appear only after the Redis deployment reaches `SUCCESS`; poll readiness before applying references. |
| `NODE_ENV` | static | `production` | |
| `NEXT_TELEMETRY_DISABLED` | static | `1` | Avoid telemetry in CI. |
| `PORT` | static | `3000` | Must match the Dockerfile exposure and Railway domain `targetPort`; setting it explicitly prevents Railway runtime port injection from diverging from the public-domain route. |
| `NEXT_PUBLIC_APP_URL` | derived | `https://<domain>` | Computed after domain provisioning; updated on `--domain` change. |
| `APP_URL` | derived | same as above | Server-side mirror. |
| `OM_AI_PROVIDER` | env-file | `openai` (matches repo default) | Honors `OM_AI_PROVIDER` from the local env file. |
| `OM_AI_MODEL` | env-file | `gpt-5-mini` (matches repo default) | Honors `OM_AI_MODEL` from the local env file. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` and provider-specific aliases | env-file | (none) | Pass through when present. Missing AI keys should not block a deploy; the app can show provider configuration warnings after boot. |
| `AUTH_SECRET` | auto-gen | 64-byte hex | Preferred auth/session secret. Generated once per Railway environment and stored on Railway. Only written back locally if `--write-env` is set. |
| `JWT_SECRET` | auto-gen | 64-byte hex | Backward-compatible auth fallback used by existing modules. |
| `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` | auto-gen | 32-byte base64url or hex-safe equivalent | Required fallback for tenant encryption when tenant-specific keys are absent. |
| `QUEUE_STRATEGY` | static | `async` | Production Railway deploys use Redis/BullMQ, not local file queues. |
| `NEXT_PUBLIC_QUEUE_STRATEGY` | static | `async` | Mirrors queue strategy for UI surfaces that display async-only queue capabilities. |
| `AUTO_SPAWN_WORKERS` / `OM_AUTO_SPAWN_WORKERS` | static | App: `false` when `--worker`, `true` when `--no-worker`; Worker: `false` | Avoid running duplicate queue workers inside the app service when a dedicated worker exists. |
| `PORT` | Railway-injected | (auto) | Railway sets this; the app's start script must respect it. |

The CLI's env-var module computes the final variable set as a pure function of `(env-file contents, recorded state, Railway-injected references, source mode, service role)` and runs one `variableCollectionUpsert` per service. This makes the operation diff-able under `--dry-run`.

The CLI MUST refuse to upload any variable whose **value** matches the user's Railway Account token or any obvious credential pattern that is not in the allowlist — defense in depth against accidental token leakage. Allowlisting is per-key through repeatable `--allow-secret-passthrough <key>` and must not disable scanning for unrelated variables.

Dry-run output and verbose GraphQL logging must never print secret values or value fragments. For sensitive keys, print `<redacted>` plus a short stable fingerprint such as `sha256:abcdef12` so users can tell whether a value changed without leaking it. For non-sensitive keys, values may be shown only when they do not match the credential scanner.

### Build configuration: Nixpacks vs. Dockerfile

**Decision: Dockerfile in the template.**

Justification:

- The Open Mercato monorepo (and its scaffolded standalone apps) has non-trivial build steps: `yarn generate`, optional `yarn build:packages`, Next.js standalone output, and module discovery via the generated `.mercato/` directory. Nixpacks' default Next.js detection misses the generate step.
- A committed `Dockerfile` is reviewable, reproducible offline, and survives Railway-side Nixpacks default changes.
- The template already ships a `Dockerfile` (verified in `packages/create-app/template/Dockerfile`), so this aligns with the existing scaffolding.

`railway.toml` in the template root declares:

```toml
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

The app service uses the `railway.toml` start command. The worker service (when `--worker`) uses the same Dockerfile/source but must override the service start command to `./scripts/railway-worker.sh` through Railway service configuration, because a shared `railway.toml` file cannot safely express two service-specific start commands for the same source tree.

The worker script runs the queue worker via the `mercato` CLI. The current command is `yarn mercato queue worker --all`, and `packages/queue/AGENTS.md` requires production workers to use `QUEUE_STRATEGY=async`. The app service should set worker auto-spawn off when a dedicated worker service exists.

### Start scripts

Two scripts ship in the template:

- `scripts/railway-start.sh` (app service):
  1. Run the existing initialize-or-migrate contract used by the scaffolded Docker template: first boot must initialize the app (`yarn initialize`), later boots apply pending migrations. Do not replace this with unconditional `yarn db:migrate`; a fresh Railway database needs tenant/bootstrap initialization.
  2. `if [ ! -d ".mercato/generated" ]; then yarn generate; fi` — re-run module generation if missing (e.g., first cold boot after a fresh image).
  3. Start the Next.js server. The repo's current `apps/mercato/next.config.ts` does NOT set `output: 'standalone'` (verified at spec time), so the default start command is `exec yarn workspace @open-mercato/app start` (which calls `next start`). The implementation PR SHOULD add `output: 'standalone'` to the scaffolded template's `next.config.ts` to shrink deploy images — when it does, the start line changes to `exec node apps/mercato/.next/standalone/server.js`. Pick one and document the choice; do not assume standalone output exists.

- `scripts/railway-worker.sh` (worker service): runs the queue worker entry point. The exact command must match the worker contract declared in `packages/queue/AGENTS.md`.

Both scripts must `set -euo pipefail` and forward `SIGTERM` to the child process so Railway's graceful-shutdown windows work.

### Healthcheck endpoint

The template ships `app/api/healthz/route.ts` (or equivalent) returning:

```
GET /api/healthz
200 { "status": "ok", "ts": "<ISO>" }
503 { "status": "degraded", "ts": "<ISO>" }
```

The endpoint:

- Pings the DB with `SELECT 1` via the existing ORM connection pool (no new connection per request).
- Pings Redis with a `PING` via the existing cache client.
- Times out each ping at 1500 ms; on timeout marks that backend as `down`.
- Never queries tenant data — pure infrastructure check. No auth, no organization scoping.
- Does not expose component-level DB/Redis status in the public response. Component failures should be logged server-side with normal log redaction; the public body stays coarse to avoid unnecessary infrastructure disclosure.

Railway uses this for the deployment-success signal and for runtime health monitoring. `healthcheckTimeout = 60` gives the app a generous boot window for the first deploy (migrations + generation).

### Volume requirements

The legacy doc at `apps/docs/docs/installation/railway.mdx` mentions a `/app/apps/mercato/storage` volume for attachments. The implementation PR MUST decide whether to:

- **Ship volume by default** — call the Railway `volumeCreate` mutation as part of the flow.
- **Make it opt-in** — `--volume` flag, off by default.

**Recommendation:** opt-in (`--volume <mountPath>`). Users who do not yet have attachment-heavy workflows shouldn't pay for storage they don't use. The CLI prints a clear warning when running without a volume: "Attachments uploaded to this deployment will be lost on redeploy. Re-run with `--volume /app/storage` to enable persistent storage."

## Data Models

**No DB schema, no MikroORM entities, no migration files.** This feature is a CLI tool that talks to an external service; it does not persist any application-level data in the Open Mercato database.

Two local-filesystem state files are introduced, documented in detail elsewhere in this spec:

- `.mercato/railway.json` — per-repo Railway resource identifiers (`projectId`, `workspaceId`, environment records, service IDs, database service IDs, domain IDs, source metadata, last deployment IDs, `schemaVersion`, CLI version). See *Proposed Solution → Idempotency contract*. Committed by default via an allowlist line in `packages/create-app/template/gitignore`.
- `~/.config/open-mercato/railway.json` — per-user Railway Account token (`{ "token": "..." }`). Mode `0600`. See *Security & secrets → Token storage*.

Both files use a `schemaVersion` integer so future CLI versions can detect and migrate older shapes. The implementation PR MUST define `schemaVersion: 1` in the first release and document the migration policy.

## API Contracts

This spec exposes no new HTTP API routes inside the Open Mercato app — the CLI is a pure outbound caller against Railway's public API.

- **Outbound (Railway public GraphQL):** the full list of operations the CLI calls is enumerated under *Architecture → Railway integration approach → Operations used*. The table reflects the 2026-06-03 Phase 0 live verification and should be guarded by schema-fingerprint tests/mocks in the implementation.
- **New healthcheck route added by the implementation PR:** `GET /api/healthz` — see *Railway template & project structure → Healthcheck endpoint* for the response contract. Returns `200 { status: "ok", ts }` or `503 { status: "degraded", ts }`. No auth, no tenant scoping, no component-level infrastructure details in the public body. Used by Railway's healthcheck and by future ops dashboards.

## End-to-end flow

The single command runs the following steps in order. State transitions are documented so an interrupted run can resume by re-reading `.mercato/railway.json`.

### Step 0 — Local prerequisites

1. Confirm `git` is on `PATH`. If absent, `--source git` fails and `--source auto` may still use `local` when Railway CLI is available.
2. Detect whether cwd is a git repo (`git rev-parse --git-dir`), current branch, and usable Railway-supported remote. This informs `--source auto`.
3. Confirm the working tree is clean for `--source git`. If dirty: fail in `--non-interactive`; warn + prompt in TTY. Also verify the selected branch is pushed to, and not ahead of, the configured remote; Railway builds from remote Git, so deploying a local-only commit would deploy different code than the user sees locally.
4. Confirm Node ≥ the version pinned in the template's `package.json` `engines.node`.
5. Confirm a `package.json` exists at the cwd root and declares an Open Mercato app (look for `@open-mercato/*` dependencies).
6. Confirm a `--env-file` resolves to an existing file. If neither `.env.production` nor `.env` exists, fail with a clear message.
7. Resolve `--source auto|git|local`. If `local`, confirm Railway CLI is installed and logged in enough for `railway up`; if missing, print install instructions.
8. For `--source local`, run the archive-safety preflight described in **Local source upload path** before creating or mutating Railway resources.

**Persisted state:** none.

### Step 1 — Authenticate with Railway

Resolve token per the precedence in **Credential handling** above. Call the `me` query to validate the token; capture `me.id` and available workspaces. On 401, print "Token rejected. Generate a Railway Account token at https://railway.com/account/tokens" and exit non-zero.

**API call:** `query me { me { id name email workspaces { id name } } }`.

**Persisted state:** none (token may be written to `~/.config/open-mercato/railway.json` only after explicit consent).

### Step 2 — Resolve workspace

Use the `workspaces` returned by `me`. Default to the first accessible workspace unless a future `--workspace` flag is added. Capture `workspaceId`.

**API call:** same `me` query as Step 1.

**Persisted state:** `workspaceId` cached in memory for the run.

### Step 3 — Create or look up the project

If `.mercato/railway.json` has a `projectId`, look it up (`query project($id)`). On 404 (project deleted by user out-of-band), prompt to recreate or exit.

Else call `projectCreate(input: { name, description, workspaceId })`. The `name` is `--project` or derived from `package.json.name`. Railway rejects some long names with `Invalid project name`, so normalize to a conservative slug before mutation and show the final name in `--dry-run`. Pre-check by listing `projects(workspaceId)` and filtering by name client-side; there is no server-side name filter.

**Persisted state:** `projectId` written to `.mercato/railway.json` after success.

### Step 4 — Create or look up the environment

`--env` (default `production`). Same lookup-then-create dance using `environments(projectId)` for name lookup and `environment(id, projectId)` for recorded IDs.

If `environmentCreate` times out or returns an ambiguous transport response, do not blindly retry. Phase 0 observed an environment being created even though the request later returned non-JSON HTML. Re-run the lookup first, then decide whether a retry is safe.

**Persisted state:** `environmentId`.

### Step 5 — Provision managed Postgres + Redis

For each database service (`Postgres`, `Redis`), if not already recorded:

1. Fetch the current Railway database template (`template(code: "postgres")` / `template(code: "redis")`) and its serialized config.
2. Deploy the template with `templateDeployV2(input: { projectId, environmentId, templateId, serializedConfig, workspaceId })`.
3. Poll the resulting workflow/service/deployment until the database service reaches a ready/success state.
4. Re-read the project services and record the new service ID.

Do **not** use `pluginCreate`; Phase 0 confirmed it is deprecated with the schema reason "Plugins are deprecated on Railway. Use database templates instead."

The database services expose connection variables as Railway reference variables. The CLI does **not** copy rendered database URLs into its own variable upserts; instead, app/worker variables include `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}`. Phase 0 observed Redis variables appearing only after the Redis deployment reached `SUCCESS`, so readiness polling must happen before applying references.

**Persisted state:** `postgresServiceId`, `redisServiceId` in the selected environment record.

### Step 6 — Create the app service (and optional worker)

Create service shells via `serviceCreate`.

- For `--source git`, pass `source: { repo }` plus `branch` when a usable remote/branch exists.
- For `--source local`, create an empty service shell now. Local source is uploaded in Step 8 through `railway up`.
- For `--source auto`, use the resolved mode from Step 0 and record the reason in `--dry-run`.

For `--worker`, repeat with a second service named `mercato-worker`, same Dockerfile, different `startCommand`.

**Persisted state:** `appServiceId`, optionally `workerServiceId`, and source metadata (`mode`, `repo`, `branch`).

### Step 7 — Compute and upload env vars

1. Load `--env-file`.
2. Auto-generate any missing protected secrets (`AUTH_SECRET`, `JWT_SECRET`, `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`).
3. Compute the merged variable set per the matrix in **Required environment variables**.
4. Issue one `variableCollectionUpsert` per service (app, optional worker). Cross-service bulk upsert is not supported by the verified input shape.
5. Under `--dry-run`, print a diff: `+ ADD <key>`, `~ CHANGE <key>`, `- REMOVE <key>`. Sensitive values are always `<redacted>` plus a stable fingerprint; never print first/last characters for secrets.

**Persisted state:** none beyond the run (Railway is the source of truth for env-var state).

### Step 8 — Trigger deployment and stream logs

For each service:

- `--source git`: trigger with `serviceInstanceDeployV2(environmentId, serviceId)`.
- `--source local`: run `railway link --project <projectId> --environment <environmentId> --service <serviceId>` followed by `railway up --service <serviceName> --environment <env> --detach --json`. The JSON response contains a deployment ID and logs URL for the upload path.

After triggering, query the latest deployments for the service/environment and poll the actual latest deployment ID. Phase 0 observed `serviceInstanceDeployV2` returning the previous deployment ID while still creating a new deployment, so the mutation return value must not be treated as authoritative.

Poll `deployment(id)` every 5 s up to 15 min cap (configurable via `--timeout`). Treat `deployment.staticUrl` as the likely public Railway host when `deployment.url` is null. Stream logs concurrently — prefer WebSocket subscriptions for `buildLogs` and `deploymentLogs`, else HTTP query polling. All streamed log lines pass through the same credential redactor used by `--verbose` output before they reach stdout.

Log output is prefixed `[mercato-app]` / `[mercato-worker]` so a user with `--worker` can distinguish streams.

On `FAILED` status, surface the last 100 log lines, print a clear "deployment failed" message, leave Railway state intact (so the user can inspect in the dashboard), and exit non-zero.

**Persisted state:** `lastDeployId` per service.

### Step 9 — Provision domain

For the app service only:

- If `--domain <fqdn>` was supplied: `customDomainCreate(input: { projectId, serviceId, environmentId, domain })`. Print the DNS records the user must add (CNAME or A) and **wait** for verification (capped at 5 min, `--no-wait-domain` to skip). On timeout without verification, print the records and exit zero with a "DNS not yet propagated" warning — the deploy itself is still successful.
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

Every step persists its result before the next step starts. A crash between Step 5 and Step 6 leaves database service IDs recorded; re-running the CLI skips already-ready database services. A crash between Step 7 and Step 8 leaves app/worker service IDs recorded; re-running re-uploads env vars (idempotent) and re-triggers the deploy.

The CLI prints, at the start of each step, "Step N: <description>" so an interrupted run's logs make the resume point obvious.

### Log streaming

- WebSocket subscription preferred. URL pattern: `wss://backboard.railway.com/graphql/v2` with `graphql-transport-ws`.
- HTTP query fallback: `buildLogs(deploymentId, limit, filter)` and `deploymentLogs(deploymentId, limit, filter)` every 2 s, deduped by timestamp/message.
- Logs are written to stdout in real time. On `--dry-run`, log streaming is skipped (nothing was triggered).

### Timeouts and retries

| Operation | Timeout | Retry policy |
|-----------|---------|--------------|
| Token validation (`me`) | 10 s | 1 retry on 5xx |
| Project/env/service lookups | 10 s each | 1 retry on 5xx |
| Mutations (create/upsert/deploy/cleanup) | 30 s | **no blind retry** — for ambiguous outcomes, perform a lookup first |
| Database template provisioning poll | 180 s wall | poll every 5 s |
| Deployment poll | 900 s wall (configurable via `--timeout`) | poll every 5 s |
| Domain DNS verification | 300 s wall | poll every 10 s |

When a wall timeout is hit, the CLI exits non-zero with a clear message including the last-known state and the next step the user can take ("Re-run the command to resume from <step>").

### Cleanup

`mercato deploy railway --cleanup` issues `projectDelete(id: <recorded>)` only after explicit confirmation. In TTY mode, the prompt shows project name, project ID, environment names, and app URL, then asks the user to type the project name. In `--non-interactive` mode, cleanup requires `--yes`; otherwise the CLI fails closed. After deletion, the CLI deletes `.mercato/railway.json`. The user-config token file is **never** touched by `--cleanup`.

A future flag `--cleanup --keep-database` may preserve the Postgres service and detach it from the project. Out of scope here.

## Security & secrets

### Token storage

- `~/.config/open-mercato/railway.json` is created with mode `0600`. The CLI refuses to read it if the perms are wider (e.g., world-readable).
- The token is never written to repo files, never to `.mercato/railway.json`, never to CLI logs even under `--verbose`.
- The token is redacted (`Bearer ****`) in any `--verbose` output.
- On Windows the equivalent path is `%APPDATA%\open-mercato\railway.json`. NTFS permissions are not as tight as POSIX `0600`; document this gap and recommend users on Windows rotate their Account token if the machine is shared.

### Auto-generated secrets

`AUTH_SECRET`, `JWT_SECRET`, and `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` are generated **on the user's machine** (using `crypto.randomBytes`) and uploaded to Railway. They are not echoed to stdout, not written to local files, and not persisted in `.mercato/railway.json`. The only place they live is Railway's variable storage.

`--write-env` opts the user into writing them to the local env file as well, useful for matching production locally — but the file is the user's responsibility to keep out of version control.

### Threat model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Leaked Railway Account token | High — project takeover, data exfiltration for accessible workspaces | Recommend scoped tokens when Railway supports them. Document token rotation. Refuse to use tokens with overly permissive scopes when detectable. |
| Token supplied through `--token` appears in shell history/process tooling | Medium — local machine exposure | Prefer `RAILWAY_API_TOKEN`, prompt, or `0600` cache in docs. Keep `--token` as an automation escape hatch and redact it from all CLI output. |
| `.mercato/railway.json` in a public repo | Low — only opaque IDs, no secrets | Acceptable to commit by default. Document the `--no-track` opt-out. |
| `--write-env` writes secrets to local file | Medium — user error can commit secrets | Default off. When set, prepend a `# DO NOT COMMIT` warning to the file. CLI verifies `.gitignore` covers the env file before writing; refuses to write if it doesn't. |
| Local-source deploy uploads `.env`, private keys, or local caches | High — secrets or large local artifacts leave the machine | `--source local` runs an archive-safety preflight and ships a `.railwayignore` denying env files, private keys, `.git`, `node_modules`, local DB files, and local Railway state. Env vars are uploaded through Railway variables, not source archives. |
| MITM on the GraphQL connection | Low — HTTPS only | TLS-only client. Refuse non-HTTPS endpoints. |
| Compromised Railway database template/image (e.g., upstream Postgres image vulnerability) | Out of our control | Document Railway's responsibility; recommend users monitor their Railway project dashboard. |
| CLI executed in a hostile working tree (malicious `package.json` scripts triggered by `yarn install` during validation) | Medium | The CLI does NOT run `yarn install` during deploy. Build runs server-side on Railway in an isolated container. |
| Git-backed deploy builds a different commit than the user expects | Medium — stale or unreviewed code may be deployed | `--source git` verifies clean worktree and branch sync with the configured remote before mutating Railway resources. |
| Build/deployment logs leak secrets | Medium — copied into CI logs or terminal history | All Railway log streams and verbose GraphQL output pass through the same redactor before stdout. Failure summaries show redacted last 100 lines only. |
| Public `/api/healthz` reveals infrastructure details | Low/Medium — unnecessary reconnaissance signal | Response body is coarse (`status`, `ts`) and omits DB/Redis component status. Component detail stays in server logs. |
| Accidental upload of a developer secret as a Railway env var | Medium | Variable-value scanner refuses upload of patterns matching the user's own Railway Account token or obvious credentials (e.g., `sk-`, `xoxb-`, `gh[pousr]_` prefixes) unless that exact key is passed through repeatable `--allow-secret-passthrough <key>`. |
| Accidental deletion of the wrong Railway project | High — data/service loss | `--cleanup` shows the recorded project name, ID, environments, and URL. TTY cleanup requires typing the project name; non-interactive cleanup requires `--yes`. |

## Testing strategy

### Unit tests (mandatory; CI-gated)

Target: `packages/cli/__tests__/deploy/railway/`.

- **Command parser** — every flag combination, error messages for conflicting flags.
- **Source strategy resolver** — `auto|git|local` selection from git state, remotes, branch, Railway CLI availability, and CI/TTY mode.
- **Env-var computation** — pure function that takes `(env-file contents, recorded state, Railway-injected reference variable names)` and returns the merged variable set. Snapshot tests for the diff format under `--dry-run`.
- **Secret scanning and redaction** — scanner catches Railway token echoes, common credential prefixes, private-key blocks, and env-file mistakes. Snapshot tests prove `--dry-run`, `--verbose`, and streamed deployment logs do not print secret fragments.
- **Local upload safety** — `--source local` preflight refuses archives that would include env files, private keys, `.git`, `node_modules`, local DB files, or `.mercato/railway.json.local`.
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
3. `curl <url>/api/healthz` returns 200 and the response body contains only coarse status fields (`status`, `ts`), not DB/Redis component detail.
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
  - Troubleshooting (token rejected, database provisioning stuck, deploy failed, DNS not propagated).
  - Cost note (Railway free trial → paid plan).
- **Task Router row** in root `AGENTS.md` mapping "Deploy a freshly-scaffolded Open Mercato app to Railway with one CLI command" to this spec and the new doc page. (Added in *this* PR pointing at the spec only; updated in the implementation PR to also point at the doc.)
- **Banner update** on the existing `apps/docs/docs/installation/railway.mdx` flagging the template button as unmaintained and pointing readers at the new spec / forthcoming doc. (Added in this PR.)
- **Removal/redirect** of the legacy `installation/railway.mdx` is **deferred** to a follow-up cleanup PR after the new doc page is published and indexed.

## Integration Coverage

For the implementation PR (not this spec PR), the following integration tests must exist:

| Path / surface | Test name | Notes |
|----------------|-----------|-------|
| `mercato deploy railway --dry-run` | `cli/deploy/railway/dry-run.spec.ts` | Snapshot of planned GraphQL ops. Mock Railway transport. |
| `mercato deploy railway --source auto|git|local` | `cli/deploy/railway/source-strategy.spec.ts` | Unit tests for source-mode selection and failure messages. |
| `mercato deploy railway` (happy path) | `cli/deploy/railway/full-deploy.integration.spec.ts` | Gated by `RAILWAY_INTEGRATION_TOKEN`. |
| `mercato deploy railway` (resume after partial state) | `cli/deploy/railway/resume.spec.ts` | Synthetic `.mercato/railway.json` fixtures. |
| `mercato deploy railway --cleanup` | `cli/deploy/railway/cleanup.integration.spec.ts` | Gated. |
| Token-resolver precedence | `cli/deploy/railway/token-resolver.spec.ts` | Unit. |
| Env-var computation | `cli/deploy/railway/env-vars.spec.ts` | Unit, snapshot. |
| Healthcheck endpoint | `apps/mercato/__tests__/healthz.spec.ts` (or template equivalent) | Verifies DB/Redis ping logic and confirms the public response omits component-level infrastructure detail. |
| Secret redaction | `cli/deploy/railway/redaction.spec.ts` | Unit tests for dry-run, verbose GraphQL output, deployment-log redaction, and scanner bypass only for exact `--allow-secret-passthrough <key>` matches. |
| Local upload preflight | `cli/deploy/railway/local-upload-safety.spec.ts` | Unit tests that `.env*`, private keys, `.git`, `node_modules`, local DB files, and `.mercato/railway.json.local` block `--source local` before Railway mutations. |

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
- **Mitigation:** Phase 0 live verification was completed on 2026-06-03. The implementation PR MUST keep a schema fingerprint and mocked operation fixtures so future maintainers can detect drift.
- **Residual risk:** Railway may break the schema after we ship. We add a CLI-level error that surfaces the raw GraphQL error message and links to `https://docs.railway.com/reference/public-api` so users can self-diagnose without an Open Mercato release.

### Risk: Two source modes increase implementation surface

- **Severity:** Medium — affects the deploy state machine and test matrix.
- **Affected area:** Step 0, Step 6, Step 8, docs, dry-run output.
- **Mitigation:** Model the mode explicitly as `--source auto|git|local`. Keep source-mode detection as a pure unit-tested function. Make dry-run show selected mode and reason.
- **Residual risk:** Users may be surprised when `auto` chooses local upload because no usable remote exists. The summary and dry-run must state the selected mode clearly.

### Risk: Local upload depends on Railway CLI

- **Severity:** Medium — required for users with no Git remote.
- **Affected area:** `--source local` and `--source auto` fallback.
- **Mitigation:** Use the supported `railway up` CLI instead of calling Railway's undocumented upload endpoint directly. Detect missing CLI before mutating Railway resources when local mode is required.
- **Residual risk:** Railway CLI output or auth behavior may change. The implementation should parse only `--json` output and surface raw CLI errors when parsing fails.

### Risk: Outdated legacy Railway docs continue to mislead users

- **Severity:** Low — banner mitigates.
- **Affected area:** `apps/docs/docs/installation/railway.mdx`.
- **Mitigation:** Banner update lands with this spec PR. Full rewrite or removal lands with the implementation PR.
- **Residual risk:** A user with a cached doc page may still follow the legacy template. Acceptable.

### Risk: Cost surprise for users on Railway's free trial

- **Severity:** Low — informational.
- **Affected area:** Post-deploy user experience.
- **Mitigation:** The CLI prints a one-line cost/resource note in the post-deploy summary and surfaces Railway resource-limit errors verbatim. Phase 0 confirmed a free account can hit `Free plan resource provision limit exceeded` during additional provisioning.
- **Residual risk:** Users still surprised. Acceptable — same as any cloud deploy.

### Risk: Ambiguous mutation outcome creates duplicate resources

- **Severity:** Medium.
- **Affected area:** Project/environment/service/database creation.
- **Mitigation:** Never blindly retry mutations after timeouts or non-JSON/transport failures. Perform a lookup by recorded ID or expected name first, then resume.
- **Residual risk:** Railway may create a resource with a partially different name/config before failing. The CLI should print the discovered resource and ask before adopting it when interactive.

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
- **Mitigation:** `0600` perms; `RAILWAY_API_TOKEN` or the interactive prompt lets users avoid the cache entirely. `--token` remains available but is documented as less safe on shared machines because shell history/process tooling may capture arguments.
- **Residual risk:** Same as any local credential store. Out of our scope.

## Final Compliance Report

- **Spec format** — TLDR, Overview, Problem Statement, Proposed Solution (CLI + Railway + Template + Flow), Failure Handling, Security, Testing, Documentation, Integration Coverage, Migration/BC, Risks, Final Compliance, Changelog. ✓
- **AGENTS.md alignment** — references the CLI package (`packages/cli`), the create-app template (`packages/create-app/template`), and the docs app (`apps/docs/docs`). ✓
- **BC contract** — new CLI command, template files, healthcheck route, and optional cache `healthcheck()` method are additive contract surfaces; no existing surface was removed. ✓
- **Naming** — `mercato deploy railway` aligns with future provider namespace `mercato deploy <provider>`. ✓
- **Testing requirements** — unit-test-mandatory + gated-integration-test pattern matches `.ai/qa/AGENTS.md`. ✓
- **Security defaults** — fail-closed: no token in env/cache → fail in CI mode; no envfile → fail; missing AI keys do not block deploy but are surfaced as app configuration warnings. ✓
- **Phase 0 evidence** — live Railway CLI/API findings are reconciled into the operation table and risk model. ✓

## Resolved Implementation Decisions

These are the remaining product/implementation decisions after Phase 0:

- **Decision A — Source strategy.** Resolved by issue #2414 follow-up: support both Git-backed and local-source deploys. Implement `--source auto|git|local`; `auto` prefers Git when a usable remote exists and otherwise falls back to local upload via `railway up`.
- **Decision B — Volume default.** Resolved: volume creation is opt-in via `--volume`.
- **Decision C — Track `.mercato/railway.json` or not.** Resolved: commit-by-default, with `--no-track` writing `.mercato/railway.json.local`.
- **Decision D — `railway.toml` vs. `railway.json`.** Resolved for v1: use `railway.toml`; Phase 0 accepted the required fields.
- **Decision E — Worker entry command.** Resolved for v1: use `yarn mercato queue worker --all` with `QUEUE_STRATEGY=async`, unless implementation discovers a blocking runtime issue.
- **Decision F — `pluginCreate` vs. service-backed databases.** Resolved: use database templates via `templateDeployV2`; do not use deprecated `pluginCreate`.

## Changelog

- 2026-05-12 — Initial spec authored under `auto-create-pr` (slug `railway-one-command-deploy`). Honors the user-flagged constraint that `apps/docs/docs/installation/railway.mdx` and `railway.com/deploy/TKvo95` are outdated and not assumed to be accessible. Railway GraphQL operations were intentionally left for live verification. Status: **Draft / Pending Implementation**.
- 2026-06-04 — Reconciled after live Railway Phase 0 verification and issue #2414 maintainer feedback. Updates auth token handling, source strategy (`auto|git|local`), database provisioning (`templateDeployV2`), verified GraphQL operation shapes, env-var matrix, retry rules, and remaining open decisions. Status remains **Draft / Pending Implementation**.
- 2026-06-04 — Security hardening pass: added local-upload archive preflight, per-key secret scanner bypass, stronger output/log redaction, coarse public healthcheck response, Git remote sync checks, and non-interactive cleanup confirmation. Status remains **Draft / Pending Implementation**.
- 2026-06-05 — Implemented issue #2414 across `packages/cli`, the standalone create-app template, docs, unit tests, and a gated Railway integration test. Local builds and focused tests pass; live Railway validation remains credential-gated. Status: **Implemented / Pending Live Railway Validation**.
- 2026-06-06 — Live Railway validation found that Railway injected runtime port `8080` while the generated service domain targeted port `3000`, producing a persistent public `502` despite a successful deployment. The deployer now pins `PORT=3000` in service variables and covers the invariant with a regression assertion. The corrected deployment returned HTTP 200 from `/api/healthz`, reused the same three Railway services across repeated runs, and cleanup removed the project. Status: **Implemented / Live Deployment Flow Validated**.
