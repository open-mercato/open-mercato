# Cold Bootstrap And Layout Slimming

## TLDR
**Key Points:**
- The 2026-03-30 route registry split reduced the size of page manifests, but it did not materially improve first-hit compile time because the dominant cold path is still root bootstrap plus backend layout compilation.
- Current evidence from 2026-03-31 shows cold compile still dominated by shared runtime imports: `/backend/customers/companies` compiled in ~19.4s, `/login` in ~8.1s, and `/api/auth/feature-check` in ~9.7s.
- The next optimization must separate root-safe i18n initialization from full runtime bootstrap, then stop centralizing route implementations into app-wide manifests. Shared metadata stays centralized; route implementations become per-module manifests behind lightweight global indices.

**Scope:**
- Add a dedicated module-translation registry so root layout can resolve dictionaries without full module bootstrap.
- Split app bootstrap into a root-safe initialization path and a heavier runtime/request bootstrap path.
- Remove route metadata and page imports from the bootstrap manifest used by runtime registration.
- Replace centralized route implementation manifests with per-module route manifests plus lightweight global indices.
- Slim backend layout by isolating optional interactive chrome behind lighter boundaries.

**Concerns:**
- `resolveTranslations()` currently depends on `getModules()`, so removing root bootstrap without replacing that dependency would break i18n.
- Generated-file contracts are stable; new manifests and bootstrap entrypoints must be additive.
- Backend layout compile time may remain high even after root bootstrap is reduced unless search/AI/notification chrome is also isolated.

## Overview

The previous cold-route optimization correctly split route registries away from `modules.generated.ts`, but the observed cold compile times show the critical path still flows through root app bootstrap and backend layout imports.

Today, a cold request to a backend page compiles:

- the root app layout, which imports `@/bootstrap` and calls `bootstrap()` at module load time
- a large bootstrap wrapper that imports many generated registries unrelated to simple route matching
- the backend layout, which imports AppShell, nav helpers, search UI, AI assistant UI, notifications, and other shell-only integrations
- the catch-all page and matched route component

This means the route-manifest split improved only one layer of the import graph. It did not target the dominant cold bundle.

This spec is a follow-up to [2026-03-30-cold-route-registry-split](/Users/piotrkarwatka/Projects/mercato-development/.ai/specs/2026-03-30-cold-route-registry-split.md). That spec remains valid, but its expected wins are capped because it still centralizes route implementations into shared generated files. This follow-up adopts a stricter rule:

> **Centralize metadata, not implementations.**

Entities, translations, DI registrars, subscribers, and other truly shared surfaces remain centralized. Routes do not, unless only their metadata is needed for indexing, conflict detection, or navigation.

## Problem Statement

### Observed Baseline

Cold dev-server timings captured on 2026-03-31:

- `GET /backend/customers/companies` -> `38.6s` total, `19.4s` compile, `19.0s` render
- `GET /login?redirect=%2Fbackend%2Fcustomers%2Fcompanies` -> `9.6s` total, `8.1s` compile
- `POST /api/auth/feature-check` -> `10.2s` total, `9.7s` compile

These numbers indicate the bottleneck is shared application/runtime compilation, not only backend catch-all page matching.

### Current Causes

1. **Root layout eagerly bootstraps the full app runtime**
   - `apps/mercato/src/app/layout.tsx` imports `@/bootstrap` and calls `bootstrap()` at module load time.
   - This forces the root route tree to compile the runtime bootstrap graph before a specific page can benefit from slim route manifests.

2. **`bootstrap.ts` still imports a large generated surface**
   - `apps/mercato/src/bootstrap.ts` imports `bootstrap-modules.generated.ts`, entity registries, DI registrars, widget registries, search configs, events, enrichers, guards, command interceptors, notification handlers, message registries, and bootstrap registrations.
   - Many of these are not required to render the root layout or resolve page metadata.

3. **`bootstrap-modules.generated.ts` is still too broad**
   - Although it excludes APIs/CLI/subscribers/workers, it still contains route metadata and some eager page imports.
   - It remains a large input file and keeps root bootstrap coupled to route surfaces.

4. **Backend layout remains a heavy compile unit**
   - `apps/mercato/src/app/(backend)/backend/layout.tsx` imports backend route metadata, AppShell, nav builders, search dialog, AI assistant integrations, notification UI, org switcher, and request-container access.
   - Even if route pages are slimmed, the backend layout can dominate first-hit compilation.

### Consequences

