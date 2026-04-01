# Lessons

# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

## Standardize record-not-found as a dedicated page state in backend UI

**Context**: Record-backed backend pages evolved with mixed missing-record patterns. Some pages used `ErrorMessage`, some rendered custom centered `<div>` markup with plain text and a button, and some collapsed `notFound` and generic load failures into the same branch.

**Problem**: The UX became inconsistent across products, customers, auth, resources, sales, and similar modules. In some pages the missing-record path still lived too close to the form/detail rendering path, making it easy to keep rendering page chrome or controls when the record was gone.

**Rule**: For any record-backed backend detail or edit page, model `notFound` as a dedicated page state separate from generic `error`. When the requested record does not exist, return early and render a page-level state built on `ErrorMessage`, with a clear recovery action such as "Back to list". Do not render `CrudForm`, detail sections, tabs, or record actions in the not-found branch.

**Applies to**: `packages/ui`, `packages/ui/src/backend`, and any backend `[id]` page in `packages/core/src/modules/**/backend/**`.

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

## Keep standalone template module lists aligned with template package dependencies

**Context**: The standalone app template enabled `{ id: 'webhooks', from: '@open-mercato/webhooks' }` in `packages/create-app/template/src/modules.ts`, but `packages/create-app/template/package.json.template` did not install `@open-mercato/webhooks`.

**Problem**: `yarn install` succeeded, but `mercato generate` failed later because the generator resolved a package-backed module that was never installed in the standalone app.

**Rule**: Any time a package-backed module is added or kept enabled in `packages/create-app/template/src/modules.ts`, verify the matching npm package exists in `packages/create-app/template/package.json.template`. Review the template lockfile in the same change whenever dependency shape changes.

**Applies to**: `packages/create-app/template/src/modules.ts`, `packages/create-app/template/package.json.template`, template lockfiles, and standalone app smoke tests.

## Fresh standalone Yarn scaffolds must ship a runnable root workspace lockfile entry

**Context**: `create-mercato-app` advertised `yarn setup` as the first command, but the scaffold only shipped an empty `yarn.lock`.

**Problem**: Yarn 4 resolves package scripts through the lockfile. In a fresh scaffold, `yarn setup` failed before `scripts/setup.mjs` could call `yarn install` with `This package doesn't seem to be present in your lockfile`.

**Rule**: Standalone templates that expect a pre-install Yarn script to run must ship a templated `yarn.lock` containing the root `"{{APP_NAME}}@workspace:."` entry. Keep the standalone smoke test exercising at least one trivial Yarn script before the first install so the regression is caught immediately.

**Applies to**: `packages/create-app/template/yarn.lock.template`, `packages/create-app/src/index.ts`, and `scripts/test-create-app.ts`.

## Generated standalone app installs in CI must opt out of immutable lockfiles

**Context**: Snapshot parity scaffolds a fresh standalone app from `create-mercato-app` and then runs `yarn install` inside that generated directory.

**Problem**: On CI, Yarn enables immutable installs by default. Because the scaffold intentionally ships only a minimal root workspace `yarn.lock`, the first standalone `yarn install` needs to materialize the real lockfile and otherwise fails with `YN0028`.

**Rule**: When CI or smoke tests run the first `yarn install` inside a freshly scaffolded standalone app, set `YARN_ENABLE_IMMUTABLE_INSTALLS=0`. Do this only for the generated app install/add steps, not for the monorepo install.

**Applies to**: `.github/workflows/snapshot.yml`, `scripts/test-create-app.ts`, and `scripts/test-create-app-integration.ts`.

## Standalone scaffolding and generators must not assume monorepo-only paths

**Context**: Separately, the standalone `yarn generate` OpenAPI bundle still looked for `packages/shared`, `apps/mercato`, and `tsconfig.base.json`.

**Problem**: Newly scaffolded apps - `yarn generate` printed noisy OpenAPI bundle resolution errors before falling back.

**Rule**: For standalone app flows, do not hardcode monorepo paths; CLI generators must resolve app/package paths through the shared resolver (`getRootDir()`, `getAppDir()`, `getPackageRoot()`) instead of constructing `packages/*` or `apps/mercato/*` paths directly.

