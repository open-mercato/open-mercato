# 2026-11-15 – Modularize Core: Move Business Modules to Standalone Packages

## Status
Proposed

## Problem
`packages/core/src/modules/` contains both platform infrastructure and full business domains.
Core is becoming a monolith: catalog, customers, sales, cart, promotions, warranty_claims, wms,
customer_accounts, etc. live in the same package as the module system, auth, ACL, query index.
This couples distribution and obscures dependency boundaries. Package extraction should enable
opt-in activation without changing existing application behavior or the release policy.

The goal is to keep `@open-mercato/core` as a thin platform kernel and move every business domain
into its own npm package (workspace distribution except the existing staff agreement), installable as `@open-mercato/<domain>` (see
Distribution and Activation below). The optional `external/official-modules` repository is
another distribution channel for both first-party and third-party modules. This specification
preserves existing distribution agreements, including the staff extraction described below.

## TLDR
Extract business domains using the existing module discovery convention, preserving module IDs,
runtime behavior, database history and old imports. This PR changes only the design document.
No source extraction, schema migration, release automation change or submodule pointer update
is authorized by merging this specification.

## Approved Direction — 2026-11-17
* **Thin core immediately:** the extraction release has no mandatory installation dependency
  from core to a domain. Applications explicitly install their enabled domains; compatibility
  shims retain old code imports, but cannot supply a domain that is not installed.
* **One implementation spec:** this document owns the entire implementation, phase gates,
  coverage and progress. Phases may land in separate PRs referencing this same specification;
  no child implementation specs are required. The independent scope review recommended smaller
  specs; the maintainer explicitly chose one implementation spec.
* Retain synchronized workspace releases and existing staff distribution agreements. Independent
  domain versioning, release-automation changes and official-module pointer changes are excluded.

## Principles
* Core contains platform implementations and temporary compatibility facades only. Its installed
  production dependency closure must exclude all extracted domain implementations.
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
  major-version compatibility window and never less than one minor release, with documented
  `@deprecated` annotations and an `UPGRADE_NOTES.md` migration entry. This is a STABLE contract
  surface (`BACKWARD_COMPATIBILITY.md` §4 Import Paths); the shim must preserve the full
  `exports` map, not just a default export.
* Packages are published to npm with `publishConfig.access: public` and workspace versioning.

## Keep in Core – Platform / Framework
These stay in `packages/core`. Do not move.

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

The lists describe module/service relationships, not npm dependency declarations: "core" means
host platform capabilities exposed through DI/shared contracts, never a target domain-to-core
package import. "Consumers" includes planned integrations and external modules; only the
repository-wide inventory establishes an existing consumer. Phase labels group work areas;
Phase 0 determines execution order from actual edges and may interleave these areas.

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
  dictionaries (in core), audit_logs, notifications, workflows
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

## Architecture and Dependency Inventory

The phase lists above are an initial domain/consumer inventory, not an authoritative npm
manifest or a proven topological order. For example, `phone_calls` uses `devices` from a later
phase, `cart` uses `promotions` within its phase, and staff currently declares planner/resources
requirements. Inventory actual imports, metadata `requires`, DI resolutions and generated
references before ordering a slice. Do not manufacture npm packages for core modules such as
`dictionaries`; their package remains `@open-mercato/core`.

* Keep cross-module ORM relationships forbidden. Replace entity imports with scoped QueryEngine
  reads, UUID references and snapshots; use public service contracts when a lookup cannot preserve
  transaction, decryption or locking semantics. Do not replace a transactional query with an
  eventually consistent event. Move shared types only when they are actually platform contracts.
* Cross-module write effects use source-owned typed events and target-owned subscribers. Read/UI
  integration uses response enrichers and widgets. Optional consumers own the integration glue;
  the source module must not import the consumer.
* `tryResolve` protects a DI lookup only. Remove static imports of optional packages from all
  reachable server, client, CLI, seed and generator entry points; otherwise module absence still
  fails at import time. Required dependencies remain explicit; optional absence must no-op or
  return the existing documented unavailable response, without broadening authorization.
* Record runtime import, type-only, peer, installation and build-task edges separately in
  `packages/DEPENDENCIES.md`. Reject newly introduced cycles in the install/build graphs and
  runtime evaluation cycles; a type-only edge does not excuse an installation cycle. Resolve
  existing strongly connected components before extraction; never silently disable cycle checks.
* The retained platform modules must generate, build and start without any enabled domain.
  Installing fewer packages and enabling fewer modules are separate acceptance conditions.

