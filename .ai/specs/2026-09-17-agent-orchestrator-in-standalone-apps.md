# Agent Orchestrator in Standalone Apps (OpenCode file-defined agents covered)

**Status:** Implemented (2026-09-17) — Phases 1–4. Phase 3's `starters/` mirror was
deliberately dropped; see the changelog.
**Scope:** OSS packages (`create-app`, `cli`, `starter`, root `docker/`). Enables the commercial
`agent_orchestrator` module (`packages/enterprise`), whose own design lives in
[`.ai/specs/enterprise/agent-orchestrator/`](./enterprise/agent-orchestrator/README.md).

## TLDR

A scaffolded standalone app can run **in-process/`native`** agents today (once the enterprise
package is added by hand), but **cannot run OpenCode file-defined agents at all**. Five independent
blockers stack up: the enterprise dependency is absent, the OpenCode generator silently no-ops
outside the monorepo, the template compose files ship no `opencode`/`mcp` services, the
`docker/opencode/` build context and `mcp-entrypoint.sh` are not in the template, and every
orchestrator/OpenCode/MCP env var has drifted out of the template `.env.example`.

This spec closes all five, reusing the already-designed `starters/` delivery vehicle rather than
inventing a parallel mechanism.

## Problem Statement

`packages/create-app/template/src/modules.ts:193-199` already wires the module:

```ts
if (enterpriseModulesEnabled && enterpriseAgentsEnabled) {
  enabledModules.push({ id: 'agent_orchestrator', from: '@open-mercato/enterprise' })
  enabledModules.push({ id: 'agent_examples', from: '@app' })
}
```

and `packages/create-app/template/src/modules/agent_examples/agents/**` ships four complete
file-defined agent sources (`AGENT.md`, `OUTCOME.md`, `skills/`, `sub-agents/`, `tools/`). So the
*authoring* surface is already delivered to every scaffolded app. Nothing downstream of it works.

### Blocker 1 — `@open-mercato/enterprise` is not a dependency

`packages/create-app/template/package.json.template:55-134` lists 27 `@open-mercato/*` packages;
`enterprise` is not among them. Setting `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` fails module
resolution.

The package **is publicly installable** — `scripts/publish-packages.sh:20` selects it via
`yarn workspaces list --no-private` and `:72` publishes with `npm publish --access public`,
overriding the `"access": "restricted"` in `packages/enterprise/package.json:106`. `npm view
@open-mercato/enterprise version` resolves. There is **no technical license gate**: `grep -rni
"licen" packages/enterprise/src` finds only three `license: 'Proprietary'` metadata strings and no
key check. `packages/enterprise/LICENSE.md` restricts production use contractually.

CI already demonstrates the install step — `ensureEnterpriseDependency()` in
`scripts/test-create-app-integration.ts:53-62` sets `dependencies['@open-mercato/enterprise']`
before `yarn install`, and `.github/workflows/snapshot.yml:319-325` runs
`yarn add "@open-mercato/enterprise@<snapshot>"`.

### Blocker 2 — the OpenCode generator is structurally monorepo-only

`packages/cli/src/lib/generators/extensions/agent-files.ts:826-841`:

```ts
/** Walk up from a known in-repo path until a dir containing both `docker` and `packages` is found. */
function findRepoRoot(start: string): string | null {
  // requires BOTH fs.existsSync(path.join(current, 'docker', 'opencode'))
  //          AND  fs.existsSync(path.join(current, 'packages'))
}
```

A scaffolded app has neither `packages/` nor `docker/opencode/`, so this returns `null` and
`generateOutput()` returns an empty Map (`:1240-1245`) — **silently**. No agent `.md` files, no
manifest, no warning.

Two further monorepo assumptions in the same function:

- The manifest is written to
  `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts`
  (`:1256-1268`) — in standalone that resolves inside `node_modules/`, which is wiped on reinstall.
- Agent files go to `<repoRoot>/docker/opencode/agents/` and skills to
  `<repoRoot>/docker/opencode/skills/` (`:1269`, `:1295`).