**Applies to**: `packages/create-app/**`, `packages/cli/**`, standalone app smoke tests, and any generator/bundler that runs inside installed npm packages.

## Store global event bus in `globalThis` to survive module duplication in dev

**Context**: `record_locks` notifications stopped while banners still worked. Banner logic uses direct API polling, but notifications depend on `emitRecordLocksEvent()` from `createModuleEvents()` and the global event bus wiring.

**Problem**: In dev (HMR/Turbopack), duplicated module instances can appear. One instance receives `setGlobalEventBus()` during bootstrap, another instance emits events. With module-local singleton only, emitted events can be dropped silently.

**Rule**: For process-wide runtime singletons used across package boundaries (event bus, similar registries), keep canonical reference in `globalThis` and use module-local variable only as fallback.

**Applies to**: `packages/shared/src/modules/events/factory.ts` and any shared runtime singleton relied on by module auto-discovery/subscriber pipelines.

## Feature-gated runtime helpers must use wildcard-aware permission matching

**Context**: ACL wildcard grants like `customer_accounts.*` correctly passed server-side checks, but several shared UI/runtime helpers still gated behavior with exact `includes` or `Set.has` checks.

**Problem**: Navigation, notification handlers, mutation guards, and command interceptors could silently disappear or stop running even though the user had a valid wildcard permission from RBAC.

**Rule**: Any feature-gated helper outside the core RBAC service must use the shared wildcard-aware matcher (`hasFeature` / `hasAllFeatures`) instead of ad hoc exact-match checks such as `features.includes(...)`, `set.has(...)`, or `every(...includes(...))`.

**Additional rule**: Do not assume every `granted` feature array is normalized to exact requested ids. Some flows return exact feature-check responses, while others pass through stored wildcard ACLs or resolved feature snapshots. Runtime helpers must treat all granted-feature arrays as wildcard-capable input.

**Applies to**: Navigation builders, injected menu filtering, notification dispatchers, mutation guards, command interceptors, and similar client/server ACL-driven registries.

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

## WeakSet-based circular reference detection drops shared (non-circular) object references

**Context**: The CLI OpenAPI generator (`packages/cli/src/lib/generators/openapi.ts`) used a `WeakSet` in `safeStringify` to detect circular references during JSON serialization. The `zodToJsonSchema` converter uses a `WeakMap` memo cache that returns the same JS object reference for identical Zod schema instances (e.g., `currencyCode` shared between quote and line item schemas).

**Problem**: The `WeakSet` treated shared-but-non-circular references as circular, dropping them on second encounter. This caused properties like `currencyCode` to vanish from nested schemas in the generated `openapi.generated.json`. The line item schema was missing required fields, which misled AI agents and broke API payload construction.

**Rule**: When detecting circular references in JSON serialization, use stack-based ancestor tracking (checking only the current path from root to node) instead of a `WeakSet` (which tracks all previously visited nodes globally). Shared references are legitimate and must be cloned, not dropped.

**Applies to**: Any serialization code that processes object graphs with shared references (common in Zod schema conversions, AST tools, and dependency graphs).

## Inject TypeScript types into LLM tool descriptions for correct API payloads

**Context**: The AI Code Mode tools (`search` + `execute`) require the LLM to construct API payloads. When the LLM must query a separate tool to discover schema fields and then mentally translate a compact JSON format, it frequently constructs wrong payloads and enters debug spirals (20+ tool calls, 50+ API requests).

**Problem**: Without inline type information, the LLM guesses field names and structures, sends bad payloads, gets 400 errors, then experiments with variations — wasting tokens and user time.

**Rule**: For LLM-facing tools that construct structured API calls, pre-generate compact TypeScript type stubs from the OpenAPI spec at startup and inject them directly into the tool description. This mirrors Cloudflare's `generateTypes()` pattern. The LLM sees the correct types immediately without needing an extra discovery step.

**Applies to**: Any AI tool that requires the LLM to construct structured payloads (API calls, database queries, form submissions).

## Format Zod validation errors for LLM consumption

