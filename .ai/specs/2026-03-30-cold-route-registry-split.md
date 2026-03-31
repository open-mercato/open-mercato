# Cold Route Registry Split

## TLDR
**Key Points:**
- Cold compilation of `/(backend)/backend/[...slug]` and `/(frontend)/[...slug]` is dominated by eager imports from `modules.generated.ts`, which currently pulls backend pages, frontend pages, API handlers, translations, CLI modules, subscribers, and workers into one generated file.
- Reduce first-hit cold compile time by introducing additive, surface-specific generated manifests for backend routes, frontend routes, and bootstrap/runtime registration, while preserving the existing `modules.generated.ts` export and `Module` / `ModuleRoute` contracts.

**Scope:**
- Add new generated route manifests for cold-path consumers.
- Keep `modules.generated.ts` and `modules` export backward compatible.
- Use lazy route component wrappers in new page manifests.
- Do not implement API dispatcher split in Phase 1.

**Concerns:**
- Generated file contracts are stable and must remain backward compatible.
- Inline page metadata stored in `page.tsx` reduces how much can be lazified in the first phase.
- Root app bootstrap currently imports `modules.generated.ts`; cold-start wins require bootstrap-path separation, not only catch-all page changes.

## Overview

Open Mercato's page dispatch is built around generated registries. The current catch-all backend page, catch-all frontend page, backend layout, and app bootstrap all depend directly or indirectly on `apps/mercato/.mercato/generated/modules.generated.ts`. That file eagerly imports nearly every route-facing module concern, which causes cold compilation of a single catch-all page to traverse far more code than the matched page actually needs.

> **Market Reference**: Next.js route segment manifests and Remix route manifests both bias toward lightweight route matching with lazy route module loading. This spec adopts that principle for generated Open Mercato route manifests while rejecting a framework rewrite or a breaking replacement of the current `modules` export.

This specification proposes an additive split of generated registries. The existing `modules.generated.ts` remains the compatibility layer. New slim manifests are introduced for hot-path consumers so cold page compilation no longer pays for unrelated APIs, CLI commands, workers, or non-matched pages.

This spec is related to, but distinct from, [2026-03-20-decentralize-module-registry-generator](/Users/piotrkarwatka/Projects/mercato-development/.ai/specs/2026-03-20-decentralize-module-registry-generator.md). That spec addresses generator ownership and decomposition; this spec addresses runtime import graph size and cold compile performance.

## Problem Statement

The current generated module registry creates a wide, eager import graph:

- `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` imports `modules.generated.ts`
- `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` imports `modules.generated.ts`
- `apps/mercato/src/app/(backend)/backend/layout.tsx` imports `modules.generated.ts`
- `apps/mercato/src/bootstrap.ts` imports `modules.generated.ts`, and `apps/mercato/src/app/layout.tsx` imports `bootstrap()`

This means a cold request to a single catch-all page compiles:

- all backend page modules
- all frontend page modules
- all API route files
- subscribers, workers, CLI modules
- module translations and metadata
- layout-only integrations such as admin nav, global search, AI assistant shell integrations

Consequences:

1. **Cold compile latency is too high**: a single `/(backend)/backend/[...slug]` request compiles much more than the matched page.
2. **Hot-path consumers import unrelated surfaces**: page routing depends on API handler imports and other unrelated runtime concerns.
3. **Root bootstrap prevents page-only optimization**: even if catch-all pages are slimmed, root layout bootstrap still drags in the full registry.
4. **Naive replacement would be risky**: `modules.generated.ts`, `modules`, `Module`, and `ModuleRoute` are stable contracts and should not be broken.

## Proposed Solution