### Immediate Thin-Core Dependency Topology

The compatibility dependency model is fixed as follows; it is not left to the implementer:

| Package/application | Required installation edges | Optional edges and behavior |
|---|---|---|
| `@open-mercato/core` | Existing platform dependencies only; none on an extracted domain | Each shim target is a version-aligned optional peer using `peerDependenciesMeta.<name>.optional = true`; optional peers must not auto-install domains |
| Extracted domain | Shared contracts/utilities, and actual required domain/runtime libraries | No dependency, peer or devDependency back on core; resolve platform services through host DI and shared contract types |
| Kernel-only application | Core and its required platform peers | Explicitly enables retained platform modules only; no domain package, shim import or domain registration |
| Domain application | Core plus every enabled domain and its required domain dependencies | Replaces each module's `from` with its canonical package; optional integrations degrade when absent |
| Legacy application during bridge window | Core plus explicit packages for every domain its old activation/imports use | Old `@open-mercato/core/modules/<id>/...` imports continue through shims; one provider per ID |

The resulting direction is application → core/domain, core compatibility peer → domain,
and domain → shared/required-domain. There is no domain → core edge. Package presence is
independent of activation: installing a package does not enable its module or execute setup.
Do not use `optionalDependencies` to ship domains by default, omit a real dependency to disguise
an edge, or route core platform code through a domain facade.

**Prerequisite before any affected domain moves:** eliminate every import back into core,
including platform entities, validators, helpers, type-only paths, test fixtures, seeds and
transitive imports through required domain dependencies. Place genuinely reusable contract
interfaces/helpers in `@open-mercato/shared`, leaving deprecated core forwards where public.
Keep platform implementations and business rules in their owning module: consume them through
DI/public service contracts, events, enrichers or snapshots. Integration fixture orchestration
that requires core stays in the host test harness rather than creating a domain devDependency
cycle. Domain-local tests inject contract-conforming fakes. No wholesale move of auth or business
implementation into shared is permitted. The before/after import and manifest graph is a gate;
if a seam cannot preserve transactions, authorization or canonical entity identity, that domain
cannot move until the seam is implemented and tested within this specification.

**Compatibility is conditional on installation, not import rewriting.** Because an absent package
cannot satisfy synchronous named/default ESM exports, thin core cannot provide old business imports
in a kernel-only installation. Upgrade instructions must explicitly add domain dependencies before
installing the extraction release; retaining only the old `core` manifest entry is not a supported
drop-in upgrade. Keep all old export paths and signatures for installed domains throughout the
bridge window. Include this installation requirement prominently in `UPGRADE_NOTES.md`, the app
and create-app manifests, and the upgrade rehearsal. Publish only as an announced migration
release under the existing release policy; do not present it as a transparent patch update.
This approved installation change does not authorize removing any protected export or API.

Package builds may transpile unused facades without resolving optional peers (the existing
unbundled builder supports this), but kernel runtime entry points must never import them.
Verify clean generation, app typecheck/build/start, CLI and workers with domains physically
absent. Run the full core package source typecheck in the full workspace where shim peers are
available, plus a separate packed kernel-consumer typecheck; do not suppress missing-module
errors or broaden `skipLibCheck` to manufacture a pass.

### Current tooling constraints

Grounding: `packages/cli/src/lib/resolver.ts` locates package modules under `src/modules/<id>`
or `dist/modules/<id>`, and `module-package.ts` rejects packages lacking those directories.
`packages/core/package.json` exposes explicit paths and wildcard nested paths. The shared
`scripts/build-package.mjs` transpiles unbundled files; `turbo.json` and workspace manifests
still determine the package/task graph. Neither `workspace:*` nor DI makes a graph cycle safe.
The topology above must pass source and packed-consumer proofs before the first physical move.

## Package Layout

```text
packages/<kebab-domain>/
  package.json
  README.md
  AGENTS.md
  build.mjs
  tsconfig.json
  src/
    index.ts
    modules/<unchanged_snake_id>/
      index.ts
      acl.ts
      setup.ts
      di.ts
      events.ts
      encryption.ts
      data/
      migrations/.snapshot-open-mercato.json
      api/
      backend/
      frontend/
      lib/
      services/
      subscribers/
      workers/
      widgets/
      i18n/
      __tests__/
      __integration__/
```

