# 2026-11-15 – Modularize Core: Move Business Modules to Standalone Packages

## Status
Proposed

## Problem
`packages/core/src/modules/` contains both platform infrastructure and full business domains.
Core is becoming a monolith: catalog, customers, sales, cart, promotions, warranty_claims, wms,
customer_accounts, etc. live in the same package as the module system, auth, ACL, query index.
This prevents independent versioning, opt-in activation, and clear dependency boundaries.
`external/official-modules` is intended for exactly this kind of extraction.

The goal is to keep `@open-mercato/core` as a thin platform kernel and move every business domain
into its own npm workspace package, publishable as `@open-mercato/<domain>`.

## Principles
* Core stays platform only.
* Business modules become first-class packages with their own `package.json`, `AGENTS.md`,
  `README.md`, DI registration and public API surface.
* No direct ORM relations across packages. Cross-package coupling is via IDs, snapshots,
  events, QueryEngine lookups and widgets – same rules as today.
* Backward compatibility: existing imports from `@open-mercato/core/modules/<id>` must continue
  to work via re-exports for at least one major version. Deprecation warnings are emitted.
* Packages are published to npm with `publishConfig.access: public` and workspace versioning.

## Keep in Core – Platform / Framework
These stay in `packages/core`. Do not move.

* core – module bootstrap / registry
* api_docs – OpenAPI generation
* api_keys – API key issuance / validation
* attachments – file upload, storage drivers, partitions, OCR
* audit_logs – immutable audit trail
* auth – staff identity, login, role sync
* configs – tenant / organization configuration
* dictionaries – code-list / enum registry
* directory – tenants & organizations
* entities – custom fields / EAV
* feature_toggles – typed toggles + overrides
* forms – CrudForm scaffolding
* integrations – integration registry, credentials API, operation logs
* messages – messaging primitives
* notifications – in-app notification model + SSE bridge
* perspectives – view / perspective definitions
* progress – ProgressJob / top-bar progress contract
* query_index – query engine integration
* seeds – encrypted seed loader
* translations – translatable field registry
* widgets – injection / component replacement system
* workflows – workflow engine runtime
* data_sync – sync hub / adapter contract
* design_system – gallery / DS metadata

Explicitly moved out:
* availability – stock policy layer
* resources – asset & resource planning / scheduling
* sync_excel – excel import/export helpers

## Modules to Move Out

**Naming:** a single mechanical rule — **package = `@open-mercato/` + kebab(module_name)** with no
per-module exceptions (`customer_groups` → `@open-mercato/customer-groups`,
`communication_channels` → `@open-mercato/communication-channels`, `warranty_claims` →
`@open-mercato/warranty-claims`). The module `id`, folder and every FROZEN contract-id prefix (event
ids, ACL feature ids, notification/agent/tool ids) stay **snake_case** and unchanged, so no
event/feature renames or data migrations are required. `payment_gateways` stays in core as a
platform abstraction (not extracted).

### Phase 1 – Catalog & Pricing
* `catalog` → `@open-mercato/catalog`
  Depends on: core, entities, dictionaries, translations, feature_toggles, audit_logs, attachments
  Consumers: sales, cart, promotions, wms, ecommerce

* `currencies` → `@open-mercato/currencies`
  Depends on: core, audit_logs
  Consumers: catalog, sales, cart, promotions

* `availability` → `@open-mercato/availability`
  Depends on: @open-mercato/catalog, core
  Consumers: sales, cart, wms

### Phase 2 – CRM & Customer
* `customers` → `@open-mercato/customers`
  Depends on: core, entities, dictionaries, audit_logs, notifications
  Consumers: sales, cart, promotions, warranty_claims, workflows

* `customer_groups` → `@open-mercato/customer-groups`
  Depends on: core, @open-mercato/customers
  Consumers: promotions, catalog pricing

* `customer_accounts` → `@open-mercato/customer-accounts`
  Depends on: core, auth, notifications, audit_logs
  Consumers: portal, sales, ecommerce

* `inbox_ops` → `@open-mercato/inbox-ops`
  Depends on: core, customers, notifications, messages
  Consumers: workflows

* `phone_calls` → `@open-mercato/phone-calls`
  Depends on: core, customers, devices
  Consumers: inbox_ops

* `communication_channels` → `@open-mercato/communication-channels`
  Depends on: core, integrations, notifications
  Consumers: customers, sales

### Phase 3 – Commerce
* `sales` → `@open-mercato/sales`
  Depends on: core, @open-mercato/catalog, @open-mercato/customers, @open-mercato/currencies,
  @open-mercato/dictionaries, audit_logs, notifications, workflows
  Consumers: cart, promotions, warranty_claims, wms, invoices