Introduce additive, generated manifests for cold-path route consumers while preserving the existing `modules.generated.ts` contract.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Keep `modules.generated.ts` and `modules` export | Preserves generated-file contract and existing imports |
| Add new generated manifests instead of replacing existing one | Minimizes migration risk and lets hot paths adopt the slim files incrementally |
| Keep `ModuleRoute.Component` contract unchanged | Avoids BC impact on route matching and rendering callers |
| Use lazy component wrappers in new route manifests | Allows `findBackendMatch()` / `findFrontendMatch()` to work unchanged while removing eager page imports |
| Split bootstrap manifest from page manifests | Cold page compilation still pays for full registry if root bootstrap keeps importing it |
| Phase 1 excludes API dispatcher split | User-reported pain is page cold compilation; API split is a follow-up optimization |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Replace `modules.generated.ts` in-place with a new shape | High BC risk; touches stable generated-file contract directly |
| Add a new `loadComponent` field and require app code changes everywhere | Unnecessary public type churn; wrapper functions can preserve `Component` |
| Dynamic import by arbitrary string path at runtime | Weak bundler safety and poor determinism; generated static import expressions are safer |
| Optimize DI/auth/runtime code first | These affect request execution more than cold compilation of the route bundle |

## User Stories / Use Cases

- **Developer** wants the first request to `/backend/*` after a cold dev start to compile faster so local feedback loops improve.
- **Developer** wants the first request to a frontend catch-all route to avoid compiling unrelated backend pages and API handlers.
- **Core maintainer** wants the optimization to preserve `modules.generated.ts`, `Module`, `ModuleRoute`, `findBackendMatch()`, and `findFrontendMatch()` so existing code remains stable.
- **Module author** wants convention files and module auto-discovery to remain unchanged.

## Architecture

### Target Output Files

Phase 1 introduces new generated files:

```text
apps/mercato/.mercato/generated/
├── modules.generated.ts                 # Existing compatibility layer (preserved)
├── backend-routes.generated.ts          # New: backend route metadata + lazy Component wrappers
├── frontend-routes.generated.ts         # New: frontend route metadata + lazy Component wrappers
├── api-routes.generated.ts              # New: API route metadata/handlers for API-only consumers
├── bootstrap-modules.generated.ts       # New: runtime/bootstrap module data without eager page/API imports
├── cli-modules.generated.ts             # New: CLI-only module metadata for runtime dashboards/tooling
├── subscribers.generated.ts             # New: discovered subscriber registry for request-container wiring
└── route-metadata.generated.ts          # Optional helper for shared metadata extraction if needed
```

### Phase 1 Consumer Mapping

| Consumer | Current import | New import |
|----------|----------------|------------|
| Backend catch-all page | `modules.generated.ts` | `backend-routes.generated.ts` |
| Frontend catch-all page | `modules.generated.ts` | `frontend-routes.generated.ts` |
| Backend layout | `modules.generated.ts` | `backend-routes.generated.ts` or `bootstrap-modules.generated.ts` depending on needed fields |
| Root bootstrap | `modules.generated.ts` | `bootstrap-modules.generated.ts` |
| API catch-all route | `modules.generated.ts` | `api-routes.generated.ts` |
| API docs routes | `modules.generated.ts` | `api-routes.generated.ts` |
| Existing callers outside hot paths | `modules.generated.ts` | Unchanged |

### New Manifest Shapes

#### Backend Route Manifest

```typescript
import type { Module } from '@open-mercato/shared/modules/registry'

export const backendModules: Pick<Module, 'id' | 'backendRoutes'>[] = [
  {
    id: 'customers',
    backendRoutes: [
      {
        pattern: '/backend/customers/people',
        requireAuth: true,
        requireFeatures: ['customers.view'],
        title: 'People',
        Component: async (props) => {
          const mod = await import('@open-mercato/core/modules/customers/backend/customers/people/page')
          const Component = mod.default
          return <Component {...props} />
        },
      },
    ],
  },
]
```

Key properties:

- `Component` remains present and callable as today.
- Route matching continues to use `findBackendMatch()` unchanged.
- Unmatched page modules are not eagerly imported into the route entry bundle.

#### Frontend Route Manifest

Same pattern as backend, but limited to `id` + `frontendRoutes`.

#### Bootstrap Modules Manifest

