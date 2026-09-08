# `example` surface map

Human navigation view of [`surface-inventory.json`](surface-inventory.json). Same rows, same statuses — the JSON is the machine-readable source of truth.

Read [`../README.md`](../README.md) first if you have not: this module is **source-present and runtime-disabled**, must not be copied wholesale, and every identifier must be renamed when you lift a capability out of it.

## How to read this

- **Capability** — the stable `capabilityId` you look up in the JSON.
- **Demonstrates** — what the linked file actually proves.
- **Source** — the exact file(s). Open only these.
- **Status** — `readable` (passed the reference-quality gate) or `qa-only` (present and working, but fails a current project rule — do not copy).

Test paths are shown as plain code, not links: `__tests__/**` and `__integration__/**` are repository-only evidence and are filtered out of emitted apps.

Rule owners named per row own the *normative* rule. This module owns only *one compiling way to satisfy it*.

---

## Module foundation

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `module.metadata` | `ModuleInfo` export; everything else is found by file convention | [`../index.ts`](../index.ts) | readable |
| `module.acl-features` | Feature ids with `dependsOn` chains | [`../acl.ts`](../acl.ts) | readable |
| `module.setup-role-features` | `ModuleSetupConfig` default role grants, plus all three seeding hooks used for the job only each one can do — `onTenantCreated` (no container: pure-`em` custom-entity install), `seedDefaults` (container: scoped reference records via `dataEngine`, deterministic upserting ids), `seedExamples` (skipped by `--no-examples`: demo Todos through the shared CLI seeder) | [`../setup.ts`](../setup.ts), [`../lib/exampleSeeds.ts`](../lib/exampleSeeds.ts) | readable |
| `module.di-registration` | `register(container)` doing both halves of module DI: the module's own scoped Awilix service (`asFunction(...).scoped()`) into *this* container, and gateway / carrier / webhook adapters into module-external registries | [`../di.ts`](../di.ts), [`../lib/todoSummaryService.ts`](../lib/todoSummaryService.ts) | readable |
| `module.cli-command` | Module CLI entrypoint, custom-entity install, idempotent seeding | [`../cli.ts`](../cli.ts) | readable |
| `module.i18n-catalogs` | Per-module locale catalogs for `useT()` / `resolveTranslations()` | [`../i18n/en.json`](../i18n/en.json), [`../i18n/de.json`](../i18n/de.json), [`../i18n/es.json`](../i18n/es.json), [`../i18n/pl.json`](../i18n/pl.json) | readable |
| `module.translatable-fields` | `<module>:<entity>` → translatable field names; declaring the file injects the Translation Manager into that entity's CrudForm header spot | [`../translations.ts`](../translations.ts) | readable |
| `module.generator-plugin` | Type-only generator declaration → deterministic reference-index output → bootstrap registration in a duplicate- and path-validating consumer | [`../generators.ts`](../generators.ts), [`../reference-index.ts`](../reference-index.ts), [`../lib/module-reference-index.ts`](../lib/module-reference-index.ts) | readable |

Evidence: `__tests__/acl-dependencies.test.ts`, `__tests__/translations.test.ts`, `__tests__/setup-seeding.test.ts`, `__tests__/di-registration.test.ts`, `lib/__tests__/module-reference-index.test.ts`, `__integration__/TC-EXAMPLE-016-generator-plugin.spec.ts`.

Rule owners: `om-module-scaffold`, `om-integration-builder` (DI adapters).

## Cache

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `runtime.tenant-scoped-cache` | Cache-aside read whose logical key carries tenant **and** organization, `runWithCacheTenant` around every backend call, a cached value that re-asserts its own scope on read, a bounded TTL, and tag invalidation | [`../lib/todoSummaryCache.ts`](../lib/todoSummaryCache.ts), [`../lib/todoSummaryService.ts`](../lib/todoSummaryService.ts), [`../api/todos/summary/route.ts`](../api/todos/summary/route.ts), [`../subscribers/invalidate-todo-summary.ts`](../subscribers/invalidate-todo-summary.ts) | readable |

Three things are worth copying and one is worth understanding.

**Copy**: the scope never comes from the request — a caller-supplied tenant or organization would become part of the cache key and let one caller both populate and read another scope's entry. The subscriber uses the wildcard `example.todo.*`, so a fourth write path cannot be added without invalidating. And it runs from `flushOrmEntityChanges`, which fires **after** the domain write commits, which is the ordering the cache package's own consistency rule requires.

**Understand**: the entry is tagged `crud:example.todo:tenant:<id>:org:<id>:collection`, which is not a name this module invented. `makeCrudRoute` derives its cache resource from `events: { module, entity }`, so the Todo route's resource is exactly `example.todo`, and `buildCollectionTags` from `@open-mercato/shared/lib/crud/cache` builds the tag. Reusing it means the platform's own post-commit `invalidateCrudCache` drops this entry too whenever `ENABLE_CRUD_API_CACHE` is on, without the module reimplementing tag naming. `lib/__tests__/todoSummaryCache.test.ts` pins that derivation rather than trusting the comment.

The subscriber is `persistent: false`, so under the default process-local memory strategy peers converge on the TTL; a shared backend (`CACHE_STRATEGY=redis`) makes the single `deleteByTags` authoritative for the deployment.

Evidence: `lib/__tests__/todoSummaryCache.test.ts`, `__tests__/invalidate-todo-summary.test.ts`, `api/__tests__/todos.summary.test.ts`.