1. The current route split delivers only marginal cold-start improvement.
2. Root layout and API cold starts still compile much of the same runtime graph.
3. Backend page cold-start performance will remain poor until layout chrome and i18n bootstrap are separated from full runtime registration.
4. Continued use of centralized route implementation manifests preserves a large invalidation and compile surface even when routes are mostly module-isolated.

## Proposed Solution

Introduce a second-stage cold-path optimization focused on root-safe initialization, selective centralization, and shell slimming.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Add a dedicated module-translation registry instead of reusing `getModules()` for root i18n | Root layout only needs translations, not full runtime module data |
| Keep `bootstrap.ts` contract stable where practical | Avoid BC churn for existing imports while allowing root layout to stop using it |
| Add a route-free runtime manifest for module registration | Root/runtime bootstrap should not import backend/frontend route metadata |
| Centralize route indices, not route implementations | Routing needs global conflict detection and matching metadata, but not one global implementation bundle |
| Emit per-module route manifests | Most routes do not interoperate and should compile/load within their owning module boundary |
| Slim backend layout separately from catch-all pages | Next compiles the route tree, so layout cost must be addressed explicitly |
| Keep `modules.generated.ts` and existing `Module` contracts unchanged | Generated file contracts are stable and widely consumed |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Only continue route-manifest splitting | Evidence shows route manifests are not the dominant cold path anymore |
| Remove all bootstrap work from root layout without replacing translation registration | Would break `resolveTranslations()` and root dictionary composition |
| Rework `Module` type to separate translations/routes/bootstrap concerns in one breaking change | Too much contract churn for a performance optimization |
| Keep one centralized backend/frontend/API implementation manifest per surface | Still centralizes mostly-independent route code and keeps a large compile unit |
| Accept backend layout cost and optimize only API/root paths | Backend page cold-start remains the most painful observed path |

## User Stories / Use Cases

- **Developer** wants the first request to `/backend/*` after a cold start to compile materially faster than the current ~19s compile baseline.
- **Developer** wants login and auth API cold paths to stop paying for unrelated runtime registration.
- **Core maintainer** wants the optimization to remain additive and backward compatible with existing generated files and bootstrap callers.
- **Module author** wants translation loading, route discovery, and module conventions to remain unchanged.
- **Module author** wants a module's route implementation changes to invalidate and compile only that module's route manifest, not a single global route implementation file.

## Architecture

### Current Critical Path

```text
app/layout.tsx
  -> import '@/bootstrap'
  -> bootstrap()
  -> bootstrap.ts imports many generated registries
  -> registerModules(bootstrapModules)
  -> resolveTranslations() reads getModules()

backend/layout.tsx
  -> backend-routes.generated.ts
  -> AppShell + nav builders + search + AI + notifications + container code

backend/[...slug]/page.tsx
  -> backend-routes.generated.ts
  -> matched route.Component
```

The route split only reduced the bottom layer of that tree.

### Target Structure

#### Guiding Rule

Centralize only the surfaces that are truly application-wide:

- entities and entity ids
- DI registrars
- translations
- ACL/features
- subscribers
- integration bundles and other app-wide runtime registries

Decentralize surfaces that are mostly module-local:

- backend route implementations
- frontend route implementations
- API route implementations
- route components and handlers

Keep only route metadata centralized where it is needed for:

- route matching
- deterministic precedence
- conflict detection
- backend navigation construction
- metadata/title/auth checks before the owning route module is loaded

#### 1. Root-Safe Translation Initialization

Add a dedicated generated file:

```typescript
import type { Module } from '@open-mercato/shared/modules/registry'

export const moduleTranslations: Array<Pick<Module, 'id' | 'translations'>> = [
  { id: 'customers', translations: { ... } },
]
```

Add a dedicated shared registry and registration helpers:

- `registerModuleTranslations()`
- `getModuleTranslations()`

Update `loadDictionary()` / `resolveTranslations()` to read module translations from that dedicated registry instead of `getModules()`.

Result:

- root layout can initialize translation data without full module bootstrap
- module translations remain available in standalone-package contexts
- full module registration becomes a request/runtime concern instead of a root-layout concern

#### 2. Split Root Init From Runtime Bootstrap

Introduce two explicit bootstrap layers:

**Root init**
- app dictionary loader registration
- module translation registration
- no DI registrars
- no entities
- no routes
- no widgets
- no search/events/enrichers/guards registration

**Runtime bootstrap**
- full registration required for request containers and API execution
- entities, DI, search, analytics, enrichers, interceptors, guards, command interceptors, notification handlers, widgets, integrations, etc.