Preserve every existing convention file, asset, private helper, migration and nested directory,
not merely the examples above. Build to `dist/modules/<id>/...`. Export
`@open-mercato/<domain>/modules/<id>` and all existing relative subpaths with runtime and type
conditions, including explicit index aliases and TS/TSX paths where currently supported.
Do not flatten the module or introduce a new discovery convention. Follow the existing package
builder for generated-import rewriting and copy all required JSON, authored Markdown, static
assets, locale files and migration snapshots into the published shape; verify the tarball.

Use `publishConfig.access: public` and the repository release-managed version. New packages
join the existing release set in `scripts/release-line.mts` and the snapshot/tag conventions in
`CONTRIBUTING.md`; do not start a separate `0.1.0` line or independently publish versions.
Independent releases would require a separately approved tooling and compatibility proposal.
Specify actual runtime dependencies, host peers and development dependencies from the import
inventory, not a blanket core/shared/ui peer list. A package lacking UI must not gain a UI peer
merely because another domain uses it.

## Distribution and Activation

Workspace distribution and `official-modules` are channels, not first-party/third-party labels.
Most domains in this specification target workspace packages. Staff retains its previously agreed
`open-mercato/official-modules` destination from
`implemented/2026-05-08-staff-decouple-from-core.md`; this specification does not supersede that
agreement. Coordinate its separate repo PR and release, preserve contributor credit, and never
bump the host submodule pointer as an incidental extraction change. Staff must satisfy the same
no-core-backedge contract before core adds its optional compatibility peer. Land additive shared
contracts in the host repo first, publish through the existing prerelease process, then update
and verify staff in its destination repo, and finally consume that released staff package in
the extraction release. Record the versions and cross-repo PRs; no cross-repo atomic commit or
unpublished submodule checkout may stand in for packed-install evidence. The synchronized
workspace-release rule applies to packages managed by this repo, not to changing the external
repo's publishing policy.

For a workspace package, add the app dependency and replace the existing module entry's `from`:

```ts
{ id: 'catalog', from: '@open-mercato/catalog' }
```

Keep its overrides and other entry configuration unchanged. There must be exactly one entry
and implementation provider per module ID. `yarn generate` rebuilds the runtime registries from
this activation input; it neither installs nor enables an arbitrary npm package. Mirror app
activation/dependency changes into the create-app template using `yarn template:sync:fix`.

`apps/mercato/src/official-modules.generated.ts` comes from `official-modules.json` and its local
override through `yarn official-modules`, not `yarn generate`. Only use that channel for a module
actually distributed there. Leave its schema and unrelated activation entries unchanged.
Never edit either kind of generated file by hand. Apply the documented structural cache
invalidation after activation changes; reset dev caches only if stale chunks remain.

## Migration & Backward Compatibility

### Public surface preservation

Before each move, enumerate the real files reachable through explicit and wildcard core exports,
including root/index aliases, named/default/type exports, side-effect-only modules, CLI handlers,
React pages/widgets, entity classes, module helper exports outside the module directory and
third-party consumers. Capture a machine-readable before/after manifest in the implementation PR.
Preserve API URLs/methods/request/response/error contracts, module/entity IDs, SQL identifiers,
DI tokens, command IDs and undo payloads, event IDs/payloads, ACL wildcard semantics, widget
spot IDs, notification/agent/tool IDs and existing CLI commands.

Each old subpath forwards to the canonical implementation, with no second registration:

```ts
export * from '@open-mercato/catalog/modules/catalog/cli'
export { default } from '@open-mercato/catalog/modules/catalog/cli'
```

Only add the default forwarding line if that source actually exports a default. Preserve
`'use client'` boundaries on browser facades; do not funnel client imports through a server barrel.
Add `@deprecated` documentation to forwarded public declarations/facades, record replacement
paths and the earliest removal release in `UPGRADE_NOTES.md`, and update the compatibility ledger.
Keep bridges for the stated compatibility window; removal requires a separate approved PR.
Documentation is sufficient deprecation signaling here; do not add import-time warnings or
invent a new environment variable. Test named/default exports, type imports, side effects once,
and old/new entity/command identity, not just `require.resolve`.

Core compatibility files must not become a second discovered module when an app enables the
new provider. The legacy `from: '@open-mercato/core'` entry and the new entry must each work
separately, including child-directory scans, but never both be enabled. Prove all registries
contain each logical route/entity/worker/subscriber/command exactly once.

### Data Models and Migration Ownership

