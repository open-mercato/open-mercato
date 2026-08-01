# Complete UMES Extension-Point Catalog — Generated Per-Module Host and Contribution Facts

- **Status:** Proposed — design only, ready for review
- **Date:** 2026-08-01
- **Scope:** OSS developer tooling; `packages/shared`, `packages/cli`, package-provided modules, and `packages/create-app` agentic guides
- **Related:** [Platform Map](2026-06-17-platform-map-introspection.md), [ts-morph Module Fact-Sheets](2026-06-27-ts-morph-module-fact-sheets.md), [Module Fact Auto-Discovery](2026-07-06-module-facts-auto-discovery.md), [UMES](implemented/SPEC-041-2026-02-24-universal-module-extension-system.md), [DataTable Extensions](implemented/SPEC-041f-datatable-extensions.md), `BACKWARD_COMPATIBILITY.md`

## 📝 TLDR

Open Mercato’s generated module fact sheets list events, routes, ACL features, entities, and a small set of raw host tokens, but they do not answer the agent’s practical question: **“Which UMES seams does this installed module host, which exact target ID do I use, what does the module already contribute, and which read/write/UI legs must compose?”** The current generator misses explicit `InjectionSpot` IDs, dynamic host patterns, component handles, route/entity/command extension capability, query lifecycle events, browser broadcast flags, and outgoing registrations.

This specification adds typed declarations only for UMES host surfaces that lack an existing canonical fact source, binds UI host call sites to those declarations, reuses the existing CLI registry readers for outgoing contributions, and extends module-facts Markdown/JSON with a bidirectional `extensionSurfaces` catalog. The catalog covers widget/menu/DataTable/CrudForm/detail/portal hosts, component handles, response and query enrichers, API and command interceptors, mutation guards, entity extensions, sync/async/query subscribers, DOM and portal bridges, notification reactions, dashboard/integration widgets, and supported override keys. Existing event/entity/route facts are referenced instead of duplicated.

The 2026-08-01 repository audit covered **58 package module roots / 54 unique module IDs** after resolving four duplicate provider IDs. It found **24 modules with UI host surfaces**, **64 exact custom spot IDs**, **53 DataTable tokens**, **11 replacement handles**, **6 dynamic call sites requiring classification**, and outgoing UMES evidence across injection tables, enrichers, API/command interceptors, guards, entity extensions, subscribers, browser-broadcast events, notification handlers, dashboard widgets, and component overrides. Those values are a migration baseline, not hard-coded acceptance counts; the implementation derives the live set on every test/build.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Should the source of truth extend standalone module facts, the runtime Platform Map, or both? | Extend the existing module-facts pipeline; define a shape the Platform Map can adapt to later, but add no runtime API/UI in this change. | Generated facts are the surface user agents already read, and this avoids duplicating or blocking on the open Platform Map implementation. | ok |
| Q2 | Should the catalog list only hosted extension points or also outgoing widget/extension registrations? | Emit both hosts and outgoing contributions across the complete UMES taxonomy, with target correlation and override identity. | The maintainer explicitly requested complete UMES coverage in PR #4788, including enrichers, interceptors, query events, DOM bridge, menus, CrudForm, and DataTable. | user-confirmed |
| Q3 | How should dynamic/provider-selected spot IDs be represented? | Require an explicit typed pattern declaration with named parameters; never guess a concrete ID or silently omit the host. | Pattern facts preserve correctness for `integrations.detail:{integrationId}` and conditional sales hosts while keeping the output machine-readable. | ok |
| Q4 | Should legacy `hostTokens` be replaced? | Keep `hostTokens` unchanged and derive it from the richer catalog where possible; add optional fields to exported types. | Additive output preserves the stable JSON/type contract. Removal or deprecation can be considered only in a later minor under the deprecation protocol. | ok |

No assumption needs human confirmation. All defaults are additive, reversible, and do not alter runtime behavior.

## 📝 Overview

The module-facts pipeline already gives standalone agents a compact, source-derived view of installed module contracts. It auto-discovers package modules and emits `.ai/guides/modules/<module>.md` plus `.ai/guides/module-facts.json`. Its `Host extension points` section currently contains only:

```ts
type ModuleHostTokens = {
  entityIds: string[]
  tableIds: string[]
}
```

That shape is too lossy:

- `tableId: 'catalog.products.list'` implies deep spots such as `data-table:catalog.products.list:columns`, but the same DataTable explicitly exposes the base spot `data-table:catalog.products`; the fact sheet records only the first token.
- A custom `InjectionSpot` such as `detail:customers.person:header` or `auth.login:form` is not represented at all.
- Helper-built portal spots and provider-selected integration-detail spots are invisible.
- Component handles such as `section:checkout.pay-page.summary` are documented only in source comments or call sites.
- Response/query enricher opt-ins, interceptor/guard phases, query lifecycle event patterns, command targets, event broadcast transports, and supported override keys are not visible beside the target module.
- Outgoing widgets, enrichers, interceptors, guards, entity links, subscribers, notification handlers, and specialized registrations are scattered across generated registries and convention files, so an agent cannot see the complete round trip from one fact sheet.
- A raw token does not say what mechanism it supports, what context/data contract a widget receives, whether the ID is exact or patterned, or where its authoritative declaration lives.

The catalog must describe stable addresses, not implementation prose. Conceptual mechanism selection remains in `.ai/guides/extensions.md`; the module sheet supplies exact installed facts.

## 📝 Problem Statement

Open Mercato freezes widget injection spot IDs because third-party modules depend on them, yet the platform does not publish a per-module inventory of those IDs. An agent working in a standalone app therefore has three unsafe choices:

1. Guess a spot from naming conventions, which fails for legacy aliases and split base/deep DataTable IDs.
2. Escalate to installed-source inspection for every extension, defeating the compact generated-facts design and often becoming impossible for compiled-only packages.
3. Read multiple generated registries and convention files, then manually correlate contribution targets to hosts while still missing implicit query, browser-event, command, and override contracts.

The distinction matters. A registration key proves that a widget wants to mount somewhere; only the host call site/declaration proves that the surface exists and defines its context. The current Platform Map design aggregates runtime registries, which is valuable for a running app, but it sees registered targets and enabled modules rather than a complete package-time authoring contract for standalone agents.

### Success criteria

- Every discovered package module fact sheet explicitly says which UMES surfaces the module **hosts** and **contributes**, even when either answer is `_none_`.
- Every emitted host has an exact ID or an explicit parameterized pattern, mechanism/family, supported attachment capabilities, context/data contract identifier, source provenance, and stability classification.
- Every emitted contribution has a stable ID, kind, exact/pattern target, lifecycle phase/operations, feature/scope metadata, source provenance, override domain/key when supported, and host resolution status.
- Event facts expose async/sync subscriber capability plus `clientBroadcast`/`portalBroadcast`; queryable entity facts expose `*.querying`/`*.queried` patterns and query-enricher activation rules.
- CrudForm/DataTable facts distinguish runtime-bound surfaces from helper-only IDs; agents never receive `before-fields`, `empty-state`, or another theoretical helper as usable when the component does not render it.
- Every first-party contribution resolves to an exact, pattern, framework, existing-fact, or explicitly optional-external host; unresolved first-party targets fail validation.
- First-party host call sites cannot drift from declarations without a deterministic test failure.
- Existing spot IDs, component handles, module-facts keys, JSON top-level shape, and `hostTokens` remain compatible.
- The standalone agent harness proves that an agent can select an exact host from facts without bulk-reading installed source or inventing an ID.

## Research — comparable extension catalogs

Two established designs inform the shape:

- **VS Code contribution points** show the value of named, machine-readable extension contracts instead of prose-only documentation: <https://code.visualstudio.com/api/references/contribution-points>.
- **Backstage** makes the host plugin own named extension points and treats optional modules as consumers of those contracts: <https://backstage.io/docs/frontend-system/architecture/extension-blueprints/> and <https://backstage.io/docs/backend-system/architecture/modules/>.

Applied here: use stable IDs, typed host families, distinct host/contribution facts, explicit target relationships, phase/operation metadata, and host ownership. Rejected: a single runtime-only graph (insufficient for package facts), prose manifests (drift), and a new mutable admin UI (outside the agent-discovery problem).

## Goals and non-goals

### Goals