Rule owner: `om-module-scaffold`.

## Data model

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `data.entities` | UUID PKs, snake_case columns, `tenant_id`/`organization_id`, `created_at`/`updated_at`/`deleted_at`, no cross-module relations | [`../data/entities.ts`](../data/entities.ts) | readable |
| `data.validators` | Zod create/update/list schemas, `z.infer` types, shared enum schema | [`../data/validators.ts`](../data/validators.ts) | readable |
| `data.custom-fields` | `ce.ts` custom entities and field kinds: integer, select, boolean, multi-text tags, markdown, `optionsUrl`, listbox, attachments, defaults, validation rules | [`../ce.ts`](../ce.ts) | readable |
| `data.migrations` | Generated SQL migrations — an initial `create table` and a later additive `alter table ... add column` — plus the module-scoped ORM snapshot that `yarn db:generate` diffs against | [`../migrations/Migration20251030150038.ts`](../migrations/Migration20251030150038.ts), [`../migrations/Migration20260226161000_example.ts`](../migrations/Migration20260226161000_example.ts), [`../migrations/Migration20260804120546_example.ts`](../migrations/Migration20260804120546_example.ts), [`../migrations/.snapshot-open-mercato.json`](../migrations/.snapshot-open-mercato.json) | readable |
| `data.encryption-map` | `defaultEncryptionMaps` for one at-rest-encrypted column, and every read/write path the declaration forces: explicit `encryptEntityPayload` before `nativeUpdate` (no ORM hooks fire there), `findOneWithDecryption` for undo pre-images | [`../encryption.ts`](../encryption.ts), [`../data/entities.ts`](../data/entities.ts), [`../commands/todos.ts`](../commands/todos.ts) | readable |
| `data.entity-extensions` | `EntityExtension` linking the customers base entity to this module's priority entity by FK-id join keys instead of a cross-module ORM relation, with the `table` override the extension join needs. **Declaration-only** — see the note below | [`../data/extensions.ts`](../data/extensions.ts) | readable |

Evidence: `__tests__/encryption-search-contract.test.ts`, `commands/__tests__/todos.notes-encryption.test.ts`, `__tests__/entity-extensions.test.ts`.

Rule owner: `om-data-model-design` (`data.entity-extensions`: `om-system-extension`).

`data.entity-extensions` has **no runtime call site anywhere in the repository, by design of what the platform supports today**, and the row does not claim one. Nothing passes `includeExtensions` to a query outside two query-engine unit tests; `BasicQueryEngine`'s extension join adds a `LEFT JOIN` with no projection and no filterable or sortable alias, so a caller receives no extension data from it; and `HybridQueryEngine` — the implementation `query_index/di.ts` registers as `queryEngine` — has no `includeExtensions` handling at all outside its basic-engine fallback. Read the file for the declaration shape, not for a read path.

## Search

An encrypted column changes what search can do with it, and the two files below are the two halves of that answer.

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `search.module-config` | `SearchModuleConfig` for one entity: `buildSource` + `checksumSource`, `formatResult`, `resolveUrl`, per-entity `aclFeatures`, and a `fieldPolicy` that whitelists only plaintext columns as `searchable` and puts the encrypted column in `excluded` | [`../search.ts`](../search.ts) | readable |
| `search.vector-config` | `VectorModuleConfig` for the Todo entity with deterministic plaintext source/checksum builders, translated presentation, a deep link, and encrypted notes excluded from embeddings | [`../vector.ts`](../vector.ts) | readable |
| `search.encrypted-column-list-filter` | Text search over an encrypted column resolved from the hashed `search_tokens` index and narrowed to ids, instead of an `$ilike` that would compare a plaintext pattern against ciphertext; `matched: false` is read fail-closed | [`../api/todos/route.ts`](../api/todos/route.ts) | readable |

The encrypted `notes` column is therefore: **not exported to CSV**, **not projected on grid pages** (the query engine decrypts per row, so a 50-row page would pay 50 decryptions nobody renders), and **searchable through a plain `$ilike`** that the query engine rewrites into a hashed `search_tokens` lookup — the indexer runs `decryptIndexDocForSearch` before tokenizing, so `fieldPolicy` excluding the field costs no reachability. On **sorting**, be precise about what the module does and does not do: `notes` is absent from `sortFieldMap`, but that is documentation rather than enforcement — the CRUD factory falls through to the raw field name for an unmapped sort field, so `?sortField=notes` still reaches the engine, which recognises the column as encrypted and routes it to a decrypt-then-sort-in-memory path that is correct but row-capped. Blocking it would need an explicit sort allowlist.

Evidence: `__tests__/encryption-search-contract.test.ts`, `api/__tests__/todos.encrypted-search.test.ts`.

Rule owners: `om-module-scaffold` (search config), `om-data-model-design` (encrypted read paths).

