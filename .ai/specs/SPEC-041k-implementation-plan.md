# SPEC-041k Implementation Plan — DevTools + Conflict Detection

| Field | Value |
|-------|-------|
| **Spec** | [SPEC-041k](./SPEC-041k-devtools.md) |
| **Branch** | `feat/umes-phase-k` |
| **Created** | 2026-03-04 |

---

## Progress Tracker

| Step | Title | Status | Notes |
|------|-------|--------|-------|
| 1 | Folder structure + types | `done` | All dirs + types + tests created, 18/18 tests pass |
| 2 | Build-time conflict detection | `done` | Integrated into generators, yarn generate passes |
| 3 | CLI commands (`umes:list`, `umes:inspect`, `umes:check`) | `done` | All 3 commands work, ESM require fix applied |
| 4 | Enricher performance logging | `done` | Integrated logEnricherTiming into enricher-runner (both list & single) |
| 5 | Extension header protocol (`x-om-ext-*`) | `done` | Added extensionHeaders to InterceptorContext, parsed in factory.ts |
| 6 | Response metadata (`_meta.enrichedBy`) | `done` | Already implemented in enricher-runner (lines 255-261, 335-341) |
| 7 | Enricher cache integration (optional) | `done` | Already implemented in enricher-runner (read-through strategy, cache key, tags, TTL) |
| 8 | Interceptor audit trail (`action_log`) | `done` | Dev-mode activity logger + integrated into interceptor-runner |
| 9 | DevTools data hook (`useUmesDevTools`) | `done` | Collects from all registries + timing/activity entries |
| 10 | DevTools Panel UI (`UmesDevToolsPanel`) | `done` | Full panel with 5 tabs, all sub-components, Ctrl+Shift+U toggle |

---

## Step 1 — Folder Structure + Types

**Goal**: Scaffold all directories, placeholder files, and shared type definitions needed by subsequent steps.

**Files to create**:

| Action | File | Purpose |
|--------|------|---------|
| NEW | `packages/shared/src/lib/umes/devtools-types.ts` | Shared types for DevTools data (extension point info, conflict info, enricher timing, event flow) |
| NEW | `packages/shared/src/lib/umes/conflict-detection.ts` | Conflict detection logic (pure functions, used by both generator and CLI) |
| NEW | `packages/shared/src/lib/umes/index.ts` | Barrel export for umes utilities |
| NEW | `packages/ui/src/backend/devtools/UmesDevToolsPanel.tsx` | Placeholder panel component (renders "DevTools — coming soon" in dev mode) |
| NEW | `packages/ui/src/backend/devtools/useUmesDevTools.ts` | Placeholder hook (returns empty data structure) |
| NEW | `packages/ui/src/backend/devtools/index.ts` | Barrel export |
| NEW | `packages/cli/src/lib/umes/index.ts` | Entry point for UMES CLI subcommands |

**Testable outcome**: Application builds and runs. DevTools panel can be imported but is not yet wired. Types compile. `yarn build:packages` succeeds.

**Verification**:
- `yarn build:packages` passes
- `yarn lint` passes
- Importing `@open-mercato/shared/lib/umes` resolves types
- Importing `@open-mercato/ui/backend/devtools` resolves components

---

## Step 2 — Build-Time Conflict Detection

**Goal**: During `yarn generate`, detect and report conflicts as defined in the spec.

**Conflict rules**:

| Conflict | Severity | Action |
|----------|----------|--------|
| Two modules replacing same component at same priority | Error | Build fails |
| Enricher adding fields conflicting with core fields | Warning | Console warning |
| Circular widget dependencies | Error | Build fails |
| Missing feature declarations for gated extensions | Warning | Console warning |
| Multiple interceptors on same route at same priority | Warning | Console warning |

**Files to modify/create**:

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `packages/cli/src/lib/generators/module-registry.ts` | Add conflict detection calls after collecting all module data |
| CREATE | `packages/shared/src/lib/umes/conflict-detection.ts` | Pure conflict detection functions (already scaffolded in Step 1, now filled) |
| MODIFY | `packages/cli/src/lib/generators/index.ts` | Export conflict detection results |

