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
| `module.setup-role-features` | `ModuleSetupConfig` default role grants applied at tenant init | [`../setup.ts`](../setup.ts) | readable |
| `module.di-registration` | `register(container)` registering gateway / carrier / webhook adapters and provider descriptors | [`../di.ts`](../di.ts) | readable |
| `module.cli-command` | Module CLI entrypoint, custom-entity install, idempotent seeding | [`../cli.ts`](../cli.ts) | **qa-only** |
| `module.i18n-catalogs` | Per-module locale catalogs for `useT()` / `resolveTranslations()` | [`../i18n/en.json`](../i18n/en.json), [`../i18n/de.json`](../i18n/de.json), [`../i18n/es.json`](../i18n/es.json), [`../i18n/pl.json`](../i18n/pl.json) | readable |

Rule owners: `om-module-scaffold`, `om-integration-builder` (DI adapters).

## Data model

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `data.entities` | UUID PKs, snake_case columns, `tenant_id`/`organization_id`, `created_at`/`updated_at`/`deleted_at`, no cross-module relations | [`../data/entities.ts`](../data/entities.ts) | readable |
| `data.validators` | Zod create/update/list schemas, `z.infer` types, shared enum schema | [`../data/validators.ts`](../data/validators.ts) | readable |
| `data.custom-fields` | `ce.ts` custom entities and field kinds: integer, select, boolean, multi-text tags, markdown, `optionsUrl`, listbox, attachments, defaults, validation rules | [`../ce.ts`](../ce.ts) | readable |
| `data.migrations` | Generated SQL migrations and the module-scoped ORM snapshot that `yarn db:generate` diffs against | [`../migrations/Migration20251030150038.ts`](../migrations/Migration20251030150038.ts), [`../migrations/Migration20260226161000_example.ts`](../migrations/Migration20260226161000_example.ts), [`../migrations/.snapshot-open-mercato.json`](../migrations/.snapshot-open-mercato.json) | readable |

Rule owner: `om-data-model-design`.

## API

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `api.crud-factory` | The smallest complete `makeCrudRoute`: per-method ACL, ORM/scope/soft-delete binding, list schema + sort map, `mapToEntity`/`applyToEntity`, scoped cross-module cache invalidation hooks | [`../api/customer-priorities/route.ts`](../api/customer-priorities/route.ts) | readable |
| `api.crud-query-engine-custom-fields` | Query-engine list fields, `cf:*` projection and filtering, per-request custom-field discovery, command-backed actions, CSV export config | [`../api/todos/route.ts`](../api/todos/route.ts) | **qa-only** |
| `api.openapi` | Module OpenAPI factory over the shared CRUD OpenAPI helpers | [`../api/openapi.ts`](../api/openapi.ts) | readable |
| `api.custom-route` | Hand-written route: own request container, cookie auth, query-engine read | [`../api/organizations/route.ts`](../api/organizations/route.ts) | **qa-only** |
| `api.option-source-routes` | Backends for `optionsUrl` on tags/listbox custom fields | [`../api/tags/route.ts`](../api/tags/route.ts), [`../api/assignees/route.ts`](../api/assignees/route.ts), [`../api/notifications/route.ts`](../api/notifications/route.ts) | **qa-only** |
| `api.interceptors` | Exact-route and wildcard interceptors: rejection, timeout, thrown error, query rewrite, cross-module `?ids=` narrowing, `after` response merge via metadata | [`../api/interceptors.ts`](../api/interceptors.ts) | readable |

Evidence: `__integration__/TC-UMES-004.spec.ts`, `__integration__/TC-UMES-021.spec.ts`, `api/__tests__/tags.tenant-scope.test.ts`.

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
| `events.ephemeral-subscriber` | `persistent: false` subscriber resolving a service from the DI context | [`../subscribers/example-event.ts`](../subscribers/example-event.ts) | **qa-only** |

Evidence: `commands/__tests__/todos.update.test.ts`, `commands/__tests__/todos.prepare-scope.test.ts`, `commands/__tests__/todos.undo.test.ts`, `__integration__/TC-UMES-003.spec.ts`, `__integration__/TC-UMES-006-mutation-lifecycle.spec.ts`, `__integration__/TC-EXAMPLE-002-query-index-failure.spec.ts`.

Rule owners: `om-data-model-design` (commands, events/indexer), `om-system-extension` (interceptors, subscribers).