## API

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `api.crud-factory` | The smallest complete `makeCrudRoute`: per-method ACL, ORM/scope/soft-delete binding, list schema + sort map, `mapToEntity`/`applyToEntity`, scoped cross-module cache invalidation hooks | [`../api/customer-priorities/route.ts`](../api/customer-priorities/route.ts) | readable |
| `api.crud-query-engine-custom-fields` | Query-engine list fields, `cf:*` projection and filtering, per-request custom-field discovery published on the request context, command-backed actions, CSV export config | [`../api/todos/route.ts`](../api/todos/route.ts) | readable |
| `api.openapi` | Module OpenAPI factory over the shared CRUD OpenAPI helpers | [`../api/openapi.ts`](../api/openapi.ts) | readable |
| `api.custom-route` | Hand-written route: own request container, cookie auth, query-engine read | [`../api/organizations/route.ts`](../api/organizations/route.ts) | readable |
| `api.option-source-routes` | Backends for `optionsUrl` on tags/listbox custom fields | [`../api/tags/route.ts`](../api/tags/route.ts), [`../api/assignees/route.ts`](../api/assignees/route.ts), [`../api/notifications/route.ts`](../api/notifications/route.ts) | readable |
| `api.interceptors` | Exact-route and wildcard interceptors: rejection, timeout, thrown error, query rewrite, cross-module `?ids=` narrowing, `after` response merge via metadata | [`../api/interceptors.ts`](../api/interceptors.ts) | readable |

Evidence: `__integration__/TC-UMES-004.spec.ts`, `__integration__/TC-UMES-021.spec.ts`, `api/__tests__/tags.tenant-scope.test.ts`, `api/__tests__/todos.request-scope.test.ts`.

Rule owners: `om-module-scaffold`, `om-system-extension` (interceptors).

## Commands, events, subscribers

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `commands.write` | Registered command handlers, Zod parsing, custom-field extraction, `ensureScope` tenant/org enforcement, `prepare` snapshots, CRUD side effects, fork-isolated native update | [`../commands/todos.ts`](../commands/todos.ts) | readable |
| `commands.undo-redo` | `isUndoable`, `captureAfter`, translated `buildLog`, `buildChanges` diffs incl. custom fields, scope-validating undo, `makeCreateRedo` | [`../commands/todos.ts`](../commands/todos.ts) | readable |
| `commands.interceptors` | `beforeExecute` → `afterExecute` state hand-off through the interceptor metadata bag | [`../commands/interceptors.ts`](../commands/interceptors.ts) | readable |
| `events.typed-definitions` | `createModuleEvents` with an `as const` table, typed emitter, event-id union, `clientBroadcast` | [`../events.ts`](../events.ts) | readable |
| `events.crud-indexer-bridge` | `CrudEventsConfig` + `CrudIndexerConfig` shared by the command module and the CRUD route | [`../commands/todos.ts`](../commands/todos.ts) | readable |
| `events.sync-subscribers` | Before-create payload rewrite, before-update rejection with status, non-blocking after-delete | [`../subscribers/auto-default-priority.ts`](../subscribers/auto-default-priority.ts), [`../subscribers/prevent-uncomplete.ts`](../subscribers/prevent-uncomplete.ts), [`../subscribers/audit-delete.ts`](../subscribers/audit-delete.ts) | readable |
| `events.ephemeral-subscriber` | `persistent: false` subscriber resolving a service from the DI context | [`../subscribers/example-event.ts`](../subscribers/example-event.ts) | readable |
| `events.portal-broadcast` | An event declared `portalBroadcast: true` **plus the subscriber that emits it** — the Portal Event Bridge's twin of `clientBroadcast` | [`../events.ts`](../events.ts), [`../subscribers/announce-todo-to-portal.ts`](../subscribers/announce-todo-to-portal.ts) | readable |

Three decisions in the portal row are the copyable part, and none of them are visible from the flag alone.

**The announcement gets its own entity segment.** The internal writes are `example.todo.*` and this module already runs a wildcard subscriber on that pattern, so naming the announcement `example.todo.announced` would have made every write re-enter the subscriber that produced it. `example.todo_announcement.published` cannot match `example.todo.*` under the platform's single-segment matcher, and `__tests__/announce-todo-to-portal.test.ts` asserts that against `matchEventPattern` itself rather than against a comment.

**Nothing staff-authored goes on the wire.** The payload is `{ todoId, tenantId, organizationId, action }`. The todo's title is staff-written and its `notes` column is encrypted at rest; a portal broadcast reaches customers, which is the wrong place to discover either. The projection is a pure exported function so the field whitelist is asserted, not assumed.

**An unscoped write produces nothing.** `matchesAudience` in `customer_accounts/api/portal/events/stream.ts` drops a payload with no `tenantId`, so emitting one would only put an unaddressable record on the bus. The subscriber returns instead.

Evidence: `commands/__tests__/todos.update.test.ts`, `commands/__tests__/todos.prepare-scope.test.ts`, `commands/__tests__/todos.undo.test.ts`, `__tests__/announce-todo-to-portal.test.ts`, `__integration__/TC-UMES-003.spec.ts`, `__integration__/TC-UMES-006-mutation-lifecycle.spec.ts`, `__integration__/TC-EXAMPLE-002-query-index-failure.spec.ts`.

Rule owners: `om-data-model-design` (commands, events/indexer), `om-system-extension` (interceptors, subscribers).

