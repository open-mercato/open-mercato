# Lessons

# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

## Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

## Flush entity updates before running relation syncs that query

**Context**: `catalog.products.update` mutates scalar fields and then calls `syncOffers` / `syncCategoryAssignments` / `syncProductTags`, which perform `find` queries. MikroORM auto-flush + subscriber logic reset `__originalEntityData`, resulting in no change sets and no UPDATE being issued.

**Problem**: Updates to the main entity silently did not hit the database when relation syncs executed before the flush.

**Rule**: If an update command mutates scalar fields and then performs relation-sync queries, flush the main entity changes *before* those syncs (or split into two UoWs/transactions).

**Applies to**: Commands that update a core record and then call sync helpers that query/modify relations using the same `EntityManager`.

## Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, and related template-only wrapper components.

## Store global event bus in `globalThis` to survive module duplication in dev

**Context**: `record_locks` notifications stopped while banners still worked. Banner logic uses direct API polling, but notifications depend on `emitRecordLocksEvent()` from `createModuleEvents()` and the global event bus wiring.

**Problem**: In dev (HMR/Turbopack), duplicated module instances can appear. One instance receives `setGlobalEventBus()` during bootstrap, another instance emits events. With module-local singleton only, emitted events can be dropped silently.

**Rule**: For process-wide runtime singletons used across package boundaries (event bus, similar registries), keep canonical reference in `globalThis` and use module-local variable only as fallback.

**Applies to**: `packages/shared/src/modules/events/factory.ts` and any shared runtime singleton relied on by module auto-discovery/subscriber pipelines.

## Always propagate structured conflict payload from `onBeforeSave` blockers

**Context**: Conflict handling in record locks had two paths: preflight `onBeforeSave` and real mutation `save` response. UI recovered conflict dialog only from save error path.

**Problem**: When conflict was blocked in preflight, users could hit dead-end loops (`Keep editing` / `Keep my changes`) because the dialog state was not rehydrated with full conflict payload.

**Rule**: Any blocking `onBeforeSave` result must carry machine-readable `details` (code + payload), and `CrudForm` must route it through the same global save-error recovery channel as normal save failures.

**Applies to**: Injection widgets that gate save (`WidgetBeforeSaveResult`) and conflict-capable modules (record locks, future optimistic concurrency widgets).
## MUST use Button and IconButton primitives — never raw `<button>` elements

**Context**: The codebase was refactored to replace all raw `<button>` elements with `Button` and `IconButton` from `@open-mercato/ui/primitives`. This ensures consistent styling, focus rings, disabled states, and dark mode support across the entire application.

**Rules**:

1. **Never use raw `<button>` elements** — always use `Button` or `IconButton` from `@open-mercato/ui`.
2. **Use `IconButton` for icon-only buttons** (no text label, just an icon). Use `Button` for everything else (text-only, icon+text, or any button with visible label content).
3. **Always pass `type="button"` explicitly** unless the button is a form submit (`type="submit"`). Neither `Button` nor `IconButton` sets a default type, so omitting it defaults to `type="submit"` per HTML spec, which can cause accidental form submissions.
4. **Tab-pattern buttons** using `variant="ghost"` with underline indicators MUST include `hover:bg-transparent` in className to suppress the ghost variant's default `hover:bg-accent` background.
5. **For compact inline contexts** (tag chips, toolbar buttons, inline list items), add `h-auto` to className to override the fixed height from size variants.

**Button variants and sizes quick reference**:

| Component | Variants | Sizes | Default |
|-----------|----------|-------|---------|
| `Button` | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | `default` (h-9), `sm` (h-8), `lg` (h-10), `icon` (size-9) | `variant="default"`, `size="default"` |
| `IconButton` | `outline`, `ghost` | `xs` (size-6), `sm` (size-7), `default` (size-8), `lg` (size-9) | `variant="outline"`, `size="default"` |

**Common patterns**:
- Sidebar/nav toggle: `<IconButton variant="outline" size="sm">`
- Close/dismiss: `<IconButton variant="ghost" size="sm">` with `<X />` icon
- Tab navigation: `<Button variant="ghost" size="sm" className="h-auto rounded-none hover:bg-transparent border-b-2 ...">`
- Dropdown menu items: `<Button variant="ghost" size="sm" className="w-full justify-start">`
- Toolbar formatting buttons: `<Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs">`
- Muted section headers: `<Button variant="muted" className="w-full justify-between">`

**Applies to**: All UI components across `packages/ui`, `packages/core`, and `apps/mercato`.

## Integration tests: avoid `networkidle` on pages with SSE/background streams

**Context**: Multiple Sales/Integration UI tests started timing out at 20s in ephemeral runs. Failing point was `page.waitForLoadState('networkidle')` right after navigation.