**Implementation details**:
1. After all modules are collected in `generateModuleRegistry()`, call `detectConflicts(allData)`.
2. `detectConflicts` returns `{ errors: ConflictError[], warnings: ConflictWarning[] }`.
3. Warnings are printed to console with yellow color.
4. Errors are printed to console with red color and cause the generator to throw (build fails).
5. Conflict info includes: conflicting module IDs, target (component/route/spot), priority values.

**Testable outcome**: Running `yarn generate` with the existing modules completes without errors (no current conflicts). If two test fixture modules target the same component at same priority, the build fails with a descriptive error.

**Verification**:
- `yarn generate` succeeds with current modules
- Unit test: creating conflicting fixtures → detect errors
- Unit test: creating enricher field conflicts → detect warnings
- `yarn build:packages` passes

---

## Step 3 — CLI Commands

**Goal**: Add three UMES CLI commands for inspecting and validating extensions.

**Commands**:
```bash
yarn umes:list                    # List all UMES extensions across all modules
yarn umes:inspect --module <id>   # Show extension tree for a specific module
yarn umes:check                   # Run conflict detection without building
```

**Files to create/modify**:

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `packages/cli/src/lib/umes/list.ts` | `umes:list` implementation — collects and formats all extensions |
| CREATE | `packages/cli/src/lib/umes/inspect.ts` | `umes:inspect` implementation — tree view for one module |
| CREATE | `packages/cli/src/lib/umes/check.ts` | `umes:check` implementation — runs conflict detection standalone |
| MODIFY | `packages/cli/src/lib/umes/index.ts` | Wire subcommands together |
| MODIFY | `packages/cli/src/mercato.ts` | Register `umes:list`, `umes:inspect`, `umes:check` commands |

**Implementation details**:
1. Commands use the same `createResolver()` and scanner infrastructure as generators.
2. `umes:list` outputs a table: Module | Type | Target | Priority | Features.
3. `umes:inspect --module loyalty` shows a tree: enrichers, interceptors, widgets, components, events.
4. `umes:check` reuses `detectConflicts()` from Step 2, prints results, exits with code 1 on errors.

**Testable outcome**: All three commands run successfully. `yarn umes:list` shows extensions from the example module. `yarn umes:check` exits 0 with no conflicts.

**Verification**:
- `yarn umes:list` outputs a formatted table
- `yarn umes:inspect --module example` shows example module extensions
- `yarn umes:check` exits 0
- `yarn build:packages` passes

---

## Step 4 — Enricher Performance Logging

**Goal**: In development mode, log enricher execution time with severity thresholds.

**Thresholds**:
- < 100ms: silent (normal)
- 100–500ms: `console.warn` with enricher ID and duration
- \> 500ms: `console.error` with enricher ID, duration, and caching suggestion

**Files to create/modify**:

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `packages/shared/src/lib/umes/enricher-timing.ts` | Timing wrapper + threshold logger |
| MODIFY | CRUD enricher execution path (where enrichers are called) | Wrap each enricher call with timing |

**Implementation details**:
1. Create `withEnricherTiming(enricher, fn)` that wraps the enricher execution, measures duration, and logs based on thresholds.
2. Only active when `NODE_ENV === 'development'`.
3. Log format: `[UMES] Enricher "loyalty.customer-points" took 342ms (warning: >100ms)`.
4. Store timing data in a global dev-only registry for DevTools to read later (Step 9).

**Testable outcome**: In dev mode, slow enrichers produce console warnings. In production mode, no overhead.

**Verification**:
- Dev server shows enricher timing in console for example module enrichers
- No timing logs in production build
- `yarn build:packages` passes

---

## Step 5 — Extension Header Protocol

**Goal**: Support `x-om-ext-<module>-<key>: <value>` headers for widget/interceptor communication.

**Files to create/modify**:

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `packages/shared/src/lib/umes/extension-headers.ts` | Helper functions: `buildExtensionHeader(module, key)`, `parseExtensionHeaders(headers)`, `getExtensionHeaderValue(headers, module, key)` |
| MODIFY | Interceptor execution path | Pass extension headers to interceptor context |