```typescript
import type { Module } from '@open-mercato/shared/modules/registry'

export const bootstrapModules: Module[] = [
  {
    id: 'customers',
    info: ...,
    translations: ...,
    features: ...,
    entityExtensions: ...,
    customFieldSets: ...,
    customEntities: ...,
    setup: ...,
    integrations: ...,
    bundles: ...,
    backendRoutes: [
      // metadata-only or lazy-wrapper routes; no eager page imports
    ],
    frontendRoutes: [
      // metadata-only or lazy-wrapper routes; no eager page imports
    ],
    // Excludes eager API/subscriber/worker/CLI imports in phase 1
  },
]
```

This manifest exists so `apps/mercato/src/bootstrap.ts` and root layout no longer reintroduce the cold import graph through `modules.generated.ts`.

### Metadata Handling

The generator already distinguishes between colocated `page.meta.ts` / `meta.ts` and inline metadata exported from `page.tsx`.

Phase 1 rules:

1. If `page.meta.ts` or `meta.ts` exists:
   - import metadata eagerly
   - generate lazy `Component` wrapper
2. If metadata is inline in `page.tsx`:
   - keep eager import fallback for that page in Phase 1
   - emit a generator diagnostic counter for inline-metadata pages so future codemods can migrate them

This keeps Phase 1 fully compatible while still reducing cold imports for the majority of pages that already use metadata sidecars.

### Compatibility Layer

`modules.generated.ts` remains stable and continues to export:

- `modules`
- `modulesInfo`
- default export

Two acceptable implementation strategies are allowed by this spec:

1. **Preserve current `modules.generated.ts` output** and generate new slim manifests alongside it.
2. **Recompose `modules.generated.ts` from slim manifests** while preserving the exact export names and `Module[]` shape.

Phase 1 SHOULD prefer option 1 because it minimizes risk and avoids incidental diffs for existing consumers.

## Data Models

No database schema changes.

### Generated Route Manifest (Virtual)
- `moduleId`: string
- `pattern`: string
- `requireAuth`: boolean | undefined
- `requireRoles`: string[] | undefined
- `requireFeatures`: string[] | undefined
- `title`: string | undefined
- `titleKey`: string | undefined
- `group`: string | undefined
- `groupKey`: string | undefined
- `icon`: ReactNode | undefined
- `order`: number | undefined
- `priority`: number | undefined
- `navHidden`: boolean | undefined
- `visible`: function | undefined
- `enabled`: function | undefined
- `breadcrumb`: array | undefined
- `pageContext`: `'main' | 'admin' | 'settings' | 'profile' | undefined`
- `Component`: `(props: any) => ReactNode | Promise<ReactNode>`

### Bootstrap Modules Manifest (Virtual)
- `modules`: `Module[]`
- Same stable `Module` shape as current runtime expectations
- Internally populated from split generated sources

## API Contracts

No HTTP endpoint contract changes in Phase 1.

### Generated File Contracts

#### Preserved
- `apps/mercato/.mercato/generated/modules.generated.ts`
  - `export const modules: Module[]`
  - `export const modulesInfo`
  - `export default modules`

#### Added
- `apps/mercato/.mercato/generated/backend-routes.generated.ts`
  - `export const backendModules: Pick<Module, 'id' | 'backendRoutes'>[]`
- `apps/mercato/.mercato/generated/frontend-routes.generated.ts`
  - `export const frontendModules: Pick<Module, 'id' | 'frontendRoutes'>[]`
- `apps/mercato/.mercato/generated/bootstrap-modules.generated.ts`
  - `export const bootstrapModules: Module[]`

### Internal App Consumer Updates

These are implementation details, not public contract changes:

- backend catch-all imports `backendModules`
- frontend catch-all imports `frontendModules`
- backend layout imports `backendModules` or `bootstrapModules`
- app bootstrap imports `bootstrapModules`

## Internationalization (i18n)

No translation key changes required by the feature itself.

Generator diagnostics MAY add a developer-facing warning for pages that still embed metadata in `page.tsx`, but this warning MUST NOT be user-facing and MUST NOT require translation.

## UI/UX

No user-facing UI change is intended.

Expected developer-facing outcome:

- reduced cold compile time for backend and frontend catch-all pages
- no route behavior regressions
- no changes to route URLs, auth guards, or metadata-driven navigation

## Configuration