* `cart` → `@open-mercato/cart`
  Depends on: core, @open-mercato/catalog, @open-mercato/currencies, @open-mercato/promotions,
  @open-mercato/customers
  Consumers: ecommerce, checkout

* `promotions` → `@open-mercato/promotions`
  Depends on: core, @open-mercato/catalog, @open-mercato/customers, @open-mercato/currencies
  Consumers: cart, sales

* `ecommerce` → `@open-mercato/ecommerce`
  Depends on: core, @open-mercato/catalog, @open-mercato/sales, @open-mercato/cart,
  @open-mercato/customers
  Consumers: apps

* `shipping_carriers` → `@open-mercato/shipping-carriers`
  Depends on: core, integrations, @open-mercato/sales
  Consumers: sales, wms

* `payment_gateways` → keep as platform abstraction in core, providers stay as separate
  packages `gateway-stripe`, `gateway-tpay`, `gateway-autopay`

* `dashboards` → `@open-mercato/dashboards`
  Depends on: core, query_index, perspectives
  Consumers: apps

### Phase 4 – Operations
* `wms` → `@open-mercato/wms`
  Depends on: core, @open-mercato/catalog, @open-mercato/sales, @open-mercato/availability
  Consumers: sales, warranty_claims

* `warranty_claims` → `@open-mercato/warranty-claims`
  Depends on: core, @open-mercato/customers, @open-mercato/sales, @open-mercato/catalog,
  notifications, workflows
  Consumers: portal

* `eudr` → `@open-mercato/eudr`
  Depends on: core, @open-mercato/catalog, @open-mercato/sales
  Consumers: compliance

* `business_rules` → `@open-mercato/business-rules`
  Depends on: core, workflows
  Consumers: sales, catalog, promotions

* `planner` → `@open-mercato/planner`
  Depends on: core, workflows, customers
  Consumers: apps

* `resources` → `@open-mercato/resources`
  Depends on: core, entities, dictionaries, directory, auth, @open-mercato/planner
  Consumers: apps

* `staff` → `@open-mercato/staff` – already planned for extraction
  Depends on: core, auth, directory
  Consumers: apps

* `devices` → `@open-mercato/devices`
  Depends on: core, notifications
  Consumers: phone_calls, push_notifications

* `push_notifications` → `@open-mercato/push-notifications`
  Depends on: core, devices, communication_channels, notifications
  Consumers: apps

* `sync_excel` → `@open-mercato/sync-excel`
  Depends on: core, attachments
  Consumers: data_sync

## Dependency Rules
* No package may import ORM entities from another package. Use UUID references + QueryEngine.
* Cross-package events must be declared in the source package `events.ts` and consumed via
  subscribers in the target package.
* Shared types go to `@open-mercato/shared`.
* DI tokens are registered in each package `di.ts`. Optional peer dependencies are resolved
  with `tryResolve` pattern.
* All public APIs must export `openApi` where applicable.

## Package Layout
```
packages/<domain>/
  package.json
  README.md
  AGENTS.md
  src/
    index.ts
    metadata.ts
    acl.ts
    setup.ts
    di.ts
    events.ts
    data/entities.ts
    api/
    backend/
    lib/
    services/
    subscribers/
    widgets/
  tsconfig.json
```
`package.json` name: `@open-mercato/<kebab-name>`
`version`: start at `0.1.0`, follow core versioning.
`peerDependencies`: `@open-mercato/core`, `@open-mercato/shared`, `@open-mercato/ui`
`dependencies`: only domain dependencies listed above.

## Context & Docs Impact

### Naming — no AGENTS.md or doc change required
The rule **package = `@open-mercato/` + kebab(module_name)** with the module `id` staying
**snake_case** is the *existing* convention, not a new one — no context file needs renaming:
* Root `AGENTS.md` ("Modules: plural, snake_case … folders and `id`") and
  `apps/docs/docs/framework/modules/overview.mdx` ("Modules: plural snake_case folder and `id`")
  already state the module-id convention — unchanged, since the module id stays snake.
* The channel-* packages already document the exact shape we are adopting:
  `@open-mercato/channel-expo` ⇒ module id `channel_expo`, and likewise for `channel-fcm`,
  `channel-apns`, `channel-imap`, `channel-gmail` (see `packages/channel-*/AGENTS.md`). Extracted
  business packages follow the identical `@open-mercato/<kebab>` ⇒ `<snake>` mapping.
* Every FROZEN contract-id prefix (event / ACL feature / notification / agent / tool / widget ids)
  is built from the unchanged snake module id, so no renames, aliases or data migrations.

