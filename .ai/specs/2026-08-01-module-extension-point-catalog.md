# Module Extension-Point Catalog — Generated Per-Module Host Facts

- **Status:** Proposed — design only, ready for review
- **Date:** 2026-08-01
- **Scope:** OSS developer tooling; `packages/shared`, `packages/cli`, package-provided modules, and `packages/create-app` agentic guides
- **Related:** [Platform Map](2026-06-17-platform-map-introspection.md), [ts-morph Module Fact-Sheets](2026-06-27-ts-morph-module-fact-sheets.md), [Module Fact Auto-Discovery](2026-07-06-module-facts-auto-discovery.md), [UMES](implemented/SPEC-041-2026-02-24-universal-module-extension-system.md), [DataTable Extensions](implemented/SPEC-041f-datatable-extensions.md), `BACKWARD_COMPATIBILITY.md`

## 📝 TLDR

Open Mercato’s generated module fact sheets list events, routes, ACL features, entities, and a small set of raw host tokens, but they do not answer the agent’s practical question: **“Which extension surfaces does this installed module host, which exact target ID do I use, and what can attach there?”** The current generator misses explicit `InjectionSpot` IDs, dynamic host patterns, component replacement handles, and the distinction between a DataTable’s base spot and its deep-extension table ID.

This specification adds a typed `extension-points.ts` declaration to modules that host extension surfaces, migrates host call sites to consume those declarations, and extends the existing module-facts Markdown/JSON with an `extensionHosts` catalog. It reuses the current package discovery pipeline, introduces no database or HTTP API, does not duplicate the runtime Platform Map, preserves every existing frozen spot ID, and retains `hostTokens` as an additive compatibility summary.

The 2026-08-01 repository audit covered **58 package module roots / 54 unique module IDs** after resolving four duplicate provider IDs. It found **24 modules with host surfaces**, **64 exact custom spot IDs**, **53 DataTable tokens**, **11 replacement handles**, and **6 dynamic call sites requiring classification**. Those numbers are a migration baseline, not hard-coded acceptance counts; the implementation must derive the live set on every test/build.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Should the source of truth extend standalone module facts, the runtime Platform Map, or both? | Extend the existing module-facts pipeline; define a shape the Platform Map can adapt to later, but add no runtime API/UI in this change. | Generated facts are the surface user agents already read, and this avoids duplicating or blocking on the open Platform Map implementation. | ok |
| Q2 | Should the catalog list only hosted extension points or also outgoing widget/extension registrations? | Ship hosted extension-point discovery only; defer outgoing contribution inventory and host correlation to a follow-up specification. | Host facts solve the stated discovery problem independently. Contribution extraction spans separate registries and can ship later without changing the host contract. | ok |
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
- A raw token does not say what mechanism it supports, what context/data contract a widget receives, whether the ID is exact or patterned, or where its authoritative declaration lives.

The catalog must describe stable addresses, not implementation prose. Conceptual mechanism selection remains in `.ai/guides/extensions.md`; the module sheet supplies exact installed facts.

## 📝 Problem Statement

Open Mercato freezes widget injection spot IDs because third-party modules depend on them, yet the platform does not publish a per-module inventory of those IDs. An agent working in a standalone app therefore has three unsafe choices:

1. Guess a spot from naming conventions, which fails for legacy aliases and split base/deep DataTable IDs.
2. Escalate to installed-source inspection for every extension, defeating the compact generated-facts design and often becoming impossible for compiled-only packages.
3. Read another module’s `widgets/injection-table.ts` and assume every referenced target is a real host, even though an injection table describes an outgoing registration, not a host render point or its context contract.

The distinction matters. A registration key proves that a widget wants to mount somewhere; only the host call site/declaration proves that the surface exists and defines its context. The current Platform Map design aggregates runtime registries, which is valuable for a running app, but it sees registered targets and enabled modules rather than a complete package-time authoring contract for standalone agents.

### Success criteria

- Every discovered package module fact sheet explicitly says which extension surfaces the module **hosts**, even when the answer is `_none_`.
- Every emitted host has an exact ID or an explicit parameterized pattern, mechanism/family, supported attachment capabilities, context/data contract identifier, source provenance, and stability classification.
- First-party host call sites cannot drift from declarations without a deterministic test failure.
- Existing spot IDs, component handles, module-facts keys, JSON top-level shape, and `hostTokens` remain compatible.
- The standalone agent harness proves that an agent can select an exact host from facts without bulk-reading installed source or inventing an ID.

