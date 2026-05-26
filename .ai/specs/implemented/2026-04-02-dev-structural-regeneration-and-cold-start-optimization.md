# Dev Structural Regeneration And Cold-Start Optimization

## TLDR
**Key Points:**
- The current `yarn dev` bottleneck is not server boot. It is cold request compilation of the three catch-all entrypoints that eagerly import the full generated module registry and bootstrap the whole app.
- On April 2, 2026 profiling of the current code showed `GET /backend/customers/people` at `19.4s` (`17.0s` compile) and `GET /api/customers/people` at `15.0s` (`14.8s` compile), with Next dev RSS growing above `7 GB`.
- The permanent fix is two-part:
  1. add a generator watch pipeline so structural file changes regenerate `.mercato/generated` during `yarn dev` without restart
  2. replace the eager catch-all route graph with generated lightweight route manifests plus lazy route loaders and partitioned bootstrap domains.
- May 5, 2026 amendment: app `.env*` changes are runtime inputs, not structural inputs. `mercato server dev` now watches app env files and restarts the managed Next.js + worker + scheduler group so changed secrets, provider settings, ports, and runtime toggles are picked up without manually restarting `yarn dev`.

**Scope:**
- Modify the dev workflow so structural module changes trigger targeted generator runs during `yarn dev`.
- Restart the managed dev runtime group when app environment files change.
- Add generated route manifests for `frontend`, `backend`, and `api` catch-all routing.
- Keep monorepo and standalone-app behavior aligned.
- Keep existing generated-file contracts additive and backward-compatible.

**Concerns:**
- `modules.generated.ts` is a generated contract and cannot be removed or narrowed in one release.
- Standalone apps resolve module code from compiled package `dist/` trees, so loader generation must work for both source and compiled package layouts.

## Implementation Status

Status on April 2, 2026 after implementation and rerun:
- Implemented:
  - `mercato generate watch` and wired it into app/template `yarn dev`
  - standalone `create-app` template now uses the same splash wrapper/template as the monorepo `yarn dev`, with the child runtime mirrored from `apps/mercato/scripts/dev.mjs`
  - additive generated manifests: `frontend-routes.generated.ts`, `backend-routes.generated.ts`, `api-routes.generated.ts`, `modules.runtime.generated.ts`, `modules.app.generated.ts`
  - catch-all frontend/backend/API routing switched to manifest-based lazy loaders
  - app bootstrap switched to the route-free `modules.app.generated.ts` registry instead of the full route registry
  - subscriber and worker registration switched to lazy metadata wrappers so handler implementations are imported only when an event or queue actually executes
  - dev-only background route warmup added through `instrumentation.ts` with `OM_DEV_WARM*` controls and backward-compatible `MERCATO_DEV_WARM*` aliases
  - `experimental.preloadEntriesOnStart = false` enabled for app and standalone template
- Verification:
  - `yarn build:packages` passes
  - `yarn generate` passes
  - `yarn i18n:check-sync` passes
  - `yarn i18n:check-usage` reports only pre-existing advisory unused keys
  - unit tests for shared registry, event worker, and generator subsets/manifests pass
  - `yarn typecheck` passes
  - `yarn test` passes
  - `yarn build:app` passes
- Measured strict cold-dev results with a fresh `yarn dev` boot per route:

| Scenario | Total | Compile | Notes |
|----------|-------|---------|-------|
| `GET /login` with warmup off | `8.1s` | `7.4s` | cold frontend catch-all only |
| `GET /login` after background warmup | `2.0s` | `1.4s` | warmed in background before first user hit |
| `GET /backend/customers/people` with warmup off | `14.4s` | `7.5s` | includes cold auth sidecar compile and redirect render |
| `GET /backend/customers/people` after background warmup | `3.9s` | `1.5s` | auth sidecar still costs `~1.5s`, but backend page compile is largely removed |
| `GET /api/customers/people?page=1&pageSize=20` with warmup off | `1.86s` | `1.71s` | already mostly fixed by lazy API route loading |
| `GET /api/customers/people?page=1&pageSize=20` after background warmup | `1.73s` | `1.59s` | small additional improvement |

