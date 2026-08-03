# Standalone Canonical Example Module

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS, standalone applications emitted by `create-mercato-app`
- **Related:** [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), [Standalone Agent Spec-First Routing](./2026-08-01-standalone-agent-spec-first-routing.md), [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Empty App Starter Presets](./2026-04-02-empty-app-starter-presets.md), merged PR [#4529](https://github.com/open-mercato/open-mercato/pull/4529), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

The standalone template already contains a comprehensive `example` module, but the `empty` and `crm` preset resolver deletes it while the default `classic` scaffold enables it. Do not create a second teaching module that copies the same entities, routes, commands, forms, UMES branches, and tests. Make the existing `example` tree the one canonical module reference: ship it in every built-in scaffold, keep it absent from every generated `src/modules.ts`, add progressive-disclosure source maps, and extend the existing Todo-centered vertical slice only for capability gaps that the current tree does not cover.

`apps/mercato/src/modules/example/**` is the authoring source. `packages/create-app/template/src/modules/example/**` is a byte-identical mirror maintained by the existing `yarn template:sync:fix` workflow and enforced by `yarn template:sync`. Standalone skills and harness cases link to exact files under the emitted `src/modules/example/**` root. No shadow teaching module, template-only example fork, or copied reference implementation is allowed.

## Overview

This specification changes generated-source delivery and agent guidance, not the framework module contract. Fresh scaffolds gain a local reference tree but no example runtime behavior: no routes, pages, navigation, migrations, seeds, ACL grants, events, widgets, workers, or search registrations load until a developer explicitly enables or copies the module.

The existing example is intentionally broad because it also supports monorepo QA. Progressive disclosure makes that breadth useful to standalone agents without asking them to read or copy the whole tree. Normative rules stay in the owning skills and guides; the example README and machine-readable surface inventory point to the smallest executable slice for each capability.

## Resolved Decisions

| # | Question | Decision | Rationale |
|---|---|---|---|
| Q1 | Reuse `example` or add a second teaching module? | Reuse and extend `example`; a shadow module is forbidden. | The current tree already implements the majority of the proposed vertical slice. Copying it would create two owners and guaranteed drift. |
| Q2 | Should the example run in new apps? | No. Ship its source in every built-in preset but omit `example` from every generated `src/modules.ts`. | Agents and developers can inspect it without changing runtime, navigation, schema, or seed behavior. |
| Q3 | Which copy is authoritative? | `apps/mercato/src/modules/example/**` is the authoring source; the create-app template is an exact materialized mirror. | The monorepo app is the real integration environment, and the existing template-sync workflow already mirrors `apps/mercato/src/{app,components,lib,modules}` into create-app. |
| Q4 | How are missing surfaces added? | Extend the existing Todo-centered example in focused files, tests, and migrations. | A missing capability does not justify another module, placeholder discovery file, or pasted skill snippet. |
| Q5 | How does the harness consume the reference? | Relevant cases receive bounded `exampleRoots` entries rooted at `src/modules/example`; the first entrypoint is its README or surface map. | Exact capability links let an agent read only what the prompt needs and avoid the test-only `ratelimit_probe`. |
| Q6 | Add a new harness case or extend an existing one? | Semantically deduplicate first, especially against OMH-185 and existing discovery/UMES cases. | Coverage behavior matters; case-number allocation is not a design goal. |
| Q7 | Split delivery, gap closure, and reference-specific harness proof? | Retain them as phased acceptance of one canonical-example capability; generic read semantics, governance, and spec-first policy remain separate companion specs. | The user explicitly requires one shipped, complete, discoverable example contract. Source delivery without usable coverage or discoverability does not meet that outcome. |

## Problem Statement

`packages/create-app/src/lib/starter-presets.ts` currently removes `src/modules/example` and `src/modules/example_customers_sync` for `empty`; `crm` inherits that removal. `classic` bypasses preset rewriting, so the template's current `src/modules.ts` enables `example`. This creates two bad outcomes:

1. lean standalone apps retain the narrow `ratelimit_probe` fixture but lose the only comprehensive local module example; and
2. the proposed remedy duplicates much of the already-shipped example under a new module ID, adding a second implementation and a second maintenance surface.

At the 2026-08-03 design baseline, the template example contains 136 files and 746,030 file bytes. The scaffold copier intentionally omits `__tests__` and `__integration__`, leaving 104 runtime/reference files and 555,327 file bytes in a generated app. The repository tree already covers CRUD, commands and undo, custom fields, OpenAPI, list export, an `updatedAt`-bearing editable entity, backend forms and tables, typed events, subscribers, notification types/handlers, response enrichers, mutation guards, API and command interceptors, component replacement, dashboard widgets, customers/catalog/sales injections, unified overrides, migrations, ACL, setup, DI, CLI, i18n, and extensive integration coverage.

The two repository copies are not currently identical: 20 paths differ, including command scope/redo behavior, a missing command test, page metadata, integration fixtures, and locale/test formatting. The existing `yarn template:sync` command already detects this drift because `modules/**` is in its sync set. This spec turns a passing exact-sync check into a release requirement and requires the baseline reconciliation to preserve the safer/correct behavior rather than copying the stale side blindly.

## Proposed Solution

1. Stop removing `src/modules/example` from lean presets and remove `example` from the default classic registry so all built-in scaffolds have the same source-present/runtime-disabled contract.
2. Keep `example_customers_sync` and `ratelimit_probe` outside the canonical reference contract; do not broaden this change into their delivery redesign.
3. Remove or enabled-module-gate the example entries in `src/lib/homeQuickLinks.ts` (`/example`, `/backend/example`, and `/backend/todos`) so a disabled module never leaves dead navigation.
4. Add `README.md`, `references/surface-map.md`, and `references/surface-inventory.json` inside the existing example tree.
5. Reconcile the current monorepo/template drift, using the monorepo tree as source and reviewing each differing behavior before running the existing sync fixer.
6. Extend `example` only for the missing surfaces identified by the finite inventory. Reuse its existing `Todo`, commands, routes, pages, widgets, and identifiers rather than adding a parallel task domain.
7. Replace large inline examples in standalone skills with exact, line-number-free links to the example source while retaining one normative rule owner per capability.
8. Register `src/modules/example` as a capability-scoped, read-only root in relevant harness cases and prove agents select it before `ratelimit_probe` or installed framework source.

## Scope Boundaries

### In Scope

- Byte-identical parity between `apps/mercato/src/modules/example/**` and `packages/create-app/template/src/modules/example/**`.
- Source-presence and registration-absence contracts for `classic`, `empty`, and `crm` scaffolds.
- Removal or registry-gating of example-only home quick links while the module is disabled.
- Progressive-disclosure README, surface map, finite inventory, activation/copy/rename checklist, and exact source links.
- Reuse of the current Todo CRUD/command/UI slice and current UMES/widget/integration examples.
- A reference-quality audit of every file exposed by the capability map; unsafe QA/demo-only files remain present but are classified `qa-only` and forbidden to harness reads until remediated.
- Focused additions to `example` for verified gaps such as encryption, explicit data extensions/links, search registration, DI cache use and invalidation, queued import/worker/progress, client notification rendering, translatable-field registration, and default/example seeding.
- Standalone skill links, harness source-selection behavior, bounded example reads, preset tests, sync tests, and activated-fixture validation.

### Out of Scope

- Adding a separate teaching module, parallel task entity, or duplicate reference-only API/UI tree.
- Enabling `example` or applying its migrations in a newly generated app.
- Treating the entire example tree as code to copy wholesale.
- Removing, renaming, or repurposing `ratelimit_probe`.
- Redesigning `example_customers_sync`; it is not an example-read root.
- Implementing provider-specific packages, complete workflow engines, AI tool packs, or portal authentication inside `example`. Those remain specialist routes to exact installed sources and skills.
- Expanding issue #4670 beyond the affected certified harness lane.

## Canonical Ownership and Synchronization

### One Authoring Source

The canonical authoring root is:

```text
apps/mercato/src/modules/example/
```

The emitted template mirror is:

```text
packages/create-app/template/src/modules/example/
```

All relative paths, file bytes, and file presence under those roots must match. No template content transform or template-only allowlist entry may target `modules/example/**`. If a difference is necessary for standalone compilation, change the shared source to work in both environments; do not create an exception.

The implementation workflow is:

1. edit and validate the monorepo source;
2. run `yarn template:sync:fix` to materialize the template mirror;
3. review the resulting template diff;
4. run `yarn template:sync` and a focused example-tree parity test; and
5. run monorepo and standalone activated fixtures.

The focused parity test compares sorted relative file lists and SHA-256 content hashes. It also rejects future `TEMPLATE_ONLY_RELATIVE_FILES` or `TEMPLATE_CONTENT_TRANSFORMS` entries under `modules/example/**`. Adding, changing, renaming, or deleting any example file without the exact mirrored change fails the gate.

### Baseline Reconciliation

The implementation must classify each existing differing path before synchronization. Correctness and security changes in the monorepo copy, including tenant/organization scope in Todo command preparation, redo support, and their regression tests, must not be lost. Page-metadata and standalone-compile differences must be resolved into one implementation that works in both trees. After reconciliation, the full example subtree is identical; the spec permits no permanent baseline exceptions.

## Reuse Inventory

Implementation starts by recording every row in `references/surface-inventory.json`. Each row has a stable `capabilityId`, one rule owner, a coverage kind (`example`, `authoritative-source`, or `specialist-route`), and exact paths. `references/surface-map.md` renders the same inventory for humans. Paths have no line anchors.

### Existing Example Surfaces to Reuse

| Capability | Existing source | Required treatment |
|---|---|---|
| Module metadata, ACL, setup, DI, CLI | `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `cli.ts` | Link to the existing implementation; extend the same files only when the capability gap requires it. |
| Entities, validators, custom fields, migration/snapshot | `data/entities.ts`, `data/validators.ts`, `ce.ts`, `migrations/**` | Keep `Todo` as the canonical editable entity and extend its schema/migration rather than introducing a parallel task entity. |
| CRUD factory, Query Engine, OpenAPI, CSV export | `api/todos/route.ts`, `api/openapi.ts`, `components/TodosTable.tsx` | Reuse the live Todo API/list path and close compliance gaps in place. |
| Commands, undo/redo, events/indexer | `commands/todos.ts`, `commands/__tests__/**`, `events.ts`, `subscribers/**` | Preserve scoped command preparation, undo/redo, safe side effects, and typed events; complete optimistic-lock coverage through the gap below. |
| CrudForm/DataTable/perspectives/filters | `backend/todos/**`, `components/TodosTable.tsx` | Extract shared create/edit form definitions only where current pages duplicate them; keep the existing user path. |
| API/command interceptors, guards, enrichers | `api/interceptors.ts`, `commands/interceptors.ts`, `data/guards.ts`, `data/enrichers.ts` | Treat these as the canonical UMES examples and retain real callers/tests. |
| Headless and rendered injection | `widgets/injection/**`, `widgets/injection-table.ts` | Reuse the existing field, column, filter, row/bulk action, menu, customers, catalog, sales, and portal examples by capability. |
| Component replacement and dashboard widgets | `widgets/components.ts`, `widgets/dashboard/**` | Link to the existing registrations and tests. |
| Notification type and reactive handler | `notifications.ts`, `notifications.handlers.ts` | Reuse these owners; add a client renderer only because that discovery surface is absent. |
| Unified overrides | `src/modules.ts`, `__integration__/TC-UMES-022-overrides.spec.ts` | Keep the typed inactive override inventory and its exact test. The source map may link outside the module for the registry entry. |
| Integration coverage | `__integration__/**`, `__tests__/**`, `widgets/__tests__/**`, `lib/__tests__/**` | Preserve and extend focused tests instead of creating a second reference test suite. |

### Verified Gaps to Extend in `example`

The current tree does not have executable owners for the following required reference capabilities. They are additive extensions to `example`, not grounds for a new module:

| Gap | Extension of the current example | Minimum proof |
|---|---|---|
| Progressive source routing | Add `README.md`, `references/surface-map.md`, and `references/surface-inventory.json`. | Link/inventory tests resolve every path in monorepo, template, and emitted layouts. |
| Encryption | Add `encryption.ts`; add one optional sensitive Todo field or module-owned link snapshot and read it through decryption helpers. | Ciphertext-at-rest and no-plaintext-in-search/event/log/cache tests. |
| Explicit extension hosts and entity extensions/links | Add `extension-points.ts`, bind every declaration to a current call site, add `data/extensions.ts`, and only if needed add a module-owned ID/snapshot link entity tied to Todo. | No documentation-only host, no cross-module ORM relation, scoped reads/writes, absent-host behavior. |
| Search registration | Add `search.ts` using the existing `example:todo` identity and non-sensitive fields. | Activated search/index lifecycle and tenant-scope test. |
| Cache | Add a focused DI-resolved Todo read cache with tenant/org tags and post-commit invalidation. | Hit, miss, isolation, and all-write-path invalidation tests. |
| Queue, worker, progress, import | Add a bounded Todo import route plus one idempotent worker using commands and platform progress. | Retry, cancel, partial failure, scope, and progress tests. |
| Client notification rendering | Add `notifications.client.ts`; reuse `notifications.ts` and `notifications.handlers.ts`. | Renderer registration, audience, dedupe, and cleanup tests. |
| Translatable fields | Add `translations.ts` for applicable Todo text fields. | Generator registration and locale/translation tests. |
| Defaults/example seeds | Extend `setup.ts` with idempotent defaults and opt-in example data. | New-tenant idempotency and no seed while disabled. |
| Shared form definition | Extract a shared Todo create/edit field/group definition from the existing pages when duplication is confirmed. | Both create and edit use it; locking/conflict behavior stays green. |
| Complete optimistic locking | Return `updatedAt` from list/detail projections, pass it through edit `initialValues`, and enforce it in command writes without narrowing legacy schema columns. | Update/delete stale writes return the standard 409 and the unified conflict UI can reload/retry. |
| Standalone override reference | Move or mirror the typed inactive override examples from root `src/modules.ts` into a compileable file under `example/references/` so lean preset registry replacement does not erase the reference. | Every override domain remains typed, inactive, linked, and covered by TC-UMES-022 or its focused successor. |

The capability audit must not bless existing code by location alone. Files linked as canonical examples must satisfy current rules: no unscoped lookup, no raw `.json().catch`, no hard-coded status colors, and no `any`-based shortcut where a runtime-narrowed type is possible. Current QA/demo files that do not yet meet that bar remain in the synchronized tree but receive `qa-only` inventory classification and are denied by `allowedCapabilityIds`; implementation either remediates them before linking or points to a safer exact file. The existing nullable Todo scope columns are a stable schema surface: new writes and queries must require effective tenant/organization scope, but the columns are not narrowed to non-null without a separately approved additive bridge for legacy rows.

Highly specialized AI, provider, workflow, portal-auth, security-provider, vector-search, analytics, messages/inbox, and generator-plugin branches stay `authoritative-source` or `specialist-route`. The surface map must name the owning installed skill and exact source file; it must not claim local implementation.

Empty placeholder discovery files are forbidden. If an inventory row is marked `example`, it needs a real registration, caller, and focused test. Additions to or removals from the finite inventory require a spec amendment and compatibility review.

## Disabled-by-Default Delivery Contract

Every built-in `classic`, `empty`, and `crm` scaffold must satisfy both assertions:

1. the emittable `src/modules/example/**` runtime/reference file set is present and byte-identical to the canonical tree after the scaffold's existing `__tests__`/`__integration__` filter; and
2. `src/modules.ts` contains no enabled entry with `id: 'example'`.

Consequently the example contributes no runtime surface until explicitly enabled. The source still participates in TypeScript compilation, so it must compile with the dependencies installed by every built-in preset. A fixture that opts in must add `{ id: 'example', from: '@app' }`, run `yarn generate`, verify the generated entity ID `E.example.todo === 'example:todo'`, and exercise the Todo list/create/edit/delete paths without applying migrations to a developer database.

This intentionally changes the fresh `classic` scaffold from enabled to disabled. Existing applications are not rewritten. Preset and snapshot tests must make the new-app boundary explicit and prove the generated home screen contains no dead example quick link. `ratelimit_probe` behavior stays unchanged. `example_customers_sync` remains outside this spec and must never be activated merely because the example source is present.

## Data, API, UI, and Runtime Contracts

The existing `Todo` slice is the reference entity. Extensions preserve `example`, `Todo`, `example:todo`, the current table/API paths, ACL IDs, events, widget IDs, and integration-test identifiers. Renaming those surfaces for a shadow module or creating parallel IDs is forbidden.

Any added user-editable field keeps `updated_at`/`updatedAt` and the default optimistic-lock contract. Todo create/update/delete and any child/link mutation stay command-mediated, tenant/organization scoped, Zod-validated, undoable where supported, and use the child record's version when a child mutation overrides the parent header. No decrypted or cross-module display value enters events, logs, cache, search, or notification payloads.

Existing pages remain the UI reference. Lists use `DataTable`; create/edit use `CrudForm`; HTTP uses the shared API helpers; non-`CrudForm` writes use `useGuardedMutation`; conflicts use the unified conflict surface. New UI uses translations, semantic design tokens, shared loading/error/empty components, keyboard behavior, and accessible labels. Extensions must not enlarge an already oversized page merely to demonstrate another surface; add a focused component and link it from the map.

Optional customers, catalog, sales, and portal hosts degrade gracefully. The example never gains a hard `requires` dependency or cross-module ORM relationship. All cross-module contributions retain stable typed context, ACL checks, tenant/organization scope, and absent-host tests.

## Standalone Skill-to-Example Contract

The standalone `om-module-scaffold`, `om-system-extension`, `om-backend-ui-design`, `om-data-model-design`, `om-eject-and-customize`, and harness-evolution guidance must route to the exact relevant files under `src/modules/example/**`.

Each rule has one owner:

- skills/guides own requirements and decision rules;
- `example` owns compiling executable examples;
- `surface-inventory.json` owns the finite machine-readable mapping; and
- `surface-map.md` owns the human navigation view.

Skills must tell agents to copy or adapt only the necessary files and rename module/entity/route/event/widget/ACL identifiers. Large duplicated snippets move to source links. Short syntax fragments may remain when they express a rule rather than an implementation. Tests reject dead links, directory-only links, line anchors, duplicate owners, missing emitted skills, and any instruction to use `ratelimit_probe` as a blueprint.

## Harness Regression

The source-selection case gives the agent a generated lean app and a small module task. `src/modules/example/**` is immutable harness context: a case may read declared files but may not write, rename, or delete them even when its writable roots otherwise include `src/modules/**`. Its ordered trace must show:

1. the relevant skill/guide is read;
2. `src/modules/example/README.md` is the first module-source entrypoint;
3. only capability-linked example files are read within the case budget;
4. no read under `ratelimit_probe` occurs; and
5. installed framework source is used only after a named local/versioned contract gap.

The output oracle rejects copied `example`, `example:todo`, route, event, ACL, and widget identifiers and rejects whole-tree copies, while requiring a distinct plural snake_case module ID, scoped entities, guarded/locked writes, translations, and generated-registry discipline. A classic-preset assertion proves the source is present but disabled; it no longer needs to choose between two example modules.

The linked [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md) owns generic schema, path safety, budgets, and fallback semantics. This spec registers case-specific roots such as:

```json
{
  "root": "src/modules/example",
  "entrypoints": ["README.md", "references/surface-map.md"],
  "allowedCapabilityIds": ["api.crud-factory", "commands.write", "ui.form-shared"],
  "maxFiles": 12,
  "maxBytes": 131072
}
```

Case IDs are allocated only after semantic deduplication. Every affected case, validator/oracle, release-matrix lane, catalog count, documentation file, and emitted/generated harness copy moves together through `om-evolve-harness` and `om-refresh-standalone-harness`.

## Testing and Validation

### Focused Coverage

1. Exact-tree parity: sorted paths and SHA-256 hashes match between monorepo and template; template-sync has no example exception or transform.
2. Preset matrix: `classic`, `empty`, and `crm` contain `src/modules/example/**` and do not register `example`.
3. Template fixture: the disabled tree typechecks in every preset; no example route, page, migration, seed, event, widget, worker, navigation entry, or dead home quick link is generated.
4. Activated fixture: explicitly register `example`, run generation, assert `E.example.todo`, and exercise existing CRUD/UI/UMES tests plus each new extension.
5. Regression preservation: current Todo command scope/redo, API, UI, injection, override, dashboard, notification, adapter, and integration suites remain green after reconciliation.
6. Security: tenant/org isolation, 403, cross-scope 404, stale 409, encryption leakage, cache isolation, worker retry/idempotency, and audience scoping.
7. Source-map parity: every capability has one owner and exact live paths in all three layouts; repository-only tests are evidence but are not claimed as emitted files; no shadow implementation path remains.
8. Harness: fail-before/pass-after source selection, bounded read-only example access, mutation denial, renamed output, and affected certified lane evidence.
9. Instruction and source budgets: emitted `AGENTS.md`, README, and surface map remain bounded; new client components stay focused and do not grow existing oversized files.

Every integration test creates its own tenant-scoped fixtures and removes them in `finally`; none relies on seeded/demo data.

### Validation Sequence

Choose Docker or local mode once according to `.ai/docs/agent-instructions.md`, record the runner, then run:

```bash
yarn template:sync
yarn build:packages
yarn generate
yarn build:packages
yarn workspace create-mercato-app test
yarn test:create-app
yarn test:create-app:integration
yarn agents:check-budget
yarn typecheck
yarn lint
yarn test
yarn build:app
```

Run the affected harness lane and its knowledge-change manifest through the owning workflow. Do not apply migrations locally merely to validate the fixture.

## Backward Compatibility

- No framework API, import, event, widget, CLI, or database contract is removed or renamed.
- Existing `example` identifiers and paths remain stable; the design eliminates the proposed, unshipped duplicate identifiers.
- Existing repositories are not modified. The observable behavior change applies only to newly generated `classic` apps, where `example` becomes source-present but runtime-disabled.
- Lean presets gain additive source files and stop deleting `example`; their runtime remains unchanged because registration stays absent.
- Future removal or rename of `src/modules/example` requires the documented deprecation protocol once external tools rely on it.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Monorepo and template drift again | High | One authoring root, existing sync fixer/check, exact hash test, no example exceptions. | Low. |
| Baseline sync copies stale or unsafe behavior | High | Review all 20 current differing paths before sync; preserve scoped commands, redo, and tests. | Low after reconciliation review. |
| Broad QA module overwhelms agent context | Medium | README-first progressive disclosure, capability IDs, dual file/byte budgets, whole-tree-copy rejection. | Low. |
| Example is accidentally enabled | High | Registration-absence tests for all presets and runtime-surface negative fixture. | Low. |
| Classic users expect demo pages in a fresh scaffold | Medium | Explicit release note and preset regression; source remains available for one-line opt-in. | Medium. |
| A gap grows into another mini-domain | Medium | Extend Todo or route to an authoritative specialist source; require spec amendment for inventory growth. | Low. |
| Skill links and source drift | High | Exact link tests across authoring/template/emitted layouts and knowledge-governance gate. | Low. |
| Sensitive/scoped data leaks through new examples | High | Encryption, scoped queries, safe payloads, cache/audience tests, no cross-module ORM. | Low after focused tests. |

## Implementation Plan

### Phase 1 — Reconcile and Lock the Canonical Tree

1. Classify the current 20 differing paths, preserve the correct monorepo behavior, and make the two example trees byte-identical through `yarn template:sync:fix`.
2. Add the exact parity test and prohibit example-specific template exceptions/transforms.
3. Add the README, finite inventory, and surface map using only verified existing paths and capability owners.

Exit criterion: `yarn template:sync` and the focused parity test pass, and the map distinguishes existing coverage from verified gaps.

### Phase 2 — Ship the Example Inert in Every Preset

1. Stop deleting `src/modules/example` from `empty`/`crm` and remove its default classic registration.
2. Remove or registry-gate example-only home quick links, then add source-present/registration-absent tests for all presets and negative runtime-surface assertions.
3. Add an explicit activation fixture that generates, compiles, and exercises the existing Todo slice.

Exit criterion: every scaffold ships the exact source, none activates it, and explicit activation remains functional.

### Phase 3 — Extend Only Missing Core and Runtime Surfaces

1. Add the verified encryption, extension/link, search, translations, defaults/examples, and shared-form gaps to the existing Todo slice.
2. Add cache/invalidation, bounded queued import, worker/progress, and client notification rendering to the same module.
3. Add focused security, isolation, retry, conflict, event, search, cache, notification, generation, and migration tests as each gap lands.

Exit criterion: every `example` inventory row has a real caller/test and no duplicate domain or placeholder file exists.

### Phase 4 — Synchronize Skills and Harness

1. Replace duplicated implementation snippets with exact example links while preserving each normative rule owner and emitted skill tier.
2. Register `src/modules/example` roots and failure-first source-selection/read-policy cases after semantic deduplication.
3. Synchronize validators/oracles, release matrix, counts/docs, knowledge manifest, and generated harness copies through the owning workflows.

Exit criterion: relevant agents select and use the example within budget, unrelated reads fail, and every affected harness surface agrees.

### Phase 5 — Certify Monorepo and Standalone Behavior

1. Run monorepo example tests, template parity, preset matrix, activated standalone fixture, create-app integration, and the configured validation gate.
2. Run the affected certified harness lane and capture sanitized evidence.
3. Re-read the diff for accidental activation, stale mirror files, copied identifiers, dead links, placeholders, and scope drift.

Exit criterion: both environments are green, the example trees are identical, new apps are runtime-inert, and the harness uses the emitted example as its canonical module reference.

## Final Compliance Report — 2026-08-03

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/docs/module-development.md`
- `.ai/docs/agent-instructions.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/compliance-review.md`

### Compliance Matrix

| Area | Result |
|---|---|
| Scope cohesion | One capability: ship and govern the existing disabled example as the standalone module reference, including the focused proof that agents use it. |
| Canonical mechanism | Reuses the live Todo CRUD, commands, CrudForm/DataTable, events, UMES, and widget surfaces; gaps extend the same module. |
| Module isolation | Tenant/org scope, IDs/snapshots, optional hosts, and no cross-module ORM relationships remain mandatory. |
| Optimistic locking | Existing `updated_at`/`updatedAt` and default CRUD/child lock rules stay part of the activated proof. |
| Security/encryption | New sensitive example data requires encryption maps, decrypting reads, and leakage tests. |
| Template ownership | Monorepo authoring source and byte-identical template mirror are explicit and machine-enforced. |
| Runtime boundary | Source ships everywhere; registration and every derived runtime surface remain absent until opt-in. |
| Harness | Exact example root, entrypoints, capability budgets, source-selection trace, fixed output oracle, and synchronized release assets are specified. |
| Compatibility | No shipped framework contract changes; the fresh-classic default behavior change is explicit and tested. |
| Open questions | None; reuse, disablement, exact sync, and additive extension were explicitly directed. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Source ownership matches delivery | Pass | `apps/mercato` authors; template mirrors; emitted app copies the mirror. |
| Inventory matches implementation strategy | Pass | Existing surfaces are linked; verified gaps extend Todo/example only. |
| Runtime boundary matches tests | Pass | Preset negative assertions and activated fixture cover both states. |
| Skill routing matches harness reads | Pass | Both use `src/modules/example` plus the same capability inventory. |
| Risks cover writes and synchronization | Pass | Scope, locking, encryption, queues, cache, audiences, and drift are explicit. |

### Non-Compliant Items

None at design level. Implementation remains blocked from completion until the baseline tree drift is reconciled and all configured gates pass.

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-07-31: Initial draft based on the observed `ratelimit_probe` selection trace and the standalone harness merged in PR #4529.
- 2026-08-01: Expanded the proposed reference coverage and split spec-first routing, generic read policy, and harness governance into companion specs.
- 2026-08-03: Replaced the proposed duplicate teaching module with the existing `example` module as the sole standalone reference; required source-present/runtime-disabled delivery in every preset, additive gap extensions, exact skill/harness source links, and byte-identical synchronization from `apps/mercato` to the create-app template.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent fresh-context scope-cohesion and cross-spec consistency passes.
- **Scope cohesion:** The fresh pass recommended splitting delivery/sync, capability-gap closure, and harness consumption. The user-selected boundary is retained as Q7 because these are phased acceptance surfaces of one canonical-example contract; independently reusable generic policies remain in the three companion specs.
- **Security:** Passed at design level; exposed example files require scoped, locked, encrypted, reference-quality behavior or `qa-only` exclusion.
- **Performance:** Passed; emitted-size facts, bounded reads, and focused-file growth constraints replace the invalid small-module budget.
- **Cache:** Passed at design level; the missing cache example is DI-resolved, tenant/org tagged, and invalidated on every Todo write path.
- **Commands:** Passed; existing scoped command, undo/redo, and optimistic-lock behavior is preserved and regression-tested.
- **Risks:** Passed; baseline drift, accidental activation, dead links, classic behavior change, context breadth, and source-link drift are explicit.
- **Verdict:** Approved for design review under the explicit Q7 boundary.