## Research — comparable extension catalogs

Two established designs inform the shape:

- **VS Code contribution points** show the value of named, machine-readable extension contracts instead of prose-only documentation: <https://code.visualstudio.com/api/references/contribution-points>.
- **Backstage** makes the host plugin own named extension points and treats optional modules as consumers of those contracts: <https://backstage.io/docs/frontend-system/architecture/extension-blueprints/> and <https://backstage.io/docs/backend-system/architecture/modules/>.

Applied here: use stable IDs, typed host families, explicit supported attachment kinds, and host ownership. Rejected: a single runtime-only graph (insufficient for package facts), prose manifests (drift), a new mutable admin UI (outside the agent-discovery problem), and outgoing contribution inventory in the same delivery.

## Goals and non-goals

### Goals

- Make exact module extension targets discoverable in the existing generated facts.
- Cover UI injection spots, DataTable/CrudForm families, component handles, and provider/dynamic host patterns.
- Make the host declaration authoritative by having host call sites consume its exported values.
- Reuse existing module discovery and registry-generator parsing rather than create a second package scanner.
- Preserve context discipline: an agent reads one target module fact, not a repository-wide graph.

### Non-goals

- No runtime introspection API, CLI command, backoffice page, or change to Platform Map PR #3722.
- No database schema, tenant data, credentials, PII, cache, queue, or network behavior.
- No replacement of OpenAPI, event facts, or conceptual UMES guides.
- No new annotation layer for routes, entities, commands, events, enrichers, guards, or interceptors; their current fact sections and framework conventions remain unchanged.
- No inventory of outgoing widgets, dashboard widgets, overrides, enrichers, interceptors, guards, entity extensions, or subscribers. That independently deployable capability requires a follow-up specification that consumes this host catalog.
- No dangling-target correlation between outgoing registrations and hosts in this specification.
- No automatic facts for app-owned standalone modules in this phase; this extends the package-bundled facts path defined by the auto-discovery spec.
- No normalization/renaming of legacy IDs. Dotted, colon, hyphenated, wildcard, and legacy IDs remain exactly as shipped.
- No claim that every theoretical helper in `spotIds.ts` is a rendered host. The catalog lists only declared, actually bound host families/surfaces.

## Repository-wide module audit — 2026-08-01

The audit scanned non-test `.ts`/`.tsx` under every `packages/*/src/modules/<id>` root and classified literal, helper-built, conditional, forwarded, and dynamic host call sites. It also inspected outgoing registries only to distinguish registrations from real host bindings; those registrations are not deliverables of this specification. Four IDs have multiple providers (`events`, `notifications`, `payment_gateways`, `workflows`); implementation continues using the current resolver’s provider-selection rules.

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

Audit lessons that are normative for implementation:

1. Scanning every `tableId` property is insufficient: service/persistence `tableId` values are false positives, while explicit `injectionSpotId` values are false negatives.
2. A DataTable may use different IDs for its rendered base spot and deep extensions; facts must model the host instance, not merely a token list.
3. A widget forwarding `context.integrationDetailWidgetSpotId` is a host consumer, not a new host.
4. Empty convention arrays and outgoing registrations are not host evidence.
5. Comments listing intended handles do not prove a runtime handle; only a declaration bound to a host call site does.
6. Dynamic hosts must be patterns with named parameters, not guessed enumerations.

## 📝 Proposed Solution

### 1. Typed host declarations

Add the optional, additive module-root convention `extension-points.ts`:

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
- Standard families (`data-table`, `crud-form`, `detail`, `portal-page`, `menu`, `generic`, `component-handle`) provide canonical context/capability defaults. Custom hosts must declare `contextContract`, `dataContract` when data is supplied, and supported attachment capabilities.
- The helper is isomorphic and data-only: no React import, DI, database, or runtime registration side effect.
- A module with no hosts omits `extension-points.ts`; the fact generator still emits `_none_`.

### 2. Standard host-family expansion

The catalog reports only surfaces the runtime actually binds:

| Family | Declared input | Generated concrete surfaces |
|---|---|---|
| DataTable | `baseSpotId?`, `tableId` | Base render spot; `:header`, `:footer`, `:toolbar`, `:search-trailing`; deep `:columns`, `:row-actions`, `:bulk-actions`, `:filters`; component handle `data-table:<tableId>`. The base and deep IDs may differ. |
| CrudForm | `spotId` | Base render/lifecycle host, `:header`, `:fields`, and component handle. Do not emit unused theoretical helpers such as `:before-fields` unless CrudForm binds them in the same change. |
| Detail/portal/menu/generic | exact `spotId` or pattern | The declared host only, plus explicitly declared child spots. |
| Component handle | `componentId` | One replacement/wrapper/props-transform target. |

The family definitions live beside the existing spot-ID helpers and are used by runtime components/tests as the rendered-surface contract. A parity test fails if DataTable/CrudForm binds a new suffix without updating the family descriptor, preventing fact/runtime drift.

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

### 4. Generated host facts

Add an optional field to `ModuleFacts` / `ModuleFactsJsonEntry`:

```ts
export type ModuleExtensionHostFacts = {
  hosts: ModuleExtensionHostFact[]
  unresolved: ModuleExtensionUnresolvedFact[]
}

export type ModuleExtensionHostFact = {
  key: string
  id: string
  resolution: 'exact' | 'pattern'
  family: ExtensionHostFamily
  ownerModule: string
  supported: ExtensionHostCapability[]
  contextContract: string
  dataContract?: string
  stability: 'frozen' | 'stable'
  source: { path: string; symbol: string }
  aliases?: string[]
  patternParameters?: Record<string, { source: string; pattern?: string }>
  fallbacks?: string[]
}

export type ModuleExtensionUnresolvedFact = {
  key: string
  source: { path: string; symbol?: string }
  reason: 'unclassified-binding' | 'unbound-declaration' | 'dynamic-without-pattern'
}

export type ExtensionHostCapability =
  | 'render-widget'
  | 'field-widget'
  | 'column-widget'
  | 'row-action-widget'
  | 'bulk-action-widget'
  | 'filter-widget'
  | 'toolbar-widget'
  | 'menu-widget'
  | 'component-override'
  | 'tab-widget'
  | 'group-widget'
  | 'lifecycle-handler'
```

Initial host capabilities describe which established mechanism may attach at the address:

- `render-widget`, `field-widget`, `column-widget`, `row-action-widget`, `bulk-action-widget`, `filter-widget`, `toolbar-widget`, `menu-widget`
- `component-override`
- `tab-widget`, `group-widget`, `lifecycle-handler`

These values describe the host’s accepted mechanism; they do not inventory which modules currently register consumers. Imported/computed host definitions that cannot be statically resolved use an explicit declaration or become visible unresolved facts; they are never silently treated as absent.

### 5. Generated Markdown

Each `.ai/guides/modules/<module>.md` gains one compact section:

```markdown
## Extension surfaces hosted

| ID / pattern | Family | Supports | Context | Stability |
|---|---|---|---|---|
| data-table:catalog.products | data-table/base | render-widget | ui.data-table.v1 | FROZEN |
| data-table:catalog.products.list:columns | data-table/columns | column-widget | ui.data-table.v1 | FROZEN |
| crud-form:catalog.product:fields | crud-form/fields | field-widget | ui.crud-form.v1 | FROZEN |
```

The existing `Host extension points` token summary remains byte-compatible in shape. Markdown can label it “Legacy host-token summary” only after confirming no harness/parser keys on the heading; otherwise retain the heading unchanged.

### 6. Framework-owned global hosts

Global shell/menu/status hosts are not falsely assigned to a business module. The conceptual extension guide continues listing framework families from canonical constants in `packages/ui/src/backend/injection/spotIds.ts`. A generated framework catalog may be added later, but it is not required to solve per-module discovery and must not be smuggled into `module-facts.json` as a fake module key.

### 7. Relationship to Platform Map

The Platform Map remains runtime/on-demand introspection for the enabled app. This catalog is package-time authoring metadata for standalone agents. To avoid semantic divergence:

- Reuse Platform Map surface names where they overlap (`widget-spot`, `widget`, `component-override`, `enricher`, `interceptor`, `command-interceptor`, `guard`).
- Keep the fact types serializable and isomorphic.
- Leave a future adapter free to prefer declared host facts over inferring hosts from registered widget targets.
- Do not make this spec depend on PR #3722 landing and do not modify its UI/API scope here.