No new runtime env vars are required.

Optional future diagnostic env vars are allowed but out of scope for Phase 1.

## Migration & Compatibility

### Backward Compatibility

This spec is explicitly designed for full backward compatibility:

- no convention file path changes
- no route URL changes
- no `Module` or `ModuleRoute` required field removals
- no import path removals
- no generated export removals

### BC Strategy

1. Keep `modules.generated.ts` export path and names stable.
2. Add new generated files rather than renaming old ones.
3. Keep `ModuleRoute.Component` field intact via lazy wrapper functions.
4. Preserve route ordering and matching semantics.
5. Preserve generator determinism for stable diffs.

### Explicit Non-Goals

- No Phase 1 rewrite of API route dispatch.
- No change to module authoring conventions.
- No forced migration of inline page metadata in Phase 1.

## Implementation Plan

### Phase 1: Additive Route Manifest Split
1. Extend the generator to emit `backend-routes.generated.ts` and `frontend-routes.generated.ts`.
2. For page files with sidecar metadata, emit eager metadata imports plus lazy `Component` wrappers.
3. For inline-metadata pages, preserve eager import fallback.
4. Add generator tests proving route ordering and metadata fields remain stable.
5. Update backend/frontend catch-all pages to consume the new manifests.

### Phase 2: Bootstrap Path Separation
1. Emit `bootstrap-modules.generated.ts`.
2. Change `apps/mercato/src/bootstrap.ts` to consume `bootstrapModules`.
3. Ensure root `app/layout.tsx` no longer reintroduces eager page/API imports through bootstrap.
4. Verify `registerModules()` still receives all data needed by query engine, i18n, dashboards, integrations, and navigation.

### Phase 3: Backend Layout Slimming
1. Switch backend layout from full `modules.generated.ts` to `backendModules` or `bootstrapModules`.
2. Keep `buildAdminNav()` behavior identical by preserving `id` + `backendRoutes` metadata.
3. Confirm settings sections, breadcrumb resolution, and nav grouping remain unchanged.