### Extraction — the context that DOES need updating (per module, at move time)
These are about modules *leaving* core, not about naming. Each is updated in the same PR that moves
its module; the re-export shim keeps module-id references working in the meantime, so nothing breaks
early:
* `AGENTS.md` (root) — the "core (business modules: auth, catalog, customers, sales)" clause in the
  package list: reframe `core` as a thin kernel and the listed domains as opt-in
  `@open-mercato/<domain>` packages.
* `packages/core/AGENTS.md` — opening line "core contains all core business modules (…)": same
  reframe.
* `apps/docs/docs/framework/modules/overview.mdx` — note that business domains ship as separate
  installable packages enabled via `modules.ts`, not as in-core folders.
* `apps/docs/docs/framework/modules/official-modules-development.mdx` and
  `apps/docs/docs/cli/eject.mdx` — the `promote`/`eject` command *refuses* to extract from
  `@open-mercato/core` ("those touch core barrel exports, the generated registry, and a shared
  migration snapshot, so do them by hand"). This extraction is that "by hand" path; the command
  should grow a core-extraction mode (or a documented carve-out) as modules move.

### Specs
Module-id-referencing specs (`catalog`, `customers`, `sales`, `warranty_claims`, …) need **no**
change: the module id is unchanged and `@open-mercato/core/modules/<id>` keeps working through the
re-export shim. Only a spec that makes a structural "lives in core" claim would need a note; audit
each when its module moves.

## Migration Plan

### 1. Inventory & Graph
Run static analysis to build import graph of `packages/core/src/modules/*`. Generate
dependency matrix and verify no cycles introduced by extraction.

### 2. Scaffold Packages
Create workspace packages for each module in Phase 1. Copy source tree from
`packages/core/src/modules/<module>` into `packages/<domain>/src`. Update imports to
package-level imports.

### 3. Public API & Re-exports
In `packages/core/src/modules/<module>/index.ts` add deprecation re-export:
```ts
import * as mod from '@open-mercato/<domain>'
export default mod
console.warn('[DEPRECATED] @open-mercato/core/modules/<module> moved to @open-mercato/<domain>')
```
Keep re-export for one major version.

### 4. DI & Registration
Move `di.ts`, `setup.ts`, `acl.ts` into the new package. Update `packages/core/src/modules.ts`
registration to load from new packages when present.

### 5. Tests
Move `__tests__` into new package. Update Jest config. Run `yarn workspace @open-mercato/<domain> test`.

### 6. Build & Publish
Add `build` script to each package. Ensure `yarn build:packages` builds them in topological order.
Publish dry-run via `yarn nx publish` or `npm publish --dry-run`.

### 7. Docs & Activation
Update `official-modules.json` schema to allow activation of extracted modules.
Update docs for installation: `yarn add @open-mercato/catalog @open-mercato/sales`.

## Backward Compatibility
* Re-export shim in core for 1 major version.
* `BACKWARD_COMPATIBILITY.md` entry for each moved module.
* Migration guide with `yarn generate` after switching imports.

## Risks & Mitigations
* Circular deps: enforce dependency graph review before merge.
* Missing optional peer: use `tryResolve` + graceful degradation.
* Migration churn: ship Phase 1 first, stabilize, then Phase 2-4.

## Acceptance Criteria
* `@open-mercato/core` builds without business module source.
* All moved packages build, typecheck, test green.
* Re-export shims emit deprecation warning but keep existing apps working.
* Dependency graph documented in `packages/DEPENDENCIES.md`.
* Packages are publishable with `npm publish` and have correct `name`, `version`, `publishConfig`.

## Decisions
* Naming is a single mechanical rule: **package = `@open-mercato/` + kebab(module_name)**, with no
  per-module exceptions. Module ids stay **snake_case** (unchanged), so every FROZEN contract-id
  prefix (event ids, ACL feature ids, notification/agent/tool ids) stays intact — no event/feature
  renames or data migrations. The earlier "id == folder == package token" idea and the one-off
  `@open-mercato/channels` name were dropped.
* `perspectives` stays in core (view / perspective definitions); `dashboards` is moved out to `@open-mercato/dashboards` and depends on the in-core `perspectives`.
* Naming needs **no** AGENTS.md or doc rename (it is the existing `@open-mercato/<kebab>` ⇒ `<snake>`
  convention). The only context edits are extraction-time reframes of "core contains business
  modules" in root + `packages/core/AGENTS.md` and the module-system docs, plus a core-extraction
  mode for `promote`/`eject` — see the Context & Docs Impact section.

## Open Questions
* Versioning policy alignment with core releases.
