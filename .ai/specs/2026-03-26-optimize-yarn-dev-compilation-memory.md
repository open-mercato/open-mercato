# Optimize `yarn dev` Compilation Time and Memory Usage

**Status**: Draft
**Date**: 2026-03-26
**Author**: Agent

## TLDR

Keep the current `yarn dev` behavior intact and introduce additive commands for comparison:

- `yarn dev` stays unchanged
- `yarn dev:legacy` becomes an explicit alias for today’s pipeline
- `yarn dev:optimized` runs the new package-build/watch pipeline
- `yarn dev:benchmark` measures both legacy and optimized modes on the same machine

The optimized path targets package build/watch overhead only. Worker spawning remains enabled and is not reduced or disabled in this spec.

It also must support dev-time structural changes that currently require `modules:prepare`, such as adding pages, routes, subscribers, workers, widgets, or other auto-discovered module files.

## Overview

The current root dev command is:

```bash
yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app
```

That path currently:

1. rebuilds all packages on every restart because Turbo build cache is disabled
2. runs one watch process per package
3. performs a full `dist/**/*.js` extension rewrite pass after every rebuild
4. relies on a fixed `sleep 3` instead of an actual readiness signal
5. starts the app runtime with workers and scheduler
6. depends on generated registries in `apps/mercato/.mercato/generated/` for route/module discovery, DI, entities, widgets, OpenAPI, and related bootstrap wiring

This spec changes the rollout strategy:

- preserve the existing command for full backward compatibility
- add a parallel optimized command path
- add built-in measurement tooling so the repo can compare old and new behavior with the same runtime shape
- add automatic generator invalidation so new auto-discovered files become available during `dev:optimized` without manual `modules:prepare`

## Problem Statement

### P1 — Full package rebuild on every restart

[`turbo.json`](/Users/piotrkarwatka/Projects/mercato-development-two/turbo.json) disables caching for `build` and passes all env vars through the cache key. As a result, `yarn build:packages` reruns even when package sources have not changed.

### P2 — Expensive post-build `.js` extension rewriting

The shared watch/build flow in [`scripts/watch.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/scripts/watch.mjs) and package-local `build.mjs` files rewrites relative imports by scanning all emitted `.js` files after every build. In large packages such as core, that means reading and rewriting thousands of outputs even when only a small source file changed.

### P3 — One watcher process per package

`turbo run watch --parallel` starts a separate Node.js process for each package watcher. That duplicates esbuild runtime overhead and wastes memory in steady state.

### P4 — `sleep 3` is a race, not a contract

The current startup sequence does not know when the watched packages are actually ready. On slow machines, the app can start against stale or incomplete outputs; on fast machines, the fixed sleep is just dead time.

### P5 — No scoped memory ceiling for the optimized dev path

The repo has no dedicated memory tuning for the package-watch pipeline. Any memory ceiling added here should be scoped to the new optimized command, not injected globally into all commands via `.env.example`.

### P6 — Build target is older than the declared engine

Most package builds still target `node18` while the workspace declares Node `24.x`. That prevents esbuild from emitting newer syntax and creates unnecessary output overhead.

### P7 — Structural module changes require generator reruns during dev

The app runtime depends on generated files such as:

- [`apps/mercato/.mercato/generated/modules.generated.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/modules.generated.ts)
- [`apps/mercato/.mercato/generated/entities.generated.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/entities.generated.ts)
- [`apps/mercato/.mercato/generated/di.generated.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/di.generated.ts)
- [`apps/mercato/.mercato/generated/search.generated.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/search.generated.ts)
- [`apps/mercato/.mercato/generated/injection-tables.generated.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/injection-tables.generated.ts)
- [`apps/mercato/.mercato/generated/module-package-sources.css`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/.mercato/generated/module-package-sources.css)

When a developer adds or removes an auto-discovered file such as a backend page, frontend page, API route, subscriber, worker, widget, event declaration, translation declaration, or generator plugin, package rebuild alone is not sufficient. The generated registries must be refreshed too.

### P8 — Package rebuild and generator rerun must coordinate, not race

If a new file is added under a watched package and the generator reruns before the package output is ready, the app can observe stale package `dist/` output or generated registries that reference code which is not yet compiled. The optimized mode needs an explicit queue and liveness contract for package rebuilds and generator reruns.

### Constraint — Worker spawning must remain enabled