**Problem**: Pages with SSE or other long-lived background requests may never reach Playwright `networkidle`, causing deterministic false failures unrelated to product logic.

**Rules**:

1. In integration tests/helpers, do not use `waitForLoadState('networkidle')` as a generic readiness gate on backend pages.
2. Prefer `waitForLoadState('domcontentloaded')` plus one explicit UI readiness assertion for the interaction target (for example, a key button/input becoming visible).
3. Keep selectors user-facing and stable (`Edit`, `Filter`) rather than translation keys or positional indexing (`nth(...)`) when possible.

**Applies to**: `packages/*/__integration__/**` Playwright tests and shared integration helpers (especially sales/customer flows).

## Standalone template must include all generated bootstrap registries

**Context**: Standalone integration tests failed only for UMES enricher scenarios (`TC-UMES-002`) while other tests passed.

**Problem**: `packages/create-app/template/src/bootstrap.ts` drifted from `apps/mercato/src/bootstrap.ts` and did not pass generated `enricherEntries` into `createBootstrap(...)`, so response enrichers were never registered in scaffolded apps.

**Rule**: Whenever app bootstrap wiring changes (events, analytics, enrichers, message registries, similar generated registries), mirror the same imports and `createBootstrap(...)` arguments in `packages/create-app/template/src/bootstrap.ts` in the same PR.

**Applies to**: Scaffolded standalone apps and snapshot/standalone integration workflows.

## Duplicate migration creation causes initialize failures in fresh databases

**Context**: `yarn initialize` failed with `relation "customer_pipelines" already exists` because two customer migrations both created the same table.

**Problem**: Later migration `Migration20260226155449` repeated schema creation already handled by `Migration20260218191730`.

**Rule**: Before adding a migration, check existing module migrations for overlapping DDL. If a duplicate migration was already committed and may be in history, keep the file/class name stable and convert duplicate migration content to a no-op instead of deleting/renaming it.

**Applies to**: `packages/core/src/modules/*/migrations/*.ts` and initialize/ephemeral test bootstrap flows.

## Keep injected namespaces DataTable-owned, not page-owned

**Context**: Injected datatable values (for example `_example.priority`) were visible in API payloads and saved correctly, but list columns still rendered fallback values like `normal`.

**Problem**: Multiple list pages mapped API items into whitelisted row objects and accidentally dropped `_namespace` fields. That made injected columns/filters/actions unreliable and forced page-level coupling to specific modules.

**Rule**: Namespace preservation must be centralized in `DataTable` helpers. Page mappers must remain module-agnostic and finalize mapped rows with `withDataTableNamespaces(mappedRow, sourceItem)` instead of manually handling injection keys.

**Applies to**: Any backend page/component that maps API records before passing rows to `DataTable` (especially pages using `perspective.tableId` and injection-based extensions).

## Scope Playwright `testIgnore` entries to project root absolute paths

**Context**: Running integration tests from a worktree under a parent path containing `.codex` caused Playwright to report `No tests found`.

**Problem**: A relative ignore glob like `.codex/**` can match parent path segments in some environments, unintentionally excluding all discovered tests.

**Rule**: In `.ai/qa/tests/playwright.config.ts`, build `testIgnore` patterns from `projectRoot` absolute paths (normalized), for example `${normalizePath(path.join(projectRoot, '.codex'))}/**`, instead of loose relative globs.

**Applies to**: Integration Playwright config and any future test discovery/ignore configuration.

## Keep external integrations as dedicated npm workspace packages

**Context**: Provider modules like shipping carriers and payment gateways were implemented in `packages/core/src/modules/*`, which blurs the boundary between core platform modules and optional external connectors.

**Problem**: This makes provider ownership unclear, slows independent releases, and violates the integration marketplace package model (SPEC-045/SPEC-045c) where connectors are separate installable modules.

**Rule**: Any external integration provider (payment/shipping/communication/data-sync connector) must be implemented as its own package under `packages/<provider-package>/` and enabled from `apps/mercato/src/modules.ts` via that package. Do not add new external provider modules in `packages/core/src/modules/`.

**Applies to**: All new connector work and refactors of existing providers (for example, `gateway_*`, `carrier_*`, and sync connector modules), with UMES extension points per SPEC-041.

## Prefer canonical route paths over alias lists for custom APIs

**Context**: Payment and shipping endpoints were still using the legacy `api/<method>/...` layout, and shipping added alias matching because its public URL was kebab-case while the module id is snake_case.

**Problem**: That created two layers of indirection: legacy filesystem conventions plus multiple candidate URLs in the registry, which made standalone and generator debugging harder.

**Rule**: For custom APIs, prefer the standard `api/<segment>/route.ts` layout. If the public URL must differ from the generator default, declare one canonical `metadata.path` override on the route instead of alias lists or app-route special cases.

**Applies to**: Module API routes, generator path mapping, and any future public endpoint refactors.

