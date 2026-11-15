# 2026-11-15 – Modularize Core: Move Business Modules to Standalone Packages

## Status
Proposed

## Problem
`packages/core/src/modules/` contains both platform infrastructure and full business domains.
Core is becoming a monolith: catalog, customers, sales, cart, promotions, warranty_claims, wms,
customer_accounts, etc. live in the same package as the module system, auth, ACL, query index.
This prevents independent versioning, opt-in activation, and clear dependency boundaries.

The goal is to keep `@open-mercato/core` as a thin platform kernel and move every business domain
into its own npm **workspace** package, installable as `@open-mercato/<domain>` (see
Distribution channels below). The `external/official-modules` git submodule is a *separate*
distribution vehicle for **third-party** official modules; it is not the activation path for
first-party domains extracted in this spec.

## Principles
* Core stays platform only.
* Business modules become first-class packages with their own `package.json`, `AGENTS.md`,
  `README.md`, DI registration and public API surface.
* No direct ORM relations across packages. Cross-package coupling **will be** via IDs,
  snapshots, events, QueryEngine lookups and widgets — this is the *target*, not the current
  state. Modules import each other's entities today (e.g. `sales` → `catalog`/`customers`/
  `dictionaries` entities; `communication_channels` → `messages`; `business_rules` →
  `api_keys`/`auth`/`directory`; `sync_excel` → `attachments`; `staff` → `planner`/`auth`).
  A **decoupling pass** (Phase 0) must remove every cross-module entity import before the
  affected module can leave core — extraction is not mechanical.
* Backward compatibility: existing imports from `@open-mercato/core/modules/<id>` — including
  **named** imports and **nested subpaths** (`…/commands`, `…/lib/…`, `…/events`,
  `…/data/entities`) — must keep resolving via per-subpath re-export shims for at least one
  major version, with a noise-safe (once-guarded) deprecation. This is a STABLE contract
  surface (`BACKWARD_COMPATIBILITY.md` §4 Import Paths); the shim must preserve the full
  `exports` map, not just a default export.
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

* `portal` → `@open-mercato/portal`
  Depends on: core, @open-mercato/customer-accounts, feature_toggles
  Consumers: warranty_claims (Phase 4). In-core `workflows` references portal, so it resolves
  it via `tryResolve` (optional peer) and degrades gracefully when the package is absent.

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
  with `tryResolve` pattern. In-core modules that consume a moved-out module (e.g. `workflows` →
  `portal`, `data_sync` → `sync_excel`) depend on it as an **optional peer** and degrade
  gracefully when the package is absent — core must never hard-require a business domain.
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
`version`: start at `0.1.0`; version **independently** with semver (a major bump for any
breaking change). Core references each extracted package via a workspace range (`workspace:*`
in-repo), so a domain can ship without a core release. (Resolves the prior Open Question.)
`peerDependencies`: `@open-mercato/core`, `@open-mercato/shared`, `@open-mercato/ui`
`dependencies`: only domain dependencies listed above.

## Distribution channels
Two distinct channels exist; this extraction uses the first, and the `promote`/`eject`
carve-out in `official-modules-development.mdx` applies to the second:
* **First-party domains (this spec):** in-repo npm **workspace** packages
  (`@open-mercato/<domain>`, `publishConfig.access: public`), installed via `yarn add` and
  enabled through `apps/mercato/src/modules.ts` + the generated `official-modules.generated.ts`.
* **Third-party official modules:** the `external/official-modules` git submodule, activated via
  `official-modules.json`. This extraction does **not** touch that schema.

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

### 0. Decouple cross-module entity imports (prerequisite, per module, before it moves)
Inventory every cross-module **entity/validator import** inside `packages/core/src/modules/*`
and replace each with a UUID reference + QueryEngine lookup (or a shared type via
`@open-mercato/shared`). Known starting set (not exhaustive — re-scan before each move):
* `sales/commands/documents.ts` → `catalog`, `customers`, `dictionaries` entities
* `communication_channels/*` → `messages` entities
* `business_rules/lib/*` → `api_keys`, `auth`, `directory` entities
* `sync_excel/lib/upload-storage.ts` → `attachments` entities
* `staff/lib/messageObjectPreviews.ts` → `planner`, `auth` entities
* `customers|sales|catalog/inbox-actions.ts` → `inbox_ops` validators
A module may leave core only after its cross-module entity imports are gone. (ORM *relation
decorators* are already intra-module; the breakage is plain entity *imports*.)

### 1. Inventory & Graph
Build the import graph of `packages/core/src/modules/*` and emit `packages/DEPENDENCIES.md`
(the dependency matrix + phase order). Add a CI gate that **fails on a new cycle** introduced
by extraction, and confirm each moved module's "Depends on" set is satisfied by an earlier
phase or by core.

### 2. Scaffold Packages
Create workspace packages for each module in Phase 1. Copy source tree from
`packages/core/src/modules/<module>` into `packages/<domain>/src`. Update imports to
package-level imports.