This file has **no** `resolver.isMonorepo()` / `appRoot` awareness, unlike every other generator
(`entity-ids.ts:148,449`, `module-facts-discovery.ts:124`, `module-entities.ts:248`). It is the
only generator that bypasses the `generateOutput()` → `writeGeneratedFile({ outFile:
path.join(outputDir, fileName) })` contract at `module-registry.ts:4279-4288` and writes to the
filesystem directly.

### Blocker 3 — no `opencode` / `mcp` service in the template compose files

Verified across all three template compose files:

| File | Services |
|---|---|
| `template/docker-compose.yml` | postgres, redis, meilisearch, localstack |
| `template/docker-compose.fullapp.yml` | app, documents-collab, postgres, redis, meilisearch, localstack |
| `template/docker-compose.fullapp.dev.yml` | app, documents-collab, postgres, redis, meilisearch, localstack |

The monorepo's `starters/docker/compose.fullapp.yml` (root duplicate `docker-compose.fullapp.yml`,
byte-equality enforced by `scripts/__tests__/root-compose-backcompat.test.mjs:12-20`) adds
`opencode`, `mcp`, and the `mcp_shared` volume. `compose.infra.yml` adds `opencode` for the hybrid
dev mode.

The template's `fullapp.yml:83-84` forwards `OPENCODE_PROVIDER`/`OPENCODE_MODEL` to the app — inert
env vars with no container to reach.

### Blocker 4 — the container assets are not in the template

`template/docker/` contains only `redis/redis.conf`, `scripts/init-or-migrate.sh`,
`scripts/dev-entrypoint.sh`. Missing: the whole `docker/opencode/` build context (`Dockerfile`,
`entrypoint.sh`, `AGENTS.md`, `opencode.jsonc.example`, `certs/`) and `docker/scripts/mcp-entrypoint.sh`.

Consequence beyond compose: `template/scripts/dev.mjs:2307-2432` already implements a full OpenCode
lifecycle (`fetchOpencodeMcpStatus()` against `${OPENCODE_URL:-http://localhost:4096}`,
`restartOpencodeContainer()` → `docker restart mercato-opencode`, key-rotation restart) and its
failure hints print
`docker compose --project-directory . -f starters/docker/compose.infra.yml restart opencode` —
**a path that does not exist in a scaffolded app**. This is dead-ended wiring today.

### Blocker 5 — env drift

`scripts/template-sync.ts` syncs `src/{app,components,i18n,lib,modules}`, three root `src` files
(`:28-33`), ~25 explicit `scripts/*` mappings (`:34+`), and a fixed dependency allowlist
(`SYNC_DEPENDENCY_KEYS`, `SYNC_INTERNAL_PACKAGE_KEYS`, `:172-183`). It **never touches
`.env.example`, compose files, or `docker/`** — `grep '\.env' scripts/template-sync.ts` returns one
unrelated hit at `:319`. Parity is a manual checklist obligation (`packages/create-app/AGENTS.md`
Template Sync Checklist item 10), so drift is structural, not a stale run.

Measured: ~50 env names present in `apps/mercato/.env.example` and absent from the template,
including `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` (the flag `template/src/modules.ts:176` actually
reads), `OPENCODE_URL`, `OPENCODE_MCP_URL`, `MCP_*` (6), `OM_OPENCODE_*` (5),
`OM_AGENT_ARTIFACT_MAX_BYTES/COUNT`, `OM_AGENT_HEALTH_PROBE_TTL_MS`, `OM_DEV_WITH_MCP`,
`AUTO_SPAWN_SCHEDULER`, `NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI`.

### Blocker 6 (preset-only) — non-classic presets drop the wiring

`packages/create-app/src/lib/apply-starter-preset.ts:91-95` overwrites `src/modules.ts` from
`src/lib/templates/modules-ts.template` for every non-`classic` preset. That template retains
`record_locks` / `system_status_overlays` / `sso` / `security` but contains **no**
`agent_orchestrator` branch (`grep -c agent_orchestrator` → 0) and drops the
`official-modules.generated` import and the `OM_ENABLE_STORAGE_S3` branch. So `--preset
empty|crm|wms` apps cannot enable the orchestrator without hand-editing.

## Target Architecture

The monorepo topology that works, and which standalone must reproduce:

```
                  OPENCODE_URL=http://opencode:4096
  ┌─────────┐ ──────────────────────────────────▶ ┌──────────────┐
  │   app   │   OpenCodeAgentRunner                │   opencode   │
  │  :3000  │                                      │    :4096     │
  └─────────┘                                      └──────┬───────┘
       │                                                  │ OPENCODE_MCP_URL
       │ mcp waits for app /health                        │ + x-api-key (tier 1)
       ▼                                                  │ + _sessionToken (tier 2)
  ┌─────────┐ ◀───────────────────────────────────────────┘
  │   mcp   │  mcp:serve-http  — submit_outcome / load_skill /
  │  :3001  │                    run_skill_script / delegate_agent
  └────┬────┘
       │ mcp:ensure-api-key --file
       ▼
  mcp_shared volume → /run/mcp-shared/mcp-api-key (read-only in opencode)
```

Cross-process correlation is DB-backed by design: the runner and the MCP server are different
processes, so `lib/runtime/agentRunSessionStore.ts` (table `agent_run_sessions`) carries the run
correlation and the captured outcome. This was the architectural blocker recorded and fixed in
[`REAL-CONTAINER-FINDINGS.md`](./enterprise/agent-orchestrator/REAL-CONTAINER-FINDINGS.md) #3 — any
standalone topology that splits these processes inherits the same requirement, and it is already
satisfied as long as both processes share one database.

### Delivery vehicle: complete the already-specced `starters/` mirror

`.ai/specs/2026-07-17-hybrid-dev-runtime-and-starters.md` already lists as an explicit follow-up:

> mirror `starters/` into `packages/create-app/template/` (tracked via the Template Sync Checklist)

and `@open-mercato/starter` was **built for this** — `packages/starter/src/compose.mjs:9-19`:

```js
function isOpenMercatoRoot(dir) {
  // Works for the monorepo AND for standalone apps scaffolded by create-app:
  // both carry the starters/docker compose layout at their root.
  if (fs.existsSync(path.join(dir, INFRA_COMPOSE_FILE))) return true
  ...
}
```

The package is MIT, publishable, ships `bin`/`src`/`platform`, and exposes `om-start`. It already
knows the OpenCode port, base image, service image tag, health URLs, certs dir, and the
container→host MCP hop (`packages/starter/src/constants.mjs:13,26,59-60,74,84-85`;
`doctor.mjs`). It is **not** a template dependency today and it does **not** ship the compose
files (`files` = `bin`, `src`, `platform`, `README.md`), resolving them relative to a detected root.

**Decision:** ship `starters/docker/` + `docker/opencode/` + `docker/scripts/mcp-entrypoint.sh`
into the template as files, and add `@open-mercato/starter` as a template dependency so scaffolded
apps get `yarn infra:up` / `om-start` for free. This completes an existing plan instead of forking
a second delivery path, and keeps the compose files editable by the app owner (which is the whole
point of scaffolding).

### OpenCode image: no local build required

`docker/opencode/Dockerfile` is a thin layer over a **published** base image
(`docker.io/openmercatocom/open-mercato-opencode:1.18.3`) that only `COPY`s `AGENTS.md`,
`entrypoint.sh`, `agents/`, `skills/`. The dev compose already proves the bind-mount alternative
(`docker-compose.fullapp.dev.yml` mounts `./docker/opencode/{agents,skills}` read-only).

For standalone, prefer **bind-mount everything, build nothing**: reference the published base image
directly and mount `entrypoint.sh`, `AGENTS.md`, `agents/`, `skills/`, `certs/`. A scaffolded app
then needs no Docker build for the agent runtime, and `yarn generate` output reaches the container
on restart. Keep the `Dockerfile` in the template for users who want to bake a production image
(delivery model B).

## Proposed Solution

### Phase 1 — Make the enterprise module installable and discoverable *(no OpenCode yet)*

1. Add `"@open-mercato/enterprise": "{{PACKAGE_VERSION}}"` to
   `template/package.json.template` dependencies, and add `@open-mercato/enterprise` to
   `SYNC_INTERNAL_PACKAGE_KEYS` in `scripts/template-sync.ts:179-183` so the version stays pinned
   to the monorepo automatically.
   - Weigh against `packages/create-app/AGENTS.md` rule 9 (the 12 KiB `STANDALONE_ROOT_TARGET_BYTES`
     root-instruction budget). Adding a dependency does not enable a module, so the module-fact
     index is unaffected unless a fact sheet is also added — see step 4.