**Context**: When the API returns 400 errors with raw Zod validation output (nested `issues[]` arrays, `fieldErrors` maps, or raw arrays), the LLM struggles to interpret the error structure and extract actionable fix instructions.

**Problem**: The LLM sees verbose JSON like `[{"code":"invalid_type","expected":"string","path":["lines",0,"currencyCode"]}]` and may not correctly identify which field to fix, leading to trial-and-error debugging.

**Rule**: Format validation errors into a concise human-readable string before returning to the LLM. Handle all Zod error formats (v3 `issues[]`, v4 `fieldErrors`/`formErrors`, raw arrays) and produce fix instructions like `"Validation failed — lines[0].currencyCode: expected string. Fix the listed fields and retry."` Fall back to `JSON.stringify` for unrecognized formats.

**Applies to**: Any AI-facing API wrapper that surfaces validation errors to an LLM agent.

## MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing

**Context**: `@PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })` configures PostgreSQL to generate UUIDs at INSERT time. When `em.create(Entity, data)` is called without an explicit `id`, the entity's `id` field is `undefined` until `em.flush()` executes the INSERT.

**Problem**: In `sales/commands/documents.ts`, the quote/order creation code called `em.create(SalesQuote, { ... })` without providing an `id`, then immediately referenced `quote.id` when re-validating inline line items via `quoteLineCreateSchema.parse({ quoteId: quote.id })`. Since `quote.id` was `undefined`, Zod validation failed with "quoteId: Invalid input: expected string, received undefined" — silently breaking inline line creation for both quotes and orders.

**Rule**: When creating an entity and immediately referencing its PK (before flush), generate the UUID client-side via `crypto.randomUUID()` and pass it explicitly: `em.create(Entity, { id: randomUUID(), ... })`. This ensures the PK is available immediately for child entity creation.

**Applies to**: Any `em.create()` call where the entity's PK is referenced before `em.flush()`, especially parent-child patterns where children need the parent's ID.

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

## Meilisearch container healthchecks must probe IPv4 explicitly

**Context**: Standalone full-app Docker scaffolds used `wget http://localhost:7700/health` for the Meilisearch healthcheck, while other compose files used `curl`.

**Problem**: In `getmeili/meilisearch:v1.11`, `wget` resolves `localhost` to IPv6 `::1` first, but Meilisearch listens on IPv4 (`0.0.0.0:7700`). The container is healthy but Docker marks it `unhealthy`, which blocks dependent services.

**Rule**: Use `curl -fsS http://127.0.0.1:7700/health` for Meilisearch container healthchecks instead of `wget` or `localhost`.

**Applies to**: Root `docker-compose*.yml`, standalone app templates in `packages/create-app/template/`, and any future dev/test container compose files that run Meilisearch.

## Docker entrypoints must verify required binaries, not just non-empty node_modules

**Context**: The standalone app dev entrypoint only checked whether `node_modules` existed and was non-empty before skipping `yarn install`.

**Problem**: A stale named volume from another app can leave `node_modules` populated but incomplete, with `node_modules/.bin/mercato` and `@open-mercato/cli` missing. Startup then fails later with `/bin/sh: mercato: not found`.

**Rule**: Docker startup scripts must verify the specific required package/binary for the next command (for example `node_modules/@open-mercato/cli` and `node_modules/.bin/mercato` before `yarn initialize`), not just the presence of a non-empty `node_modules` directory.

**Applies to**: `packages/create-app/template/docker/scripts/*.sh` and any future container entrypoints that rely on installed CLI binaries.

## Docker initialization should treat the existing-users CLI abort as already initialized

**Context**: The CLI intentionally aborts `init` when the database already contains users, printing `Initialization aborted: found N existing user(s) in the database.`

**Problem**: Docker first-run boot paths used marker files only. When the marker was missing but the database was already initialized, containers exited instead of continuing with migrations and startup.

**Rule**: Docker init/startup wrappers must treat the specific existing-users initialization abort as a successful already-initialized state: run migrations, write the init marker, and continue boot. Do not broaden this to ignore other init failures.

**Applies to**: `docker/scripts/*.sh`, root `docker-compose.fullapp*.yml`, and standalone template Docker startup files in `packages/create-app/template/docker/**`.