### 3. Public API & Re-exports (preserve the full `exports` map — STABLE, BC §4)
The in-repo surface is ~1363 `@open-mercato/core/modules/<id>` imports, overwhelmingly
**named** and **nested subpaths** (`…/commands`, `…/lib/…`, `…/events`, `…/data/entities`,
`…/services/…`). A single `index.ts` default re-export cannot preserve them. For **each** entry
currently mapped in `@open-mercato/core/package.json` `exports`, add a per-subpath shim that
forwards **named** exports from the new package:
```ts
// packages/core/src/modules/<module>/<rest>  — one shim per existing subpath
export * from '@open-mercato/<domain>/<rest>'
```
Rules:
* Keep every existing `exports` entry; do not collapse subpaths into a single `index.ts`.
* Use `export *` (named) — **not** `export default` — so `import { X }` keeps resolving.
* Emit the deprecation **once**, noise-safe (a module-level guard, opt-in via e.g.
  `OM_DEPRECATION_WARNINGS`), **not** a `console.warn` at module-eval (that fires on every
  import and runs during SSR/build).
* Keep each shim for one major version, with a smoke test asserting every pre-move subpath
  still resolves after the move.

### 4. DI & Registration
Move `di.ts`, `setup.ts`, `acl.ts` into the new package. Registration is **generated**, not
hand-edited: the app registry is `apps/mercato/src/modules.ts`, which consumes the generated
`apps/mercato/src/official-modules.generated.ts` ("don't edit by hand"). Rebuild it with
`yarn generate` so the new packages are picked up — there is no `packages/core/src/modules.ts`.

### 5. Tests
Move `__tests__` into new package. Update Jest config. Run `yarn workspace @open-mercato/<domain> test`.

### 6. Build & Publish
Add `build` script to each package. Ensure `yarn build:packages` builds them in topological order.
Publish dry-run via `yarn nx publish` or `npm publish --dry-run`.

### 7. Docs & Activation
Extracted domains ship as **workspace packages** and are enabled through the standard
`modules.ts` / generated registry — **not** via `official-modules.json`, which activates the
`external/official-modules` git submodule for **third-party** official modules. Update docs for
installation: `yarn add @open-mercato/catalog @open-mercato/sales` + add the `modules.ts`
entry (or run `yarn generate`). Leave the `official-modules.json` schema unchanged unless a
domain is later republished through the submodule channel.

## Backward Compatibility
* Per-subpath **named** re-export shims in core, one major version (preserve the full `exports`
  map; noise-safe deprecation; smoke-tested — see step 3).
* `BACKWARD_COMPATIBILITY.md` entry for each moved module (Import Paths §4 + the re-export
  contract).
* Migration guide with `yarn generate` after switching imports.

## Risks & Mitigations
* Circular deps: enforce the dependency-graph review + CI cycle gate (step 1) before merge.
* Missing optional peer: use `tryResolve` + graceful degradation.
* Migration churn: ship Phase 1 first, stabilize, then Phase 2-4.
* Cross-module entity coupling: Phase 0 decoupling is the true critical path — a module cannot
  move until its cross-module entity imports are gone; re-scan the import set before each move
  (the list in step 0 is a starting point, not exhaustive).
* Shared migration snapshot: `catalog`/`customers`/`sales` own migrations today. The single
  `.snapshot-open-mercato.json` stays owned by core/app; per-package migrations are registered
  through the shared `yarn db:generate` path (never a forked per-package snapshot), preserving
  the ADDITIVE-ONLY schema rule (BC §8).
* Re-export breakage: the per-subpath named shims (step 3) are covered by a smoke test that
  re-resolves every pre-move `exports` subpath; do not collapse them into a default export.

## Acceptance Criteria
* `@open-mercato/core` builds without business module source, and the full partition
  (keep / move / Phase 0-decoupled) covers **every** entry in `packages/core/src/modules/`
  — including `portal`, which is neither in-core nor currently listed.
* No cross-module entity import remains in any moved package (step 0 clean).
* All moved packages build, typecheck, test green.
* A smoke test re-resolves **every** pre-move `@open-mercato/core/modules/<id>` subpath
  (named + nested) through its shim; deprecation is noise-safe (once-guarded), not a per-import
  `console.warn`.
* `packages/DEPENDENCIES.md` carries the dependency matrix + phase order, and a CI gate fails
  on a new cycle.
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
* Distribution: extracted first-party domains are in-repo **workspace** packages enabled via
  `modules.ts`/the generated registry; the `external/official-modules` submodule
  (`official-modules.json`) is reserved for third-party modules and is **not** touched.
* Re-export contract: preserve the full `exports` map with per-subpath **named** shims
  (`export *`, not `export default`), noise-safe deprecation, and a pre-move subpath smoke test
  (see step 3 / BC §4).
* Decoupling is the critical path: Phase 0 removes cross-module entity imports before any module
  moves; the shared `.snapshot-open-mercato.json` stays single and ADDITIVE-ONLY.
* `portal` is a moved-out domain (`@open-mercato/portal`); in-core `workflows` resolves it via
  `tryResolve`.

## Open Questions
* ~~Versioning policy alignment with core releases~~ — **resolved**: extracted packages version
  independently with semver (major on break), referenced by core via `workspace:*`.
* Whether any first-party domain is later republished through the `external/official-modules`
  submodule (vs. staying a workspace package) — deferred; does not block Phase 1.