2. Add the missing env block to `template/.env.example` next to the existing enterprise flags
   (`:122-140`), minimally `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=false` with the same
   licence-pointer comment.
3. Restore the `agent_orchestrator` / `agent_examples` branch in
   `packages/create-app/src/lib/templates/modules-ts.template` so non-classic presets keep parity
   with `classic`. Also restore the `official-modules.generated` import and the
   `OM_ENABLE_STORAGE_S3` branch it dropped, or document the divergence deliberately.
4. Add an `agent_orchestrator` module fact sheet to the create-app knowledge layer
   (`packages/create-app/agentic/guides/modules/<id>.md`, currently 9 sheets — auth, catalog,
   currencies, customer_accounts, customers, data_sync, integrations, sales, workflows — and no
   orchestrator) so the standalone harness can reason about it. Budget-check with
   `packages/create-app/src/lib/agent-instruction-budget.test.ts`.

**Exit criterion:** a scaffolded app with both flags true boots, runs `native` agents, and shows the
cockpit. No OpenCode.

### Phase 2 — Make the generator standalone-aware *(the load-bearing fix)*

Rework `packages/cli/src/lib/generators/extensions/agent-files.ts` to resolve its two output roots
from the app layout instead of `findRepoRoot()`:

| Artifact | Monorepo | Standalone |
|---|---|---|
| Manifest | `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts` | `<appRoot>/src/file-agents.generated.ts` — matching the existing committed-registry convention (`template/src/official-modules.generated.ts` is the only precedent) and the `apps/mercato/src/` exception in the root AGENTS.md for committed `*.generated.ts` registries that must survive `yarn clean-generated` |
| Agent `.md` | `<repoRoot>/docker/opencode/agents/` | `<appRoot>/docker/opencode/agents/` |
| Skill `SKILL.md` | `<repoRoot>/docker/opencode/skills/` | `<appRoot>/docker/opencode/skills/` |

Requirements:

- Detect the layout the way the other generators do (`resolver.isMonorepo()`), not by probing for
  `docker/opencode` — the current probe is circular (the output dir must already exist for the
  generator to decide to write to it).
- **Fail loudly, not silently.** Today an unresolvable root returns an empty Map with no diagnostic.
  When the orchestrator module is enabled and the root cannot be resolved, emit a warning naming the
  expected path. Keep the existing "neither orchestrator nor any agent module enabled ⇒ leave the
  tree untouched" behaviour (`:1240-1254`) so the generator never prunes tracked artifacts for a
  merely switched-off module.
- The manifest is imported by `lib/sdk/defineAgent.ts` `loadFileAgents()`. Standalone must resolve
  it through the app's own source tree, never `node_modules/@open-mercato/enterprise`. This needs an
  import indirection (the module cannot hard-import an app path) — likely the existing
  `standaloneImports`/`processStandaloneConfig` seam in
  `packages/cli/src/lib/generators/extension.ts:5-29`. **Open question — see below.**
- `renderOpenCodeAgentFile` is duplicated in the generator and in
  `lib/sdk/defineFileAgent.ts:258-400` (the CLI cannot import `@open-mercato/core`), both carrying
  "must stay in sync" comments. Do not add a third copy; add a test asserting the two agree.

**Exit criterion:** `yarn generate` in a scaffolded app with `agent_examples` enabled emits four
agent `.md` files, three skill dirs, and a manifest — verified by a create-app integration test.

### Phase 3 — Ship the container assets and compose services

1. Copy into the template: `docker/opencode/` (Dockerfile, Dockerfile.base reference, entrypoint.sh,
   AGENTS.md, opencode.jsonc.example, certs/README.md) and `docker/scripts/mcp-entrypoint.sh`.