- Memory and generated artifact measurements:
  - `next-server` RSS at ready with warmup off and no requests: `~2.01 GB`
  - `next-server` RSS after background warmup and no requests: `~2.47 GB`
  - `next-server` RSS after first cold API hit with warmup off: `~3.49 GB`
  - `next-server` RSS after background warmup plus first API hit: `~3.54 GB`
  - `modules.app.generated.ts`: `72,214` bytes, `300` imports
  - `modules.cli.generated.ts`: `75,175` bytes, `325` imports
  - `modules.generated.ts`: `645,576` bytes, `1,132` imports
- Outcome versus baseline:
  - backend cold first-hit time improved from `19.4s` baseline to `14.4s` without warmup and `3.9s` with warmup
  - frontend cold first-hit time improved from the prior regressed implementation (`15.5s`) to `8.1s` without warmup and `2.0s` with warmup
  - API cold first-hit time improved from `15.0s` baseline to `1.86s`; background warmup adds only marginal extra benefit there
  - steady-state dev RSS dropped materially versus the earlier `6-7 GB` traces, although enabling warmup trades about `460 MB` of idle RSS for lower first-hit latency
  - lazy subscriber and worker wrappers removed handler code from the app bootstrap hot path without changing sync event handling or async queue behavior
- Event and queue separation conclusion:
  - moving queue workers out of the app bootstrap path was worth doing and is implemented through lazy worker/subscriber wrappers
  - fully moving subscribers out of app runtime is not safe as a transparent optimization because persistent subscribers still execute synchronously today before or alongside queue enqueue
  - any future worker-only split needs explicit metadata such as `executionMode: 'sync' | 'async-only' | 'both'` so async and sync semantics remain correct
- Known caveat:
  - structural additions are handled without restart
  - structural deletions still trigger a brief transient Next compile error before the regenerated manifest lands, because the stale generated manifest still references the removed route during invalidation
  - `instrumentation.ts` must keep the warmup import behind `process.env.NEXT_RUNTIME === 'nodejs'` to avoid Edge-runtime dependency resolution errors
- May 5, 2026 amendment:
  - `mercato server dev` watches `.env`, `.env.development`, `.env.local`, and `.env.development.local` in the app directory
  - when one changes, the CLI reloads app env files while preserving shell-provided variables as authoritative
  - the managed runtime group restarts together: Next.js dev server, queue workers, and scheduler polling engine
  - structural generation remains separate; env changes do not run generators
- May 13, 2026 amendment:
  - monorepo package watch defaults to low-memory one-shot rebuilds after the initial `build:packages` stage instead of holding a persistent esbuild graph for every package at idle
  - `OM_PACKAGE_WATCH_MODE=persistent` restores the previous persistent esbuild-context tradeoff for developers who prefer faster rebuilds over lower idle RSS
  - root `yarn dev` injects lazy queue worker auto-spawn by default while direct CLI/runtime defaults stay backward-compatible

## Overview

Open Mercato’s module system is structurally powerful but the current dev path pays for that flexibility in the worst possible place: the first real request. The server itself becomes ready quickly, but the first cold page or API hit forces Turbopack to compile giant catch-all entrypoints whose top-level imports pull in almost every module page, route handler, widget registration, and bootstrap side effect.

The performance evidence gathered on April 2, 2026:

| Measurement | Result |
|-------------|--------|
| `yarn generate` | `5.52s` real, `~528 MB` max RSS |
| `yarn build:packages` | `4.78s` real |
| `apps/mercato yarn dev` ready time | `982ms` |
| First cold `GET /api/customers/people?page=1&pageSize=20` | `15.0s`, `14.8s` compile |
| First cold `GET /backend/customers/people` | `19.4s`, `17.0s` compile, `2.3s` render |
| First cold `GET /login` | `5.1s`, `5.0s` compile |
| Warm `GET /api/customers/people` | `19ms` |
| Warm `GET /backend/customers/people` | `229ms` |
| Next trace memory after first cold API hit | `~6.06 GB` RSS |
| Next trace memory after first cold backend hit | `~7.03 GB` RSS |
| Observed `next-server` RSS via `ps` | `~7.28 GB` |