## Backend UI

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `ui.page-shell` | Server-rendered `Page`/`PageHeader`/`PageBody`; `page.meta.ts` guards, nav group/order, icon token, breadcrumb with `labelKey` | [`../backend/todos/page.tsx`](../backend/todos/page.tsx), [`../backend/todos/page.meta.ts`](../backend/todos/page.meta.ts), [`../backend/page.tsx`](../backend/page.tsx), [`../backend/page.meta.ts`](../backend/page.meta.ts) | readable |
| `ui.datatable` | `DataTable` client island: translated columns, `BooleanIcon`/`EnumBadge`, custom-field column visibility, `fetchCrudList`, view + full export, `RowActions` with confirm dialog, flash, pagination | [`../components/TodosTable.tsx`](../components/TodosTable.tsx), [`../types.ts`](../types.ts) | readable |
| `ui.datatable-perspectives-filters` | `perspective={{ tableId }}`, filter definitions and apply/clear wiring, server query-param mapping, `useOrganizationScopeVersion` cache keying | [`../components/TodosTable.tsx`](../components/TodosTable.tsx) | readable |
| `ui.form-create` | `CrudForm` create: memoized translated fields, two-column groups, `customFields` group, custom component group, `createCrud`, flash-carrying success redirect | [`../backend/todos/create/page.tsx`](../backend/todos/create/page.tsx), [`../backend/todos/create/page.meta.ts`](../backend/todos/create/page.meta.ts) | readable |
| `ui.form-edit` | Scoped detail load, `extractCustomFieldEntries` initial values, `RecordNotFoundState`/`ErrorMessage`, group `setValue` actions, `updateCrud`/`deleteCrud`, `pushWithFlash` | [`../backend/todos/[id]/edit/page.tsx`](../backend/todos/[id]/edit/page.tsx), [`../backend/todos/[id]/edit/page.meta.ts`](../backend/todos/[id]/edit/page.meta.ts) | readable |
| `ui.frontend-page` | Module-owned route outside `/backend` that still resolves translations | [`../frontend/example.tsx`](../frontend/example.tsx) | readable |
| `ui.dashboard-widget` | `DashboardWidgetModule` metadata, feature gating, default size/enabled, lazy client component, `hydrateSettings`/`dehydrateSettings` clamping | [`../widgets/dashboard/todos/widget.ts`](../widgets/dashboard/todos/widget.ts), [`../widgets/dashboard/todos/config.ts`](../widgets/dashboard/todos/config.ts) | readable |

Evidence: `__integration__/TC-EXAMPLE-001-todo-label-edit.spec.ts`, `widgets/dashboard/__tests__/config.test.ts`.

Rule owner: `om-backend-ui-design`.

## Unified module extension system (UMES)

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `umes.mutation-guard` | `MutationGuard` bound to an entity kind + operations, returning `{ ok: false, message, status }` | [`../data/guards.ts`](../data/guards.ts) | readable |
| `umes.response-enricher` | `ResponseEnricher` adding a namespaced `_example` block to another module's list/detail responses, with `enrichMany` batching, `fallback`, timeout, explicit `cacheableOnListHit` | [`../data/enrichers.ts`](../data/enrichers.ts) | **qa-only** |
| `umes.injection-table` | Every supported spot-id shape mapped to widget ids: portal sections, `crud-form:<entityId>`, `data-table:<tableId>:<surface>`, menus, detail spots, tab groups, nested widget addon | [`../widgets/injection-table.ts`](../widgets/injection-table.ts) | readable |
| `umes.injection.crud-form-field` | Headless field contribution into another module's CrudForm plus an `onSave` upsert handler | [`../widgets/injection/customer-priority-field/widget.ts`](../widgets/injection/customer-priority-field/widget.ts) | readable |
| `umes.injection.datatable-column` | Headless column reading an enricher-provided accessor path | [`../widgets/injection/customer-priority-column/widget.ts`](../widgets/injection/customer-priority-column/widget.ts) | readable |
| `umes.injection.datatable-filter` | Headless server-strategy filter whose `queryParam` is consumed by this module's API interceptor | [`../widgets/injection/customer-priority-filter/widget.ts`](../widgets/injection/customer-priority-filter/widget.ts) | readable |
| `umes.injection.datatable-row-action` | Headless row action with `InjectionPosition` relative placement and a narrowed host navigate callback | [`../widgets/injection/customer-priority-row-action/widget.ts`](../widgets/injection/customer-priority-row-action/widget.ts) | readable |
| `umes.injection.datatable-bulk-action` | Headless bulk action over selected rows returning `{ ok, affectedCount }` (synchronous; no `progressJobId` yet) | [`../widgets/injection/customer-priority-bulk-actions/widget.ts`](../widgets/injection/customer-priority-bulk-actions/widget.ts) | readable |
| `umes.injection.menu-items` | Menu entries with `labelKey`, icon token, `features` gating, group assignment, `Last` and `Before`-anchor placement | [`../widgets/injection/example-menus/widget.ts`](../widgets/injection/example-menus/widget.ts), [`../widgets/injection/example-profile-menu/widget.ts`](../widgets/injection/example-profile-menu/widget.ts) | readable |
| `umes.injection.rendered-widget` | Data-only registration + focused client leaf using `readApiResultOrThrow`, `useGuardedMutation`, DS primitives, semantic tokens, translated states, effect cleanup | [`../widgets/injection/customer-priority-detail/widget.ts`](../widgets/injection/customer-priority-detail/widget.ts), [`../widgets/injection/customer-priority-detail/widget.client.tsx`](../widgets/injection/customer-priority-detail/widget.client.tsx) | readable |
| `umes.component-replacement` | `ComponentOverride` against `ComponentReplacementHandles.section(...)` in `wrapper` mode | [`../widgets/components.ts`](../widgets/components.ts) | **qa-only** |
| `overrides.unified-registry` | Typed, inactive `entry.overrides` examples for every wired override domain (app registry, not the module) | [`../../../modules.ts`](../../../modules.ts) | readable |