2. Add `opencode` + `mcp` services and the `mcp_shared` volume to
   `template/docker-compose.fullapp.yml` and `.fullapp.dev.yml`, and `opencode` to
   `template/docker-compose.yml` (the infra/hybrid case). Put them behind a **compose profile**
   (`--profile agents`) so the default `docker compose up` cost is unchanged — this matters given
   the documented 12 GB minimum for the full stack (`apps/docs/docs/installation/docker.mdx:19`).
3. Prefer `image:` + bind mounts over `build:` for the standalone opencode service (see Target
   Architecture). Pin `OPENCODE_BASE_IMAGE` with the same default as the monorepo.
4. Mirror `starters/docker/` into the template and add `@open-mercato/starter` to template
   dependencies + `infra:up`/`infra:down` scripts, so `template/scripts/dev.mjs:2385,2396`'s
   existing hints resolve to a real path.
5. Fix the version-pin fan-out: `OPENCODE_VERSION`/`OPENCODE_BASE_IMAGE` is currently duplicated in
   five places (`docker/opencode/Dockerfile:11`, `Dockerfile.base:17`,
   `packages/starter/src/constants.mjs:84`, every compose default, `BASE_IMAGE.md:15`). Adding the
   template multiplies this. Add a single source + a drift test before copying.

**Exit criterion:** `docker compose --profile agents up` in a scaffolded app brings up app + mcp +
opencode; `curl :3001/health` and `curl :4096/mcp` show `open-mercato: connected`.

### Phase 4 — Env, docs, and QA

1. Mirror the full orchestrator/OpenCode/MCP env block into `template/.env.example`.
2. **Add `.env.example` to an automated parity gate.** This is the root cause of Blocker 5 and will
   re-drift otherwise. A name-level diff test (not byte-level — comments legitimately diverge per
   `packages/create-app/AGENTS.md`) belongs next to
   `src/lib/template-i18n-parity.test.ts` / `standalone-portal-email-env-guard.test.ts`.
3. Document the standalone path. Every existing runbook
   (`RUN_AGENT_ON_OPENCODE_WINDOWS.md:56-57`, `docs/agent-dla-biznesu.md:111-112`,
   `.ai/skills/om-create-opencode-agent/SKILL.md` preflight) instructs editing `apps/mercato/.env`
   — i.e. assumes the monorepo.
4. Integration coverage per `.ai/qa/AGENTS.md`: extend
   `scripts/test-create-app-integration.ts` (which already has `ensureEnterpriseDependency()`) with
   a generate-and-assert-artifacts case.

## Runtime Requirements Inventory (for the standalone env block)

Minimum for **any** agent to run:

- Postgres with the module's 21 tables, `pgcrypto` (`gen_random_uuid()`), `jsonb`, and a
  `jsonb_path_ops` GIN index; core `workflows` enabled (the migration guards core-table rewrites
  with `to_regclass`, but the process/work-inbox path needs the module).
- A queue backend and workers — **process starts are always async** via the
  `agent-process-executions` queue. Four workers: process-execution-starter (concurrency 2),
  eval-suite-runner, llm-judge, metric-rollup (1 each).
  Note: no template compose file defines a worker service; work runs in-process via eager
  `AUTO_SPAWN_WORKERS`. For real agent load, `apps/docs/docs/deployment/agent-orchestration-scaling.mdx:16-27`
  requires `QUEUE_STRATEGY=async` + a dedicated fleet. The Railway target
  (`template/scripts/railway-worker.sh`) is the existing recipe.
- `OM_AI_PROVIDER` + matching API key; `JWT_SECRET`; a buildable `isolated-vm`
  (hard dependency of `@open-mercato/ai-assistant`, needs a compatible Node ABI/toolchain).

Additionally for `opencode` agents: a reachable `OPENCODE_URL`; a running `mcp:serve-http` reachable
*from* the OpenCode host with a shared API key; and for the file plane
`OM_OPENCODE_FILES_ENABLED=true` plus a shared RW volume
(`OM_OPENCODE_WORKSPACE_ROOT` host ↔ `OM_OPENCODE_WORKSPACE_ROOT_CONTAINER`) and S3 —
**artifact capture is fail-closed** (`lib/runtime/artifactFileStore.ts:11-16`), unlike trace
artifact offload which is fail-open.

## Risks & Open Questions