- Make exact module extension targets discoverable in the existing generated facts.
- Cover every additive UMES mechanism named by `om-system-extension`: response/query enrichers; API/command interceptors; mutation guards; rendered/headless/menu/dashboard/integration widgets; CrudForm and DataTable surfaces and lifecycle handlers; entity extensions; async/sync/query subscribers; notification/browser reactions; component overrides; and specialized registrations/override identities.
- Make the host declaration authoritative by having host call sites consume its exported values.
- Reuse existing module discovery and registry-generator parsing rather than create a second package scanner.
- Correlate outgoing contributions to exact, pattern, framework, existing-fact, or optional-external hosts.
- Let an agent reconstruct editable field/action round trips from related contribution IDs without reading implementation source.
- Preserve context discipline: an agent reads one target module fact, not a repository-wide graph.

### Non-goals

- No runtime introspection API, CLI command, backoffice page, or change to Platform Map PR #3722.
- No database schema, tenant data, credentials, PII, cache, queue, or network behavior.
- No replacement of OpenAPI, event facts, or conceptual UMES guides.
- No duplication of event/entity/route facts: UMES rows reference those existing facts and add only extension-specific capability/transport/phase metadata.
- No new execution registry or runtime activation path. Facts read the same declarations/registries runtime already uses.
- No automatic facts for app-owned standalone modules in this phase; this extends the package-bundled facts path defined by the auto-discovery spec.
- No normalization/renaming of legacy IDs. Dotted, colon, hyphenated, wildcard, and legacy IDs remain exactly as shipped.
- No claim that every theoretical helper in `spotIds.ts` is a rendered host. Helper-only IDs are diagnosed but never recommended as usable surfaces.

### Atomic delivery boundary

The public deliverable is **complete installed UMES discovery for a user agent**, not two catalogs. A host row alone answers where an extension might attach but cannot tell the agent which mechanism, lifecycle, activation, guard, or read/write companion is required. A contribution row alone cannot prove that its target exists or distinguish a framework/pattern/optional target from a dangling one. Publishing either half independently would preserve the current failure mode: an agent still has to inspect source and correlate registries by hand.

Therefore:

- `extensionSurfaces` is one atomic shape with `hosts`, `contributions`, and correlation diagnostics; no host-only public field or intermediate generated guide ships.
- The generator enables the new Markdown/JSON sections only after all first-party host/contribution readers and correlation guards pass.
- Framework facts and standalone routing are part of the same usable output because global/menu targets cannot be resolved from a business-module sheet alone.
- OMH-088/OMH-089 acceptance requires complete mechanism selection, exact target resolution, and round-trip composition. Passing host lookup alone is not feature completion.
- The implementation phases are internal dependency order within one PR. They do not define separately releasable products or compatibility commitments.

### Complete UMES inventory boundary

This matrix is normative: implementation is incomplete if any row has neither emitted facts nor an explicit reference to an existing fact section.

| UMES family | Host/target evidence | Outgoing contribution evidence | Required fact detail |
|---|---|---|---|
| Rendered/headless widgets | Bound `InjectionSpot`, `useInjectionDataWidgets`, status/wizard/detail/portal hosts | `widgets/injection/**` + `widgets/injection-table.ts` | Exact/pattern spot, widget ID/key, features, placement, context/data contracts |
| Menu injection | Framework/portal menu constants and bound `useInjectedMenuItems` surfaces | Headless `menuItems` widgets | Surface/item IDs, label keys, feature gates, relative placement |
| DataTable | Bound header/footer/toolbar/search-trailing and deep table surfaces | Column, row-action, bulk-action, filter, toolbar/render widgets | Base prefix versus `extensionTableId`, exact suffix, payload kind, execution guard |
| CrudForm | Bound base/header/fields plus lifecycle event pipeline and replacement handle | Rendered/field widgets and handler declarations | Entity ID, field/group IDs, create/update/delete filters, handler phases, request-header capability |
| Detail/portal/recursive UI | Detail/portal constants, page-bound spots, widget-level `InjectionSpot` | Rendered tab/group/status/wizard/provider widgets | Exact/pattern target, nesting owner, placement and context contract |
| Component replacement | Bound `useRegisteredComponent`/replacement handles | `widgets/components.ts` | Handle, mode, stable contribution ID, props contract reference |
| Response enrichment | CRUD/query route opt-in for target entity | `data/enrichers.ts` | Dotted target entity, list/detail surfaces, features, timeout/fallback, cache posture |
| Query enrichment | `QueryOptions.extensions` plus queryable entity/engine | Enricher `queryEngine` config | Engines, `applyOn`, caller-opt-in activation, same enricher ID |
| API interception | CRUD route pipeline or explicit custom-route bridge | `api/interceptors.ts` | Route/method, before/after phases, timeout/fail posture, override key |
| Command interception | Generated command ID and command bus lifecycle | `commands/interceptors.ts` | Target command/pattern, execute/undo phases, features, override key |
| Mutation guards | CRUD/custom route entity-operation guard bridge | `data/guards.ts` | Entity, operations, block/rewrite/after-success capability, locking preservation |
| Entity/custom-data extension | Existing entity fact and extension DSL host ID | `data/extensions.ts` / `ce.ts` declarations | Host scalar ID, extension entity/link ID, scope/orphan semantics; reference existing entity facts |
| Async/sync subscribers | Existing event facts and derived CRUD lifecycle events | `subscribers/*.ts` metadata | Event/pattern, subscriber ID, persistent/sync/priority, before/after capability |
| Query lifecycle events | Derived `<module>.<entity>.querying|queried` for queryable entities | Sync subscriber patterns | Engine, before/after, block/query/result transform capability, caller-opt-in activation |
| DOM/portal event bridge | Event facts with `clientBroadcast` / `portalBroadcast` | `useAppEvent`, `useOperationProgress`, portal hooks, reactive notification handlers | Transport, audience/scoping requirement, max payload/dedup contract reference |
| Dashboard/notification/integration UI | Framework dashboard/notification/integration-detail hosts | Dashboard widgets, notification handlers/renderers, typed integration definition/widgets | Registry ID/key, target surface, specialist route, override domain |
| Specialized vector/AI/provider registries | Existing search/vector/agent/provider/domain facts | `search.ts`, `vector.ts`, AI agents/tools/extensions, payment/shipping/currency/workflow definitions | Stable registry ID, specialist route, source fact/ref; no invented generic UMES target |
| Unified replacement overrides | Existing route/page/event/worker/widget/agent/tool/setup/ACL/DI/encryption facts | `src/modules.ts` `entry.overrides` | All wired domains, exact override key, `null`/replacement/additive shape, source fact reference |

## Repository-wide module audit — 2026-08-01

The audit scanned non-test `.ts`/`.tsx` under every `packages/*/src/modules/<id>` root and classified literal, helper-built, conditional, forwarded, and dynamic host call sites. It also inspected every generator-recognized UMES convention and specialized registration family. Four IDs have multiple providers (`events`, `notifications`, `payment_gateways`, `workflows`); implementation continues using the current resolver’s provider-selection rules.

Legend: **table** = DataTable token that expands to real base/deep hosts; **spot** = explicit/custom injection host; **handle** = component replacement host; **pattern** = runtime-selected family. “None detected” is still a required generated fact result.