Evidence: `widgets/__tests__/injection-table.test.ts`, `widgets/__tests__/components.test.ts`, `__integration__/TC-UMES-001.spec.ts`, `__integration__/TC-UMES-002.spec.ts`, `__integration__/TC-UMES-004.spec.ts`, `__integration__/TC-UMES-012.spec.ts`, `__integration__/TC-UMES-022-overrides.spec.ts`.

Rule owner: `om-system-extension` (`om-backend-ui-design` for the rendered widget leaf).

## Notifications, messages, integrations

| Capability | Demonstrates | Source | Status |
|---|---|---|---|
| `notifications.type` | `NotificationTypeDefinition`: translation keys, severity, icon token, actions with variants/hrefs, primary action, expiry | [`../notifications.ts`](../notifications.ts) | readable |
| `notifications.reactive-handler` | `NotificationHandler` bound to a type, feature-gated, raising a toast and re-emitting a DOM event | [`../notifications.handlers.ts`](../notifications.handlers.ts) | readable |
| `messages.object-type` | Message object registration plus a server-only preview loader using `findOneWithDecryption` with explicit scope and translated fallbacks | [`../message-objects.ts`](../message-objects.ts), [`../lib/messageObjectPreviews.ts`](../lib/messageObjectPreviews.ts) | readable |
| `integrations.mock-adapters` | Credential-free gateway, carrier, and webhook-endpoint adapters incl. signature verification | [`../lib/mock-gateway-adapter.ts`](../lib/mock-gateway-adapter.ts), [`../lib/mock-shipping-adapter.ts`](../lib/mock-shipping-adapter.ts), [`../lib/mock-webhook-endpoint-adapter.ts`](../lib/mock-webhook-endpoint-adapter.ts) | readable |

Evidence: `__integration__/TC-UMES-003.spec.ts`, `__integration__/TC-UMES-005.spec.ts`, `__integration__/TC-UMES-008.spec.ts`, `__integration__/TC-UMES-020.spec.ts`, `lib/__tests__/mock-gateway-adapter.test.ts`, `lib/__tests__/mock-shipping-adapter.test.ts`, `lib/__tests__/mock-webhook-endpoint-adapter.test.ts`.

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
| [`../api/todos/route.ts`](../api/todos/route.ts) | 4, 1 | File-scope `/* eslint-disable @typescript-eslint/no-explicit-any */` with ~25 `any` uses, including `(ctx.container.resolve('em') as any)` and `(em as any).getKysely()` reaching the ORM and raw SQL builder. Separately, `beforeList` mutates module-scoped `dynamicCfKeys` and `sortFieldMapRef` from tenant/organization-scoped `CustomFieldDef` rows, and `transformItem`/`sortFieldMap` read them back on subsequent requests — one tenant's custom-field key set bleeds into another tenant's projection and sort map. `listFields` is reassigned after `makeCrudRoute` already captured it, so that reassignment is dead code. |
| [`../data/enrichers.ts`](../data/enrichers.ts) | 4 | `enrichOne` and `enrichMany` both open their ORM handle with `(context.em as any).fork()`. `EnricherContext.em` is typed `unknown` so consumers narrow it; `as EntityManager` works and `as any` additionally erases the types of every following `em.find` call. |
| [`../widgets/components.ts`](../widgets/components.ts) | 3 | Wrapper class names use raw Tailwind palette shades — `border-amber-300 bg-amber-50/40`, `border-blue-300 bg-blue-50/40` — instead of semantic/status tokens. Also demonstrates only the `wrapper` mode and exports a conditionally spread array, so static fact extraction cannot read its entries. |
| [`../cli.ts`](../cli.ts) | 4 | `installCustomEntitiesFromModules(em as any, cache, ...)` erases the `EntityManager` type on an ORM handle used to mutate data; `EntityManager` is already imported in the same file. |
| [`../api/organizations/route.ts`](../api/organizations/route.ts) | 4 | `res.items.map((org: any) => ...)` erases the query-engine result type where the response is shaped. Also uses raw `new Response(JSON.stringify(...))` and raw `console.error` instead of the shared response/logging helpers. |
| [`../api/tags/route.ts`](../api/tags/route.ts) | 4 | `resolve('em') as any` and `(r as any).valueText` / `(r as any).valueMultiline` reach ORM rows and their columns untyped. |
| [`../api/assignees/route.ts`](../api/assignees/route.ts) | 2 | `await req.json().catch(() => ({}))` instead of `readJsonSafe(...)`. |
| [`../api/notifications/route.ts`](../api/notifications/route.ts) | 2 | `await request.json().catch(() => ({}))` instead of `readJsonSafe(...)`. |
| [`../subscribers/example-event.ts`](../subscribers/example-event.ts) | 4 | The exported handler signature is `(payload: any, ctx: { resolve: <T=any>(name: string) => T })` — both the event payload and every resolved service are untyped at the module's public boundary. |