Recommended app files:

```text
apps/mercato/src/
├── bootstrap-root.ts           # root-safe i18n-only init
├── bootstrap.ts                # runtime bootstrap entrypoint (preserved public app import)
```

Consumer mapping:

| Consumer | New dependency |
|----------|----------------|
| `app/layout.tsx` | `bootstrap-root.ts` |
| `app/api/[...slug]/route.ts` | `bootstrap.ts` |
| `createRequestContainer()` app DI/runtime path | `bootstrap.ts` |
| CLI/bootstrap-from-app-root | `bootstrap.ts` |

#### 3. Route-Free Runtime Modules Manifest

Introduce a new generated file for runtime module registration, for example:

```text
apps/mercato/.mercato/generated/runtime-modules.generated.ts
```

Shape:

```typescript
import type { Module } from '@open-mercato/shared/modules/registry'

export const runtimeModules: Array<
  Pick<
    Module,
    | 'id'
    | 'info'
    | 'translations'
    | 'features'
    | 'entityExtensions'
    | 'customFieldSets'
    | 'customEntities'
    | 'setup'
    | 'integrations'
    | 'bundles'
  >
> = [...]
```

Rules:

- MUST NOT include `backendRoutes`
- MUST NOT include `frontendRoutes`
- MUST NOT include `apis`, `cli`, `subscribers`, or `workers`
- SHOULD avoid importing page modules or page metadata entirely

This keeps runtime registration data available without reintroducing route surfaces.

#### 4. Per-Module Route Manifests Plus Global Indices

Replace centralized route implementation manifests with a two-layer design:

**Per-module implementation manifests**

```text
apps/mercato/.mercato/generated/modules/
├── auth/
│   ├── backend-routes.generated.ts
│   ├── frontend-routes.generated.ts
│   └── api-routes.generated.ts
├── customers/
│   ├── backend-routes.generated.ts
│   ├── frontend-routes.generated.ts
│   └── api-routes.generated.ts
```

Each file contains only route implementations owned by that module.

**Global route indices**

```text
apps/mercato/.mercato/generated/
├── backend-routes.index.generated.ts
├── frontend-routes.index.generated.ts
├── api-routes.index.generated.ts
```

Index entries should contain only:

- `moduleId`
- route `pattern` / `path`
- route metadata required before implementation load
- stable priority/order data
- a loader for the owning module manifest

Example shape:

```typescript
export const backendRouteIndex = [
  {
    moduleId: 'customers',
    pattern: '/backend/customers/companies',
    requireAuth: true,
    requireFeatures: ['customers.view'],
    title: 'Companies',
    order: 100,
    loadModuleRoutes: () => import('./modules/customers/backend-routes.generated'),
  },
]
```

Runtime flow:

1. Match candidate route from the lightweight global index.
2. Resolve the owning module.
3. Load only that module's route manifest.
4. Resolve the final route component or handler there.

This preserves global routing determinism without centralizing all route implementations into one bundle.

#### 5. Backend Layout Slimming

Refactor backend layout into lighter layers:

- keep server-only path/auth/nav-data resolution in the layout
- move optional interactive chrome behind smaller boundaries
- avoid direct eager imports of feature-rich shell widgets when a boundary or dynamic import can defer them

Primary candidates:

- search dialog
- AI assistant header/chat integrations
- notification bell wrappers and other non-critical shell chrome

This phase is intentionally separate from root bootstrap splitting so each change can be measured independently.

### Target Output Files

```text
apps/mercato/.mercato/generated/
├── modules.generated.ts                # Preserved compatibility layer
├── module-translations.generated.ts    # New: translations-only manifest for root i18n
├── runtime-modules.generated.ts        # New: route-free runtime module registry
├── backend-routes.index.generated.ts   # New: metadata-only backend route index
├── frontend-routes.index.generated.ts  # New: metadata-only frontend route index
├── api-routes.index.generated.ts       # New: metadata-only API route index
├── modules/
│   └── <module-id>/
│       ├── backend-routes.generated.ts # Per-module backend route implementations
│       ├── frontend-routes.generated.ts
│       └── api-routes.generated.ts
├── bootstrap-modules.generated.ts      # Deprecated internally or reduced to a bridge
```

### Non-Goals

- Replacing `modules.generated.ts`
- Renaming convention files or route discovery behavior
- Refactoring all backend shell UI in one pass beyond the identified cold-path imports
- Solving client-side hydration bundle size in this spec

## Data Models

No database schema changes.