**Implementation details**:
1. `buildExtensionHeader('record-locks', 'token')` → `'x-om-ext-record-locks-token'`.
2. `parseExtensionHeaders(headers)` → `{ 'record-locks': { token: 'abc123' }, 'business-rules': { override: 'skip-credit-check' } }`.
3. Extension headers are extracted from incoming requests and added to `InterceptorContext`.
4. Interceptors can read/write extension headers via context.

**Testable outcome**: Helper functions work correctly. Interceptors receive parsed extension headers in context.

**Verification**:
- Unit tests for header building/parsing
- Interceptor context includes extension headers
- `yarn build:packages` passes

---

## Step 6 — Response Metadata (`_meta.enrichedBy`)

**Goal**: When enrichers are active, responses include `_meta.enrichedBy` listing which enrichers ran.

**Files to modify**:

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | CRUD response enrichment pipeline | Collect enricher IDs that ran, append `_meta` to response |
| MODIFY | `packages/shared/src/lib/umes/devtools-types.ts` | Add `EnricherResponseMeta` type |

**Implementation details**:
1. After all enrichers execute for a response, collect their IDs.
2. Append `_meta: { enrichedBy: ['loyalty.customer-points', 'credit.score'] }` to the response body.
3. Only include `_meta` when at least one enricher ran.
4. In production, `_meta` can be toggled via a request header (`x-om-include-meta: true`) or environment variable.

**Testable outcome**: API responses for enriched entities include `_meta.enrichedBy`. Example: GET `/api/customers/people` returns `_meta.enrichedBy: ['example.customer-todo-count']`.

**Verification**:
- API call to enriched entity returns `_meta`
- `_meta.enrichedBy` lists correct enricher IDs
- `yarn build:packages` passes

---

## Step 7 — Enricher Cache Integration

**Goal**: Support optional cache layer for performance-critical enrichers using existing `@open-mercato/cache`.

**Files to create/modify**:

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `packages/shared/src/lib/umes/enricher-cache.ts` | Cache wrapper that reads `enricher.cache` config and integrates with `@open-mercato/cache` |
| MODIFY | Enricher execution pipeline | Check for cache config, use read-through pattern |

**Implementation details**:
1. If an enricher declares `cache: { strategy: 'read-through', ttl: 60, tags: [...], invalidateOn: [...] }`, wrap its execution with cache lookup.
2. Cache key: `umes:enricher:<enricherId>:<entityId>:<recordId>`.
3. Uses existing `@open-mercato/cache` infrastructure (resolve via DI).
4. `invalidateOn` events trigger cache tag invalidation via the event bus.
5. Cache is optional — enrichers without `cache` config execute normally.

**Testable outcome**: Enrichers with cache config use cached results on second call. Cache invalidation works via events.

**Verification**:
- Enricher with cache config: first call hits enricher, second call hits cache
- Event emission invalidates cache
- Enrichers without cache config unaffected
- `yarn build:packages` passes

---

## Step 8 — Interceptor Audit Trail

**Goal**: Log interceptor rejections as `action_log` entries using existing infrastructure.

**Files to modify**:

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | Interceptor execution path | On `before()` returning `ok: false`, write to `action_log` |
| MODIFY | `packages/shared/src/lib/umes/devtools-types.ts` | Add `InterceptorAuditEntry` type |

**Implementation details**:
1. When an interceptor's `before()` returns `{ ok: false, ... }`, log to `action_log`:
   - `action_type`: `'api_interceptor_reject'`
   - `metadata`: `{ interceptorId, route, method, message, statusCode }`
2. Uses existing `action_log` table — no new database entity needed.
3. Logging is async (fire-and-forget) to not slow down the rejection response.

**Testable outcome**: Interceptor rejections appear in `action_log`. Can be queried via existing admin tools.

**Verification**:
- Trigger an interceptor rejection → verify `action_log` entry
- Non-rejection interceptors don't create log entries
- `yarn build:packages` passes