| Module | Current host evidence | Catalog/migration note |
|---|---|---|
| `ai_assistant` | None detected | Emit an empty host catalog. |
| `api_docs` | None detected | Emit an empty host catalog. |
| `api_keys` | 1 table | Declare `api_keys.list`. |
| `attachments` | None detected | Existing entity facts remain separate; emit an empty host catalog. |
| `audit_logs` | 2 tables | Declare access and actions table families. |
| `auth` | 1 spot, 2 tables | Declare `auth.login:form` and user/role table families. |
| `business_rules` | 1 table | Declare its rendered table only; empty convention files are not hosts. |
| `catalog` | 2 spots, 2 tables | Preserve distinct `catalog.products` base and `catalog.products.list` deep-table IDs. |
| `channel_gmail` | None detected | Provider registrations do not make this a host; emit an empty catalog. |
| `channel_imap` | None detected | Provider registrations do not make this a host; emit an empty catalog. |
| `checkout` | 25 spots, 3 tables, 11 handles | Migrate pay-page spots and section handles as typed families without changing IDs. |
| `communication_channels` | 1 spot, 2 tables | Declare the rendered spot and table families only. |
| `configs` | 1 spot | Declare `configs.system_status:details`. |
| `content` | None detected | Emit an empty host catalog. |
| `currencies` | 2 tables | Declare currencies and exchange-rate table families. |
| `customer_accounts` | 2 tables | Declare the rendered table families only. |
| `customers` | 14 spots, 4 tables | Preserve legacy and v2 detail IDs as separate hosts. |
| `dashboards` | None in module pages | Dashboard layout hosts are framework-owned; do not assign them to this module. |
| `data_sync` | 1 table | Declare the runs table family. |
| `dictionaries` | None detected | Emit an empty host catalog. |
| `directory` | 2 tables | Declare tenant and organization table families. |
| `entities` | 2 tables | Declare system/user table families; require a pattern for any open record-table address. |
| `events` | None detected | Event contracts remain in the existing Events facts section. |
| `feature_toggles` | None detected | Emit an empty host catalog. |
| `gateway_stripe` | None detected | Provider definitions are not hosts; emit an empty catalog. |
| `generators` | None detected | Emit an empty host catalog. |
| `inbox_ops` | None detected | Empty extension declarations are not hosts. |
| `integrations` | Provider-selected pattern | Declare `integrations.detail:{integrationId}` plus frozen fallback `integrations.detail:tabs`. |
| `messages` | 3 spots, 1 table | Declare compose, detail, and table surfaces; replace comment-only documentation with facts. |
| `notifications` | None detected | Notification contracts remain in their existing facts section. |
| `onboarding` | None detected | Emit an empty host catalog. |
| `payment_gateways` | 1 spot, 1 table | Declare its rendered detail spot and table family. |
| `perspectives` | None detected | Persistence/service `tableId` values are false positives and must be rejected. |
| `planner` | None detected | Emit an empty host catalog. |
| `portal` | 12 exact page spots | Declare page before/after hosts; keep global portal menu/chrome framework-owned. |
| `progress` | None detected | Emit an empty host catalog. |
| `query_index` | 1 table | Declare the status table family. |
| `record_locks` | None detected | Wildcard outgoing registrations do not prove a host; emit an empty catalog. |
| `resources` | 2 tables | Declare resource and resource-type table families. |
| `sales` | 2 exact spots, 2 tables, 1 conditional pattern | Declare order/quote detail patterns and the order-item column host. |
| `scheduler` | None detected | Emit an empty host catalog. |
| `search` | None detected | Search entity facts remain separate. |
| `security` | 2 spots, 3 tables | Declare the rendered MFA/login and table surfaces without inventorying consumers. |
| `shipping_carriers` | None detected | Outgoing sales registrations are not hosts; emit an empty catalog. |
| `sso` | None detected | Outgoing integration registrations are not hosts; emit an empty catalog. |
| `staff` | None detected | Outgoing sidebar/dashboard registrations are not hosts; emit an empty catalog. |
| `storage_s3` | None detected | A typed provider definition is not an extension host. |
| `sync_akeneo` | None detected | Provider registrations are not hosts; emit an empty catalog. |
| `sync_excel` | None detected | A forwarded `spotId` is host context, not a new host binding. |
| `system_status_overlays` | None detected | Global/config registrations are not hosts; emit an empty catalog. |
| `translations` | None detected | Outgoing CrudForm registrations are not hosts; emit an empty catalog. |
| `webhooks` | 3 tables | Declare the rendered table families. |
| `wms` | 11 tables | Declare the rendered warehouse table families. |
| `workflows` | 3 tables | Declare the rendered workflow table families. |

Outgoing contribution audit (modules omitted from this table still emit `contributions: []`; existing event/entity/API/search facts remain referenced independently):

| Module | Outgoing UMES/specialized evidence |
|---|---|
| `ai_assistant` | Subscriber, DOM-bridge events, AI agents/tools/extensions. |
| `business_rules` | Subscribers; empty entity-extension declaration is omitted. |
| `catalog` | Injection widgets, subscriber, DOM-bridge events. |
| `channel_gmail`, `channel_imap` | Provider detail/profile injection widgets. |
| `checkout` | Injection widgets, subscribers, DOM-bridge events; empty component-override array is omitted. |
| `communication_channels` | Response enrichers, command interceptors, entity extensions, notification handlers, injection widgets, subscribers, DOM-bridge events; empty component overrides are omitted. |
| `customer_accounts` | API interceptors, response enrichers, mutation guards, entity extensions, injection widgets, subscribers, DOM and portal bridge events. |
| `customers` | Response enrichers, mutation guards, entity extensions, injection/dashboard widgets, subscribers, DOM-bridge events. |
| `dashboards` | Dashboard widget registry entries. |
| `directory` | Subscriber registrations. |
| `gateway_stripe` | Typed payment/integration provider registration and detail widget. |
| `inbox_ops` | Subscribers and inbox actions; empty entity-extension declaration is omitted. |
| `integrations` | Response enrichers and provider-detail injection widgets. |
| `messages` | Message definitions, subscribers, DOM-bridge events. |
| `notifications` | Notification types/renderers, subscriber, DOM-bridge events. |
| `payment_gateways` | API interceptor, response enricher, detail/table injection widgets, typed gateway registry. |
| `progress` | DOM-bridge progress events consumed through `useOperationProgress`. |
| `query_index` | Subscriber registrations and query-index/search facts. |
| `record_locks` | Notification handlers, wildcard injection widgets, subscribers. |
| `sales` | Response enrichers, injection/dashboard widgets, subscribers, workflow definitions. |
| `search` | Search/vector configuration and subscribers. |
| `security` | API/command interceptors, component overrides, injection widgets, subscribers. |
| `shipping_carriers` | API interceptor, response enricher, injection widgets, typed carrier registry. |
| `sso` | Injection widgets and subscriber. |
| `staff` | API interceptor, response enricher, injection/dashboard widgets. |
| `storage_s3` | Typed storage/integration provider definition; no fictional widget contribution. |
| `sync_akeneo`, `sync_excel` | Provider-detail injection widgets; forwarded host context is not a new host. |
| `system_status_overlays` | Global/config status injection widgets and subscriber. |
| `translations` | CrudForm field widgets and subscribers. |
| `webhooks` | Integration/detail injection widgets, subscribers, DOM-bridge events. |
| `wms` | API interceptors, response enrichers, injection widgets, subscribers. |
| `workflows` | Injection widgets, subscribers, typed workflow registry; empty entity extensions are omitted. |

Audit lessons that are normative for implementation:

1. Scanning every `tableId` property is insufficient: service/persistence `tableId` values are false positives, while explicit `injectionSpotId` values are false negatives.
2. A DataTable may use different IDs for its rendered base spot and deep extensions; facts must model the host instance, not merely a token list.
3. A widget forwarding `context.integrationDetailWidgetSpotId` is a host consumer, not a new host; it remains an outgoing contribution with the forwarded target provenance.
4. Empty convention arrays emit no contribution.
5. Comments listing intended handles do not prove a runtime handle; only a declaration bound to a host call site does.
6. Dynamic hosts must be patterns with named parameters, not guessed enumerations.
7. `CrudFormInjectionSpots.beforeFields/afterFields/footer/sidebar/group/fieldBefore/fieldAfter` and `DataTableInjectionSpots.emptyState` are helper-only today; the catalog must mark them unbound instead of recommending them.
8. DataTable’s base string is a prefix/configuration token, not a rendered base `InjectionSpot`; only its bound suffixes are mountable.

## 📝 Proposed Solution

### 1. Canonical host evidence

Add the optional, additive module-root convention `extension-points.ts` only for UI hosts that have no existing canonical fact source:

```ts
import {
  defineModuleExtensionPoints,
  dataTableExtensionHost,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'catalog',
  hosts: {
    productsTable: dataTableExtensionHost({
      baseSpotId: 'data-table:catalog.products',
      tableId: 'catalog.products.list',
      source: 'components/products/ProductsDataTable.tsx',
    }),
    productForm: injectionExtensionHost({
      spotId: 'crud-form:catalog.product',
      family: 'crud-form',
      contextContract: 'ui.crud-form.v1',
      dataContract: 'catalog.product-form.v1',
      supported: ['render-widget', 'field-widget', 'lifecycle-handler'],
      source: 'backend/catalog/products/[id]/page.tsx',
    }),
  },
})

export default extensionPoints
```

The helper returns immutable IDs/descriptors. Host call sites import and use these values; the declaration is not a parallel documentation copy:

```tsx
<DataTable
  injectionSpotId={extensionPoints.hosts.productsTable.baseSpotId}
  perspective={{ tableId: extensionPoints.hosts.productsTable.tableId }}
/>
```