## Backend UI

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `ui.page-shell` | Server-rendered `Page`/`PageHeader`/`PageBody`; `page.meta.ts` guards, nav group/order, icon token, breadcrumb with `labelKey` | [`../backend/todos/page.tsx`](../backend/todos/page.tsx), [`../backend/todos/page.meta.ts`](../backend/todos/page.meta.ts), [`../backend/page.tsx`](../backend/page.tsx), [`../backend/page.meta.ts`](../backend/page.meta.ts) | readable |
| `ui.datatable` | `DataTable` client island: translated columns, `BooleanIcon`/`EnumBadge`, custom-field column visibility, `fetchCrudList`, view + full export, `RowActions` with confirm dialog and a row delete that sends the row's optimistic-lock version via `buildOptimisticLockHeader`/`withScopedApiRequestHeaders`, flash, pagination | [`../components/TodosTable.tsx`](../components/TodosTable.tsx), [`../types.ts`](../types.ts) | readable |
| `ui.datatable-perspectives-filters` | `perspective={{ tableId }}`, filter definitions and apply/clear wiring, server query-param mapping, `useOrganizationScopeVersion` cache keying | [`../components/TodosTable.tsx`](../components/TodosTable.tsx) | readable |
| `ui.form-create` | `CrudForm` create: server page root delegating to a client form leaf, memoized translated fields, two-column groups, `customFields` group, custom component group, `createCrud`, flash-carrying success redirect | [`../backend/todos/create/page.tsx`](../backend/todos/create/page.tsx), [`../backend/todos/create/page.meta.ts`](../backend/todos/create/page.meta.ts), [`../components/TodoForm.tsx`](../components/TodoForm.tsx) | readable |
| `ui.form-edit` | Server page root plus client form leaf: scoped detail load, `extractCustomFieldEntries` initial values, `updatedAt` in `initialValues` so `CrudForm` auto-derives the optimistic-lock header for update **and** delete, `surfaceRecordConflict` on the 409, `RecordNotFoundState`/`ErrorMessage`, group `setValue` actions, `updateCrud`/`deleteCrud`, `pushWithFlash` | [`../backend/todos/[id]/edit/page.tsx`](../backend/todos/[id]/edit/page.tsx), [`../backend/todos/[id]/edit/page.meta.ts`](../backend/todos/[id]/edit/page.meta.ts), [`../components/TodoForm.tsx`](../components/TodoForm.tsx) | readable |
| `ui.frontend-page` | Module-owned route outside `/backend` that still resolves translations | [`../frontend/example.tsx`](../frontend/example.tsx) | readable |
| `ui.dashboard-widget` | `DashboardWidgetModule` metadata, feature gating, default size/enabled, lazy client component, `hydrateSettings`/`dehydrateSettings` clamping | [`../widgets/dashboard/todos/widget.ts`](../widgets/dashboard/todos/widget.ts), [`../widgets/dashboard/todos/config.ts`](../widgets/dashboard/todos/config.ts) | readable |
| `ui.page-middleware` | `backend/middleware.ts` folded into `backend-middleware.generated.ts` and run by the backend catch-all page; pure pathname decision behind the `{ action: 'redirect' \| 'continue' }` contract | [`../backend/middleware.ts`](../backend/middleware.ts) | readable |
| `ui.frontend-page-middleware` | The public twin: `frontend/middleware.ts` folded into `frontend-middleware.generated.ts` and run by the `(frontend)` catch-all; canonicalizes a public URL without ever reading the session | [`../frontend/middleware.ts`](../frontend/middleware.ts) | readable |

Read the page-middleware row for **where in the request it runs**, because that is what decides whether a middleware you write can do anything at all. `src/app/(backend)/backend/[...slug]/page.tsx` calls `resolvePageMiddlewareRedirect` *after* `findRouteManifestMatch` returned a route and *after* the `requireAuth` / `requireFeatures` guards passed, and *before* the page component is loaded. Two consequences:

- A middleware is **not** an access-control gate — the guard already ran, and page metadata is the right place for that.
- A middleware targeting a path with **no registered page never fires**, because the catch-all returns `notFound()` first. Pointing a `target` at a "landing path" that has no `page.tsx` produces a declaration that can never execute.

What is left is the useful window: rejecting a request that matched a route but cannot succeed. This entry sends a structurally impossible todo id back to the list instead of rendering the edit shell so it can issue a detail fetch that is guaranteed to miss.

The **frontend** row runs through the same shared executor but from `src/app/(frontend)/[...slug]/page.tsx`, and three differences there decide what you may write:

- **`context.auth` is `null` for an anonymous visitor.** A public route sets no `requireAuth`, so the catch-all never resolves a session before calling the executor. A middleware that reads `context.auth.tenantId` therefore throws — and `executePageMiddleware` rethrows — for exactly the audience the page exists to serve. The decision is a pure pathname function for that reason, and the test drives it with `auth: null`.
- **It never fires on a customer-portal route.** The catch-all returns the portal component inside the `match.route.requireCustomerAuth` branch, before `resolvePageMiddlewareRedirect` is reached, so a target of `/<org>/portal/*` is a declaration that can never execute.
- **The same "no page, no middleware" rule applies.** `/blog/:id` is backed by `frontend/blog/[id]/page.tsx`.

What that leaves is the canonical public-surface job: URL canonicalization. Serving one document at two casings is two addresses for one page; the entry collapses them and returns `continue` once the path already is canonical, so the redirect cannot loop.

Evidence: `__integration__/TC-EXAMPLE-001-todo-label-edit.spec.ts`, `widgets/dashboard/__tests__/config.test.ts`, `__tests__/backend-middleware.test.ts`, `__tests__/frontend-middleware.test.ts`.

Rule owners: `om-backend-ui-design`, `om-system-extension` (page middleware).