### Phase 4: Optional API Registry Split
1. Emit `api-routes.generated.ts` with lazy handler wrappers.
2. Update API catch-all to consume the split manifest.
3. Preserve per-route metadata and OpenAPI generation behavior.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/lib/generators/module-registry.ts` | Modify | Emit new split manifests |
| `apps/mercato/.mercato/generated/backend-routes.generated.ts` | Create | Backend cold-path manifest |
| `apps/mercato/.mercato/generated/frontend-routes.generated.ts` | Create | Frontend cold-path manifest |
| `apps/mercato/.mercato/generated/api-routes.generated.ts` | Create | API-only manifest for dispatcher/docs |
| `apps/mercato/.mercato/generated/bootstrap-modules.generated.ts` | Create | Slim bootstrap manifest |
| `apps/mercato/.mercato/generated/cli-modules.generated.ts` | Create | CLI-only metadata for runtime dashboards/tooling |
| `apps/mercato/.mercato/generated/subscribers.generated.ts` | Create | Subscriber registry for request-container wiring |
| `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` | Modify | Consume backend slim manifest |
| `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` | Modify | Consume frontend slim manifest |
| `apps/mercato/src/app/(backend)/backend/layout.tsx` | Modify | Avoid full registry import on cold path |
| `apps/mercato/src/bootstrap.ts` | Modify | Consume slim bootstrap manifest |
| `apps/mercato/src/app/api/[...slug]/route.ts` | Modify | Consume API-only manifest |
| `apps/mercato/src/app/api/docs/openapi/route.ts` | Modify | Build docs from API-only manifest |
| `apps/mercato/src/app/api/docs/markdown/route.ts` | Modify | Build docs from API-only manifest |
| `apps/mercato/src/di.ts` | Modify | Register discovered subscribers from split registry |
| `packages/create-app/template/src/app/(backend)/backend/[...slug]/page.tsx` | Modify | Keep scaffolded apps aligned |
| `packages/create-app/template/src/app/(frontend)/[...slug]/page.tsx` | Modify | Keep scaffolded apps aligned |
| `packages/create-app/template/src/bootstrap.ts` | Modify | Keep scaffolded apps aligned |
| `packages/create-app/template/src/app/api/[...slug]/route.ts` | Modify | Keep scaffolded API dispatcher aligned |
| `packages/create-app/template/src/app/api/docs/openapi/route.ts` | Modify | Keep scaffolded docs route aligned |
| `packages/create-app/template/src/app/api/docs/markdown/route.ts` | Modify | Keep scaffolded docs route aligned |
| `packages/create-app/template/src/di.ts` | Modify | Keep scaffolded subscriber wiring aligned |

### Testing Strategy

Unit / generator coverage:
- Snapshot or structural tests for new generated files.
- Regression tests proving `modules.generated.ts` export path and names are preserved.
- Tests proving backend/frontend route order and metadata remain unchanged.
- Tests proving lazy wrapper generation for sidecar metadata pages.
- Tests proving inline metadata pages still fall back to eager import correctly.

Application coverage:
- Backend catch-all smoke test: existing route still resolves and renders through `findBackendMatch()`.
- Frontend catch-all smoke test: existing route still resolves and renders through `findFrontendMatch()`.
- Backend layout smoke test: nav generation still uses backend route metadata correctly.
- Bootstrap smoke test: module registration still includes entity extensions, custom entities, translations, and integrations.

Performance validation:
- Add a non-blocking cold compile benchmark script or documented manual benchmark.
- CI MUST NOT use a hard timing threshold in Phase 1 due to environment variance.
- CI SHOULD validate structural import reduction instead: catch-all route manifests no longer import unrelated API handlers or non-matched page modules eagerly.

Affected UI/API path coverage for implementation:
- UI: `/backend/customers/people`
- UI: `/backend/customers/people/[id]`
- UI: representative frontend catch-all route (for example portal route)
- UI: `/backend` layout shell with settings/admin navigation
- API: no HTTP behavior change in Phase 1; API dispatcher split deferred

## Risks & Impact Review

#### Generated Contract Drift
- **Scenario**: New manifests accidentally change route metadata fields, ordering, or the old `modules.generated.ts` export shape.
- **Severity**: High
- **Affected area**: Catch-all pages, backend layout, any consumer importing generated registries
- **Mitigation**: Keep old file export stable, add generator snapshots, and compare route metadata structurally before/after.
- **Residual risk**: Low if generator tests cover ordering and export names.

#### Inline Metadata Forces Eager Imports
- **Scenario**: Pages that export metadata from `page.tsx` cannot be fully lazified in Phase 1, reducing performance wins.
- **Severity**: Medium
- **Affected area**: Cold compile time for routes backed by inline metadata pages
- **Mitigation**: Sidecar metadata gets full benefit immediately; inline metadata remains functional and is tracked for follow-up migration.
- **Residual risk**: Medium until inline metadata usage is reduced.

#### Bootstrap Still Reintroduces Full Import Graph
- **Scenario**: Catch-all pages adopt slim manifests but root bootstrap still imports the full registry, nullifying most cold compile wins.
- **Severity**: High
- **Affected area**: Cold page compile through root app layout
- **Mitigation**: Phase 2 explicitly separates bootstrap manifest and updates `apps/mercato/src/bootstrap.ts`.
- **Residual risk**: Low once root bootstrap no longer depends on full route/API imports.

#### Runtime Lazy Wrapper Semantics
- **Scenario**: Generated lazy `Component` wrappers behave differently from direct component imports, causing rendering regressions.
- **Severity**: Medium
- **Affected area**: Backend/frontend route rendering
- **Mitigation**: Preserve `Component` field signature exactly; cover representative routes with smoke tests in both app and template.
- **Residual risk**: Low.

#### Template Drift
- **Scenario**: `packages/create-app/template` keeps the old full-registry pattern, so newly scaffolded apps regress even after monorepo improvement.
- **Severity**: Medium
- **Affected area**: Scaffolded apps, standalone adoption
- **Mitigation**: Mirror all catch-all/bootstrap consumer changes in template files within the same implementation scope.
- **Residual risk**: Low if template updates are required in the file manifest and tests.

#### Over-Splitting Creates Maintenance Noise
- **Scenario**: Too many generated files create generator complexity without meaningful runtime gain.
- **Severity**: Low
- **Affected area**: CLI generator maintainability
- **Mitigation**: Phase 1 restricts split to backend routes, frontend routes, and bootstrap modules only. API split is deferred pending observed benefit.
- **Residual risk**: Low.

## Final Compliance Report — 2026-03-30

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Generated file contracts are STABLE | Compliant | Spec preserves `modules.generated.ts` export path and names; adds new generated files instead of replacing the old one |
| root AGENTS.md | Import paths are STABLE | Compliant | No existing generated import paths are removed |
| root AGENTS.md | Auto-discovery file conventions are FROZEN | Compliant | Module authoring conventions remain unchanged |
| root AGENTS.md | Spec-first for non-trivial architecture changes | Compliant | This document defines the generator/runtime split before implementation |
| .ai/specs/AGENTS.md | Spec must include TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog | Compliant | All required sections included |
| packages/cli/AGENTS.md | Generated output goes to `apps/mercato/.mercato/generated/` | Compliant | New manifests are defined under the same output directory |
| packages/cli/AGENTS.md | `modules.generated.ts` is a key generated file | Compliant | File remains preserved as compatibility layer |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Virtual generated manifest structures align with exported generated files |
| API contracts match UI/UX section | Pass | No HTTP contract changes proposed in Phase 1 |
| Risks cover all write operations | Pass | No database writes or user mutations are introduced by the design |
| Commands defined for all mutations | Pass | No command-scope mutations in this spec |
| Cache strategy covers all read APIs | Pass | No API cache change required; this is a generator/runtime import-graph optimization |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Additive Route Manifest Split | Done | 2026-03-30 | Added `backend-routes.generated.ts` and `frontend-routes.generated.ts` with lazy wrappers for sidecar-metadata pages and eager fallback for inline metadata pages |
| Phase 2 — Bootstrap Path Separation | Done | 2026-03-31 | `bootstrap-modules.generated.ts` now contains bootstrap-only module data; API/CLI/subscriber/worker imports were removed from the root bootstrap path |
| Phase 3 — Backend Layout Slimming | Done | 2026-03-30 | Backend layout and catch-all routes now consume split manifests instead of `modules.generated.ts` |
| Phase 4 — Optional API Registry Split | Done | 2026-03-31 | Added `api-routes.generated.ts` and switched app/template API dispatcher and docs routes to consume it; per-route metadata/docs remain colocated, so API route modules are still imported eagerly inside the API-only manifest |

### Phase 1-3 Detailed Progress
- [x] Extend the generator to emit backend, frontend, and bootstrap split manifests
- [x] Emit lazy route component wrappers when page metadata is provided by sidecar files
- [x] Preserve eager fallback for inline-metadata pages
- [x] Keep `modules.generated.ts` export path and names unchanged
- [x] Update app and template cold-path consumers to use split manifests
- [x] Add generator regression coverage for lazy-wrapper and eager-fallback behavior
- [x] Regenerate app outputs and verify package/app builds
- [x] Add `api-routes.generated.ts`, `cli-modules.generated.ts`, and `subscribers.generated.ts` for API-only, CLI-only, and subscriber-only consumers
- [x] Switch app/template API routes and API docs routes off `modules.generated.ts`
- [x] Remove direct app/template runtime imports of `modules.generated.ts` in favor of split registries
- [x] Register discovered subscribers from a dedicated generated registry during request-container setup

## Changelog
### 2026-03-30
- Initial specification for additive route registry split to reduce cold catch-all page compilation while preserving backward compatibility.

### 2026-03-31
- Completed bootstrap-path slimming by removing API/CLI/subscriber/worker imports from `bootstrap-modules.generated.ts`.
- Added `api-routes.generated.ts`, `cli-modules.generated.ts`, and `subscribers.generated.ts`.
- Switched app/template API dispatchers, API docs routes, and runtime module dashboard consumers to split registries instead of `modules.generated.ts`.