Rules:

- `moduleId` is plural snake_case where normal module naming applies.
- Host keys are stable internal symbols; public/frozen addresses are the declared IDs.
- Exact hosts use `spotId`; dynamic hosts use `pattern` and named `parameters`.
- `source` is module-relative and points to the binding call site. Generated output records the path and exported host key, never line numbers.
- Standard families (`data-table`, `crud-form`, `detail`, `portal-page`, `menu`, `generic`, `component-handle`) provide canonical context/capability defaults. Custom hosts declare `contextContract`, `dataContract` when data is supplied, and supported attachment capabilities.
- The helper is isomorphic and data-only: no React import, DI, database, or runtime registration side effect.
- A module with no hosts omits `extension-points.ts`; the fact generator still emits `_none_`.
- Existing event, entity, route, command, notification, search/vector, AI, provider, and override sources remain canonical. Their UMES host rows use a `fact-ref` rather than copying the full payload into `extension-points.ts`.
- Existing CLI generator readers for convention files and generated registries are factored into reusable readers. The catalog must not create a competing parser whose interpretation can diverge from generated runtime registries.

### 2. Standard host-family expansion

The catalog reports only surfaces the runtime actually binds:

| Family | Declared input | Generated concrete surfaces |
|---|---|---|
| DataTable | `baseSpotId?`, `tableId` | Bound render spots `:header`, `:footer`, `:toolbar`, and conditional `:search-trailing`; headless `:columns`, `:row-actions`, `:bulk-actions`, and `:filters`; component handle `data-table:<tableId>`. The base value is a prefix/configuration token, not a rendered base spot. `baseSpotId` and deep `extensionTableId` may differ. |
| CrudForm | `spotId` / entity ID | Bound base render/lifecycle host, `:header`, headless `:fields`, and component handle; lifecycle handlers `transformFormData`, `transformValidation`, `onBeforeSave`, `onSave`, `onAfterSave`, delete aliases/errors, `onFieldChange`, `onBeforeNavigate`, and operation filters. |
| Detail/portal/menu/generic | exact `spotId` or pattern | The declared host only, plus explicitly declared child spots. |
| Component handle | `componentId` | One replacement/wrapper/props-transform target. |

The family definitions live beside the existing spot-ID helpers and are used by runtime components/tests as the rendered-surface contract. `DataTableInjectionSpots.emptyState` and `CrudFormInjectionSpots.beforeFields/afterFields/footer/sidebar/group/fieldBefore/fieldAfter` remain emitted only as `bound: false` diagnostics; agents must not receive them as usable targets. A parity test fails if DataTable/CrudForm binds or unbinds a suffix/handler without updating the family descriptor.

### 3. Dynamic host patterns

Patterns are first-class facts:

```ts
integrationDetail: injectionExtensionHost({
  pattern: 'integrations.detail:{integrationId}',
  parameters: {
    integrationId: { source: 'IntegrationDefinition.id', pattern: '^[a-z0-9_]+$' },
  },
  fallbacks: ['integrations.detail:tabs'],
  family: 'integration-detail',
  contextContract: 'integrations.detail.v1',
  supported: ['render-widget', 'tab-widget', 'group-widget'],
  source: 'backend/integrations/[id]/page.tsx',
})
```

The generator emits the pattern, parameter constraints, and fallback without expanding arbitrary IDs. An unclassified dynamic expression is emitted in `warnings` during migration and is a repository-test failure before completion; the final first-party baseline has zero unclassified host call sites.

### 4. Bidirectional generated facts

Add one optional field to `ModuleFacts` / `ModuleFactsJsonEntry`:

```ts
export type ModuleExtensionSurfaceFacts = {
  hosts: ModuleExtensionHostFact[]
  contributions: ModuleExtensionContributionFact[]
  unresolved: ModuleExtensionUnresolvedFact[]
}

export type ExtensionHostFamily =
  | 'generic'
  | 'menu'
  | 'data-table'
  | 'crud-form'
  | 'detail'
  | 'portal-page'
  | 'component-handle'
  | 'entity'
  | 'api-route'
  | 'command'
  | 'event'
  | 'query-lifecycle'
  | 'dashboard'
  | 'notification'
  | 'integration'
  | 'specialized-registry'
  | 'module-override'

export type ExtensionHostCapability =
  | 'render-widget'
  | 'headless-widget'
  | 'menu-item'
  | 'column-widget'
  | 'row-action'
  | 'bulk-action'
  | 'filter-widget'
  | 'toolbar-widget'
  | 'field-widget'
  | 'lifecycle-handler'
  | 'component-replacement'
  | 'response-enricher'
  | 'query-enricher'
  | 'api-interceptor'
  | 'command-interceptor'
  | 'mutation-guard'
  | 'entity-extension'
  | 'async-subscriber'
  | 'sync-subscriber'
  | 'browser-client'
  | 'browser-portal'
  | 'registry-contribution'
  | 'module-override'

export type ModuleExtensionHostFact = {
  key: string
  id: string
  resolution: 'exact' | 'pattern' | 'framework' | 'fact-ref'
  family: ExtensionHostFamily
  ownerModule: string
  capabilities: ExtensionHostCapability[]
  phases?: string[]
  operations?: string[]
  contextContract?: string
  dataContract?: string
  scopeContract?: string
  runtimeContract?: string
  activation?: 'always' | 'host-opt-in' | 'caller-opt-in' | 'feature-gated'
  bound: boolean
  stability: 'frozen' | 'stable'
  source:
    | { kind: 'declaration'; path: string; symbol: string }
    | { kind: 'fact-ref'; factSection: string; factKey: string }
    | { kind: 'framework'; path: string; symbol: string }
  aliases?: string[]
  patternParameters?: Record<string, { source: string; pattern?: string }>
  fallbacks?: string[]
}

export type ModuleExtensionTargetFact = {
  id: string
  resolution: 'exact' | 'pattern' | 'framework' | 'fact-ref' | 'optional-external' | 'unresolved'
  factRef?: { factSection: string; factKey: string }
  optionalOwnerPackage?: string
}

export type ModuleExtensionContributionBase = {
  id: string
  targets: ModuleExtensionTargetFact[]
  phases?: string[]
  operations?: string[]
  features?: string[]
  scopeContract: string
  activation?: 'always' | 'host-opt-in' | 'caller-opt-in' | 'feature-gated'
  placement?: { relativeTo?: string; position?: 'first' | 'last' | 'before' | 'after'; priority?: number }
  roundTripId?: string
  override?: {
    domain: string
    key: string
    mode: 'disable-replace' | 'replace' | 'additive'
  }
  source: { path: string; symbol?: string }
}

export type ModuleExtensionContributionFact = ModuleExtensionContributionBase & (
  | {
      kind: 'widget'
      details: {
        payload: 'render' | 'headless' | 'menu' | 'dashboard' | 'notification' | 'integration'
        registryKey: string
        itemIds?: string[]
        labelKeys?: string[]
        contextContract?: string
        dataContract?: string
        executionGuard: 'host' | 'contribution' | 'both'
      }
    }
  | {
      kind: 'data-table'
      details: {
        payload: 'column' | 'row-action' | 'bulk-action' | 'filter' | 'toolbar' | 'render'
        tableId: string
        executionGuard: 'host' | 'contribution' | 'both'
      }
    }
  | {
      kind: 'crud-form'
      details: {
        payload: 'render' | 'field' | 'lifecycle-handler'
        entityId: string
        fieldIds?: string[]
        groupIds?: string[]
        requestHeaderCapability: boolean
      }
    }
  | {
      kind: 'component-override'
      details: { handle: string; mode: 'replace' | 'wrapper' | 'props'; propsContract: string }
    }
  | {
      kind: 'response-enricher'
      details: {
        targetEntity: string
        surfaces: Array<'list' | 'detail'>
        timeoutMs: number
        fallback: 'none' | 'configured'
        critical: boolean
        cachePosture: 'record-pure' | 'rerun-on-list-cache-hit'
        queryEngine?: {
          engines: string[]
          applyOn: Array<'list' | 'detail'>
          activation: 'caller-opt-in'
        }
      }
    }
  | {
      kind: 'api-interceptor'
      details: {
        route: string
        methods: string[]
        phases: Array<'before' | 'after'>
        activation: 'crud-pipeline' | 'custom-route-bridge'
        timeoutMs: number
        failurePosture: 'fail-closed' | 'fallback'
      }
    }
  | {
      kind: 'command-interceptor'
      details: {
        targetCommand: string
        phases: Array<'before-execute' | 'after-execute' | 'before-undo' | 'after-undo'>
      }
    }
  | {
      kind: 'mutation-guard'
      details: {
        entityId: string
        operations: Array<'create' | 'update' | 'delete'>
        capabilities: Array<'block' | 'rewrite' | 'after-success'>
        optimisticLock: 'preserved'
      }
    }
  | {
      kind: 'entity-extension'
      details: {
        hostEntityId: string
        extensionEntityId: string
        linkId: string
        scopeContract: string
        orphanContract: string
      }
    }
  | {
      kind: 'subscriber'
      details: {
        event: string
        subscriberId: string
        persistent: boolean
        sync: boolean
        priority?: number
      }
    }
  | {
      kind: 'browser-reaction'
      details: {
        transports: Array<'client' | 'portal' | 'notification-effect'>
        hooks: string[]
        audienceScopeContract: string
        maxPayloadBytes?: number
        dedupWindowMs?: number
      }
    }
  | {
      kind: 'specialized-registry'
      details: {
        registry: 'notification' | 'integration' | 'search' | 'vector' | 'ai' | 'payment' | 'shipping' | 'currency' | 'workflow'
        registryId: string
        specialistRoute: string
      }
    }
  | {
      kind: 'module-override'
      details: {
        domain: string
        key: string
        mode: 'disable-replace' | 'replace' | 'additive'
      }
    }
)

export type ModuleExtensionUnresolvedFact = {
  key: string
  source: { path: string; symbol?: string }
  reason:
    | 'unclassified-binding'
    | 'unbound-declaration'
    | 'dynamic-without-pattern'
    | 'unresolved-first-party-target'
}
```