## Unified module extension system (UMES)

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `umes.mutation-guard` | `MutationGuard` bound to an entity kind + operations, returning `{ ok: false, message, status }` | [`../data/guards.ts`](../data/guards.ts) | readable |
| `umes.response-enricher` | `ResponseEnricher` adding a namespaced `_example` block to another module's list/detail responses, with `enrichMany` batching, `fallback`, timeout, explicit `cacheableOnListHit` | [`../data/enrichers.ts`](../data/enrichers.ts) | readable |
| `umes.extension-points` | `defineModuleExtensionPoints` declaring the four hosts this module exposes: the Todo DataTable, Todo CrudForm, phase-C handler injection host, and component-override showcase; each is consumed by its declared source via `extensionPoints.hosts.<key>`, the form the framework's binding detector requires | [`../extension-points.ts`](../extension-points.ts) | readable |
| `umes.injection-table` | Every supported spot-id shape mapped to widget ids: portal sections, `crud-form:<entityId>`, `data-table:<tableId>:<surface>`, menus, detail spots, tab groups, nested widget addon — exported as one unconditional object literal, the only shape the fact extractor can fold (26 contributions read; 0 while it was an env-flag ternary) | [`../widgets/injection-table.ts`](../widgets/injection-table.ts) | readable |
| `umes.injection.crud-form-field` | Headless field contribution into another module's CrudForm plus an `onSave` upsert handler | [`../widgets/injection/customer-priority-field/widget.ts`](../widgets/injection/customer-priority-field/widget.ts) | readable |
| `umes.injection.datatable-column` | Headless column reading an enricher-provided accessor path | [`../widgets/injection/customer-priority-column/widget.ts`](../widgets/injection/customer-priority-column/widget.ts) | readable |
| `umes.injection.datatable-filter` | Headless server-strategy filter whose `queryParam` is consumed by this module's API interceptor | [`../widgets/injection/customer-priority-filter/widget.ts`](../widgets/injection/customer-priority-filter/widget.ts) | readable |
| `umes.injection.datatable-row-action` | Headless row action with `InjectionPosition` relative placement and a narrowed host navigate callback | [`../widgets/injection/customer-priority-row-action/widget.ts`](../widgets/injection/customer-priority-row-action/widget.ts) | readable |
| `umes.injection.datatable-bulk-action` | Headless bulk action over selected rows returning `{ ok, affectedCount }` — the synchronous in-request variant; the queued one is `runtime.bulk-operation-progress` | [`../widgets/injection/customer-priority-bulk-actions/widget.ts`](../widgets/injection/customer-priority-bulk-actions/widget.ts) | readable |
| `runtime.bulk-operation-progress` | Selected-row bulk action returning a real `progressJobId`: data-only injected action → scope-verified idempotent 202 route → `(tenant, org, user, key)`-unique durable outbox row + `ProgressJob` → CAS-leased, checkpointed queue worker mutating through `example.todos.update` → terminal `completeJob` / `failJob` / `markCancelled`. The action is a `widget.ts`, not a `widget.client.tsx`, because `InjectionBulkActionDefinition` has no React component slot | [`../widgets/injection/todo-bulk-complete/widget.ts`](../widgets/injection/todo-bulk-complete/widget.ts), [`../api/todos/bulk-complete/route.ts`](../api/todos/bulk-complete/route.ts), [`../lib/todoBulkComplete.ts`](../lib/todoBulkComplete.ts), [`../workers/todos-bulk-complete.ts`](../workers/todos-bulk-complete.ts), [`../workers/todos-bulk-dispatch.ts`](../workers/todos-bulk-dispatch.ts) | readable |
| `module.setup-scheduler-target` | Idempotent organization-scoped `ScheduledJob` registered from `seedDefaults` (the only always-running hook with a container), with a deterministic id and a wrapped call so the per-tenant active-schedule cap cannot abort tenant init | [`../setup.ts`](../setup.ts) | readable |
| `umes.injection.menu-items` | Menu entries with `labelKey`, icon token, `features` gating, group assignment, `Last` and `Before`-anchor placement | [`../widgets/injection/example-menus/widget.ts`](../widgets/injection/example-menus/widget.ts), [`../widgets/injection/example-profile-menu/widget.ts`](../widgets/injection/example-profile-menu/widget.ts) | readable |
| `umes.injection.rendered-widget` | Data-only registration + focused client leaf using `readApiResultOrThrow`, `useGuardedMutation`, DS primitives, semantic tokens, translated states, effect cleanup | [`../widgets/injection/customer-priority-detail/widget.ts`](../widgets/injection/customer-priority-detail/widget.ts), [`../widgets/injection/customer-priority-detail/widget.client.tsx`](../widgets/injection/customer-priority-detail/widget.client.tsx) | readable |
| `umes.component-replacement` | All three `ComponentOverride` modes against `ComponentReplacementHandles.section(...)`: `wrapper` on three handles other modules expose, plus `replacement` (with its required `propsSchema`) and `propsTransform` on a handle this module hosts itself | [`../widgets/components.ts`](../widgets/components.ts), [`../components/ComponentOverrideShowcase.tsx`](../components/ComponentOverrideShowcase.tsx), [`../backend/component-overrides/page.tsx`](../backend/component-overrides/page.tsx) | readable |
| `overrides.unified-registry` | Typed, inactive `entry.overrides` examples for every wired override domain (app registry, not the module) | [`../../../modules.ts`](../../../modules.ts) | readable |
| `overrides.compileable-reference` | The same shape as a compiling `ModuleOverrides` value that survives preset scaffolding, which the app-registry copy does not | [`module-overrides.reference.ts`](module-overrides.reference.ts) | readable |

Three things about component overrides are worth reading before you copy the file, because none of them is visible from the type.