---

## Step 9 — DevTools Data Hook (`useUmesDevTools`)

**Goal**: Implement `useUmesDevTools` hook that aggregates all UMES extension data for the current page.

**Files to modify**:

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `packages/ui/src/backend/devtools/useUmesDevTools.ts` | Full implementation of data collection hook |
| MODIFY | `packages/shared/src/lib/umes/devtools-types.ts` | Finalize all DevTools data types |

**Data collected**:
1. **Active Extension Points**: All injection spots on the current page
2. **Module Registrations**: Which modules registered for each point, with priorities
3. **Conflicts**: Warnings when two modules target same point at same priority
4. **Enricher Timing**: Duration of each enricher execution (from Step 4 global registry)
5. **Component Replacements**: Active overrides from component registry
6. **Interceptor Activity**: Recent interceptor firings (from a dev-only event log)

**Implementation details**:
1. Hook reads from global registries: `getCoreInjectionWidgets()`, `getCoreInjectionTables()`, component registry.
2. Enricher timing data comes from the dev-only timing registry (Step 4).
3. Hook is only active when `NODE_ENV === 'development'`.
4. Returns `UmesDevToolsData` with all sections populated.

**Testable outcome**: Hook returns complete data. Can be logged to console for verification.

**Verification**:
- `useUmesDevTools()` returns data for current page extensions
- Data includes example module enrichers, widgets, interceptors
- `yarn build:packages` passes

---

## Step 10 — DevTools Panel UI (`UmesDevToolsPanel`)

**Goal**: Build the visual DevTools panel, only rendered in development mode.

**Files to modify**:

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `packages/ui/src/backend/devtools/UmesDevToolsPanel.tsx` | Full panel implementation |
| CREATE | `packages/ui/src/backend/devtools/components/ExtensionPointList.tsx` | Extension points section |
| CREATE | `packages/ui/src/backend/devtools/components/ConflictWarnings.tsx` | Conflict detection display |
| CREATE | `packages/ui/src/backend/devtools/components/EnricherTiming.tsx` | Enricher timing display |
| CREATE | `packages/ui/src/backend/devtools/components/EventFlow.tsx` | Real-time event flow |
| CREATE | `packages/ui/src/backend/devtools/components/InterceptorActivity.tsx` | Interceptor activity log |

**Panel sections**:
1. **Extension Points**: Table of all active extension points (slots, enrichers, interceptors, component replacements)
2. **Module Registrations**: Per-point breakdown showing which modules registered, with priority
3. **Conflict Detection**: Yellow/red warnings for same-priority conflicts
4. **Event Flow**: Live feed of extension events (onBeforeSave fired → widget X responded → blocked/allowed)
5. **Enricher Timing**: Timing bars with color coding (green/yellow/red)
6. **Component Replacements**: Which components are replaced and by which module
7. **Interceptor Activity**: Last N interceptor firings with route, method, result

**Activation**:
- Keyboard shortcut: `Ctrl+Shift+U` toggles the panel
- Panel slides in from the right side
- Only available when `NODE_ENV === 'development'`

**Testable outcome**: Panel opens via shortcut, shows real data from the running app.

**Verification**:
- `Ctrl+Shift+U` opens panel in dev mode
- Panel shows example module extensions (enrichers, widgets, interceptors)
- Panel does NOT appear in production mode
- Enricher timing shows durations
- Conflict warnings display when applicable
- `yarn build:packages` passes
- Integration test TC-UMES-DT01 passes

---

## Dependencies Between Steps

```
Step 1 (structure)
  ├── Step 2 (conflict detection) ── Step 3 (CLI commands)
  ├── Step 4 (enricher timing) ─────┐
  ├── Step 5 (extension headers)    │
  ├── Step 6 (response metadata)    ├── Step 9 (data hook) ── Step 10 (panel UI)
  ├── Step 7 (enricher cache)       │
  └── Step 8 (audit trail) ────────┘
```

Steps 2–8 can be done in any order after Step 1. Steps 9 and 10 depend on Steps 2–8 being complete.