The host capability union and discriminated contribution-detail union cover every row of the normative UMES inventory. Kind-specific details are required, not a loose metadata bag: readers cannot silently omit timeout/fallback/cache posture, activation, delivery mode, scope contracts, execution guards, link/orphan semantics, or override identity when the source contract defines them. `factRef` and `optionalOwnerPackage` preserve correlation provenance without copying an existing contract. Existing fact sections stay authoritative: an event host references the event fact and adds sync/async subscription and browser-transport capabilities; an entity host references the entity fact and adds enricher/guard/query/extension capability; a route or command host references its route/command fact and adds phases and override identity. Imported/computed definitions that cannot be resolved become visible diagnostics, never silent absence.

### 5. Generated Markdown

Each `.ai/guides/modules/<module>.md` gains two compact sections:

```markdown
## UMES hosts

| ID / pattern | Family | Supports | Context | Stability |
|---|---|---|---|---|
| data-table:catalog.products | data-table/base | render-widget | ui.data-table.v1 | FROZEN |
| data-table:catalog.products.list:columns | data-table/columns | column-widget | ui.data-table.v1 | FROZEN |
| crud-form:catalog.product:fields | crud-form/fields | field-widget | ui.crud-form.v1 | FROZEN |

## UMES contributions

| ID | Kind | Target | Phase / operations | Contract | Resolution |
|---|---|---|---|---|---|
| catalog.product-columns | data-table/columns | data-table:catalog.products.list:columns | read | column; guard=both | exact |
| catalog.product-enricher | response/query-enricher | catalog.product | list, detail / caller opt-in query | timeout=2000; fallback=configured; cache=rerun | fact-ref |
```

The `Contract` cell is a deterministic compact rendering of the kind-specific `details`; it never embeds fallback values, function bodies, or source text. Rows with a common `roundTripId` link read enrichment, field/column display, request headers, and write handlers without embedding source. The existing `Host extension points` token summary remains byte-compatible in shape and heading.

### 6. Framework-owned global hosts

Global shell/menu/status/dashboard/notification/integration hosts are not falsely assigned to a business module. Generate `.ai/guides/framework-extension-points.md` (and a sibling machine-readable artifact only if the harness needs it) from canonical UI constants and framework registries. Do not add `$framework` or another fake module key to the frozen top-level `module-facts.json` record.

### 7. Relationship to Platform Map

The Platform Map remains runtime/on-demand introspection for the enabled app. This catalog is package-time authoring metadata for standalone agents. To avoid semantic divergence:

- Reuse Platform Map surface names where they overlap (`widget-spot`, `widget`, `component-override`, `enricher`, `interceptor`, `command-interceptor`, `guard`).
- Keep the fact types serializable and isomorphic.
- Leave a future adapter free to prefer declared host facts over inferring hosts from registered widget targets.
- Do not make this spec depend on PR #3722 landing and do not modify its UI/API scope here.

### 8. Contribution extraction and target correlation

Reuse the readers that already power injection, component, enricher, interceptor, guard, entity-extension, subscriber, notification, dashboard, integration, and specialized registry generation. Empty arrays emit no contribution. Each outgoing record resolves its target as `exact`, `pattern`, `framework`, `fact-ref`, `optional-external`, or `unresolved`:

- A first-party exact target missing from host/framework/existing facts is a repository-test failure.
- Wildcard and parameterized targets resolve against declared patterns without enumerating arbitrary IDs.
- Optional integrations may target a host owned by an absent package and remain `optional-external` with explicit provenance.
- Registrations with no generic UMES target use a `specialistRoute` and source fact reference instead of inventing a widget host.
- Unified override entries expose the exact domain/key and disable/replace/additive mode for every wired override domain, including routes/pages, subscribers/workers, widgets/components/dashboard, notifications, interceptors/enrichers/guards, AI, CLI/setup/ACL/DI, and encryption maps.
- Query lifecycle targets are derived as `<module>.<entity>.querying|queried`; facts state that execution requires caller-provided `QueryOptions.extensions` context and that post-result tenant scope is reapplied.
- `clientBroadcast` and `portalBroadcast` are projected from event definitions. A transport flag does not imply delivery without runtime tenant/organization/customer audience scope.

## 📝 Architecture

```text
package module source
  extension-points.ts + bound UI hosts ────────┐
  existing event/entity/route/command facts ───┤
  convention files + generated registries ─────┤
  modules.ts unified overrides ─────────────────┘
                         │
          reused CLI readers + correlation/diagnostics
                         │
              existing package/module resolver
                         │
                module-facts projection
            ┌────────────┼────────────────┐
            ▼            ▼                ▼
 modules/<id>.md  module-facts.json  framework-extension-points.md
            └────────────┼────────────────┘
                         ▼
              standalone guide + harness
```

### Boundaries

- `packages/shared`: serializable fact/declaration types only; query/entity/event sources remain unchanged.
- `packages/cli`: existing reader factoring, host extraction, contribution projection, target correlation, binding verification, diagnostics, and Markdown/JSON rendering.
- package modules: UI declarations and call-site binding where needed; existing convention files remain runtime and fact sources.
- `packages/events` / `packages/ui`: existing DOM/portal bridge and CrudForm/DataTable behavior is described, not changed.
- `packages/create-app`: ships enabled module sheets plus the framework catalog and updates agent routing/harness provenance.
- Platform Map/runtime: unchanged.

### Why a declaration plus a guard, not AST heuristics alone

AST heuristics can bootstrap UI-host migration but cannot safely infer semantic ownership, context contracts, helper-built patterns, or whether a forwarded `spotId` is a host. A hand-written list alone can drift. The UI declaration provides meaning and the call-site guard proves it remains bound; outgoing facts come from the same convention/registry readers as runtime generation.

## 📝 Data Models

No database entities or migrations are introduced. The data model is the generated serializable fact shape above plus additive references from existing event/entity/API/command facts.

Contract rules:

- Host arrays sort by `family`, `id`, and source path; contributions sort by `kind`, `id`, target, and source path.
- `id` contains the exact frozen ID; `pattern` facts serialize their template in `id` with `{parameter}` placeholders.
- No function bodies, React components, user data, secrets, credentials, descriptions containing user data, or resolved DI instances enter JSON.
- Context/data contracts are stable symbolic IDs, not TypeScript source dumps.
- `unresolved` includes sanitized module-relative provenance and reason only.
- Empty convention arrays produce no contribution; every resolved module still emits empty `hosts`/`contributions` arrays.
- Contribution correlation never changes runtime order, priority, feature gates, timeout/fallback, tenant scope, or optimistic-lock behavior.
- Duplicate module IDs continue through the existing resolver and selected-provider rule.