## Do not diagnose unknown-total progress as broken SSE

**Context**: Data sync jobs were emitting `progress.job.updated` correctly through the same SSE bridge used by the working example page, but the top bar and run detail still looked frozen at `0%`.

**Problem**: Product imports often do not know `totalCount` up front. `ProgressService.updateProgress()` therefore kept `progressPercent` at `0`, so the UI rendered a static 0% bar even while `processedCount` was increasing in real time.

**Rule**: When a long-running job has no reliable total, treat it as **indeterminate progress** in the UI. Keep SSE/poll updates for `processedCount`, avoid showing `0% complete`, and preserve any available `totalEstimate` instead of discarding it in adapters.

**Applies to**: `packages/core/src/modules/data_sync/lib/sync-engine.ts`, provider adapters such as `packages/sync-akeneo/src/modules/sync_akeneo/lib/adapter.ts`, and any UI using `ProgressTopBar` or run-detail progress bars.

## Worker-emitted progress needs polling fallback even when SSE exists

**Context**: Example-page progress SSE worked, but bulk product operations and data sync progress in the top bar did not update live.

**Problem**: The DOM Event Bridge tap in `packages/events/src/modules/events/api/stream/route.ts` is process-local. Queue workers emit `progress.job.updated` in a different process, so those events do not reach the browser through SSE even though the `ProgressJob` database row updates correctly.

**Rule**: For progress UIs, use **SSE for immediacy** and **polling while active jobs exist** as the correctness path. Do not assume worker-emitted progress events will reach the browser unless the event bus is explicitly cross-process bridged for broadcast traffic.

**Applies to**: `packages/ui/src/backend/progress/useProgressSse.ts`, all worker-driven progress jobs (data sync, bulk delete, reindex, similar queue jobs), and any future SSE-based progress UI.

## Akeneo base-field imports must not fall back across locales or channels

**Context**: Akeneo product values were being resolved with a score-based matcher that could still pick a different locale or scope when the selected locale/channel did not exist.

**Problem**: German or other scoped Akeneo content leaked into the tenant's base Open Mercato fields, so a single-locale import silently mixed languages and channel variants instead of leaving the field empty.

**Rule**: When importing into non-translation Open Mercato fields, only accept the explicitly selected Akeneo locale/channel plus Akeneo's unlocalized or unscoped fallback entries. Never fall back to a different locale or channel just to fill a value.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts`, future translation import work, and any adapter that flattens layered external localized values into base fields.

## Akeneo media identifiers can be slash-delimited path params

**Context**: Akeneo media values looked like file paths (`6/7/7/...jpg`). The importer treated them as opaque codes and URL-encoded the entire string before calling `/api/rest/v1/media-files/{code}`.

**Problem**: Encoding the whole identifier as one segment changed the path semantics and caused false `media file ... was not found` failures, which then prevented attachments from being created and assigned.

**Rule**: For Akeneo media-file endpoints, preserve `/` path separators inside the media identifier and only encode each path segment individually. Treat these identifiers as route params, not as a single opaque slug.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts`, media download helpers, and any future Akeneo endpoint that accepts slash-delimited resource identifiers.

## Sync progress must count source records, not emitted side-effect items

**Context**: The Akeneo product adapter emits multiple import items per source product (for example product + default variant), but the sync engine was using `batch.items.length` as the user-facing processed count.

**Problem**: Progress showed inflated numbers like 1800 processed for a 1320-product Akeneo catalog, which made the run look stuck or inconsistent even when it was just finishing reconciliation after the last real source page.

**Rule**: When adapters emit derived records, they must report a separate source-level processed count, and the sync engine must use that value for progress. Batch/item counters may still track created/updated records separately, but user-facing progress should match the source system's entity count.

**Applies to**: `packages/core/src/modules/data_sync/lib/adapter.ts`, `packages/core/src/modules/data_sync/lib/sync-engine.ts`, Akeneo import batches, and any future adapter that explodes one external record into multiple local writes.

## Data-sync run detail should subscribe to its progress job, not just poll it

**Context**: The global progress bar already reacted immediately to `progress.job.*` events, but the data-sync run detail page still depended on a 4-second polling loop.

**Problem**: For fast or concurrent sync jobs, the run detail could look stale or inconsistent compared with the top bar, especially when multiple jobs from the same integration had generic names and users expected SSE-driven updates.

**Rule**: Any page centered around a specific `ProgressJob` should subscribe to `progress.job.updated|started|completed|failed|cancelled` for that job ID and use polling only as a recovery/backfill path. Also include enough job metadata or naming detail to distinguish concurrent runs of the same integration.

**Applies to**: `packages/core/src/modules/data_sync/backend/data-sync/runs/[id]/page.tsx`, progress payload serialization, and future job-specific run/detail pages.