**Only a client host can be overridden in practice.** `registerComponentOverrides` is called from `ComponentOverrideProvider`, a client component. The server resolver (`resolveRegisteredComponent`, used by the backend catch-all for the `page:` handle) reads the same module-global map but runs during the RSC pass, before that provider has rendered — so a `page:` override is not a reliable place to start. `components/ComponentOverrideShowcase.tsx` resolves its handle through `useRegisteredComponent` instead, which is the shape every `ui.detail` and checkout section host uses.

**Priority is composition order, and the two resolvers compose differently.** `useRegisteredComponent` — the client hook every `ui.detail`, checkout and showcase host calls — partitions matches into buckets: the highest-priority `replacement` becomes the base, `wrapper`s reduce over it ascending, and every `propsTransform` is applied to the props at render time regardless of where it sorted. `resolveRegisteredComponent` — the server fold the backend catch-all uses for `page:` handles — walks matches in one pass and assigns `resolved = override.replacement`, discarding every wrapper and transform composed before it, so there a replacement at a higher number silently destroys the entries ahead of it. The showcase replacement takes priority 40 and the props transform 50 so that BOTH resolvers produce the same tree; reordering them is a no-op on the client path and drops the transform on the server path. `widgets/__tests__/component-override-modes.test.ts` renders the module's own host through the client hook, renders the same array through the server fold, asserts they agree under the declared priorities, and pins the divergence under a reordered copy.

**The two non-composing modes target a handle this module owns.** `wrapper` can be made a no-op by returning its argument by identity, which is how the checkout entries stay declared-but-inert; `replacement` and `propsTransform` have no such escape. Pointing them at a foreign handle would mean enabling this reference module rewrites a screen you did not come to look at, so they point at `section:example.overrides.showcase`, hosted by this module and rendered only by the `navHidden` `/backend/component-overrides` page. When you copy the entry, the target is the foreign handle you actually mean.

One mechanical trap comes with them: every value the fact extractor has to read must be declared in `widgets/components.ts` itself. `staticValue` resolves an identifier only against initializers in the file it is parsing, so the handle constant and the `propsTransform` callable are both declared locally rather than imported from `components/ComponentOverrideShowcase.tsx` — an imported handle publishes **zero** component-override contributions and an imported transform falls through to the `replace` default. Neither is a builder-vs-literal or named-function-vs-arrow choice: a plain string literal and an inline arrow fold identically. `widgets/__tests__/component-override-modes.test.ts` pins the two handle spellings together; `widgets/__tests__/components.test.ts` asserts the extractor resolves all five entries and their modes.

Evidence: `__tests__/extension-points.test.ts`, `widgets/__tests__/injection-table.test.ts`, `widgets/__tests__/components.test.ts`, `widgets/__tests__/component-override-modes.test.ts`, `__integration__/TC-UMES-001.spec.ts`, `__integration__/TC-UMES-002.spec.ts`, `__integration__/TC-UMES-004.spec.ts`, `__integration__/TC-UMES-012.spec.ts`, `__integration__/TC-UMES-022-overrides.spec.ts`.

`overrides.compileable-reference` exists because the app-registry row above does not survive scaffolding: `applyStarterPreset` rewrites `src/modules.ts` from a lean template for the `empty` and `crm` presets, and that template's `ModuleEntry` type does not declare an `overrides` field at all. This module's source ships in every preset, so a copy that compiles against the real `ModuleOverrides` interface lives here too.

Rule owner: `om-system-extension` (`om-backend-ui-design` for the rendered widget leaf).

## AI tools and agents

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `ai.tool-pack` | `defineAiTool` pack at the module root: Zod `inputSchema`, `requiredFeatures` drawn from `acl.ts`, `isMutation: false`, fail-closed tenant/organization resolution, one tool reading through the module's own DI service | [`../ai-tools.ts`](../ai-tools.ts) | readable |
| `ai.agent` | `defineAiAgent` read-only chat agent: closed `allowedTools` whitelist, `readOnly`/`mutationPolicy` agreeing with the pack, `requiredFeatures`, and a `systemPrompt` compiled from the framework's seven named prompt sections | [`../ai-agents.ts`](../ai-agents.ts) | readable |
| `ai.agent-extension` | `aiAgentExtensions` patching an agent **another module owns** — append-only, lending one of this module's own tools plus the prompt line that says when to reach for it | [`../ai-agents.ts`](../ai-agents.ts) | readable |
| `ai.tool-override` | `aiToolOverrides` — the keyed replace-or-disable map, tier 3 of four, whose replacement must carry the same `name` as its key | [`../ai-tools.ts`](../ai-tools.ts) | readable |
| `ai.agent-override` | `aiAgentOverrides` — the same contract for agents, and the mechanism `aiAgentExtensions` is *not*: keyed and destructive rather than unkeyed and additive | [`../ai-agents.ts`](../ai-agents.ts) | readable |

Two rules carry most of the safety here.

**Scope is never an input.** Both tools take their tenant and organization from the runtime-supplied `McpToolContext` through one fail-closed helper that throws when either half is missing. A `tenantId` field on the schema would be a field the model can be talked into filling, and the tool would then read another tenant's rows with the caller's own permissions. `__tests__/ai-tools.test.ts` asserts the schemas reject scope keys and that the guard throws before the handler touches the container.