No entity shape or table/column name changes. Each module owns its existing
`migrations/.snapshot-open-mercato.json`; there is no single shared snapshot to consolidate.
Move the entire migration directory byte-for-byte, including historical filenames/class names,
snapshots, reindex declarations and support files. Preserve the module ID and
`mikro_orm_migrations_<id>` ledger identity used in `packages/cli/src/lib/db/commands.ts`.
The canonical provider owns generation and migration discovery; compatibility exports must not
run the same migration twice or create a new ledger. Check paths in both source and packed dist.

Using disposable databases with explicit migration authorization, rehearse an existing-database
upgrade: create fixtures on the previous release, record schema/ledger/counts, switch provider,
run the normal migration discovery and generation, and require no repeated initial migration,
destructive SQL, missing rows or changed ledger identity. Compare a fresh install's schema and
migration order. Move-only generation must yield no extraction-induced SQL. Never apply a local
developer database migration or reset merely to make a generator quiet.

### API Contracts, UI and Security

No new endpoints, input schemas, response fields or UI flows are proposed. Preserve zod
validation, `openApi`, authentication and feature guards, tenant/organization scoping, encryption
maps/decryption helpers, mutation guards, command transactions/side effects, optimistic locking
(`updatedAt`, update/delete headers and conflicts), audit/undo behavior and cache invalidation.
Tests must include unauthorized and second-tenant requests, not only successful CRUD.
Relocation must not recreate encryption mappings, re-seed existing tenants or rotate data keys.

UI is moved without redesign. Preserve `CrudForm`, `DataTable`, guarded HTTP helpers, translations,
portal authentication/navigation, extension hosts and accessible keyboard behavior. Record the
server/client boundary map and existing `'use client'` files before/after; preserve lazy-loading
and server-only boundaries. Compare representative page bundles, hydration and interaction,
route counts, startup RSS and generation time under identical conditions. No new broad provider
or eager domain import belongs in the platform shell. Any regression requires investigation and
reviewed evidence rather than an unmeasured claim of a smaller core.

## Delivery Plan

All steps below are proposed work. Checkboxes do not represent completed implementation.
This is one implementation spec with one accountable progress ledger: each implementation PR
updates its affected checkboxes and attaches its unit's contract/API/test manifest here or in a
linked committed evidence artifact. No separately approved child spec is assumed.

**Release boundary:** Phase 0 and decoupling changes may ship while preserving existing ownership.
Phases 1–4 may be reviewed incrementally on the implementation branch, but a partial extraction
must not publish as the thin-core release. The first extraction release contains all domain
packages, bridges and app dependency changes together; core contains no business implementation
and its production closure installs no business domain. Only the final gate permits that release.
"Immediate" describes this first released topology; it does not permit an unsafe all-at-once
refactor without the preparatory checks.

### Phase 0 — Inventory and prerequisite decoupling

- [ ] Enumerate every current directory in `packages/core/src/modules` into keep/move ownership;
      list future/external consumers separately. The literal `core` bootstrap entry in the old
      draft is not a module directory. `payment_gateways` stays in core.
- [ ] Produce the dependency and public-surface manifests, discover entity/validator imports
      repository-wide (including enterprise overlays, providers, helpers, tests and templates),
      and order extraction units by actual required edges, not the headings above.
- [ ] Replace prohibited entity/business-logic imports through sanctioned seams, preserving
      transaction and locking semantics. Run module-decoupling checks with optional peers absent.
- [ ] Implement the approved thin-core seams and optional-peer facades before physical extraction.
      Prove clean install/build/generate/start and old imports with explicit domain dependencies
      without workspace caches. Add the installation migration to upgrade notes.

### Phase 0 Exit Gate

Before physical moves, demonstrate one dependency-light module (`currencies`) can use its host
contracts without core imports, and demonstrate the difficult transactional seam (`sales` to
catalog/customer/platform services) preserves its locks, authorization and command undo behavior.
These are contract-level tests against existing implementation, not a second business copy.
Attach the no-backedge graph and service interface/owner/failure behavior for each required
platform capability; record unresolved seams as unchecked blockers in this spec. Every extracted
module must later pass the same proof; the two examples do not waive that requirement.

### Phases 1–4 — Repeat for each dependency-ordered extraction unit

- [ ] Scaffold the package with the canonical module tree, move complete assets and migration
      history, update import/export maps and generated-import aliases without changing IDs.
- [ ] Add compatibility bridges and migration documentation, verify their canonical identity,
      and update every in-tree consumer to the intended provider through real call sites.