## Standalone scaffolds must pin the same Yarn version as the monorepo

**Context**: `node:24-alpine` exposes Yarn `1.22.22` by default. The monorepo uses Yarn `4.12.0` via the root `packageManager` field and explicit Corepack activation in some environments.

**Problem**: The standalone template had no `packageManager` field and its Dockerfile only ran `corepack enable`, so Docker-based standalone flows could stay on Yarn 1 instead of Yarn 4.

**Rule**: Keep `packages/create-app/template/package.json.template` aligned with the monorepo `packageManager` version and have the template Dockerfile explicitly run `corepack prepare yarn@<version> --activate`.

**Applies to**: `packages/create-app/template/package.json.template`, `packages/create-app/template/Dockerfile`, and any scaffolded environment that relies on Corepack.

## Compose startup commands must not hard-depend on newly added image scripts

**Context**: Fullapp compose startup was updated to call `/app/docker/scripts/init-or-migrate.sh` directly.

**Problem**: If a user updates `docker-compose.fullapp.yml` but starts an older image without `--build`, container startup fails immediately because the new helper script is not present in that image.

**Rule**: When a compose command references a newly added in-image helper, include a shell fallback path so older images can still boot until the next rebuild.

**Applies to**: Root/template `docker-compose.fullapp*.yml` and similar Docker startup commands that evolve independently from image rebuilds.

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

## Sanitize generated component override entries before runtime use

**Context**: Enterprise security login overrides caused `/login` SSR failures because the server-side override registry received at least one malformed entry from generated component overrides, and `getComponentOverrides()` assumed every item had `target.componentId`.

**Rule**: Shared runtime registries fed by generated/module-loaded plugin arrays must defensively filter malformed or `undefined` entries both at registration time and before lookup. Never assume SSR imports across client/server module boundaries preserve registry item shape.

**Applies to**: `packages/shared/src/modules/widgets/component-registry.ts` and any similar generated registries that are consumed during Next.js SSR/bootstrap.

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

## Akeneo variant reuse must be scoped to the current product, not global SKU matches

**Context**: The importer used SKU fallback when an Akeneo variant external-ID mapping was missing.

**Problem**: If a stale or orphaned Akeneo variant row with the same SKU already existed under a different product, the importer could reuse that wrong variant ID. Price creation then failed with `Variant does not belong to the provided product`, even though the Akeneo source data itself was valid.

**Rule**: Variant fallback matching must always be scoped to the current product. A missing external-ID mapping is not enough reason to reuse a same-SKU variant from another product.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts`, Akeneo re-import logic, and any sync adapter that falls back from stable external IDs to local natural keys.

## Force-delete import tools must include orphaned imported rows, not only mapped rows

**Context**: The Akeneo "Force delete all imported products" action originally found products only through `sync_external_id_mappings`.

**Problem**: Earlier bad imports could leave Akeneo-origin products behind after mappings were lost or overwritten. The delete tool reported success but still left imported rows in the catalog, which then polluted later re-imports and caused duplicate-SKU conflicts.

**Rule**: Destructive importer cleanup must discover imported rows from durable record metadata as well as external-ID mapping tables. Mapping tables alone are not a complete source of truth after failed or partial syncs.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/delete-imported-products.ts` and any future cleanup/reset actions for integration-owned data.

## Variant hero media should be written after importer flush-heavy work

**Context**: Akeneo variant images were being downloaded and attached to the correct variant records, but some variants still ended the import with `default_media_id = null`.

**Problem**: Later ORM flushes in the same import path can leave the attachment in place while writing an older in-memory variant snapshot back over the hero-media fields.