### Generated Translation Manifest (Virtual)

- `id`: string
- `translations`: `Module['translations'] | undefined`

### Generated Runtime Module Manifest (Virtual)

- `id`: string
- `info`: `Module['info'] | undefined`
- `translations`: `Module['translations'] | undefined`
- `features`: `Module['features'] | undefined`
- `entityExtensions`: `Module['entityExtensions'] | undefined`
- `customFieldSets`: `Module['customFieldSets'] | undefined`
- `customEntities`: `Module['customEntities'] | undefined`
- `setup`: `Module['setup'] | undefined`
- `integrations`: `Module['integrations'] | undefined`
- `bundles`: `Module['bundles'] | undefined`

### Generated Route Index Entry (Virtual)

- `moduleId`: string
- `pattern` or `path`: string
- route metadata needed for auth/title/nav matching
- priority/order data when applicable
- `loadModuleRoutes`: `() => Promise<unknown>`

### Generated Per-Module Route Manifest (Virtual)

- Contains only one module's backend/frontend/API route implementations
- May keep the existing route entry shapes internally
- Must not include routes from other modules

## API Contracts

No HTTP endpoint contract changes.

### Preserved Contracts

- `apps/mercato/.mercato/generated/modules.generated.ts`
- `Module` type in `@open-mercato/shared/modules/registry`
- existing `bootstrap.ts` import path in the app

### Added Contracts

- `apps/mercato/.mercato/generated/module-translations.generated.ts`
  - `export const moduleTranslations`
- `apps/mercato/.mercato/generated/runtime-modules.generated.ts`
  - `export const runtimeModules`
- `apps/mercato/.mercato/generated/backend-routes.index.generated.ts`
  - `export const backendRouteIndex`
- `apps/mercato/.mercato/generated/frontend-routes.index.generated.ts`
  - `export const frontendRouteIndex`
- `apps/mercato/.mercato/generated/api-routes.index.generated.ts`
  - `export const apiRouteIndex`
- shared translation registry helpers
  - `registerModuleTranslations()`
  - `getModuleTranslations()`

## Implementation Plan

### Phase 1: Root I18n Decoupling

1. Add a dedicated translation registry in `packages/shared/src/lib/i18n` or a neighboring shared runtime location.
2. Update `loadDictionary()` so it no longer depends on `getModules()`.
3. Extend the generator to emit `module-translations.generated.ts`.
4. Add `apps/mercato/src/bootstrap-root.ts` that registers:
   - app dictionary loader
   - generated module translations
5. Change `apps/mercato/src/app/layout.tsx` to import root init instead of full runtime bootstrap.

### Phase 2: Runtime Bootstrap Manifest Slimming

1. Extend the generator to emit `runtime-modules.generated.ts`.
2. Update `apps/mercato/src/bootstrap.ts` to use `runtimeModules` instead of `bootstrapModules`.
3. Ensure runtime module registration no longer imports route metadata or page modules.
4. Keep backward compatibility by either:
   - leaving `bootstrap-modules.generated.ts` as a bridge, or
   - preserving it for existing consumers while moving app runtime off it

### Phase 3: Route Index / Per-Module Manifest Split

1. Extend the generator to emit per-module backend/frontend/API route manifests under `generated/modules/<module-id>/`.
2. Emit lightweight global route indices for backend/frontend/API matching.
3. Update catch-all pages and API routing to:
   - match using the global index
   - load only the owning module's route manifest
4. Add conflict-detection and deterministic-priority assertions at generator time.
5. Keep existing centralized route manifests only as a temporary compatibility bridge if required during rollout.

### Phase 4: Backend Layout Slimming

1. Audit top-level imports in `apps/mercato/src/app/(backend)/backend/layout.tsx`.
2. Extract optional shell chrome into smaller boundaries or lazy-loaded client wrappers.
3. Preserve existing behavior and page navigation structure.
4. Ensure navigation still uses centralized metadata only, not centralized route implementations.
5. Re-measure cold compile of `/backend/customers/companies` after this phase separately from earlier phases.

### Phase 5: Measurement And Cleanup

1. Add a repeatable manual benchmark section to this spec using the same routes measured on 2026-03-31.
2. Record before/after timings for:
   - `/backend/customers/companies`
   - `/login`
   - `/api/auth/feature-check`
3. If centralized route implementation manifests become redundant, deprecate internal app usage and document the remaining compatibility story.
4. If `bootstrap-modules.generated.ts` becomes redundant, deprecate internal app usage and document the remaining compatibility story.