- [ ] Change app activation and create-app templates atomically, regenerate registries, and
      verify both legacy and new activation separately with no duplicate registrations.
- [ ] Move existing unit/integration suites and update Jest, TS, generator, coverage and standalone
      harness discovery paths. Tests must be found and run, not silently dropped after relocation.
- [ ] Ship the extraction unit's API/UI/absence/upgrade integration tests in the same implementation PR.
- [ ] Run the configured validation sequence, package dry-run and packed standalone rehearsal;
      review release metadata without changing release automation or actually publishing.
- [ ] Update root/package AGENTS routing, module-system docs and affected structural specs at
      extraction time. Document the manual core-extraction path; a new promote/eject mode is
      separate CLI work, not a prerequisite silently bundled into this specification.

### Final Release Gate

- [ ] All current module directories are classified; all moved implementations reside only in
      their canonical package, with core containing platform implementations and facades only.
- [ ] All phase tests and the configured validation gate pass on the assembled release candidate.
- [ ] Kernel-only, full-app, legacy-import, standalone packed-install and authorized database
      upgrade/rollback rehearsals pass with the recorded package versions and lockfiles.
- [ ] Existing API/UI coverage manifests are complete; source/package test discovery and generated
      registry counts match the baseline, except explicitly removed domain entries in kernel mode.
- [ ] `UPGRADE_NOTES.md` and app/template dependencies explain the mandatory installation migration;
      compatibility targets are available through the approved publishing process before rollout.

### Rollout and Rollback

Publish the existing release set through the approved release process only after tarball and
upgrade checks pass. Deploy one coherent package version set, regenerate before starting app
and workers, and roll processes together so old and new providers cannot concurrently register
jobs. Disable a domain through activation first; do not uninstall it while legacy code still
imports it. Retain its tables, data, job payload identities and migration ledger when disabled.

On failure, stop the new processes, restore the previous lockfile, activation and release set,
regenerate, invalidate structural caches and restart app/workers. A move-only rollout requires
no down migration. Verify data and ledger checksums plus route/worker counts after rollback.
If an implementation also changes schema or persisted payloads, separate that change and its
rollback plan before extraction; package rollback does not undo external side effects or writes.

## Integration Coverage and Acceptance Gates

Each phase implementation PR must attach an explicit manifest of affected API method/path pairs and
key UI URLs from the pre-move registry. Map every API path to an existing or new executable test;
map key list/detail/create/edit/delete and portal flows to browser tests. A phase heading or
"all tests pass" is not a coverage matrix. Fixtures create their own tenant-scoped records through
APIs and clean up in `finally`/teardown; no seeded/demo data or live providers are required.

| Phase group | Minimum behavioral coverage in addition to its full API-path manifest |
|---|---|
| Catalog/currencies/availability | Product and variant CRUD, pricing/currency reads, stock-policy lookup, product list/detail/edit, pricing without optional sales |
| Customers/groups/accounts/portal/channels/inbox/calls | Company/person/deal CRUD, group membership, account authentication and portal authorization, conversation/message/call flows, corresponding admin and portal screens; device absence |
| Sales/cart/promotions/ecommerce/carriers/dashboards | Quote/order lifecycle and undo, cart line pricing/promotion recalculation, checkout integration, carrier hooks, dashboard load and permissions; absent optional integrations |
| WMS/claims/EUDR/rules/planner/resources/staff/devices/push/Excel | Stock movements, claim lifecycle, compliance actions/undo, rule evaluation, availability/scheduling and staff access, device delivery using fakes, import/export roundtrip; permission and peer-absence cases |

Every extraction unit must also prove:

* Existing default app behavior unchanged with exactly one provider per module ID, and both old
  and new activation paths tested independently while bridges exist.
* Two tenant/organization scopes stay isolated; feature wildcard/deny behavior, encrypted reads,
  custom fields, update/delete conflicts, transactions, undo/audit and cache tags are unchanged.
* Old/new named, default and type imports resolve and preserve identity; CLI, DI, setup, typed
  events, notifications, agents, search, widgets, workers and subscribers register exactly once.
* The module's migrations/snapshot and ledger survive existing-database upgrade, fresh install,
  disable/re-enable and rollback. No extraction-induced schema diff or duplicate seed effects.
* Packed packages install in a clean standalone app outside the workspace with exported types,
  migration assets/locales present and no reliance on source aliases, symlinks or cached dist.