Worker spawning is required for this repo’s development workflow. This spec does not disable or opt out of workers in either legacy or optimized mode. Benchmarks must compare the two paths with workers enabled.

## Proposed Solution

Introduce an additive optimized dev toolchain and a benchmark runner. Do not replace the existing command during this spec.

### Phase 1 — Add explicit command surfaces for legacy, optimized, and benchmark modes

Add new root scripts and a CLI-owned benchmark runner:

```json
{
  "scripts": {
    "dev": "yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app",
    "dev:legacy": "yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app",
    "dev:optimized": "node scripts/dev-optimized.mjs",
    "dev:benchmark": "yarn mercato dev:benchmark --mode both"
  }
}
```

Command intent:

- `yarn dev`: frozen current behavior
- `yarn dev:legacy`: explicit literal baseline alias used by benchmark tooling
- `yarn dev:optimized`: new path that uses cache-aware build, optimized watch startup, automatic generator invalidation, readiness signaling, and scoped memory flags
- `yarn dev:benchmark`: runs both modes and emits comparable metrics

Why this phase comes first:

- it preserves full backward compatibility for existing users
- it makes measurement possible before deciding whether to switch defaults later
- it avoids contaminating the baseline during the optimization rollout

Baseline stability rule:

- `dev:legacy` must inline the original command string and must not delegate to `dev`
- future changes to `dev` must not silently change the benchmark baseline

### Phase 2 — Enable Turbo cache for package builds with a verified input matrix

Remove `cache: false` from the `build` task and replace `globalPassThroughEnv: ["*"]` with a narrow allowlist of env vars that truly affect build output.

The cache key must reflect the real build graph used today. At minimum, the spec must cover these input classes:

| Package class | Required inputs |
|---------------|-----------------|
| Base esbuild packages | `src/**/*.{ts,tsx}`, `build.mjs`, `package.json`, `tsconfig.json` when present |
| JSON-copy packages | base inputs + `src/**/*.json` |
| Generated-code packages | base inputs + `generated/**/*.{ts,tsx}` |
| Agentic-copy packages | base inputs + `agentic/**` and any copied sibling guide sources |
| Version-injection packages | base inputs + `package.json` |

Current packages that need special coverage include:

- [`packages/core/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/core/build.mjs): `generated/**`, `src/**/*.json`
- [`packages/cli/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/cli/build.mjs): copied `../create-app/agentic/**`
- [`packages/create-app/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/create-app/build.mjs): `agentic/**`, copied sibling standalone guides
- [`packages/shared/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/shared/build.mjs): version injection from `package.json`
- [`packages/search/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/search/build.mjs), [`packages/enterprise/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/enterprise/build.mjs), [`packages/ai-assistant/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ai-assistant/build.mjs), [`packages/scheduler/build.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/scheduler/build.mjs): `src/**/*.json`

Expected impact:

- warm `build:packages` invocations become cache hits
- `yarn dev:optimized` can skip redundant rebuild work on restart

### Phase 3 — Replace full-output rewrite passes with a verified incremental rewrite strategy

Do not use `result.metafile.outputs` as a proxy for changed outputs. In local verification, it reports the full output set on rebuild, not only modified files.

Instead, the optimized path should use a proven strategy:

1. record `buildStartedAt` before each build/rebuild
2. after esbuild completes, scan emitted `dist/**/*.js`
3. only process files whose `mtime` is newer than `buildStartedAt - skewWindowMs`
4. still perform a full scan on the very first build or when the incremental filter is unavailable
5. skip writes when the rewritten content is identical

Optional safety valve:

- `OM_DEV_FORCE_FULL_JS_REWRITE=true` forces the old full-scan behavior for debugging

Expected impact:

- rebuild-time rewrite work becomes proportional to actual changed outputs
- repeated writes to unchanged files are avoided

### Phase 4 — Add a single-process watch coordinator with package-level fault isolation

Create [`scripts/watch-all.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/scripts/watch-all.mjs) for the optimized path.

Responsibilities:

1. discover workspace packages that have a `src/` directory
2. create one esbuild watch context per package inside a single Node.js process
3. isolate per-package failures so one package error does not terminate all watchers
4. emit package lifecycle events to a readiness manifest
5. dispose cleanly on `SIGINT` and `SIGTERM`

Fault-isolation requirements:

- a failed rebuild marks only that package as failed in the readiness manifest
- the watch coordinator stays alive unless the root coordinator itself crashes
- package errors are clearly logged with package name and last successful build time

Expected impact:

- lower steady-state memory than one-process-per-package
- faster startup than Turbo parallel watch spawning

### Phase 5 — Add generator invalidation and auto-regeneration during optimized mode

Create a generator coordinator for `dev:optimized`. It must watch for changes that affect `.mercato/generated/` output and rerun generators automatically.

Generator-trigger classes:

| Change type | Examples | Action required |
|-------------|----------|-----------------|
| Auto-discovered route/page files | `frontend/**`, `backend/**`, `api/**` | rerun generators |
| Auto-discovered runtime files | `subscribers/**`, `workers/**` | rerun generators |
| Widget and component extension files | `widgets/injection/**`, `widgets/dashboard/**`, `widgets/components.ts`, `widgets/injection-table.ts` | rerun generators |
| Registry convention files | `index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `search.ts`, `events.ts`, `translations.ts`, `notifications.ts`, `notifications.client.ts`, `ai-tools.ts`, `generators.ts`, `data/extensions.ts`, `data/enrichers.ts`, `api/interceptors.ts` | rerun generators |
| Enabled module list changes | `apps/mercato/src/modules.ts` | rerun generators and refresh package source CSS |
| Generator implementation changes | `packages/cli/src/lib/generators/**` | rerun generators and report that generator logic changed |

Generator-derived trigger contract:

- the optimized implementation must derive structural invalidation from the same generator conventions and scanner rules used by the generator pipeline itself, especially the scanner definitions in [`packages/cli/src/lib/generators/scanner.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/cli/src/lib/generators/scanner.ts)
- the manual table above is explanatory, not authoritative
- if generator discovery conventions change, optimized invalidation must update automatically from the same source of truth rather than from a second handwritten list

Filesystem event requirements:

- support file creation
- support file modification
- support file deletion
- support file rename as create + delete
- treat directory creation/removal under auto-discovery roots as structural invalidation events

Generator execution rules:

1. Debounce structural changes briefly, for example 150-300ms.
2. Serialize generator runs: never run two generator passes concurrently.
3. If a structural change happens while generators are already running, queue exactly one follow-up run.
4. Update the watch manifest with `generator.status`, `lastStartedAt`, `lastSuccessAt`, `runSeq`, and `error`.
5. Mark the optimized session as `degraded` or `failed` if generator output cannot be refreshed.

The optimized implementation may call generator functions directly through the CLI library instead of spawning a separate process, but it must produce the same outputs as:

```bash
yarn mercato generate all --quiet
```

Generated outputs that must remain current during optimized mode include at least:

- `modules.generated.ts`
- `modules.cli.generated.ts`
- `entities.generated.ts`
- `di.generated.ts`
- `entities.ids.generated.ts`
- `search.generated.ts`
- `events.generated.ts`
- `notifications.generated.ts`
- `notifications.client.generated.ts`
- `injection-widgets.generated.ts`
- `injection-tables.generated.ts`
- `dashboard-widgets.generated.ts`
- `ai-tools.generated.ts`
- `analytics.generated.ts`
- `component-overrides.generated.ts`
- `guards.generated.ts`
- `command-interceptors.generated.ts`
- `frontend-middleware.generated.ts`
- `backend-middleware.generated.ts`
- `notification-handlers.generated.ts`
- `message-types.generated.ts`
- `message-objects.generated.ts`
- `messages.client.generated.ts`
- `payments.client.generated.ts`
- `bootstrap-registrations.generated.ts`
- `translations-fields.generated.ts`
- `inbox-actions.generated.ts`
- `interceptors.generated.ts`
- `enrichers.generated.ts`
- `module-package-sources.css`
- OpenAPI output generated by the current generator pipeline

### Phase 6 — Coordinate package rebuild and generator rerun ordering

The optimized mode needs an explicit invalidation matrix so structural edits do the right thing automatically.

| Scenario | Package rebuild | Generator rerun | Restart required |
|----------|-----------------|-----------------|------------------|
| Edit existing package source file | Yes | No, unless it is a generator-trigger file | No |
| Edit existing app-local module source file | No package rebuild; rely on app runtime invalidation | No, unless it is a generator-trigger file | No |
| Add/remove backend or frontend page in an existing module | Yes for package modules; no for app-local modules | Yes | No |
| Add/remove API route in an existing module | Yes for package modules; no for app-local modules | Yes | No |
| Add/remove subscriber or worker | Yes for package modules; no for app-local modules | Yes | No |
| Add/change `events.ts`, `search.ts`, `translations.ts`, `notifications.ts`, `ai-tools.ts`, `generators.ts` | Yes for package modules; no for app-local modules | Yes | No |
| Change `apps/mercato/src/modules.ts` enabled module list | Maybe, depending on selected packages | Yes | No |
| Add a brand-new workspace package under `packages/*` | Yes | Yes | Yes, unless dynamic watcher attachment is implemented |
| Change root workspace layout or root script wiring | Possibly | Possibly | Yes |

Ordering rules:

1. Structural changes under an existing package module first wait for that package’s rebuild success, then trigger the generator pass.
2. Structural changes under app-local modules can trigger generator pass immediately because there is no package `dist/` step.
3. For app-local structural changes, the generator pass must complete before optimized mode reports the session back to `ready`.
4. If both package rebuild and generator rerun are needed, the readiness contract must not report the app as fully ready until both complete successfully.
5. The app runtime may continue serving the last good generated state while generators rerun, but session status must reflect that the system is updating.
6. The benchmark runner must exclude restart-required scenarios from its automatic measurement loop and report them explicitly as unsupported hot changes unless dynamic attachment is implemented.

Restart-required scenarios unless explicitly implemented later:

- adding a brand-new workspace package under `packages/*`
- changing root `package.json` scripts or workspace shape
- changing `turbo.json`
- changing root TypeScript/workspace config that affects package resolution
- changing generator implementation internals under `packages/cli/src/lib/generators/**` when the optimized session cannot hot-reload its own generator code safely
- adding a new workspace to the monorepo workspace list

### Phase 7 — Replace `sleep 3` with a manifest-based readiness contract in optimized mode

Do not use `dist/` existence as readiness.

The optimized watch flow should write a session-scoped manifest, for example:

```json
{
  "sessionId": "2026-03-27T10-15-00.000Z-12345",
  "packages": {
    "core": { "status": "ready", "updatedAt": "..." },
    "ui": { "status": "ready", "updatedAt": "..." }
  }
}
```

`scripts/wait-for-packages.mjs` should:

- wait only for the current optimized watch session
- require every tracked package to reach `ready`
- fail fast if any package enters `failed`
- enforce a timeout with a useful error message

The manifest must also cover generator liveness so the app does not start from half-updated registry state.

Required root-level liveness fields:

- `sessionId`
- `status`: `starting` | `running` | `ready` | `degraded` | `failed` | `dead`
- `heartbeatAt`
- `packageRunSeq`
- `generatorRunSeq`

Required package-level fields:

- `status`: `idle` | `building` | `ready` | `failed`
- `buildSeq`
- `lastCompletedSeq`
- `lastEventAt`
- `lastSuccessAt`
- `error`

Required generator-level fields:

- `status`: `idle` | `running` | `ready` | `failed`
- `runSeq`
- `lastStartedAt`
- `lastSuccessAt`
- `lastEventAt`
- `error`

Operational state rules after startup:

- if package rebuild fails after the session was previously `ready`, keep the last good outputs in place and mark session `degraded`
- if generator rerun fails after the session was previously `ready`, keep the last good generated files in place and mark session `degraded`
- a subsequent successful rebuild/generator pass clears degraded state and returns the session to `ready`
- terminal coordinator failure marks the session `dead`
- console output must always show the current degraded reason and the exact recovery action

Anti-stall rules:

- coordinator heartbeat updates every 1-2 seconds
- if heartbeat is stale beyond the configured threshold, waiters fail immediately
- if any package remains `building` too long, it is marked `failed`
- if generators remain `running` too long, they are marked `failed`
- on shutdown or crash, the session status becomes `dead`

This readiness contract is used only by `yarn dev:optimized`. The existing `yarn dev` keeps its current startup behavior unchanged.

### Phase 8 — Scope memory options to the optimized command only

Do not add global `NODE_OPTIONS` defaults to `.env.example`.

Instead, `yarn dev:optimized` may set a scoped memory ceiling internally, for example:

```bash
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=2048" node scripts/dev-optimized.mjs
```

Rules:

- preserve existing user-supplied `NODE_OPTIONS`
- apply the memory cap only in optimized mode
- document an override env var if contributors need a larger heap

### Phase 9 — Update package build/watch targets to `node24`

Update package build and watch scripts from `node18` to `node24` to match the workspace engine declaration.

This applies to:

- package `build.mjs` files
- shared watch configuration in [`scripts/watch.mjs`](/Users/piotrkarwatka/Projects/mercato-development-two/scripts/watch.mjs)
- any auxiliary esbuild compile steps still targeting `node18`

## Architecture

### Command Matrix

| Command | Purpose | Worker spawn | Status |
|---------|---------|--------------|--------|
| `yarn dev` | Existing developer entrypoint | Enabled | Preserved unchanged |
| `yarn dev:legacy` | Explicit baseline alias | Enabled | New additive alias |
| `yarn dev:optimized` | New optimized package build/watch + generator path | Enabled | New additive command |
| `yarn dev:benchmark` | Compare legacy vs optimized and write metrics | n/a | New additive command |

### Optimized Startup Flow

```text
yarn dev:optimized
  -> optional cached build:packages
  -> node scripts/watch-all.mjs
  -> generator coordinator watches structural module files
  -> node scripts/wait-for-packages.mjs --session <id>
  -> yarn dev:app
  -> workers + scheduler remain enabled through existing app runtime
```

### Benchmark Flow

```text
yarn dev:benchmark
  -> run legacy scenario
  -> capture startup/rebuild/memory metrics
  -> run optimized scenario
  -> capture same metrics
  -> write JSON artifact + console summary
```

## Data Models

No domain data model changes.

New tooling artifacts are limited to local benchmark and watch-state files, for example:

- `.mercato/dev-watch/*.json`
- `.mercato/dev-watch/*.lock`
- `.ai/benchmarks/dev/*.json`

These are implementation details, not application contracts.

## API Contracts

No HTTP API changes.

New user-facing command surfaces are additive only:

| Surface | Contract |
|---------|----------|
| `yarn dev` | Must continue to behave as it does today throughout this spec |
| `yarn dev:legacy` | Must match the current `yarn dev` flow |
| `yarn dev:optimized` | Must keep worker spawning enabled |
| `yarn dev:benchmark` | Must support comparing at least `legacy`, `optimized`, and `both` modes |

If the benchmark runner emits structured JSON, the output should be treated as an internal tooling contract and covered by tests.

Benchmark command implementation rule:

- the spec implementation must define whether `mercato dev:benchmark` runs from built CLI output or directly from source
- if it depends on built CLI output, `dev:benchmark` must ensure the required CLI artifacts exist before measurement begins and must report that bootstrap cost separately from measured scenario timings
- the benchmark must never accidentally include “CLI was not built yet” failures in legacy vs optimized comparisons

## Migration & Backward Compatibility

This spec is designed for full backward compatibility at the command level.

Rules:

1. `yarn dev` is not modified in this spec.
2. All new behaviors are introduced behind additive commands.
3. Worker spawning remains enabled in both legacy and optimized modes.
4. Auto-regeneration of `.mercato/generated/` is additive and applies only to optimized mode in this spec.
5. Any future proposal to switch `yarn dev` to the optimized path requires a follow-up spec.
6. `dev:legacy` is the frozen baseline used by benchmark comparisons and must remain a literal copy of the original startup command during this spec.

Rollback strategy:

- Phase 2: disable cache changes or run `turbo clean`
- Phase 3: set `OM_DEV_FORCE_FULL_JS_REWRITE=true`
- Phase 4/5: keep using `yarn dev` or `yarn dev:legacy`
- Phase 6: bypass optimized-only memory flags
- Phase 7: revert target updates if a Node 24 issue is discovered

## Measurement & Acceptance Criteria

### Metrics

The benchmark runner must capture:

- `coldStartMs`: process start to first successful app readiness check
- `warmRestartMs`: second run with unchanged sources
- `steadyStateRssMb`: total RSS of the process tree after 60 seconds idle
- `incrementalRebuildMs`: touch-file to successful rebuild completion
- `generatorRefreshMs`: structural change to successful generator completion
- `watchReliability`: count of successful rebuilds over a fixed edit loop

### Protocol

Measurements must be run:

- on the same machine for legacy and optimized scenarios
- with workers enabled in both scenarios
- with at least 5 cold samples and 5 warm samples per scenario
- with median and p95 reported
- with machine metadata captured: OS, CPU model, RAM, Node version, Yarn version

Measurement isolation rules:

- cold runs must define whether `.turbo/`, `.next/`, package `dist/`, and `.mercato/generated/` are cleaned before each sample
- warm runs must intentionally reuse caches and generated outputs
- legacy and optimized scenarios should alternate run order when practical to reduce thermal/noise bias
- process-tree RSS collection must use one documented cross-platform method
- benchmark artifacts must record exactly which caches were cleaned or preserved for each run

Artifacts should be written to `.ai/benchmarks/dev/` as structured JSON.

### Initial Acceptance Targets

The optimized path is considered successful if, on the same machine and with workers enabled:

- median `warmRestartMs` improves by at least 35%
- median `steadyStateRssMb` improves by at least 20%
- median `incrementalRebuildMs` improves by at least 40%
- median `generatorRefreshMs` remains within an acceptable dev loop threshold, initial target <= 3000ms for existing modules
- `watchReliability` is 100% across a 20-edit loop
- no regression is observed in the ability to run the normal app runtime with workers

If one or more targets are missed but the optimized path is still materially better, the benchmark results must be documented and the spec updated before any default switch is considered.

## Risks & Impact Review

| Risk | Failure Scenario | Severity | Affected Area | Mitigation | Residual Risk |
|------|------------------|----------|---------------|------------|---------------|
| Cache false positives | Build cache omits a real input and reuses stale `dist/` output | High | Build correctness | Build a verified input matrix from actual package build scripts; keep `yarn dev` unchanged as fallback | Low |
| Incremental rewrite misses a changed output | Runtime import path stays unpatched in optimized mode | High | Package runtime | Use mtime-based filtering with full-scan fallback and test coverage for rewrite candidates | Low |
| Watch-all coordinator crashes | All optimized watchers stop at once | High | Dev workflow | Keep `yarn dev`/`dev:legacy` as stable escape hatches and isolate per-package errors | Medium |
| Generator rerun races with package rebuild | Generated registry points to files not yet built | High | Route/module discovery | Serialize package-ready then generator ordering for structural package changes | Low |
| Structural file additions are not watched | New route/page/widget does not appear until manual regenerate | High | Dev workflow | Define and test the generator-trigger matrix against scanner conventions | Low |
| Readiness manifest lies | App starts before optimized watch outputs are ready | High | Startup correctness | Use session-scoped manifest updates only after successful initial build completion | Low |
| Generator queue stalls | Optimized mode waits forever after a structural change | High | Dev workflow | Add heartbeat, run sequence counters, generator timeout, and `dead` session state | Low |
| Hand-maintained trigger list drifts from real generator behavior | New auto-discovered files fail to regenerate during optimized mode | High | Dev workflow | Derive invalidation from the same scanner/convention sources as the generator pipeline | Low |
| Benchmark noise leads to false conclusions | A single noisy machine run overstates gains | Medium | Decision quality | Require repeated runs, medians, p95, and artifact persistence | Low |
| Benchmark baseline drifts over time | `dev:legacy` stops representing the original path | Medium | Measurement quality | Keep `dev:legacy` as a literal baseline command and test it against the spec contract | Low |
| Scoped memory cap is too aggressive | Optimized mode OOMs on large workspaces | Medium | Dev workflow | Allow override and preserve user-provided `NODE_OPTIONS` | Low |
| Node 24 target exposes unsupported syntax to outdated local environments | Contributor sees runtime failure on old Node | Low | Local setup | Node 24 is already the declared engine; document requirement in the benchmark summary and docs | Low |

## Non-Goals

- changing the default `yarn dev` behavior in this spec
- disabling worker spawning
- removing scheduler startup from the existing app runtime
- replacing esbuild with another build tool
- optimizing production builds
- hot-attaching brand-new workspace packages unless explicitly implemented later

## Implementation Plan

Recommended landing order:

| Order | Phase | Effort | Notes |
|-------|-------|--------|-------|
| 1 | Phase 1 — additive commands and benchmark shell | ~1h | Establish comparison surface first |
| 2 | Phase 2 — Turbo cache with verified inputs | ~2h | Must be correct before measuring warm-start wins |
| 3 | Phase 3 — incremental rewrite strategy | ~2h | Replace invalid metafile-based plan |
| 4 | Phase 4 — watch-all coordinator | ~3h | Include package failure isolation |
| 5 | Phase 5 — generator invalidation and auto-regeneration | ~3h | Cover auto-discovery changes during dev |
| 6 | Phase 6 — package/generator ordering | ~1.5h | Avoid stale generated registries |
| 7 | Phase 7 — manifest readiness and anti-stall | ~1.5h | Used only by optimized mode |
| 8 | Phase 8 — scoped memory options | ~30m | Keep out of global env defaults |
| 9 | Phase 9 — `node24` targets | ~30m | Final low-risk cleanup |
| 10 | Benchmark pass and docs sync | ~1h | Record before/after artifacts |

## Integration Test Coverage

Automated coverage for this spec should include:

1. CLI/unit tests for benchmark mode parsing and JSON output shape.
2. Unit tests for readiness-manifest parsing and failure handling.
3. Unit tests for incremental rewrite candidate filtering.
4. Unit tests for generator-trigger classification against the current scanner conventions.
5. Unit tests for package/generator ordering rules.
6. Smoke tests that `dev:legacy` and `dev:optimized` resolve the expected command paths.
7. Smoke coverage that optimized mode preserves worker-enabled runtime settings.
8. Smoke coverage for these hot-change cases in optimized mode:
   - add backend page to an existing module
   - add API route to an existing module
   - add `events.ts` or `search.ts` to an existing module
   - change `apps/mercato/src/modules.ts`
9. Tests that `dev:legacy` remains a literal baseline command and does not delegate to `dev`.
10. Tests that generator invalidation handles create/delete/rename cases, not only content edits.
11. Tests that degraded mode preserves last good generated state after generator failure.

What remains manual or benchmark-driven:

- absolute performance numbers
- machine-specific memory measurements
- long-running watch reliability outside the defined edit-loop benchmark

## Test Plan

- Run `yarn dev:benchmark --mode both --json` and verify artifacts are written for both scenarios.
- Run the benchmark twice on the same machine and confirm medians are stable enough to compare.
- Touch representative files in `packages/core/src/`, `packages/shared/src/`, and `packages/ui/src/` and verify optimized rebuild timing improves without missed rebuilds.
- In optimized mode, add a temporary backend page under an existing module and verify package rebuild + generator rerun make the page available without manual `modules:prepare`.
- In optimized mode, add a temporary API route under an existing module and verify package rebuild + generator rerun make the route available without manual `modules:prepare`.
- In optimized mode, change `apps/mercato/src/modules.ts` and verify generated registries refresh automatically.
- In optimized mode, rename and delete temporary structural files and verify generator invalidation still behaves correctly.
- Force a generator failure in optimized mode and verify the session becomes `degraded`, keeps last good generated state, and recovers on the next successful generator pass.
- Verify `yarn dev` still behaves exactly as before.
- Verify `yarn dev:legacy` matches `yarn dev`.
- Verify `yarn dev:optimized` starts the normal app runtime with workers enabled.
- Run `yarn test` after implementing the command and helper changes.

## Documentation Updates

Implementation must review and update user-facing guidance that currently tells contributors to run `modules:prepare` manually when optimized mode can handle the change automatically.

At minimum review:

- backend/UI error strings that currently instruct `modules:prepare`
- docs pages describing module-discovery workflow
- troubleshooting docs for generated registries

Documentation should distinguish:

- `yarn dev` / `yarn dev:legacy`: manual `modules:prepare` behavior remains unchanged
- `yarn dev:optimized`: structural changes should auto-regenerate supported generated outputs

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| TLDR & Overview included | Pass | Updated |
| Problem Statement included | Pass | Updated |
| Proposed Solution included | Pass | Updated |
| Architecture included | Pass | Updated |
| Data Models included | Pass | No domain changes |
| API Contracts included | Pass | Command-surface contracts documented |
| Risks & Impact Review included | Pass | Expanded |
| Phasing included | Pass | Updated |
| Implementation Plan included | Pass | Updated |
| Integration Test Coverage included | Pass | Added |
| Migration & Backward Compatibility included | Pass | Added |
| Changelog included | Pass | Updated |

## Changelog

| Date | Change |
|------|--------|
| 2026-03-26 | Initial draft |
| 2026-03-27 | Reworked spec around additive `legacy` / `optimized` / `benchmark` commands; preserved `yarn dev`; kept worker spawning enabled; added BC, measurement, readiness, and automated coverage requirements |