**Rule**: When an importer creates variant attachments and also performs later flush-heavy work, persist the variant hero-media pointer as the final variant write in that path. Attachment assignment and hero-media selection are separate pieces of state and both must survive the last flush.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts` and any importer that assigns attachments plus a default/hero attachment on the same entity in one transaction flow.

## Env-backed integration presets belong in the provider module, not core

**Context**: Akeneo needed a way to come up preconfigured on fresh installs from deployment environment variables, while still supporting a manual rerun later.

**Problem**: Pushing provider-specific bootstrap logic into core integration or data-sync modules would couple generic infrastructure to one connector and make every future provider preset harder to maintain.

**Rule**: Provider-specific env bootstrapping should live in the provider package itself, exposed through that module's own `setup.ts` and `cli.ts`, and should reuse the same helper for automatic tenant init and manual reruns.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts`, `packages/sync-akeneo/src/modules/sync_akeneo/cli.ts`, and future integration packages that need env-driven bootstrap.

## Integration packages must use decryption-aware find helpers for all entity reads

**Context**: The Akeneo package had accumulated a mix of `findWithDecryption` usage and raw `em.find` / `em.findOne` reads across routes, setup presets, cleanup jobs, and importer internals.

**Problem**: Even when the currently-read fields are not encrypted, raw ORM reads bypass encryption-map handling and create silent regressions once entity fields become encrypted later.

**Rule**: In integration/provider modules, all entity reads should default to `findWithDecryption` / `findOneWithDecryption`; treat raw `em.find` / `em.findOne` as a bug unless there is a deliberate low-level reason that is documented inline.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/**/*` and future integration packages reading tenant-scoped entities.

## Optional native dependencies must report load failures accurately

**Context**: The cache package warned that SQLite was unavailable because of a "missing dependency: better-sqlite3", even though the package was installed.

**Problem**: The actual failure was a stale native build of `better-sqlite3` after a Node.js upgrade. The misleading warning sent debugging toward dependency declarations instead of the ABI mismatch and rebuild.

**Rule**: For optional native dependencies, preserve and classify the original load error. Do not collapse ABI/version/build failures into "missing dependency" messages. When loading native modules from package runtimes, prefer `createRequire(import.meta.url)` over dynamic `import()` if it is more reliable for CJS/native addons.

**Applies to**: `packages/cache/src/strategies/sqlite.ts`, `packages/cache/src/service.ts`, and any package with optional native providers.

## New progress UI must use SSE, not fresh polling loops

**Context**: The Akeneo "first full import" widget originally tracked its sequence state with `setTimeout` polling against a status endpoint, even though the platform already broadcasts `progress.job.*` events to the browser.

**Problem**: Browser-local polling made the feature look active without proving a durable backend job existed, added stale state paths on refresh, and reintroduced a legacy pattern the rest of the progress system is moving away from.

**Rule**: When a feature already has a real `ProgressJob`, drive the UI from `progress.job.*` SSE events and only use one-shot fetches for initial hydration or reconnect recovery. Do not add new timer-based progress polling loops in widgets or backend pages.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/widgets/injection/akeneo-config/widget.client.tsx` and future progress-driven UI in integrations or data sync.

## Browser SSE bridges must work across worker and web processes

**Context**: Akeneo product imports were updating `ProgressJob` rows and even the top bar sometimes, but the browser SSE stream often showed only heartbeats while worker-driven product progress was actively changing in the database.

**Problem**: The DOM Event Bridge only tapped in-process event emits. Queue workers emitted `progress.job.*` from a different Node process, so the web server's `/api/events/stream` never saw those updates live. UI built on SSE then looked stalled or inconsistent, and frontend polling crept back in as a workaround.

**Rule**: If server events can originate from workers, the event bridge must include a cross-process transport. Do not assume an in-memory tap is enough for SSE delivery. Also, orchestration widgets that wrap child sync runs should subscribe to the active child `progressJobId`, not only to a slower wrapper job.

**Applies to**: `packages/events/src/bus.ts`, `packages/events/src/modules/events/api/stream/route.ts`, `packages/sync-akeneo/src/modules/sync_akeneo/lib/first-import.ts`, and worker-backed progress UI across the platform.

## Keep standalone agentic content in sync with module conventions

**Context**: `packages/create-app/agentic/` contains purpose-built AI coding tool configurations for standalone Open Mercato apps (AGENTS.md, CLAUDE.md, entity-migration hooks, Cursor rules, Codex enforcement rules). This content is separate from the monorepo's `.ai/` folder.