### 8. Follow-up boundary: outgoing contribution inventory

A separate specification may add per-module outgoing contributions and correlate their target IDs to this host catalog. That follow-up owns registry-reader reuse, contribution taxonomy, framework/optional/exact/pattern resolution, dangling-target diagnostics, and facts for widgets, dashboard widgets, component overrides, enrichers, interceptors, guards, entity extensions, subscribers, and provider definitions. This host specification neither adds placeholder contribution fields nor commits the follow-up to one JSON shape.

## 📝 Architecture

```text
package module source
  extension-points.ts ───────────────┐
  bound DataTable/CrudForm/Spot calls│  coverage/parity guard
                                      ▼              ▼
                              CLI host reader   diagnostics
                                      │
                         existing package resolver
                                      │
                         module-facts.ts projection
                              ┌───────┴────────┐
                              ▼                ▼
                 modules/<id>.md      module-facts.json
                              │                │
                              └──── standalone agent context
```

### Boundaries

- `packages/shared`: types and isomorphic declaration helpers only.
- `packages/cli`: discovery, declaration extraction, binding verification, diagnostics, and Markdown/JSON projection.
- package modules: declarations and call-site binding; no registry side effects.
- `packages/create-app`: ships only enabled module sheets as today and updates agent routing/tests.
- Platform Map/runtime: unchanged.

### Why a declaration plus a guard, not AST heuristics alone

AST heuristics can bootstrap the migration but cannot safely infer semantic ownership, context contracts, helper-built patterns, or whether a forwarded `spotId` is a host. A hand-written list alone can drift. The declaration provides meaning; the call-site coverage guard proves it remains bound.

## 📝 Data Models

No database entities or migrations are introduced. The data model is the generated serializable fact shape above.

Contract rules:

- All arrays are deterministically sorted by `family`, then `id`, then source path.
- `id` contains the exact frozen ID; `pattern` facts serialize their template in `id` with `{parameter}` placeholders.
- No function bodies, React components, user data, secrets, credentials, descriptions containing user data, or resolved DI instances enter JSON.
- Context/data contracts are stable symbolic IDs, not TypeScript source dumps.
- `unresolved` includes sanitized module-relative provenance and reason only.
- Duplicate module IDs continue through the existing resolver and selected-provider rule.

## 📝 API Contracts

### HTTP/API

N/A. No HTTP endpoint is added or changed.

### Generated JSON compatibility

The top-level `module-facts.json` remains `Record<moduleId, ModuleFactsJsonEntry>`. Do not add `$schema`, `framework`, or another non-module key. Additive entry fields:

```ts
export interface ModuleFactsJsonEntry {
  // all existing required fields unchanged
  extensionHosts?: ModuleExtensionHostFacts
}
```

The property is optional in the exported interface for source compatibility with external constructors, but the current generator always emits it (including empty arrays). Existing `hostTokens` remains required and unchanged.

### Declaration helper contract

`defineModuleExtensionPoints`, family helpers, and required declaration fields become STABLE exported APIs. `extension-points.ts` plus its `extensionPoints` export becomes an additive FROZEN auto-discovery convention once released. This addition must be documented in `BACKWARD_COMPATIBILITY.md` and module-development guidance.

## Internationalization

N/A. Generated technical IDs and contract names are developer tooling, not end-user strings. Module titles/descriptions continue through the existing facts behavior. Do not introduce new UI copy.

## UI/UX

N/A. There is no rendered application surface. The developer experience is the generated Markdown table. Consequently no frontend architecture contract, screenshots, mockups, design-system changes, or manual UI QA are required.

## Edge Cases & Failure Scenarios