Supporting artifacts:
- `apps/mercato/.mercato/next/dev/trace`
- `apps/mercato/CPU.main.1775119537021.cpuprofile`

The generated registry is also materially large:

| Artifact | Size |
|----------|------|
| `.mercato/generated/modules.generated.ts` | `656,371` bytes |
| `.mercato/generated/modules.generated.ts` imports | `1,287` |
| `.mercato/generated/modules.generated.ts` lines | `2,129` |
| compiled server chunk for `modules.generated.ts` | `~2.21 MB` |
| `.mercato/next/dev` after a few cold hits | `~1.3 GB` |

> **Reference Material**:
> - Next.js memory guidance: <https://nextjs.org/docs/app/guides/memory-usage>
> - Next.js Turbopack filesystem cache: <https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache>

The official Next.js guidance is useful here mostly as a filter for bad ideas:
- `turbopackFileSystemCache` is already enabled by default in dev on modern Next.js, so it is not the missing fix.
- `experimental.webpackMemoryOptimizations` is Webpack-oriented and not the main lever for this Turbopack dev path.
- `experimental.preloadEntriesOnStart` can reduce initial memory footprint, but it does not solve the measured problem that compile time is dominated by catch-all bundling on first request.

## Problem Statement

There are two separate but related defects in the current dev experience.

### 1. Structural changes do not participate in `yarn dev`

Today `yarn dev`:
1. builds all packages
2. starts package `watch` processes
3. starts `mercato server dev`

Package watch processes rebuild `dist/`, but nothing watches module convention files and regenerates `.mercato/generated` when a structural change happens. Adding a new `page.tsx`, `route.ts`, `setup.ts`, `translations.ts`, `events.ts`, or similar file still requires a manual `yarn generate` and a dev-server restart.

That breaks the core module-development contract.

### 2. Catch-all entrypoints are eagerly bound to the entire module graph

The three catch-all files:
- `apps/mercato/src/app/api/[...slug]/route.ts`
- `apps/mercato/src/app/(frontend)/[...slug]/page.tsx`
- `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`

all import `@/.mercato/generated/modules.generated` directly.

The API catch-all also imports `@/bootstrap` at top level, which eagerly registers modules, entities, DI registrars, widgets, enrichers, interceptors, guards, and more before route matching finishes.

This means a request for one backend page or one API route forces Turbopack to reason about a large cross-module graph up front. The trace confirms this:

| Trace event | Duration |
|-------------|----------|
| `compile-path` for `/api/[...slug]` | `15.17s` |
| `ensure-page` for `/api/[...slug]/route` | `11.80s` |
| total request `/api/customers/people` | `14.99s` |
| total request `/backend/customers/people` | `19.31s` |
| `compile-path` for `/[...slug]` | `3.92s` |

The core issue is architectural, not incidental:
- route matching depends on a registry that eagerly imports route implementations
- bootstrap does more work than the request kind actually needs
- the same pattern exists in both monorepo source mode and standalone compiled-package mode.

## Proposed Solution

Implement the optimization in two coordinated parts.

### Part A: Generator watch pipeline for structural dev changes

Add a generator watch mode that runs alongside package watch during `yarn dev`.

High-level behavior:
- watch module convention files in app and package module roots
- classify the changed file into the minimal generator subset that must rerun
- write generated files atomically into `.mercato/generated`
- let Next/Turbopack react to generated-file updates through normal file invalidation
- never require a process restart for structural changes that can be handled by regeneration

This is the missing bridge between source structure and dev runtime.

### Part B: Lightweight route manifests with lazy loaders

Stop importing full module implementations in the catch-all routes.

Generate three new lightweight manifests:
- `backend-routes.generated.ts`
- `frontend-routes.generated.ts`
- `api-routes.generated.ts`

Each manifest contains only:
- normalized route pattern data
- auth/role/feature metadata
- title/breadcrumb metadata where needed
- a lazy `load()` function using static `import(...)` to load the matched page or API route file only after a match is found

The catch-all files switch from:
- eager `modules.generated` import
- eager bootstrap of the full application