### Not in the inventory at all

The following files are present in the tree but are **not** capability rows and must never be read as references: the UMES showcase pages (`backend/umes-*/page.tsx`, `backend/mutation-lifecycle/page.tsx`, `backend/payments/page.tsx`, `backend/products/page.tsx`, `backend/blog/[id]/page.tsx`) and the demo injection widgets `widgets/injection/portal-stats`, `widgets/injection/portal-recent-activity`, `widgets/injection/catalog-seo-report`, `widgets/injection/crud-validation`, `widgets/injection/crud-validation-addon`, and `widgets/injection/sales-todos`. They fail gate 3 (raw `text-emerald-*` / `bg-amber-*` / `bg-green-500` / `bg-red-500` status colors), gate 5 (hard-coded JSX text and `title`/`placeholder`/`aria-label` literals), and in the sales case gate 4 (`record?: any`, `(item as any)`).

## Outstanding notes on `readable` rows

Recorded so the gate stays honest; none of these demote the row.

- `commands/todos.ts`, `api/interceptors.ts`, `lib/mock-*-adapter.ts` — several internal `throw new Error('...')` assertions are missing the `[internal]` prefix required by the i18n hardcoded-string convention.
- `commands/interceptors.ts`, `subscribers/audit-delete.ts` — raw `console.log` behind an eslint disable instead of the `createLogger` facade (advisory `yarn logger:check-console`).
- `components/TodosTable.tsx` — two localized `(col as any)` property probes on the TanStack `ColumnDef` union; both are immediately runtime-checked, so they are notes rather than gate-4 failures.
- `backend/todos/create/page.tsx`, `backend/todos/[id]/edit/page.tsx` — the page roots themselves carry `"use client"`; the target architecture extracts the interactive form into a focused client leaf.
- `backend/todos/[id]/edit/page.tsx` — `initialValues` does not yet carry `updatedAt`, so `CrudForm` cannot auto-derive the optimistic-lock header for update/delete.
- `widgets/injection-table.ts`, `widgets/components.ts` — conditionally spread exports; static module-fact extraction cannot read their entries.
- `di.ts` — registers adapters through external registries; it contains no Awilix `container.register` call, so it emits no rich DI registration fact.
- `data/guards.ts`, `subscribers/prevent-uncomplete.ts` — English rejection messages are inline object properties rather than translation keys.
- `widgets/dashboard/todos/widget.client.tsx`, `widgets/dashboard/notes/widget.client.tsx`, `widgets/dashboard/welcome/widget.client.tsx` — arbitrary Tailwind values (`min-h-[120px]`, `min-h-[160px]`); the widget registration and settings files linked above are unaffected.

## Capabilities this module does not cover yet

Not present in the tree today, so there is no row and no link: encryption of a module field, `search.ts` registration, DI-resolved caching with tag invalidation, queued bulk operations with operation progress, `notifications.client.ts` renderers, `translations.ts`, `extension-points.ts`, `data/extensions.ts`, `generators.ts`, `ai-tools.ts` / `ai-agents.ts`, page middleware, portal broadcast, and `setup.ts` seed hooks. Follow the owning skill; do not infer a pattern from an adjacent `example` file.