## 📝 API Contracts

### HTTP/API

N/A. No HTTP endpoint is added or changed.

### Generated JSON compatibility

The top-level `module-facts.json` remains `Record<moduleId, ModuleFactsJsonEntry>`. Do not add `$schema`, `framework`, or another non-module key. Additive entry fields:

```ts
export interface ModuleFactsJsonEntry {
  // all existing required fields unchanged
  extensionSurfaces?: ModuleExtensionSurfaceFacts
}
```

The property is optional in the exported interface for source compatibility with external constructors, but the current generator always emits it (including empty arrays). Existing `hostTokens` remains required and unchanged.

Existing event facts gain optional `clientBroadcast` and `portalBroadcast` booleans. Existing entity, route, and command sections gain only the smallest optional reference/capability fields needed to avoid copying their contracts into `extensionSurfaces`. Framework facts are emitted in a separate artifact, never a top-level module key.

### Declaration helper contract

`defineModuleExtensionPoints`, family helpers, and required declaration fields become STABLE exported APIs. `extension-points.ts` plus its `extensionPoints` export becomes an additive FROZEN auto-discovery convention once released. The contribution readers expose internal normalized records for generator reuse but do not create a new public runtime API. This addition must be documented in `BACKWARD_COMPATIBILITY.md` and module-development guidance.

## Internationalization

N/A. Generated technical IDs and contract names are developer tooling, not end-user strings. Module titles/descriptions continue through the existing facts behavior. Do not introduce new UI copy.

## UI/UX

N/A. There is no rendered application surface. The developer experience is the generated Markdown table. Consequently no frontend architecture contract, screenshots, mockups, design-system changes, or manual UI QA are required.

## Edge Cases & Failure Scenarios

- **Split DataTable IDs:** emit base and deep families separately; do not collapse `catalog.products` into `catalog.products.list`.
- **DataTable prefix versus mount:** do not report its base prefix as a rendered `InjectionSpot`; report only bound suffixes/headless surfaces and the replacement handle.
- **Helper-only IDs:** retain `bound: false` diagnostics for DataTable `emptyState` and unused CrudForm helper builders, and exclude them from agent recommendations.
- **CrudForm mixed pipeline:** distinguish rendered base/header, headless fields, replacement handle, transform/save/delete/field/navigation handlers, and create/update/delete operation filters.
- **Conditional tables:** a closed literal conditional (orders/quotes) emits both exact hosts; an open value becomes a pattern only with a declaration.
- **Wildcard host declarations:** preserve wildcard syntax as a pattern and never expand it to every module.
- **Provider-selected detail spots:** emit the integration host pattern, parameter contract, and legacy fallback.
- **Legacy aliases:** emit all live aliases and identify the primary declaration without renaming either.
- **Empty host declarations:** emit zero hosts, not a placeholder surface.
- **Empty contribution arrays:** emit no contribution; never infer intent from filename presence.
- **Forwarded props:** classify a value forwarded into a child/widget as a binding/consumer, not a new host.
- **Optional external target:** preserve the declared target and mark it optional without failing when its provider package is not installed.
- **Specialized registrations:** point to the AI/search/vector/provider/workflow route; do not invent a generic UMES spot.
- **Custom routes and query engines:** report host/caller opt-in activation; convention presence alone does not prove the custom route or query call executes the mechanism.
- **Query lifecycle:** derive `.querying`/`.queried` only for queryable entity IDs and preserve block/query/result-transform phases plus post-result scope enforcement.
- **Browser transport:** report DOM/portal availability from event flags while making audience scope and client hook selection explicit.
- **Unresolved first-party binding/target:** emit sanitized provenance and fail the repository coverage test with module, key, source, and expected resolution class.
- **Compiled-only packages:** facts remain created at package/create-app build time from source, matching the parent specs; no runtime JS extraction is added.
- **Duplicate module providers:** use the selected provider exactly as current discovery does; never merge incompatible facts under one ID.
- **New runtime suffix:** parity tests fail until the standard family descriptor and generated facts are updated in the same change.

## Migration & Backward Compatibility

This is additive but touches FROZEN/STABLE surfaces, so implementation follows `BACKWARD_COMPATIBILITY.md`:

1. Add `extension-points.ts` as a new convention; do not rename any existing convention.
2. Move only raw UI-host literals lacking canonical facts into declarations without changing byte values or runtime resolution order.
3. Read existing event/entity/route/command and registry/convention sources by reference; do not duplicate them into `extension-points.ts`.
4. Preserve every existing wildcard, alias, fallback, context/data shape, component handle, ordering/priority, timeout/failure mode, feature guard, and override key.
5. Add optional fields to exported interfaces; never make existing consumers construct new required properties.
6. Preserve `hostTokens`, existing event/entity/API sections, their JSON shape, the top-level module record, and existing Markdown headings relied on by tests/harnesses.
7. Add the framework catalog as a sibling generated guide rather than a fake module-facts entry.
8. Factor current registry readers before adding projection/correlation so runtime generation and facts share one interpretation.
9. Update `BACKWARD_COMPATIBILITY.md`, `RELEASE_NOTES.md`, and `UPGRADE_NOTES.md` only if implementation introduces a deprecation. This spec introduces no deprecation by default.
10. Run `yarn generate` after module convention changes and verify no unintended generated registry drift. The module-facts artifacts remain build outputs, not a new committed app registry.

Rollback is code-only: revert the additive helper/declarations/readers/fact projection and restore literal bindings. No data rollback exists or is needed. Because IDs and registries never change, reverting does not strand third-party registrations.

## 📋 Phasing

### Phase 1 — Canonical host taxonomy and runtime parity

1. Add shared serializable types/helpers and bound-family descriptors.
2. Add `extension-points.ts` to all 24 audited UI-host modules, including provider-selected patterns, and bind call sites without behavior changes.
3. Project event/entity/API/command extension capability from existing facts, including browser flags and query lifecycle patterns.
4. Add repository-wide bound/unbound parity guards; reach zero unclassified first-party host sites.

Application behavior stays unchanged after every migration step because declarations return the exact strings used today.

### Phase 2 — Contribution extraction and correlation

5. Factor and reuse current generator readers for every additive UMES convention and specialized registry.
6. Normalize outgoing contributions, unified override identities, activation, phases, operations, features, and round-trip group IDs.
7. Correlate targets to exact, pattern, framework, fact-ref, or optional-external hosts; eliminate unresolved first-party targets across all 54 resolved module IDs.

### Phase 3 — Generated module and framework facts

8. Extend `ModuleFacts`, optional JSON types, deterministic Markdown/JSON renderers, and sanitized diagnostics.
9. Preserve/derive `hostTokens` and existing facts; generate per-module host/contribution sections and the separate framework catalog.
10. Add all-module, compatibility, output-size, and extraction-time evidence.

### Phase 4 — Standalone routing and harness

11. Update create-app’s extension guide/routing to prefer the named target module fact, framework catalog, and specialist route.
12. Strengthen OMH-088/OMH-089 and targeted cases for enrichers, interceptors, query events, DOM/portal bridge, menus, every bound CrudForm/DataTable family, correlation, and unified overrides.
13. Add the UMES umbrella spec to harness provenance as an **optional** reference: include `.ai/specs/implemented/SPEC-041-2026-02-24-universal-module-extension-system.md` in the relevant case `source.paths`, and permit it through `context.allowedExtra` only when a source-checkout fixture exposes it. The harness must pass both with and without the file; it is never required in standalone output.
14. Add the same optional upstream/repository-relative UMES link to generated `.ai/guides/extensions.md`; generated facts and the mechanism selector remain sufficient offline.
15. Update BC/module-development docs and run the focused/full validation gate.

These phases are one cohesive capability: complete installed UMES discovery and correct agent routing. Intermediate code remains behind the generator projection and creates no public artifact; the PR is not complete or releasable until all four phases land.

## 📋 Implementation Plan

### Expected file manifest