- **Split DataTable IDs:** emit base and deep families separately; do not collapse `catalog.products` into `catalog.products.list`.
- **Conditional tables:** a closed literal conditional (orders/quotes) emits both exact hosts; an open value becomes a pattern only with a declaration.
- **Wildcard host declarations:** preserve wildcard syntax as a pattern and never expand it to every module.
- **Provider-selected detail spots:** emit the integration host pattern, parameter contract, and legacy fallback.
- **Legacy aliases:** emit all live aliases and identify the primary declaration without renaming either.
- **Empty host declarations:** emit zero hosts, not a placeholder surface.
- **Forwarded props:** classify a value forwarded into a child/widget as a binding/consumer, not a new host.
- **Unresolved first-party binding:** emit sanitized `unresolved` provenance and fail the repository coverage test with module, declaration key, and source.
- **Compiled-only packages:** facts remain created at package/create-app build time from source, matching the parent specs; no runtime JS extraction is added.
- **Duplicate module providers:** use the selected provider exactly as current discovery does; never merge incompatible facts under one ID.
- **New runtime suffix:** parity tests fail until the standard family descriptor and generated facts are updated in the same change.

## Migration & Backward Compatibility

This is additive but touches FROZEN/STABLE surfaces, so implementation follows `BACKWARD_COMPATIBILITY.md`:

1. Add `extension-points.ts` as a new convention; do not rename any existing convention.
2. Move raw host literals into declarations without changing their byte values or runtime resolution order.
3. Preserve every existing wildcard, alias, fallback, context/data shape, and component handle.
4. Add optional fields to exported interfaces; never make existing consumers construct new required properties.
5. Preserve `hostTokens` and its JSON shape. It may be generated from the richer facts internally, but observable output stays compatible.
6. Preserve the top-level module-facts record and existing Markdown headings relied on by tests/harnesses.
7. Update `BACKWARD_COMPATIBILITY.md`, `RELEASE_NOTES.md`, and `UPGRADE_NOTES.md` only if implementation introduces a deprecation. This spec introduces no deprecation by default.
8. Run `yarn generate` after module convention changes and verify no unintended generated registry drift. The module-facts artifacts remain build outputs, not a new committed app registry.

Rollback is code-only: revert the additive helper/declarations/fact projection and restore literal bindings. No data rollback exists or is needed. Because IDs never change, reverting does not strand third-party registrations.

## 📋 Phasing

### Phase 1 — Canonical host contract and audit migration

1. Add shared types/helpers and rendered-family descriptors.
2. Add `extension-points.ts` to all 24 audited host modules (provider-selected patterns included).
3. Bind actual host call sites to exported declarations without behavior changes.
4. Add repository-wide coverage/parity guards; reach zero unclassified first-party host sites.

Application remains working after each module migration because declarations return the same strings used today.

### Phase 2 — Generated per-module host facts

5. Extend `ModuleFacts`, optional JSON types, deterministic renderer, and warnings.
6. Reuse package discovery and emit hosted surfaces to Markdown/JSON.
7. Retain/derive `hostTokens`; update `customers`, `catalog`, `checkout`, `integrations`, and empty-module fixtures.

At this checkpoint the host catalog is complete and agents can answer the original question from generated facts.

### Phase 3 — Standalone routing, harness, and compatibility evidence

8. Update create-app’s extension guide/routing to prefer the named host module fact.
9. Add harness cases proving exact spot selection, split DataTable IDs, dynamic patterns, and zero bulk fact reads.
10. Update BC/module-development docs and run the focused/full validation gate.
11. Record extraction timing and output-size deltas; keep the fact sheet within agent context budgets.

## 📋 Implementation Plan

### Expected file manifest