## Testing Strategy

### Automated

- Generator regression tests for:
  - `module-translations.generated.ts`
  - `runtime-modules.generated.ts`
  - absence of route imports in runtime manifest
  - per-module route manifest generation
  - lightweight global route index generation
  - conflict detection and priority ordering across modules
- Shared i18n tests proving:
  - `loadDictionary()` works after only root init
  - root translation loading no longer requires `registerModules()`
- App smoke tests proving:
  - `app/layout.tsx` no longer imports the full runtime bootstrap
  - API routes and request container creation still work with runtime bootstrap
  - catch-all pages and API routing load only the matched module manifest
- Backend layout smoke tests for preserved nav/auth/render behavior

### Manual Benchmark

Use a cold dev server and measure first-hit timings for:

1. `GET /backend/customers/companies`
2. `GET /login?redirect=%2Fbackend%2Fcustomers%2Fcompanies`
3. `POST /api/auth/feature-check`

Success criteria:

- cold compile time for backend route materially lower than the 2026-03-31 baseline
- login/API cold compile time also reduced
- no translation regressions on first request

## Risks & Impact Review

#### Root Translation Regression
- **Scenario**: Root layout stops calling full bootstrap before translation registry is ready.
- **Severity**: High
- **Affected Area**: All pages using `resolveTranslations()`
- **Mitigation**: Add dedicated translation registry first, then switch root layout to root init.
- **Residual Risk**: Low after automated coverage.

#### Runtime Registration Gaps
- **Scenario**: Splitting root init from runtime bootstrap leaves some APIs or request-container consumers without required registrations.
- **Severity**: High
- **Affected Area**: API routes, auth checks, command/query flows
- **Mitigation**: Keep `bootstrap.ts` as the single runtime entrypoint and verify request container + API smoke tests.
- **Residual Risk**: Medium until app-wide smoke coverage is added.

#### Hidden Route Coupling In Runtime Manifest
- **Scenario**: The new runtime manifest still accidentally imports route metadata or page modules.
- **Severity**: Medium
- **Affected Area**: Cold compile time improvements
- **Mitigation**: Add generator regression tests that assert runtime manifest excludes route surfaces.
- **Residual Risk**: Low.

#### Route Index / Implementation Divergence
- **Scenario**: The global route index metadata drifts from the owning module route manifest, causing incorrect auth/title/nav behavior or wrong route resolution.
- **Severity**: High
- **Affected Area**: Routing, authorization, backend navigation
- **Mitigation**: Generate both index and per-module manifest from the same scan result and add regression tests for index-to-implementation consistency.
- **Residual Risk**: Medium until broad routing coverage is in place.

#### Cross-Module Route Conflicts
- **Scenario**: Per-module route manifests make route collisions harder to reason about, and the wrong module wins for an overlapping pattern.
- **Severity**: High
- **Affected Area**: Routing determinism
- **Mitigation**: Keep conflict detection centralized in the generator and preserve stable priority ordering in the global indices.
- **Residual Risk**: Low after generator assertions.

#### Backend Layout Behavior Drift
- **Scenario**: Lazy shell chrome changes timing or visibility of search/AI/notification UI.
- **Severity**: Medium
- **Affected Area**: Backend shell UX
- **Mitigation**: Keep behavioral tests and isolate changes to non-critical interactive chrome.
- **Residual Risk**: Medium.

## Migration & Backward Compatibility

- This spec is additive.
- No existing generated file is removed.
- No `Module` fields are removed or renamed.
- Existing app import path `@/bootstrap` remains valid.
- New registries and manifests are introduced alongside the existing compatibility layer.
- Existing centralized route manifests may remain temporarily as internal bridges during migration, but new hot-path consumers should move to global indices plus per-module manifests.

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| Backward compatibility preserved | Pass | Additive manifests and registries only |
| Module/file conventions preserved | Pass | No convention-file rename or routing change |
| Cross-module isolation respected | Pass | Architecture now further aligns with module isolation by centralizing metadata but not route implementations |
| Tenant/data security preserved | Pass | No data model or authorization contract changes |
| Implementation phased into testable slices | Pass | Translation split, runtime manifest, per-module route manifests, layout slimming, benchmark cleanup |

## Changelog

- 2026-03-31: Initial spec created to follow up on the limited gains from the route registry split and target the actual cold compile bottlenecks in root bootstrap and backend layout.
- 2026-03-31: Updated architecture to centralize only shared metadata while moving route implementations to per-module manifests behind lightweight global route indices.