* Optional-peer absence passes generation/build/start and meaningful route/DI behavior tests.
  Required-peer absence fails installation/startup clearly; it must not silently fake success.
* All retained platform modules can run with domains disabled. A physically domain-free install
  is mandatory from the first extraction release; optional compatibility peers must not install
  domains. The final ownership manifest must show zero remaining business implementations in core.
* The existing configured build→generate→build→i18n→typecheck→test→app-build gate passes; moved
  unit and Playwright suite counts match the before/after manifest. Follow the repository's
  runner detection and record local versus Docker evidence.

## Risks & Impact Review

| Failure scenario | Severity / affected area | Mitigation and detection | Residual risk |
|---|---|---|---|
| Domain still imports core, or an optional peer pulls domains into kernel install | High / install and Turbo graph | Remove all reverse edges before move; inspect real lockfile/task/evaluation graphs and packed kernel installs | A domain with an unresolved seam stays unmoved |
| Legacy app upgrades core without installing its domains | High / missing-module startup failure | Explicit dependency migration and release announcement; rehearse unchanged code imports with updated manifest | This is an installation migration, not a transparent core-only upgrade |
| Default export, asset or client directive lost | High / CLI, UI and published imports | Enumerate wildcard files, compare import semantics, assets, boundaries and browser smoke tests | Uninventoried third-party consumers need a compatibility window |
| Old and new providers both discovered | High / duplicate jobs, routes or writes | One activation entry, canonical forwarding, registry cardinality and one-delivery tests | Rolling deployments require coordinated process restart |
| Snapshot or ledger changes with package path | Critical / duplicate or destructive migrations | Byte-preserved history, disposable upgrade/fresh-install rehearsals and zero SQL diff | No schema-changing work may piggyback on extraction |
| Optional package absent but statically imported | High / startup or authorization | Audit all entry-point import graphs; absent-peer build/start and fail-closed access tests | Required peers remain an explicit installation constraint |
| Shared identity or guard weakened while decoupling | Critical / tenant data and mutations | Canonical entity/command identity; two-scope, encryption, locking and undo regressions | Refactoring transactional seams warrants separate review |
| Tests or translations disappear after move | High / undetected regressions | Compare discovered suite counts, locales and packed assets; update harness and configs | External consumer suites remain downstream responsibility |
| New release policy or staff destination assumed | High / publication and contributor agreement | Preserve synchronized release tooling and the existing staff official-modules agreement | Any later change needs named maintainer approval |

## Final Compliance Report — 2026-11-17

This is a design review, not deployment or runtime verification. Reviewed guidance:
root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md`, `packages/cli/AGENTS.md`,
`.ai/qa/AGENTS.md`, `.ai/docs/module-development.md`, `.ai/docs/official-modules.md`, and
`BACKWARD_COMPATIBILITY.md`. Local package/module guides apply again to each implementation phase.

| Rule / consistency check | Design disposition |
|---|---|
| Discovery and generated files | Existing src/dist module layout; generator ownership explicit; no hand edits |
| Stable import/API/DI/event/widget/CLI contracts | Per-surface inventory, named/default bridges and deprecation window required |
| Database ownership and rollback | Module-local snapshots/history/ledgers unchanged; disposable upgrade evidence required |
| Security, encryption and commands | Existing mechanisms preserved; no new schema or mutation design; negative and undo tests required |
| UI, cache and performance | Existing boundaries/primitives/cache behavior preserved; before/after runtime evidence required |
| Release and external-module governance | Synchronized publication and staff agreement retained; no automation/pointer changes |
| Scope and dependency topology | Maintainer chose immediate thin core and one implementation spec; the acyclic topology and physical-absence proofs are explicit prerequisites |

## Changelog

### 2026-11-16 — Review autofix
* Corrected discovery layout, default-export compatibility, generator ownership, migration
  snapshots/ledgers, release policy and staff distribution assumptions.
* Added explicit dependency/contract inventories, optional-absence behavior, packed-install and
  database-upgrade gates, per-slice API/UI coverage, rollback, risks and compliance requirements.
* Runtime implementation and integration tests remain the responsibility of implementation PRs.

### 2026-11-17 — Maintainer decisions applied
* Recorded immediate thin core and a single implementation spec, overriding the scope review's
  recommendation to split implementation specs.
* Specified optional compatibility peers, explicit legacy-app dependency migration and the
  prerequisite elimination of every domain-to-core edge; retained all public import bridges.
* Distinguished full-workspace package typechecks from physically domain-free consumer proofs.