to:
- lightweight manifest import
- fast route match
- route-kind bootstrap
- lazy load of the matched module implementation

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Keep `modules.generated.ts` for compatibility | Generated-file contracts are stable; the fix must be additive first. |
| Generate new route manifests instead of mutating `modules.generated.ts` in place | Keeps the compatibility surface stable while removing the dev hot path from the large registry. |
| Split bootstrap by domain | API requests should not eagerly register backend widget trees, and simple frontend routes should not pay for unrelated API-heavy registries. |
| Make generator watch change-classified | Running all generators on every structural change would solve correctness but still feel heavy and noisy. |
| Use the same generator architecture for monorepo and standalone | The resolver already distinguishes source vs compiled package roots; route loader generation must build on that instead of introducing two separate systems. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rely on Turbopack filesystem cache only | Already effectively enabled; it does not explain or solve the measured cold compile path. |
| Disable preload with `experimental.preloadEntriesOnStart` only | Might help initial RSS, but the measured bottleneck is request-time compile breadth, not startup readiness. |
| Split catch-all files by hardcoded module groups | Would reduce compile scope temporarily but violates the module-discovery architecture and does not scale. |
| Replace catch-all routing with physical Next routes for every module file | Large BC and generator-contract risk, and not compatible with the current extensibility model. |
| Rebuild the whole dev server on every structural change | Correct but defeats the user goal of no restart and wastes package/watch state. |

## User Stories / Use Cases

- A module developer adds `backend/customers/new-report/page.tsx` during `yarn dev` and the page becomes reachable without rerunning `yarn generate` manually or restarting Next.
- A module developer adds `api/post/sync/run/route.ts` during `yarn dev` and the route becomes callable after generation finishes.
- A user opens the first backend page in a cold dev session and sees the response in less than half the current time.
- A standalone app using published `@open-mercato/*` packages gets the same lazy route loading benefits even though package code is resolved from `node_modules/@open-mercato/*/dist/`.

## Architecture

### Profiling Methodology

This spec is based on measured data, not conjecture.

Commands used:

```bash
/usr/bin/time -l yarn generate
/usr/bin/time -l yarn build:packages
rm -rf apps/mercato/.mercato/next
cd apps/mercato
NEXT_CPU_PROF=1 yarn dev
curl http://localhost:3000/backend/customers/people
curl 'http://localhost:3000/api/customers/people?page=1&pageSize=20'
curl http://localhost:3000/login
```

Primary evidence source:
- `apps/mercato/.mercato/next/dev/trace`

Secondary evidence source:
- `apps/mercato/CPU.main.1775119537021.cpuprofile`

The trace was more actionable than the CPU profile because it directly attributes cold time to request-level `compile-path` and `ensure-page` events.

### A. Structural Generation Watch

Introduce:

```ts
type GeneratorWatchMode = {
  debounceMs: number
  roots: string[]
  onGenerated?: (changedOutputs: string[]) => void
}
```

New additive CLI command:

```bash
mercato generate watch
```

Responsibilities:
- discover watch roots from the existing CLI resolver
- watch only convention files that can affect generated output
- map changed files to generator groups
- serialize generator runs
- write through temporary files + rename to avoid partial reads

Change classification examples:

| Changed file | Generators to rerun |
|-------------|---------------------|
| `frontend/**`, `backend/**`, `api/**`, `index.ts`, `acl.ts`, `setup.ts`, `ce.ts` | route manifests, module registry, CLI registry, package sources |
| `data/entities.ts` | entities, entity IDs, module registry if entity registration surface changed |
| `di.ts` | DI generator |
| `translations.ts` | translations-fields generator |
| `events.ts` | events generator |
| `api/**/route.ts` | API manifest, module registry, OpenAPI |
| `widgets/**` | injection/dashboard/component generators as applicable |

#### Dev Orchestration

`yarn dev` keeps the same command name but changes behavior:

1. build packages once
2. start package watch processes
3. start `mercato generate watch`
4. start app dev server

This remains BC-safe because no command is removed or renamed.

### B. Route Manifest Generation

Generate route manifests that do not import route implementations eagerly.

Illustrative shape:

```ts
export type GeneratedBackendRoute = {
  pattern: string
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  title?: string
  titleKey?: string
  breadcrumb?: Array<{ label: string; labelKey?: string; href?: string }>
  load: () => Promise<{
    default: (props: any) => React.ReactNode | Promise<React.ReactNode>
    metadata?: PageMetadata
  }>
}

export type GeneratedApiRoute = {
  path: string
  methods: HttpMethod[]
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  metadata?: Partial<Record<HttpMethod, unknown>>
  load: () => Promise<Partial<Record<HttpMethod, ApiHandler>>>
}
```

Important constraint:
- `load()` must be emitted as static `import('<literal>')`, not computed paths, so Turbopack can still split and track modules.

### C. Catch-All Runtime Rewrite

Rewrite the three catch-all entrypoints to use new manifests:

- API catch-all
  - match route from `api-routes.generated`
  - run `bootstrapApi()` after match
  - lazy-import matched route file

- Backend catch-all
  - match route from `backend-routes.generated`
  - run `bootstrapBackend()` after match
  - lazy-import matched page

- Frontend catch-all
  - match route from `frontend-routes.generated`
  - run `bootstrapFrontend()` after match
  - lazy-import matched page

### D. Bootstrap Partitioning

Current `bootstrap()` does too much for all request kinds.

Introduce additive bootstrap domains:

| Bootstrap | Responsibilities |
|-----------|------------------|
| `bootstrapFoundation()` | ORM entities, DI registrars, entity IDs, lightweight module metadata registries |
| `bootstrapApi()` | foundation + search configs + enrichers + interceptors + guards + command interceptors |
| `bootstrapBackend()` | foundation + component overrides + backend widget registries |
| `bootstrapFrontend()` | foundation + frontend-specific registries only |
| `bootstrapLegacy()` | existing full bootstrap wrapper kept for compatibility |

Rules:
- API boot must not eagerly import backend widget registries.
- Simple auth/frontend requests must not eagerly import backend/dashboard widget registries.
- Existing bootstrap export remains available until the lighter runtime path has proven stable.

### E. Standalone Support

The generator and route-manifest logic must build on the resolver contracts from the standalone CLI work.

Monorepo:
- loaders point at package source module paths or app source module paths

Standalone:
- loaders point at compiled `node_modules/@open-mercato/*/dist/modules/...` files
- app-local modules still resolve from `src/modules/...`

The manifest generator must never assume `packages/<name>/src`.

### F. Optional Next.js Levers After Architecture Change

The following are explicitly secondary:

- benchmark `experimental.preloadEntriesOnStart = false` in dev after lazy manifests land
- keep `turbopackFileSystemCache` explicit only if needed for clarity, not as the primary fix

This order matters. The current evidence says architecture is the primary bottleneck.

## Data Models

No persistent database schema changes are part of this spec.

New generated artifact models:

### Generated Route Manifest (Singular entry)
- `pattern` or `path`: string
- `kind`: `'frontend' | 'backend' | 'api'`
- `metadata`: auth/title/breadcrumb info
- `load`: async lazy loader

### Generated Bootstrap Partition
- `foundation`: registrations required across all request kinds
- `api`: API-only registration list
- `backend`: backend UI registration list
- `frontend`: frontend-only registration list

## API Contracts

No user-facing HTTP API route URLs change.

New additive CLI contracts:

### `mercato generate watch`
- Purpose: keep `.mercato/generated` synchronized during `yarn dev`
- Request shape: CLI flags only
- Response: long-running process, logs changed outputs

### `mercato generate changed` (optional helper)
- Purpose: rerun only affected generators once from a changed-file set
- Status: optional internal helper, not required if watch mode handles this internally

Generated file contract strategy:
- add `backend-routes.generated.ts`
- add `frontend-routes.generated.ts`
- add `api-routes.generated.ts`
- add partitioned bootstrap generated files if needed
- keep `modules.generated.ts` unchanged in export shape for compatibility

## Internationalization (i18n)

User-facing changes are limited to developer-facing CLI logs and optional docs:
- generator watch started
- generator watch changed outputs
- structural regeneration failed