**Problem**: When module conventions change (entity lifecycle, auto-discovery paths, CLI commands, `yarn generate` behavior), the standalone agentic content can drift, causing AI tools to give incorrect guidance or hooks to miss new patterns.

**Rule**: When changing module conventions that affect standalone app developers — entity/migration workflow, auto-discovery file conventions, CLI commands, `yarn generate` behavior — also update the corresponding content in `packages/create-app/agentic/` (shared AGENTS.md.template, tool-specific rules/hooks).

**Applies to**: `packages/create-app/agentic/shared/`, `packages/create-app/agentic/claude-code/`, `packages/create-app/agentic/codex/`, `packages/create-app/agentic/cursor/`.

## Detail sections must route writes through page-level guarded mutations

**Context**: Customer detail sections introduced canonical interaction writes in local hooks and components while the surrounding backend pages already had mutation-injection context for record locks and retry flows.

**Problem**: Raw `apiCall` or CRUD-helper writes from detail sections bypass `useGuardedMutation`, so lock/conflict hooks never see those saves. Separately, showing flash messages in both the data hook and the section UI produces duplicate toasts for one mutation.

**Rule**: In backend detail pages, the page owns `useGuardedMutation` and passes a guarded mutation runner into child sections. Data hooks should execute the network call and refresh state, while the section or presenter owns user-facing flash messages so each mutation emits one toast.

**Applies to**: `packages/core/src/modules/customers/components/detail/**/*`, customer detail pages, and any future backend section that performs manual writes outside `CrudForm`.

## Workspace packages with backend pages must build and export deep TSX entrypoints

**Context**: The new `@open-mercato/webhooks` workspace package exposed backend pages through generated imports like `@open-mercato/webhooks/modules/webhooks/backend/webhooks/page`, but the package build only compiled `src/**/*.ts` and the export map stopped before the deepest generated paths.

**Problem**: `yarn build:app` failed even though generation succeeded, because the generated app imported real package entrypoints that were neither emitted to `dist/` nor resolvable through `package.json` exports.

**Rule**: Any workspace package that contributes auto-discovered backend/frontend pages must compile both `.ts` and `.tsx` sources into `dist/`, and its export map must cover the deepest generated import paths used by `modules.generated.ts`.

**Applies to**: `packages/webhooks/build.mjs`, `packages/webhooks/package.json`, and future feature packages that expose generated page modules.

## MikroORM string defaults must be plain values, not pre-quoted SQL fragments

**Context**: The webhooks module declared text defaults as `"'pending'"`, `"'POST'"`, and `"'http'"` in entity metadata.

**Problem**: MikroORM treated those values as literal strings and generated migration SQL with doubled quotes like `default ''pending''`, which broke `yarn initialize` when PostgreSQL tried to create the tables.

**Rule**: For `@Property(... default: ...)` on string/text columns, pass the plain value such as `'pending'` or `'POST'`. Use `defaultRaw` only when you intentionally need a database expression.

**Applies to**: `packages/webhooks/src/modules/webhooks/data/entities.ts` and future MikroORM entities with string defaults.

## Client injection hooks must tolerate late registry registration

**Context**: The integrations detail page relied on provider-injected tabs for webhook settings and aggregated logs. In the browser, generated injection tables and widgets were present, but some pages could still render without injected content on the first client pass.

**Problem**: `useInjectionWidgets()` and `useInjectionSpotEvents()` could read the injection registry before client bootstrap finished registering generated tables/widgets, cache an empty result, and never retry. That left valid widgets invisible until a hard refresh or unrelated rerender.

**Rule**: Client-side injection hooks must react to registry registration changes. When bootstrap registers core injection widgets/tables, invalidate loader caches and notify hooks so they reload instead of permanently caching an empty registry snapshot.

**Applies to**: `packages/shared/src/modules/widgets/injection-loader.ts`, `packages/ui/src/backend/injection/InjectionSpot.tsx`, and any future client hook that reads generated registries during hydration.

## New shared deep import paths should get explicit export-map entries

**Context**: A new shared utility under `@open-mercato/shared/lib/events/patterns` built correctly, but sibling workspace tests failed to resolve it through the package name.