1. **OpenCode is on a deprecation path.** `.ai/specs/enterprise/agent-orchestrator/2026-07-07-lightweight-agent-runtime.md`
   records a maintainer-resolved decision for **full OpenCode replacement** by the `native` runtime;
   Phases 1–2 shipped 2026-07-12, Phase 3 is "file agents on native + OpenCode deprecation bridge",
   Phase 6 is decommission. Building an OpenCode install path into every scaffolded app adds surface
   to a runtime that is planned for removal. **This is the decision to take before Phase 3 of this
   spec.** Phases 1–2 here are valuable regardless (they are what `native` needs too).
2. **Manifest import seam — RESOLVED.** `generated-registry-loader.ts:53-58` already
   probes `<cwd>/.mercato/generated/<file>` "for a standalone app whose root holds
   `.mercato/generated`", and the scaffolded `tsconfig.json` maps `@/.mercato/*` to the
   same place. `importFileAgentsManifest()` therefore mirrors `ai-assistant`'s
   `importGeneratedAiToolsModule()` exactly: relative import (monorepo) → `@/` alias
   (standalone under the Next bundler) → `findGeneratedFile` + `compileAndImportGenerated`
   (standalone in a plain Node process: the MCP sidecar, workers, the CLI). No new
   resolution machinery. The monorepo app typecheck needed a `/// <reference>` to the
   ambient declaration, because the `@/.mercato/generated/file-agents.generated.ts` target
   only exists in a scaffold.
3. **Security posture shifts on scaffold — RESOLVED as specified.** `OPENCODE_PASSWORD` is unset in
   every shipped compose file and the monorepo infra/dev compose publishes 4096 to the host. In a
   scaffold that may be a server, and the ACL boundary is entirely the MCP-side session token. The
   standalone `docker-compose.fullapp.yml` therefore uses `expose:` rather than `ports:` for
   OpenCode (app reaches it over the Compose network); the two dev variants still publish it for
   convenience. `OPENCODE_PASSWORD` is documented in both env examples and forwarded by every
   opencode service.
4. **Resource cost — RESOLVED as specified.** Both services sit behind the `agents` Compose
   profile in all three template files, verified by asserting `docker compose config --services`
   is unchanged without the profile.
5. **Stale path bug — NOT fixed (out of scope, still open).** `lib/seeds.ts:113-117` probes
   `<cwd>/packages/core/src/modules/agent_orchestrator/examples` — the module lives in
   `packages/enterprise`, so that candidate can never resolve. Standalone relies on candidates 1 and
   3, and `readExampleJson` **throws** if none resolve.
6. **Doc drift found during research** (out of scope, worth separate issues): `.ai/docs/opencode-runtime.md:15-29`
   documents a stale `/root/.opencode/opencode.json` mount contradicted by the actual non-root
   entrypoint-generated path; `.ai/skills/om-create-opencode-agent/SKILL.md` exists as two real
   14667-byte files (`.ai/skills/` and `packages/enterprise/src/modules/agent_orchestrator/.ai/skills/`)
   while the module AGENTS.md:246 calls it symlinked; the four create-app `mcp.json.example`
   templates use a stdio/`MCP_API_KEY`/`mercato mcp:dev` shape that does not match the actual HTTP
   server reading `OPEN_MERCATO_API_KEY` under `mercato ai_assistant mcp:dev`.

## Backward Compatibility

Per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md): the generated-file contract
(category 13) and the manifest's import path are contract surfaces. Phase 2 changes **where** the
manifest is written in the standalone layout only — the monorepo path must stay byte-identical, and
the `fileAgentDescriptors` export shape must not change. New env vars are additive. No CLI command,
event ID, widget spot ID, API route, DB schema, DI key, or ACL feature changes.

## Changelog

### 2026-09-17 — implemented

**Phase 1 — installable + discoverable.** `@open-mercato/enterprise` added to
`template/package.json.template` and to `SYNC_INTERNAL_PACKAGE_KEYS` so its version tracks the
monorepo automatically. `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` + the full MCP / OpenCode / file-plane
/ runtime-budget env blocks mirrored into `template/.env.example`; the budget block was added to
`apps/mercato/.env.example` too rather than leave one-sided drift. The `agent_orchestrator` /
`agent_examples` branch restored in `src/lib/templates/modules-ts.template`, so non-`classic`
presets reach parity with `classic`.