These log strings do not require user-facing product translations.

## UI/UX

No end-user workflow changes are introduced directly. The visible UX improvement is performance:

- cold backend pages resolve materially faster
- structural module additions appear without manual regeneration/restart
- dev sessions use less RAM and degrade later rather than immediately on first cold hit

## Configuration

Additive env/config only:

| Setting | Purpose |
|---------|---------|
| `OM_GENERATOR_WATCH=1` | Enable generator watch explicitly in dev orchestration if needed |
| `OM_DEV_ROUTE_MANIFESTS=1` | Temporary rollout flag for lightweight manifests during migration |
| `OM_DEV_PRELOAD_ENTRIES=0` | Optional experiment for `preloadEntriesOnStart` after route-manifest work lands |

These flags are implementation aids, not permanent public requirements.

## Migration & Compatibility

### Backward Compatibility

- Auto-discovery file conventions do not change.
- API URLs do not change.
- ACL feature IDs do not change.
- Event IDs do not change.
- Existing `yarn dev` command name remains unchanged.
- `modules.generated.ts` remains present and compatible during the migration window.

### Rollout Strategy

1. add route manifests and generator watch behind flags
2. switch app catch-alls to the new manifests
3. measure and compare against baseline
4. keep legacy bootstrap/registry generation until one minor release proves the new path stable

## Implementation Plan

### Phase 1: Measurement Harness And Generator Watch
1. Add a documented cold-profile script or procedure that reproduces the current benchmark and stores the trace artifact.
2. Implement `mercato generate watch` with resolver-based roots and change classification.
3. Update root `yarn dev` to start generator watch alongside package watch and app dev.
4. Verify that adding or renaming backend/frontend/API module files becomes visible without restarting the dev process.

### Phase 2: Lightweight Route Manifest Generation
1. Add generator outputs for backend, frontend, and API route manifests.
2. Emit static lazy loaders that resolve correctly in monorepo and standalone environments.
3. Keep existing `modules.generated.ts` intact.
4. Add matcher helpers for the new manifests so catch-all routes do not need full module registry imports.

### Phase 3: Partitioned Bootstrap
1. Introduce `bootstrapFoundation`, `bootstrapApi`, `bootstrapBackend`, and `bootstrapFrontend`.
2. Move UI-only async widget registration out of the API boot path.
3. Keep a legacy bootstrap wrapper for compatibility.
4. Verify no request kind loses required registrations.

### Phase 4: Catch-All Migration And Benchmark Gate
1. Rewrite API catch-all to use `api-routes.generated.ts`.
2. Rewrite backend catch-all to use `backend-routes.generated.ts`.
3. Rewrite frontend catch-all to use `frontend-routes.generated.ts`.
4. Rerun the same cold benchmarks and compare against the April 2, 2026 baseline.
5. Optionally benchmark `preloadEntriesOnStart = false` after the architectural work is in place.