| File/area | Action | Purpose |
|---|---|---|
| `packages/shared/src/modules/widgets/extension-points.ts` | Create | Serializable UI-host declaration types/helpers and standard bound-family descriptors. |
| `packages/shared/src/lib/query/query-extension-runner.ts` tests/types | Modify only if needed | Project existing query lifecycle/activation facts without changing execution. |
| `packages/ui/src/backend/injection/spotIds.ts`, DataTable/CrudForm, and tests | Modify | Export/test actually bound render/headless/lifecycle families and helper-only negatives. |
| `packages/cli/src/lib/generators/module-extension-facts.ts` | Create | Host/contribution normalization, target correlation, sorting, and diagnostics. |
| Existing CLI convention/registry readers | Refactor | Share one normalized reader path with runtime registry generation. |
| `packages/cli/src/lib/generators/module-facts.ts` | Modify | Optional bidirectional facts, event flags/fact refs, framework catalog, Markdown/JSON projection; preserve legacy output. |
| `packages/*/src/modules/*/extension-points.ts` (host modules only) | Create | Authoritative per-module host declarations. |
| Host components/pages in the 24 audited modules | Modify | Replace duplicated raw strings with declaration values. |
| Existing UMES convention files and specialized registries | Read only by default | Canonical outgoing sources; change only if factoring exposes a real reader gap. |
| `packages/cli/src/lib/generators/__tests__/` | Modify/create | Bound-family, mechanism, correlation, all-module, framework, performance, and compatibility fixtures. |
| `packages/create-app/agentic/guides/extensions.md` | Modify | Route from mechanism choice to module/framework facts and add the optional UMES reference. |
| `packages/create-app/agentic/shared/ai/harness/cases.json` and validators | Modify | Strengthen OMH-088/089 and targeted routing/identifier/provenance coverage. |
| `.ai/docs/module-development.md`, `packages/core/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `RELEASE_NOTES.md` | Modify | Document additive convention and compatibility contract. |

### Implementation constraints

- No production dependency.
- Do not edit generated files manually.
- Use existing resolver/scanner/AST utilities; no second module discovery algorithm.
- Use existing convention/registry readers; parsing the same registry twice is a design failure.
- Keep output deterministic and bounded; do not embed implementation source.
- Preserve activation, feature, scope, priority/order, timeout/fallback, optimistic-lock, and before/after semantics; facts never enable a mechanism.
- A source reader warning must identify the module and convention path while avoiding secrets or source-body dumps.
- Call-site migration must be mechanical and behavior-preserving; any proposed ID correction is a separate, explicitly approved compatibility project.

## Integration & Test Coverage

This feature has no HTTP/UI runtime path. Integration coverage means generator/build/harness paths and must ship in the same implementation change.

| ID | Layer | Assertion |
|---|---|---|
| `T-EXTFACT-001` | shared/ui unit | DataTable emits all and only bound header/footer/toolbar/search-trailing, columns/row-actions/bulk-actions/filters, and replacement surfaces; its base prefix and `emptyState` helper are not mountable. |
| `T-EXTFACT-002` | shared/ui unit | CrudForm emits bound base/header/fields, replacement, every transform/save/delete/field/navigation handler and operation filter; helper-only builders remain `bound: false`. |
| `T-EXTFACT-003` | cli unit | Exact, conditional, wildcard, alias, parameterized, framework, and fact-ref hosts serialize deterministically; forwarded props and persistence `tableId` values are rejected as host evidence. |
| `T-EXTFACT-004` | cli fixture | `catalog` keeps split base/deep IDs; `checkout`, `customers`, and `integrations` preserve every live exact/pattern/alias/fallback handle. |
| `T-EXTFACT-005` | cli unit | Response enrichers include list/detail, features, timeout/fallback/cache posture; query enrichers include engines, `applyOn`, same ID, and caller-opt-in activation. |
| `T-EXTFACT-006` | cli unit | API interceptors expose route/method/before/after and bridge activation; command interceptors expose target/pattern and execute/undo; guards expose entity operations and block/rewrite/after semantics. |
| `T-EXTFACT-007` | cli unit | Entity extensions reference existing entity facts and preserve host/link/scope/orphan semantics; empty extension files emit nothing. |
| `T-EXTFACT-008` | cli/events unit | Subscribers expose async/sync/persistent/priority metadata; query entities derive `.querying`/`.queried`; events project `clientBroadcast`/`portalBroadcast` and scoping requirements. |
| `T-EXTFACT-009` | cli unit | Menu/dashboard/notification/integration/component and specialized AI/search/vector/provider/workflow registrations use exact framework or specialist routes and preserve override identity. |
| `T-EXTFACT-010` | correlation guard | Every first-party target resolves exact/pattern/framework/fact-ref; wildcard and optional-external targets are classified; empty arrays do not produce records; unresolved first-party targets fail. |
| `T-EXTFACT-011` | override guard | Every runtime-wired unified override domain/key is projected with disable/replace/additive mode, and unsupported keys are rejected. |
| `T-EXTFACT-012` | repo-wide guard | All non-test first-party host bindings are covered once and all 54 resolved module IDs emit deterministic host/contribution facts, including empty arrays. |
| `T-EXTFACT-013` | BC guard | A legacy `ModuleFactsJsonEntry` without `extensionSurfaces` type-checks; top-level JSON, `hostTokens`, existing sections, IDs, order, and generated headings remain compatible. |
| `T-EXTFACT-014` | create-app build | Enabled module sheets and framework facts ship; disabled module sheets are not linked; specialist routing remains available offline. |
| `T-EXTFACT-015` | standalone harness | Catalog-column and CrudForm-field prompts select exact deep/field IDs and complete read/write round trips without bulk fact reads or helper-only IDs. |
| `T-EXTFACT-016` | standalone harness | Enricher/interceptor/guard/query-event prompts select the correct target, activation, phases, operations, and scoped write requirements. |
| `T-EXTFACT-017` | standalone harness | DOM/portal/menu/provider prompts select the correct browser hook, audience scope, framework host, pattern, and specialist route. |
| `T-EXTFACT-018` | standalone harness | OMH-088 covers every additive UMES mechanism and OMH-089 covers every unified override domain using fact-first target resolution. |
| `T-EXTFACT-019` | standalone harness | OMH-088/089 pass with the UMES source path available via `allowedExtra` and with it absent; no case requires the spec in a standalone scaffold. |
| `T-EXTFACT-020` | performance | Record build duration and Markdown/JSON bytes before/after; reject duplicate registry parsing, source dumps, or an unbounded context regression. |

Focused validation:

```bash
yarn workspace @open-mercato/shared test --testPathPatterns=extension-points
yarn workspace @open-mercato/ui test --testPathPatterns='DataTable|CrudForm.*extension'
yarn workspace @open-mercato/cli test --testPathPatterns=module-facts
yarn workspace @open-mercato/create-app test
yarn agents:check-budget
yarn generate
```

Then run the configured validation sequence from `.ai/agentic.config.json`. The implementation report records one runner choice (Docker when the compose app container is running, otherwise local) for the entire gate.

## 📝 Risks & Impact Review

### Manifest/call-site drift

- **Scenario:** A developer adds an `InjectionSpot` literal or DataTable host without declaring it, or leaves a declaration after removing the binding.
- **Severity:** High
- **Affected area:** Third-party extension reliability and generated agent facts.
- **Mitigation:** Host call sites consume exported declaration values; repository-wide coverage guards detect unbound and undeclared hosts.
- **Residual risk:** Non-standard runtime-created hosts may require an explicit pattern declaration and reviewer attention.

### Incorrect host or contribution inference

- **Scenario:** The extractor mistakes a persistence `tableId` or forwarded widget `spotId` for a host, treats an empty convention file as a contribution, or loses phase/activation semantics while normalizing a registry.
- **Severity:** High
- **Affected area:** Module facts and generated third-party code.
- **Mitigation:** UI declarations are authoritative; AST scanning is a coverage verifier; outgoing projection reuses runtime generator readers. Fixtures cover `perspectives`, `sync_excel`, empty arrays, query opt-in, and route/command phases.
- **Residual risk:** A new custom host wrapper or registry family must be added to the explicit taxonomy and shared reader.

### Target-correlation false pass or false failure

- **Scenario:** A valid wildcard/optional integration is rejected, or a dangling first-party exact target is mislabeled optional and shown as usable.
- **Severity:** High
- **Affected area:** Extension correctness and optional-module independence.
- **Mitigation:** Resolution classes are explicit; only declared optional dependencies may use `optional-external`; wildcard/pattern matching is tested independently; unresolved first-party exact targets fail.
- **Residual risk:** Dynamic third-party IDs cannot be exhaustively proven at package build time and remain constrained patterns.

### Frozen-ID regression during migration

- **Scenario:** Moving a raw string into a declaration accidentally changes punctuation, alias precedence, wildcard semantics, or DataTable resolution order.
- **Severity:** High
- **Affected area:** Existing external modules.
- **Mitigation:** Snapshot IDs before migration, byte-compare before/after catalogs, preserve aliases/fallbacks, and run existing UMES integration tests. No ID cleanup is in scope.
- **Residual risk:** Undocumented consumers may depend on an ID that existing tests do not exercise; the repository audit and frozen-ID snapshots reduce this.

### JSON consumer breakage

- **Scenario:** An external consumer assumes every entry has only the old keys or constructs `ModuleFactsJsonEntry` directly.
- **Severity:** Medium
- **Affected area:** Standalone tooling using `module-facts.json` or CLI types.
- **Mitigation:** Add optional interface fields, retain all required keys and top-level record shape, and add a legacy fixture/type test.
- **Residual risk:** A consumer performing exact-key validation may reject additive data despite the additive contract; release notes call out the new optional field.

### Fact/context bloat

- **Scenario:** Listing every expanded host and contribution makes module sheets too large for agent routing budgets.
- **Severity:** Medium
- **Affected area:** Standalone agent performance and harness pass rate.
- **Mitigation:** Compact tables, fact references instead of duplicated contracts, stable IDs instead of source/type dumps, one target module sheet at a time, round-trip grouping, size metrics, and optional collapsing of standard family members in Markdown while keeping exact JSON rows.
- **Residual risk:** Very extensible modules such as checkout/customers remain larger; targeted facts are still much smaller than installed-source exploration.

### Generator cost

- **Scenario:** Declaration extraction, registry normalization, correlation, and binding verification materially slow create-app/CLI builds.
- **Severity:** Low
- **Affected area:** package build/scaffold time.
- **Mitigation:** Reuse existing resolver/scanner/registry readers, forbid duplicate parsing, measure Phase 3, and keep extraction source-only/static.
- **Residual risk:** A bounded build-time increase proportional to module/source count is acceptable if measured and documented.

### Sensitive metadata disclosure

- **Scenario:** A normalized contribution leaks function bodies, provider configuration, credentials, tenant/customer identifiers, or resolved DI values into generated facts.
- **Severity:** High
- **Affected area:** Generated standalone artifacts and repository safety.
- **Mitigation:** Emit only stable IDs, symbolic contract refs, safe feature/phase metadata, and module-relative provenance; schema tests reject values and source bodies.
- **Residual risk:** A future registry may add a descriptive field containing operational data and must be explicitly excluded by its reader.

### Platform Map semantic divergence

- **Scenario:** Runtime Platform Map calls a registered target a host while facts call only rendered declarations hosts.
- **Severity:** Medium
- **Affected area:** Developer understanding across CLI/UI/facts.
- **Mitigation:** Shared surface names, documented distinction, and a follow-up adapter; this spec does not alter the open implementation underneath reviewers.
- **Residual risk:** Until the adapter lands, runtime and package-time views answer different but explicit questions.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md` — Extensibility Contract, Widget/Menu Injection, Component Replacement, Enrichers, API/command interceptors, guards, extensions, events
- `packages/ui/AGENTS.md` — DataTable, CrudForm injection, menu/component/portal extension
- `packages/events/AGENTS.md` — DOM Event Bridge and browser broadcast
- `packages/shared/AGENTS.md` — Query Engine Extensibility
- `packages/cli/AGENTS.md` — generator system and validation
- `packages/create-app/AGENTS.md` — agentic setup maintenance and template sync
- `packages/create-app/agentic/shared/ai/skills/om-system-extension/SKILL.md` and references — complete UMES routing, round trips, unified overrides, and verification
- `.ai/docs/module-development.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root + core | Preserve module isolation; optional consumer owns glue | Compliant | Catalog is read-only metadata; no cross-module import or ORM relationship is added. |
| Root + BC | Frozen widget spot IDs cannot be renamed/removed | Compliant | Migration preserves byte values, aliases, wildcard semantics, context, and resolution order. |
| BC auto-discovery | New convention may be added; existing conventions immutable | Compliant | Adds optional `extension-points.ts` and documents it; removes nothing. |
| BC types/signatures | Required fields cannot be added to stable consumers in a breaking way | Compliant | New JSON/type property is optional; helper APIs are additive; newly introduced discriminated detail records define the complete contract before first release. |
| BC generated files | Generated output shape remains compatible | Compliant | Top-level record and existing required fields/exports remain unchanged. |
| Core UMES | Keep IDs, phases, ordering, feature guards, timeouts, and canonical convention readers stable | Compliant | Facts reference existing contracts and reuse registry readers; no runtime activation changes. |
| Core extensions | Cross-module data links use `data/extensions.ts` | Compliant | Catalog reads extension declarations and existing entity facts; it creates no relation. |
| UI DataTable/CrudForm | Keep stable IDs and distinguish bound from helper-only surfaces | Compliant | Facts preserve every bound render/headless/lifecycle surface and negatively classify unused helpers. |
| Events/shared | Browser/query extension paths preserve audience/tenant scope and caller opt-in | Compliant | Facts expose activation and transport without weakening runtime scope enforcement. |
| CLI | Reuse generator infrastructure; do not hand-edit generated files | Compliant | Reuses resolver/readers and updates source generators/tests only. |
| Create-app | Keep agentic source/template/build consumers synchronized | Compliant | Guide, framework facts, OMH-088/089, optional UMES provenance, and build tests are one phase. |
| Root testing | Feature specs include integration coverage for affected paths | Compliant | Build, generated facts, binding parity, BC, and standalone harness paths are specified; no runtime UI/API exists. |
| Root design system / frontend contract | UI changes require DS and client-boundary evidence | N/A | No rendered UI or Next.js boundary changes. |
| Root data/security | Tenant scoping, zod, encryption, locking for data/write paths | N/A | No data model, request, or mutation path. Facts exclude values/secrets. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Bidirectional fact types and fact references match the additive JSON entry; no HTTP contract. |
| API contracts match UI/UX | Pass | Both are N/A; output is generated Markdown/JSON. |
| Risks cover write operations | Pass | No runtime/data writes; generator artifact and source-migration risks are covered. |
| Commands defined for mutations | Pass | No mutations. |
| Cache strategy covers read APIs | Pass | No API/cache surface. |
| Compatibility matches implementation plan | Pass | Frozen IDs and legacy facts are preserved with explicit tests. |
| Scope cohesion | Maintainer-confirmed override | Two fresh-context reviews returned SPLIT at host facts versus contribution/correlation facts. Per the checklist this is a maintainer Open Question, and Q2 records the maintainer’s explicit decision to keep complete UMES discovery in PR #4788. The atomic projection/harness gate prevents a misleading half-catalog from shipping. |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant with a recorded maintainer scope decision:** Approved as a design and ready for implementation. The fresh reviewers’ SPLIT recommendation and the maintainer’s explicit unified-scope override remain visible in Q2 and the review record.

## Changelog

### 2026-08-01

- Initial autonomous specification after a repository-wide audit of all package module roots.
- Resolved source-of-truth, host-only scope, dynamic-pattern, and compatibility defaults.
- Bounded the design against the existing Platform Map and module-facts specs to avoid duplicate runtime tooling.
- Applied the fresh-context SPLIT finding by deferring outgoing contribution inventory and host correlation to a separate specification.
- Maintainer override: expanded this PR to the complete UMES taxonomy, including contributions/correlation, enrichers, interceptors, guards, entity/query extensions, DOM/portal bridge, menus, all bound CrudForm/DataTable surfaces, unified overrides, and optional standalone-harness linkage to the UMES umbrella spec.
- Review autofix: replaced the underspecified generic contribution record with explicit host-family/capability unions, correlation provenance, scope contracts, and discriminated kind-specific details; generated Markdown now exposes a compact contract summary.

### Review — 2026-08-01

- **Reviewer:** Agent author pass plus two required fresh-context scope reviews. Both recommended splitting host discovery from contribution/correlation discovery; the maintainer had explicitly requested their unified delivery in PR #4788, so Q2 is the controlling scope decision.
- **Security:** Passed — no values/secrets/runtime authority; facts are static contract metadata.
- **Performance:** Passed with implementation evidence required — build time and context bytes are budgeted/tested.
- **Cache:** N/A.
- **Commands:** N/A.
- **Risks:** Passed — drift, inference, BC, bloat, build cost, and Platform Map divergence covered.
- **Verdict:** Approved with the maintainer-confirmed unified-scope override recorded; no Open Questions remain.