**`allowedTools` is closed, and `readOnly` has to agree with it.** The runtime exposes nothing outside the whitelist, so a typo removes a tool silently rather than erroring — the test cross-checks every entry against `ai-tools.ts` instead of against the agent's own list. `readOnly: true` additionally hard-filters any `isMutation` tool, so a `read-only` agent that whitelists a write tool is a review defect, not a runtime error.

The extension row is the one to copy when your module wants to *lend* rather than *own*: it names a foreign `targetAgentId`, appends only, and is skipped with a log line when that agent is not installed. Anything mutation-shaped belongs in the pending-action approval contract, which this module deliberately does not demonstrate — route that to `om-create-ai-agent`.

**The two override rows are the destructive counterpart, and choosing between them and the extension is the decision worth getting right.** `aiAgentOverrides` / `aiToolOverrides` are keyed maps where `null` deletes and a definition replaces wholesale; `aiAgentExtensions` is an unkeyed array that only appends, and it is applied *after* overrides resolve. Reach for an override when you must change what an agent or tool **is**; reach for the extension when you only want to lend it something.

Two properties decide whether an override you write behaves:

- **It is tier 3 of four.** Programmatic (`applyAiAgentOverrides` / `applyAiToolOverrides`) beats `modules.ts` `entry.overrides.ai`, which beats these file exports, which beat the base declaration. A module ships a *default*; the app has the last word. `__tests__/ai-overrides.test.ts` proves that ordering against the real `compose*` / `apply*` functions rather than describing it.
- **The value's identity must equal its key.** `applyToolOverrideMap` skips a replacement whose `name` differs from the map key, and `applyAgentOverrideMap` skips one whose `id` differs — in both cases the base entry silently survives and the override looks applied in source only.

Both keys here name ids **this module owns**, which is the one place these rows deliberately diverge from production practice: a real override names a foreign id, but a canonical reference module that someone enables to look around must not rewrite a shipped assistant while they do. The replacements are derived from the base by spread and move only the feature gate, so the handler and the prompt cannot fork.

Evidence: `__tests__/ai-tools.test.ts`, `__tests__/ai-agents.test.ts`, `__tests__/ai-overrides.test.ts` (unit only — no `__integration__` spec exercises the AI surface yet).

Rule owner: `om-create-ai-agent`.

## Notifications, messages, integrations

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `notifications.type` | `NotificationTypeDefinition`: translation keys, severity, icon token, actions with variants/hrefs, primary action, expiry | [`../notifications.ts`](../notifications.ts) | readable |
| `notifications.reactive-handler` | `NotificationHandler` bound to a type, feature-gated, raising a toast and re-emitting a DOM event | [`../notifications.handlers.ts`](../notifications.handlers.ts) | readable |
| `notifications.client-renderer` | Client re-declaration of the server notification types with a custom `Renderer` attached, mapped over `notifications.ts` so the frozen id and keys stay single-sourced | [`../notifications.client.ts`](../notifications.client.ts) | readable |
| `messages.object-type` | Message object registration plus a server-only preview loader using `findOneWithDecryption` with explicit scope and translated fallbacks | [`../message-objects.ts`](../message-objects.ts), [`../lib/messageObjectPreviews.ts`](../lib/messageObjectPreviews.ts) | readable |
| `integrations.mock-adapters` | Credential-free gateway, carrier, and webhook-endpoint adapters incl. signature verification | [`../lib/mock-gateway-adapter.ts`](../lib/mock-gateway-adapter.ts), [`../lib/mock-shipping-adapter.ts`](../lib/mock-shipping-adapter.ts), [`../lib/mock-webhook-endpoint-adapter.ts`](../lib/mock-webhook-endpoint-adapter.ts) | readable |
| `integrations.local-bundle` | Discoverable local bundle reusing the payment and shipping mocks plus a DI-registered deterministic currency-rate provider; all three identities need no credentials or network | [`../integration.ts`](../integration.ts), [`../di.ts`](../di.ts), [`../lib/mock-currency-rate-provider.ts`](../lib/mock-currency-rate-provider.ts) | readable |
| `workflows.code-definition` | Minimal code workflow triggered by the typed `example.todo.created` event, mapping the Todo id into context and ending without activities or external side effects | [`../workflows.ts`](../workflows.ts) | readable |

Evidence: `__tests__/notifications.client.test.tsx`, `__tests__/specialized-registries.test.ts`, `__integration__/TC-EXAMPLE-015-specialized-registries.spec.ts`, `__integration__/TC-UMES-003.spec.ts`, `__integration__/TC-UMES-005.spec.ts`, `__integration__/TC-UMES-008.spec.ts`, `__integration__/TC-UMES-020.spec.ts`, `lib/__tests__/mock-gateway-adapter.test.ts`, `lib/__tests__/mock-shipping-adapter.test.ts`, `lib/__tests__/mock-webhook-endpoint-adapter.test.ts`.

Rule owners: `om-system-extension`, `om-integration-builder`.

## Testing

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `testing.integration-coverage` | Self-contained Playwright and unit suites for every runtime surface above | none emitted — repository-only evidence | qa-only (route to `om-integration-tests`) |

---

## `qa-only` rows and their exact defects

These files stay in the tree because the module is also the platform's QA surface. They are **not** patterns to copy. Each entry names the gate from [`../README.md`](../README.md) that it fails.

| Source | Gate | Exact defect |
|---|---|---|
| — | — | No source row is `qa-only` any more. `widgets/components.ts` was the last one and is now `readable`: the export is one unconditional array literal, the fact extractor reads all five entries, and `replace` / `props` have canonical examples alongside `wrapper`. `testing.integration-coverage` remains `qa-only` by definition — it is repository-only evidence, not emitted source. |