| File/area | Action | Purpose |
|---|---|---|
| `packages/shared/src/modules/widgets/extension-points.ts` | Create | Serializable host declaration types/helpers and standard family descriptors. |
| `packages/ui/src/backend/injection/spotIds.ts` and DataTable/CrudForm tests | Modify | Export/test the actually rendered family contract; no new unused spots. |
| `packages/cli/src/lib/generators/module-extension-facts.ts` | Create | Host declaration extraction, binding verification, sorting, and diagnostics. |
| `packages/cli/src/lib/generators/module-facts.ts` | Modify | Optional fact fields and Markdown/JSON projection; preserve legacy output. |
| `packages/*/src/modules/*/extension-points.ts` (host modules only) | Create | Authoritative per-module host declarations. |
| Host components/pages in the 24 audited modules | Modify | Replace duplicated raw strings with declaration values. |
| `packages/cli/src/lib/generators/__tests__/` | Modify/create | Fixtures, parity, all-module audit, and compatibility. |
| `packages/create-app/agentic/guides/extensions.md` | Modify | Route agents from mechanism choice to exact host facts. |
| `packages/create-app/agentic/shared/ai/harness/cases.json` and validators | Modify | Standalone routing/identifier correctness coverage. |
| `.ai/docs/module-development.md`, `packages/core/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `RELEASE_NOTES.md` | Modify | Document additive convention and compatibility contract. |

### Implementation constraints

- No production dependency.
- Do not edit generated files manually.
- Use existing resolver/scanner/AST utilities; no second module discovery algorithm.
- Keep output deterministic and bounded; do not embed implementation source.
- A source reader warning must identify the module and convention path while avoiding secrets or source-body dumps.
- Call-site migration must be mechanical and behavior-preserving; any proposed ID correction is a separate, explicitly approved compatibility project.

## Integration & Test Coverage

This feature has no HTTP/UI runtime path. Integration coverage means generator/build/harness paths and must ship in the same implementation change.

| ID | Layer | Assertion |
|---|---|---|
| `T-EXTFACT-001` | shared/unit | Each family expands only rendered spots; DataTable split base/deep IDs and CrudForm base/header/fields stay exact. |
| `T-EXTFACT-002` | cli/unit | Static exact, helper-based, conditional, wildcard, alias, and parameterized host declarations serialize deterministically. |
| `T-EXTFACT-003` | cli/unit | Forwarded props, outgoing registration targets, and persistence/service `tableId` values are rejected as host evidence. |
| `T-EXTFACT-004` | cli/fixture | `catalog` emits distinct `catalog.products` base and `catalog.products.list:*` deep hosts. |
| `T-EXTFACT-005` | cli/fixture | `checkout` emits all bound pay-page spots/handles and no comment-only handles. |
| `T-EXTFACT-006` | cli/fixture | `integrations` emits the named pattern, parameter rule, and legacy fallback without expanding provider IDs. |
| `T-EXTFACT-007` | cli/fixture | `customers` preserves legacy/v2 detail aliases and all current table/form hosts. |
| `T-EXTFACT-008` | repo-wide guard | Every non-test first-party `InjectionSpot`, DataTable, CrudForm, and component-handle host binding is covered by exactly one declaration; all 54 resolved module IDs produce facts, including empty catalogs. |
| `T-EXTFACT-009` | BC guard | Old `ModuleFactsJsonEntry` fixture without `extensionHosts` still type-checks; top-level JSON and `hostTokens` remain unchanged. |
| `T-EXTFACT-010` | create-app build | Built `modules/<id>.md` and `module-facts.json` contain enabled modules’ host facts and no app-disabled module sheet is linked. |
| `T-EXTFACT-011` | standalone harness | Given a request to add a catalog product column, the agent reads only catalog facts, selects the exact deep spot, and does not invent the base/deep ID. |
| `T-EXTFACT-012` | standalone harness | Given provider-detail work, the agent selects `integrations.detail:{integrationId}` and the integration route without bulk-reading all facts. |
| `T-EXTFACT-013` | performance | Record module-facts build duration and total guide/JSON bytes before/after; reject an unbounded per-module source dump or context-budget regression. |

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

### Incorrect semantic inference

- **Scenario:** The extractor mistakes a persistence `tableId` or a forwarded widget `spotId` for a host and tells agents to target a non-rendered surface.
- **Severity:** High
- **Affected area:** Module facts and generated third-party code.
- **Mitigation:** Declarations are authoritative; AST scanning is a coverage verifier, not the semantic source. Regression fixtures cover `perspectives` and `sync_excel` false-positive classes.
- **Residual risk:** A new custom host wrapper must be added to the coverage classifier.

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

- **Scenario:** Listing every expanded host makes module sheets too large for agent routing budgets.
- **Severity:** Medium
- **Affected area:** Standalone agent performance and harness pass rate.
- **Mitigation:** Compact tables, stable contract IDs instead of source/type dumps, one module sheet at a time, size metrics, and optional collapsing of standard family members in Markdown while keeping exact JSON rows.
- **Residual risk:** Very extensible modules such as checkout/customers remain larger; targeted facts are still much smaller than installed-source exploration.

### Generator cost

- **Scenario:** Declaration extraction and binding verification across all packages materially slows create-app/CLI builds.
- **Severity:** Low
- **Affected area:** package build/scaffold time.
- **Mitigation:** Reuse the existing resolver/scanner, measure Phase 3, and keep extraction source-only/static.
- **Residual risk:** A bounded build-time increase proportional to module/source count is acceptable if measured and documented.

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
- `packages/core/AGENTS.md` — Extensibility Contract, Widget Injection, Component Replacement, Extensions, Events
- `packages/ui/AGENTS.md` — DataTable, CrudForm injection, menu/component/portal extension
- `packages/cli/AGENTS.md` — generator system and validation
- `packages/create-app/AGENTS.md` — agentic setup maintenance and template sync
- `.ai/docs/module-development.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root + core | Preserve module isolation; optional consumer owns glue | Compliant | Catalog is read-only metadata; no cross-module import or ORM relationship is added. |
| Root + BC | Frozen widget spot IDs cannot be renamed/removed | Compliant | Migration preserves byte values, aliases, wildcard semantics, context, and resolution order. |
| BC auto-discovery | New convention may be added; existing conventions immutable | Compliant | Adds optional `extension-points.ts` and documents it; removes nothing. |
| BC types/signatures | Required fields cannot be added to stable consumers in a breaking way | Compliant | New JSON/type property is optional; helper APIs are additive. |
| BC generated files | Generated output shape remains compatible | Compliant | Top-level record and existing required fields/exports remain unchanged. |
| Core widgets | Keep host IDs stable and use canonical injection/component mechanisms | Compliant | Host declarations bind to the existing runtime call sites without changing placement or resolution. |
| Core extensions | Cross-module data links use `data/extensions.ts` | Compliant | Catalog reads declarations; it creates no relation. |
| UI DataTable/CrudForm | Keep stable `extensionTableId`/entity host IDs | Compliant | Host declarations preserve and explicitly model them. |
| CLI | Reuse generator infrastructure; do not hand-edit generated files | Compliant | Reuses resolver/readers and updates source generators/tests only. |
| Create-app | Keep agentic source/template/build consumers synchronized | Compliant | Guide, build test, setup selection, and harness changes are in the same implementation plan. |
| Root testing | Feature specs include integration coverage for affected paths | Compliant | Build, generated facts, binding parity, BC, and standalone harness paths are specified; no runtime UI/API exists. |
| Root design system / frontend contract | UI changes require DS and client-boundary evidence | N/A | No rendered UI or Next.js boundary changes. |
| Root data/security | Tenant scoping, zod, encryption, locking for data/write paths | N/A | No data model, request, or mutation path. Facts exclude values/secrets. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Serializable fact types match the additive JSON entry; no HTTP contract. |
| API contracts match UI/UX | Pass | Both are N/A; output is generated Markdown/JSON. |
| Risks cover write operations | Pass | No runtime/data writes; generator artifact and source-migration risks are covered. |
| Commands defined for mutations | Pass | No mutations. |
| Cache strategy covers read APIs | Pass | No API/cache surface. |
| Compatibility matches implementation plan | Pass | Frozen IDs and legacy facts are preserved with explicit tests. |
| Scope cohesion | Pass | Fresh-context re-review confirmed that declarations, host binding, fact generation, compatibility, and agent routing form one hosted-surface discovery capability. Outgoing contribution inventory/correlation remains a separate follow-up. |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant:** Approved as a design and ready for implementation.

## Changelog

### 2026-08-01

- Initial autonomous specification after a repository-wide audit of all package module roots.
- Resolved source-of-truth, host-only scope, dynamic-pattern, and compatibility defaults.
- Bounded the design against the existing Platform Map and module-facts specs to avoid duplicate runtime tooling.
- Applied the fresh-context SPLIT finding by deferring outgoing contribution inventory and host correlation to a separate specification.

### Review — 2026-08-01

- **Reviewer:** Agent author pass plus required fresh-context scope re-review.
- **Security:** Passed — no values/secrets/runtime authority; facts are static contract metadata.
- **Performance:** Passed with implementation evidence required — build time and context bytes are budgeted/tested.
- **Cache:** N/A.
- **Commands:** N/A.
- **Risks:** Passed — drift, inference, BC, bloat, build cost, and Platform Map divergence covered.
- **Verdict:** Approved. The re-review passed after contribution inventory/correlation was separated from this host-catalog capability.