Dropped from the plan: the `agent_orchestrator` module fact sheet. `selectModuleFactSheets` ships
`available ∩ enabled` parsed from the STATIC `enabledModules` literal, and this module is only ever
added by a conditional `.push()`, so a fact sheet could never be selected and would only consume
root-instruction budget.

**Phase 2 — generator.** `resolveAgentFilesTargets()` replaces `findRepoRoot()` as the decision
point; `createAgentFilesExtension(resolver?)` and `loadGeneratorExtensions(resolver?)` take an
optional structural `AgentFilesResolver`, passed from `module-registry.ts`. Standalone writes the
manifest to `<app>/.mercato/generated/file-agents.generated.ts` and agent/skill files to
`<app>/docker/opencode/{agents,skills}/`; the monorepo paths are byte-for-byte unchanged (verified
by re-running `yarn generate` and confirming a clean `git status` over `docker/opencode/` and
`generated/`). The silent empty-Map return now warns when the orchestrator module or any agent was
present — that silence was the reason the breakage went unnoticed. Runtime side:
`importFileAgentsManifest()` in `defineAgent.ts` resolves the manifest across both layouts.

**Phase 3 — containers.** `docker/opencode/` (Dockerfile, entrypoint.sh, AGENTS.md,
opencode.jsonc.example, certs/, and `.gitkeep`-seeded agents/ + skills/) and
`docker/scripts/mcp-entrypoint.sh` copied into the template; the template `Dockerfile` now ships
`mcp-entrypoint.sh` in both the `dev` and `runner` stages. `opencode` + `mcp` services and the
`mcp_shared` volume added to `docker-compose.fullapp{,.dev}.yml`, and `opencode` to
`docker-compose.yml` (hybrid dev, `container_name` pinned to the name `scripts/dev.mjs` restarts by).
All behind the `agents` profile. The standalone opencode service runs the published base image with
bind mounts and **no local Docker build**.

**Phase 4 — drift gate + docs.** `packages/create-app/src/lib/template-env-parity.test.ts` compares
env var NAMES across the two `.env.example` files with a frozen baseline of the ~40 pre-existing
divergences, so no NEW name can drift; verified to fail when a variable is removed. The layout-aware
`opencodeRestartCommand()` in `scripts/dev.mjs` replaces the hard-coded
`starters/docker/compose.infra.yml` hint that could never resolve in a scaffold. Standalone setup
documented in `apps/docs/docs/customization/standalone-app.mdx`.

**Deliberately not done:** mirroring `starters/` into the template. The template already keeps its
compose files at the app root, and adding the `agents` profile there needed no new layout. The
`starters/` mirror remains the tracked follow-up of
`.ai/specs/2026-07-17-hybrid-dev-runtime-and-starters.md`, and
`@open-mercato/starter` is still not a template dependency.

**Validation.** `yarn generate` (monorepo artifacts byte-identical); `yarn lint` 0 errors;
`yarn typecheck` 38/38; `yarn test` 46/46 tasks; `@open-mercato/cli` 103 suites / 1926 tests;
`@open-mercato/enterprise` 227 suites / 1985 tests; `create-mercato-app` 890 tests incl. the 3 new
parity tests; `yarn template:sync` clean; `yarn agents:check-budget` exit 0, no regression. A real
`create-mercato-app` scaffold was inspected: docker assets present, enterprise dep pinned, agents
flag documented, `--profile agents` resolves app+mcp+opencode while a plain `up` is unchanged.
`yarn build:app` fails on three pre-existing `warranty_claims` generated-entity resolution errors,
reproduced with these changes stashed.

### 2026-09-17
- Initial research and specification. Grounded in a code-level audit of `agent-files.ts`,
  `template-sync.ts`, `apply-starter-preset.ts`, all template and `starters/docker/` compose files,
  `docker/opencode/{Dockerfile,entrypoint.sh}`, `docker/scripts/mcp-entrypoint.sh`,
  `packages/starter/src/compose.mjs`, and the agent_orchestrator runtime/DI/worker surface.