**Problem**: Generic wildcard export rules are not always enough for every tool in the workspace, especially test runners resolving package subpaths across linked workspaces. That turns a valid refactor into a package-resolution failure.

**Rule**: When adding a new shared utility intended for cross-package imports, add an explicit `package.json` export entry for the new subpath instead of relying only on broad wildcard export patterns.

**Applies to**: `packages/shared/package.json` and future cross-package utilities added under new `@open-mercato/shared/lib/*` paths.
## Use `safeExtend()` when composing refined Zod object schemas

**Context**: Checkout pay-link validators extended a schema that already contained `superRefine(...)` rules.

**Problem**: Zod v4 throws at runtime when `.extend()` is used on object schemas that contain refinements. This broke both OpenAPI generation and app initialization with `Object schemas containing refinements cannot be extended`.

**Rule**: Any time a Zod object schema has refinements (`refine`, `superRefine`, similar), compose follow-up schemas with `.safeExtend()` instead of `.extend()`.

**Applies to**: Module validators, generated OpenAPI bundling, bootstrap/init code paths, and any schema reuse chain built on refined objects.

## Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist

**Context**: `@open-mercato/checkout` emitted `import "./commands"` into dist because its build post-processing only rewrote `from` and dynamic imports. `@open-mercato/gateway-stripe` declared `"watch": "node watch.mjs"` without a `watch.mjs` file.

**Problem**: Dev boot failed on unsupported directory ESM imports, and `yarn watch:packages` aborted immediately on the missing watch entrypoint.

**Rule**: For package-local build scripts, handle all three relative import forms when fixing ESM output: static `from`, dynamic `import(...)`, and bare side-effect `import "..."`. If a package exposes a `watch` script, keep a real `watch.mjs` entrypoint committed alongside `build.mjs`.

**Applies to**: Workspace packages with custom `build.mjs` / `watch.mjs` tooling and any new ESM package added to the monorepo.

## Use canonical generated entity ids, not shortened ad-hoc aliases

**Context**: Checkout used shortened ids like `checkout:link` and `checkout:transaction`, while the generated canonical ids for its ORM entities are `checkout:checkout_link` and `checkout:checkout_transaction`.

**Problem**: Query/index/search/encryption helpers rely on canonical entity ids to infer table names and registry metadata. The shortened aliases pushed reindexing toward `links` instead of `checkout_links` and silently diverged from the generated contract.

**Rule**: For ORM-backed entities, use the generated canonical entity ids consistently across CRUD indexers, search config, translations, encryption defaults, and custom-entity declarations. Do not invent shorter aliases unless the platform explicitly supports them everywhere.

**Applies to**: Any module that participates in generated entity ids, query index/search, translations, encryption maps, or custom field registration.

## Prefer relative intra-package imports inside package CLI/runtime entrypoints

**Context**: The core entities CLI imported its own package internals through `@open-mercato/core/...` aliases.

**Problem**: Dist-time ESM resolution became brittle in initialization flows and failed to resolve package-internal files that were present locally.

**Rule**: Inside a package's own CLI/runtime entrypoints, prefer local relative imports for same-package modules instead of going back through the package alias, unless that alias path is explicitly part of the public runtime contract.

**Applies to**: `cli.ts`, bootstrap helpers, package-local scripts, and other runtime entrypoints executed directly from dist.

## Global registries in publishable packages must use `globalThis`, not module-local state

**Context**: Standalone `create-mercato-app` loaded `@open-mercato/shared/lib/db/mikro` through multiple server chunk/module instances while the monorepo dev app used a single source-tree instance.

**Problem**: Bootstrap registered ORM entities in one module instance, but `/api/events/stream` created a request container through another instance. Because the entity registry lived in a module-local variable, the second instance saw an empty registry and crashed with `[Bootstrap] ORM entities not registered`.

**Rule**: Any publishable cross-package registry that must be visible across bootstrap, API routes, and request containers must persist via `globalThis` with a stable key. Do not store bootstrap-critical registries only in module-local variables.

**Applies to**: ORM/entity registries, DI registrars, module registries, and other standalone-sensitive bootstrap state in `@open-mercato/*` packages.