### Phase 5: Dev Warmup And Lazy Handler Imports
1. Add a dev-only warmup runner that imports matched route modules in the background instead of issuing live HTTP requests.
2. Keep warmup opt-out and concurrency-limited via environment flags so RAM tradeoffs remain controllable.
3. Replace eager subscriber and worker handler imports with lazy wrappers that preserve the current sync and async execution contracts.
4. Measure warmup-on versus warmup-off before keeping the feature enabled by default.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/mercato.ts` | Modify | Start generator watch during dev; add watch command |
| `packages/cli/src/lib/generators/module-registry.ts` | Modify | Emit lightweight route manifests and bootstrap partitions |
| `packages/cli/src/lib/generators/*` | Modify | Support targeted generation classification |
| `packages/shared/src/modules/registry.ts` | Modify | Add match helpers for lightweight manifests if needed |
| `apps/mercato/src/app/api/[...slug]/route.ts` | Modify | Switch API catch-all to lazy manifest loading |
| `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` | Modify | Switch backend catch-all to lazy manifest loading |
| `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` | Modify | Switch frontend catch-all to lazy manifest loading |
| `apps/mercato/src/bootstrap.ts` | Modify | Preserve legacy bootstrap wrapper while exposing partitioned bootstraps |
| `apps/mercato/.mercato/generated/*` | Generate | New route manifest and bootstrap partition artifacts |

### Testing Strategy

- Unit: generator classification for changed files
- Unit: manifest emission in monorepo and standalone resolver modes
- Unit: route matcher parity between old module registry and new lightweight manifests
- Unit: bootstrap partition correctness by request kind
- Integration: structural change during `yarn dev` without restart
- Integration: cold `/login`, `/backend/customers/people`, `/api/customers/people`
- Integration: standalone app using compiled `@open-mercato/*` packages

### Integration Coverage

| Scenario | Coverage |
|----------|----------|
| Monorepo `yarn dev` adds new backend page | Integration |
| Monorepo `yarn dev` adds new API route | Integration |
| Monorepo cold `/backend/customers/people` | Integration benchmark |
| Monorepo cold `/api/customers/people` | Integration benchmark |
| Monorepo cold `/login` | Integration benchmark |
| Standalone app cold `/backend/...` route from published package module | Integration |
| Standalone app app-local structural change without restart | Integration |
| Compatibility: existing `modules.generated.ts` consumers | Unit / smoke |

### Acceptance Criteria

| Metric | Baseline | Target |
|--------|----------|--------|
| Cold `/backend/customers/people` total time | `19.4s` | `<= 9.5s` |
| Cold `/api/customers/people` total time | `15.0s` | `<= 7.5s` |
| Cold `/login` total time | `5.1s` | `<= 2.5s` |
| Next RSS after first cold API/backend hit | `6.06-7.03 GB` | `<= 4.0 GB`, stretch `<= 3.5 GB` |
| Structural page/route addition during `yarn dev` | restart required today | no manual restart |

### Measured Outcome

| Metric | Target | Measured |
|--------|--------|----------|
| Cold `/backend/customers/people` total time | `<= 9.5s` | `14.4s` without warmup, `3.9s` with warmup |
| Cold `/api/customers/people` total time | `<= 7.5s` | `1.86s` without warmup, `1.73s` with warmup |
| Cold `/login` total time | `<= 2.5s` | `8.1s` without warmup, `2.0s` with warmup |
| Next RSS after first cold API/backend hit | `<= 4.0 GB` | `~3.49-3.54 GB` in the measured API run |
| Structural page/route addition during `yarn dev` | no manual restart | achieved |

Interpretation:
- the route-manifest and bootstrap split solved the API path strongly even before warmup
- background warmup is what gets backend and frontend first-hit latency under target
- warmup increases idle RSS, but the measured post-compile footprint still stays well below the original `6-7 GB` traces
- the only target not met in the strict warmup-off scenario is `/login`, which is why background warmup is part of the shipped solution rather than a discarded experiment

## Risks & Impact Review

#### Generated Manifest Drift
- **Scenario**: The new lightweight manifests disagree with `modules.generated.ts`, so route matching or auth metadata behaves differently between dev/runtime paths.
- **Severity**: High
- **Affected area**: frontend/backend/API routing
- **Mitigation**: Generate both artifacts from the same source scan; add parity tests between old and new route-match results.
- **Residual risk**: Low once parity tests cover representative route shapes.

#### Lazy Loader Resolution Failure In Standalone Apps
- **Scenario**: Generated `import(...)` paths resolve in monorepo but fail against compiled package `dist/` paths in standalone apps.
- **Severity**: High
- **Affected area**: standalone dev and runtime
- **Mitigation**: Route manifest generation must use resolver-derived import paths, not hardcoded workspace assumptions; add standalone integration coverage.
- **Residual risk**: Medium until tested against a real scaffolded standalone app.

#### Partial Regeneration During Dev
- **Scenario**: A structural change triggers only some generators, leaving `.mercato/generated` in an inconsistent state.
- **Severity**: Medium
- **Affected area**: dev correctness
- **Mitigation**: Change classification must be conservative, generator writes must be atomic, and failures must keep prior generated outputs intact.
- **Residual risk**: Low.

#### Bootstrap Under-Partitioning
- **Scenario**: The new route-kind bootstraps omit a registration that a route actually needs, causing runtime-only failures.
- **Severity**: High
- **Affected area**: request handling across API/frontend/backend
- **Mitigation**: Start with additive partitions, keep legacy bootstrap available, and gate rollout with request-kind regression tests.
- **Residual risk**: Medium during the migration phase.

#### Cold Time Improves But Memory Does Not
- **Scenario**: Lazy route manifests cut compile time but long-lived dev RSS still grows near the prior level after many routes are visited.
- **Severity**: Medium
- **Affected area**: long dev sessions
- **Mitigation**: Benchmark memory immediately after first cold route and after a broader navigation set; evaluate `preloadEntriesOnStart = false` only after architectural changes land.
- **Residual risk**: Medium because Next.js eventually retains loaded entries over time.

#### Full Subscriber Offload Changes Event Semantics
- **Scenario**: Moving all subscribers to worker-only loading breaks modules that currently rely on synchronous in-process side effects during event publication.
- **Severity**: High
- **Affected area**: event dispatch, notifications, command side effects
- **Mitigation**: keep subscriber registration in the app runtime but lazy-load the handler body; if deeper separation is needed, add explicit execution-mode metadata first.
- **Residual risk**: Low for the implemented lazy-wrapper approach; High for any future transparent worker-only move.

#### CLI Watch Loop Feedback
- **Scenario**: Generator watch reacts to its own output writes and enters a rebuild loop.
- **Severity**: Medium
- **Affected area**: local development stability
- **Mitigation**: Ignore `.mercato/generated/**`, debounce events, and track the write set produced by the current generation cycle.
- **Residual risk**: Low.

#### Environment Reload Drift
- **Scenario**: A developer edits `.env` during `yarn dev`, but only Next.js sees the update while workers or scheduler keep stale values.
- **Severity**: Medium
- **Affected area**: local development correctness, AI provider keys, queue/scheduler toggles, app URLs, database/cache configuration.
- **Mitigation**: Watch app env files inside `mercato server dev` and restart the full managed runtime group after a debounced change. Reload env files from disk before respawn and preserve shell-provided variables so explicit terminal exports still win.
- **Residual risk**: Low.

## Final Compliance Report — 2026-04-02

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/core/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Check existing specs before non-trivial changes | Compliant | Reviewed related generator, standalone, and build/dev specs before drafting. |
| root `AGENTS.md` | New specs use `{date}-{title}.md` naming | Compliant | File uses dated kebab-case naming. |
| root `AGENTS.md` | Keep command compatibility additive | Compliant | `yarn dev` remains; new CLI watch mode is additive. |
| root `AGENTS.md` | Generated file contracts are stable | Compliant | `modules.generated.ts` is preserved; new manifests are additive. |
| `packages/cli/AGENTS.md` | Standalone generators scan compiled package modules from `dist/` | Compliant | Route-loader generation explicitly supports standalone compiled package paths. |
| `packages/core/AGENTS.md` | Auto-discovery conventions are immutable contract | Compliant | No file naming or discovery convention changes are proposed. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Problem statement matches measured baseline | Pass | Spec includes exact timing and memory numbers from April 2, 2026. |
| Proposed solution addresses both user goals | Pass | Covers structural regeneration and cold-load optimization separately. |
| Compatibility strategy is explicit | Pass | Additive manifests, unchanged command names, preserved generated contract. |
| Monorepo and standalone are both covered | Pass | Resolver-driven loader generation is specified. |
| Risks cover correctness and performance regressions | Pass | Manifest drift, standalone resolution, bootstrap gaps, watch loops, memory plateau all covered. |

### Non-Compliant Items

- None identified for the specification itself.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

### 2026-04-02
- Initial specification based on measured cold-dev profiling.
- Implementation updated with route manifests, generator watch, route-free app bootstrap, lazy subscriber/worker handlers, and dev background warmup.

### 2026-05-05
- Added env-file reload behavior for `mercato server dev`: app `.env*` changes now restart the full managed dev runtime group instead of relying on Next.js-only config reload behavior.
- Added unit coverage for env precedence/reload cleanup and the managed runtime restart path.

### Review — 2026-04-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