### Not in the inventory at all

The following files are present in the tree but are **not** capability rows and must never be read as references: the UMES showcase pages (`backend/umes-*/page.tsx`, `backend/mutation-lifecycle/page.tsx`, `backend/payments/page.tsx`, `backend/products/page.tsx`, `backend/blog/[id]/page.tsx`) — note that `backend/component-overrides/page.tsx` is **not** in this list; it is part of the `umes.component-replacement` row as that override's host — and the demo injection widgets `widgets/injection/portal-stats`, `widgets/injection/portal-recent-activity`, `widgets/injection/catalog-seo-report`, `widgets/injection/crud-validation`, `widgets/injection/crud-validation-addon`, and `widgets/injection/sales-todos`. They fail gate 3 (raw `text-emerald-*` / `bg-amber-*` / `bg-green-500` / `bg-red-500` status colors), gate 5 (hard-coded JSX text and `title`/`placeholder`/`aria-label` literals), and in the sales case gate 4 (`record?: any`, `(item as any)`).

## Outstanding notes on `readable` rows

Recorded so the gate stays honest; none of these demote the row.

**Proven by unit tests only**: `module.acl-features`, `search.encrypted-column-list-filter`, `api.option-source-routes`, `commands.undo-redo`, `ui.dashboard-widget`, and `overrides.compileable-reference`. None of these six has a dedicated integration spec; their `integrationTestPaths` entries are repository evidence, not a runtime-coverage claim.

- `commands/todos.ts`, `api/interceptors.ts`, `lib/mock-*-adapter.ts` — several internal `throw new Error('...')` assertions are missing the `[internal]` prefix required by the i18n hardcoded-string convention.
- `commands/interceptors.ts`, `subscribers/audit-delete.ts` — raw `console.log` behind an eslint disable instead of the `createLogger` facade (advisory `yarn logger:check-console`).
- `api/todos/route.ts` — imports `todoCrudEvents` / `todoCrudIndexer` from `commands/todos.ts` but configures `events` / `indexer` inline; the imports are unused. Left in place because the two shapes are not equivalent (the command-side configs carry `buildPayload` builders) and reconciling them changes emitted payloads.
- `components/TodosTable.tsx` — two localized `(col as any)` property probes on the TanStack `ColumnDef` union; both are immediately runtime-checked, so they are notes rather than gate-4 failures.
- `notifications.client.ts` — the renderer component is declared inline instead of in `widgets/notifications/<Name>.tsx`, so the convention file stays `.ts` and the component is built with `React.createElement` rather than JSX. Its action-selection decision is exported as a pure function so it stays testable. Copy the file's structure, not its component location.
- `widgets/injection-table.ts` — historically a conditionally spread export that static module-fact extraction could not read; it is now one unconditional object literal the extractor folds in full (26 contributions). `widgets/components.ts` was in the same state and is likewise resolved (5 contributions). Neither is unreadable any more.
- `di.ts` — the Awilix `container.register` call and the external adapter-registry calls sit in one function. Only the former emits a rich DI registration fact; the latter register into registries this container never sees.
- `data/guards.ts`, `subscribers/prevent-uncomplete.ts` — English rejection messages are inline object properties rather than translation keys.
- `widgets/dashboard/todos/widget.client.tsx`, `widgets/dashboard/notes/widget.client.tsx`, `widgets/dashboard/welcome/widget.client.tsx` — arbitrary Tailwind values (`min-h-[120px]`, `min-h-[160px]`); the widget registration and settings files linked above are unaffected.

The cache and setup rows are proven by both focused unit coverage and their module-local integration lanes: `__integration__/TC-EXAMPLE-007-cache.spec.ts` and `__integration__/TC-EXAMPLE-010-setup-seeding.spec.ts`.

`overrides.compileable-reference` remains a compile-time reference proved by `__tests__/module-overrides-reference.test.ts`; it has no runtime call site to exercise. `events.portal-broadcast` keeps its focused matcher/registry unit proof and is also driven through a real customer-authenticated portal SSE connection by `__integration__/TC-EXAMPLE-012-extension-topology.spec.ts`, including the scope/action payload and title/notes exclusion. `module.setup-scheduler-target` keeps its focused registration proof, while `__integration__/TC-EXAMPLE-003-todo-bulk-progress.spec.ts` exercises the target's durable outbox dispatch and recovery path and `__integration__/TC-EXAMPLE-010-setup-seeding.spec.ts` executes the scoped setup contract.

Six more rows left that list on 2026-08-10. `runtime.bulk-operation-progress` gained `__integration__/TC-EXAMPLE-003-todo-bulk-progress.spec.ts`, which closes the gap this paragraph used to name explicitly: the browser lifecycle (selection, start feedback, the 202 carrying the `progressJobId`) and the real queue round trip are now exercised, alongside crash recovery from the durable outbox, resume-from-checkpoint, mixed failure, cancellation and cross-organization refusal. The five AI rows gained `__integration__/TC-EXAMPLE-014-ai-contracts.spec.ts`, which dispatches the tools through the real executor rather than a handler call, so the ACL gate and the organization boundary are proved at the HTTP surface. Three rows had left the list on 2026-08-06: the two page-middleware rows, now driven end to end through both catch-all pages, and the cross-module extension row, through the contributor's own scoped read/write round trip against a real host record.
