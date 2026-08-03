# Standalone Canonical Example Module

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS, standalone applications emitted by `create-mercato-app`
- **Related:** [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), [Standalone Agent Spec-First Routing](./2026-08-01-standalone-agent-spec-first-routing.md), [Standalone Harness Example and Linked-Source Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Empty App Starter Presets](./2026-04-02-empty-app-starter-presets.md), merged PR [#4529](https://github.com/open-mercato/open-mercato/pull/4529), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

The standalone template already contains a comprehensive `example` module, but the `empty` and `crm` preset resolver deletes it while the default `classic` scaffold enables it. Do not create a second teaching module that copies the same entities, routes, commands, forms, UMES branches, and tests. Make the existing `example` tree the one canonical module reference: ship it in every built-in scaffold, keep it absent from every generated `src/modules.ts`, add progressive-disclosure source maps, and extend the existing Todo-centered vertical slice only for capability gaps that the current tree does not cover.

`apps/mercato/src/modules/example/**` is the authoring source. `packages/create-app/template/src/modules/example/**` is a byte-identical mirror maintained by the existing `yarn template:sync:fix` workflow and enforced by `yarn template:sync`. Standalone guides, skills, references, and harness cases contain visible Markdown links to exact files under the emitted `src/modules/example/**` root or, for specialist capabilities, exact source shipped by the installed package under `node_modules/@open-mercato/**`. A machine-readable parity ledger supplements those visible links; evaluator permissions alone do not satisfy the contract. No shadow teaching module, template-only example fork, or copied reference implementation is allowed.

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
| Q7 | Split delivery, gap closure, and reference-specific harness proof? | Keep one umbrella contract but make delivery, each gap slice, harness migration, and certification independently mergeable milestones; generic read semantics, governance, and spec-first policy remain separate companion specs. | The user explicitly requires one shipped, complete, discoverable example contract, while independent milestones prevent source delivery, a single gap, or link migration from becoming one atomic high-risk implementation. |
| Q8 | Is evaluator permission sufficient to restore the old harness examples? | No. Every implementation-bearing knowledge owner must contain visible exact-file links, and the harness must preserve the implementation-topic coverage formerly supplied by embedded snippets on `main`. | A read allowance cannot teach an agent which source to open, and prose-only replacements silently lost executable reference coverage. |
| Q9 | How should DataTable bulk actions and progress be demonstrated? | Extend the existing Todo list into one connected selected-row bulk-operation slice that returns a real `progressJobId`, queues command-mediated work, and drives the platform top progress bar. | The current example has a customers bulk-action injection and a separate synthetic progress page, but it does not show the production DataTable bulk-action-to-progress contract end to end. |

## Problem Statement

`packages/create-app/src/lib/starter-presets.ts` currently removes `src/modules/example` and `src/modules/example_customers_sync` for `empty`; `crm` inherits that removal. `classic` bypasses preset rewriting, so the template's current `src/modules.ts` enables `example`. This creates two bad outcomes:

1. lean standalone apps retain the narrow `ratelimit_probe` fixture but lose the only comprehensive local module example; and
2. the proposed remedy duplicates much of the already-shipped example under a new module ID, adding a second implementation and a second maintenance surface.

At the 2026-08-03 design baseline, the template example contains 136 files and 746,030 file bytes. The scaffold copier intentionally omits `__tests__` and `__integration__`, leaving 104 runtime/reference files and 555,327 file bytes in a generated app. The repository tree already covers CRUD, commands and undo, custom fields, OpenAPI, list export, an `updatedAt`-bearing editable entity, backend forms and tables, typed events, subscribers, notification types/handlers, response enrichers, mutation guards, API and command interceptors, component replacement, dashboard widgets, customers/catalog/sales injections, unified overrides, migrations, ACL, setup, DI, CLI, i18n, and extensive integration coverage.

The two repository copies are not currently identical: 20 paths differ, including command scope/redo behavior, a missing command test, page metadata, integration fixtures, and locale/test formatting. The existing `yarn template:sync` command already detects this drift because `modules/**` is in its sync set. This spec turns a passing exact-sync check into a release requirement and requires the baseline reconciliation to preserve the safer/correct behavior rather than copying the stale side blindly.

The whole-harness audit used `main` commit `f7c941570003f3abe920b1765995cbef98dcad0b` as the finite compatibility baseline. Its emitted root-instruction template and seven implementation skills contain 136 CommonMark fenced blocks across module anatomy, backend UI, data modeling, ejection, integrations, module scaffolding, UMES, and troubleshooting. The current core implementation-owner set—one root template, nine guides, 24 skill entrypoints, and 58 skill references—contains no Markdown link to `src/modules/example`. Some routing, workflow, upgrade, tracker, harness-operation, and report examples remain self-authoritative, but the eight implementation families are prose-only. The implementation must classify every deterministic baseline fence and close its implementation-topic coverage gap rather than assuming better evaluator access restores it.

## Proposed Solution

1. Stop removing `src/modules/example` from lean presets and remove `example` from the default classic registry so all built-in scaffolds have the same source-present/runtime-disabled contract.
2. Keep `example_customers_sync` and `ratelimit_probe` outside the canonical reference contract; do not broaden this change into their delivery redesign.
3. Remove or enabled-module-gate the example entries in `src/lib/homeQuickLinks.ts` (`/example`, `/backend/example`, and `/backend/todos`) so a disabled module never leaves dead navigation.
4. Add `README.md`, `references/surface-map.md`, and `references/surface-inventory.json` inside the existing example tree.
5. Reconcile the current monorepo/template drift, using the monorepo tree as source and reviewing each differing behavior before running the existing sync fixer.
6. Extend `example` only for the missing surfaces identified by the finite inventory. Reuse its existing `Todo`, commands, routes, pages, widgets, and identifiers rather than adding a parallel task domain.
7. Replace large inline examples in standalone skills with exact, line-number-free links to the example source while retaining one normative rule owner per capability.
8. Register `src/modules/example` as a capability-scoped, read-only root in relevant harness cases and prove agents select it before `ratelimit_probe` or undeclared installed-source fallback; declared specialist/host links remain directly usable.
9. Add a whole-harness source-reference manifest and `main`-baseline parity ledger, while also rendering each required reference as a visible direct link in its owning emitted guide, skill, or reference.
10. Turn the Todo DataTable bulk action and platform progress support into one end-to-end canonical example, then add self-contained integration coverage for every new runtime extension introduced by this spec.

## Scope Boundaries

### In Scope

- Byte-identical parity between `apps/mercato/src/modules/example/**` and `packages/create-app/template/src/modules/example/**`.
- Source-presence and registration-absence contracts for `classic`, `empty`, and `crm` scaffolds.
- Removal or registry-gating of example-only home quick links while the module is disabled.
- Progressive-disclosure README, surface map, finite inventory, activation/copy/rename checklist, and exact source links.
- Reuse of the current Todo CRUD/command/UI slice and current UMES/widget/integration examples.
- A reference-quality audit of every file exposed by the capability map; unsafe QA/demo-only files remain present but use `referenceStatus: "qa-only"` and are forbidden to harness reads until remediated.
- Focused additions to `example` for verified gaps such as encryption, explicit data extensions/links, search registration, DI cache use and invalidation, a queued Todo DataTable bulk operation with progress, client notification rendering, translatable-field registration, and default/example seeding.
- Standalone skill links, harness source-selection behavior, bounded example reads, preset tests, sync tests, and activated-fixture validation.
- Whole-harness classification of all emitted knowledge owners, visible exact-file links, prior-`main` topic parity, installed-package target resolution, and dead-link/drift enforcement.
- A Todo DataTable selected-row bulk action that creates a progress job, queues command-mediated work, returns `progressJobId`, and renders operation progress through the existing top progress bar.
- Self-contained activated-fixture integration coverage for every added or materially changed example runtime/discovery extension surface.

### Out of Scope

- Adding a separate teaching module, parallel task entity, or duplicate reference-only API/UI tree.
- Enabling `example` or applying its migrations in a newly generated app.
- Treating the entire example tree as code to copy wholesale.
- Removing, renaming, or repurposing `ratelimit_probe`.
- Redesigning `example_customers_sync`; it is not an example-read root.
- Implementing provider-specific packages, complete workflow engines, AI tool packs, or portal authentication inside `example`. Those remain specialist routes to exact installed sources and skills.
- Expanding issue #4670 beyond the affected certified harness lane.

## Canonical Ownership and Synchronization

### Delivery Milestones and Merge Boundaries

This specification is an umbrella contract, not a requirement for one implementation PR. The following milestones are independently reviewable and mergeable while preserving the final invariant:

1. **Canonical delivery:** reconcile the existing tree, add its map/inventory, enforce byte parity, ship it in every preset, and keep it disabled.
2. **Capability gaps:** implement each verified-gap row as a separate vertical slice, including its runtime caller, inventory/source-map entry, exact integration test, dependency metadata, and synchronized mirror. Closely coupled rows may share a PR only when each row remains independently traceable and green.
3. **Harness source-link migration:** classify the whole emitted owner set and prior-`main` ledger, then migrate owner families or coherent topics in independently green batches. This milestone may link existing example/package sources before every capability gap lands; a gap's new links land with that gap or in a later independently green batch.
4. **Certification:** certify each merged milestone with its focused gates, then run the final aggregate packed-scaffold and harness lane once all required milestones are present.

No milestone may temporarily enable `example`, create a shadow reference module, weaken exact-link/read safety, or leave a new runtime/discovery extension without its self-contained integration proof.

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

The implementation must classify each existing differing path before synchronization. Correctness and security changes in the monorepo copy, including tenant/organization scope in Todo command preparation, redo support, and their regression tests, must not be lost. Page-metadata and standalone-compile differences must be resolved into one implementation that works in both trees. The current template-only recovery hint `git checkout -- apps/mercato/src/modules/example/backend/page.tsx` is invalid in a generated app and must become an app-root-relative instruction (or be removed) before the file can be canonical. After reconciliation, the full example subtree is identical; the spec permits no permanent baseline exceptions.

## Reuse Inventory

Implementation starts by recording every row in `references/surface-inventory.json`. Each row has a stable `capabilityId`, one rule owner, a `coverageKind` (`example`, `authoritative-source`, or `specialist-route`), a `referenceStatus` (`canonical` or `qa-only`), a derived `readStatus` (`readable` or `qa-only`), exact source paths, `integrationTestPaths`, and `dependencyModules`. `coverageKind` says where the capability is implemented or routed; `referenceStatus` records reference quality; `readStatus` is the evaluator-facing derivation and is `readable` only for canonical exact files. Repository-only integration tests may be evidence paths but never become readable source references. Every added or materially changed runtime/discovery extension surface with `coverageKind: "example"` requires a non-empty integration-test list even when it is added to an existing capability row. `references/surface-map.md` renders the same inventory for humans. Paths have no line anchors.

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
| DataTable bulk action, queue, worker, and progress | Give the Todo table `extensionTableId="example.todos.list"`; register `widgets/injection/todo-bulk-complete/widget.ts` at `data-table:example.todos.list:bulk-actions`; add `api/todos/bulk-complete/route.ts`, `lib/todoBulkComplete.ts`, `workers/todos-bulk-dispatch.ts`, and `workers/todos-bulk-complete.ts`. The injected action returns a real `progressJobId`, which is the DataTable path that already tracks the platform top progress bar. Replace the separate synthetic demonstration as the canonical progress reference, although it may remain QA-only. | `TC-EXAMPLE-003-todo-bulk-progress.spec.ts` proves selection, start feedback, visible top progress bar, SSE/poll updates, completion, crash recovery, partial failure, cancellation, retry/idempotency, scope, and record results with `example`, `progress`, `events`, and `scheduler` enabled. |
| Client notification rendering | Add `notifications.client.ts`; reuse `notifications.ts` and `notifications.handlers.ts`. | Renderer registration, audience, dedupe, and cleanup tests. |
| Translatable fields | Add `translations.ts` for applicable Todo text fields. | Generator registration and locale/translation tests. |
| Defaults/example seeds | Extend `setup.ts` with idempotent defaults and opt-in example data. | New-tenant idempotency and no seed while disabled. |
| Shared form definition | Extract a shared Todo create/edit field/group definition from the existing pages when duplication is confirmed. | Both create and edit use it; locking/conflict behavior stays green. |
| Complete optimistic locking | Return `updatedAt` from list/detail projections, pass it through edit `initialValues`, and enforce it in command writes without narrowing legacy schema columns. | Update/delete stale writes return the standard 409 and the unified conflict UI can reload/retry. |
| Standalone override reference | Move or mirror the typed inactive override examples from root `src/modules.ts` into a compileable file under `example/references/` so lean preset registry replacement does not erase the reference. | Every override domain remains typed, inactive, linked, and covered by TC-UMES-022 or its focused successor. |

The capability audit must not bless existing code by location alone. Files linked as canonical examples must satisfy current rules: no unscoped lookup, no raw `.json().catch`, no hard-coded status colors, and no `any`-based shortcut where a runtime-narrowed type is possible. Current QA/demo files that do not yet meet that bar remain in the synchronized tree but receive `referenceStatus: "qa-only"` and are denied by `allowedCapabilityIds`; implementation either remediates them before linking or points to a safer exact file. The existing nullable Todo scope columns are a stable schema surface: new writes and queries must require effective tenant/organization scope, but the columns are not narrowed to non-null without a separately approved additive bridge for legacy rows.

Highly specialized AI, provider, workflow, portal-auth, security-provider, vector-search, analytics, messages/inbox, and generator-plugin branches stay `authoritative-source` or `specialist-route`. The byte-identical example README/map records a stable `sourceReferenceId` and routes to the owning emitted guide or skill; it does not embed a location-dependent `node_modules` href. The owning emitted guide/skill/fact sheet, outside the mirrored example tree, renders the visible exact installed-package link. This preserves byte parity while still giving the harness a direct readable target.

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

The Todo list's canonical long-operation path is an `InjectionBulkActionDefinition`, not the host-owned `bulkActions` prop path, because the existing injected-action result contract consumes `progressJobId`, tracks terminal events, clears selection, and refreshes on completion. `TodosTable` declares `extensionTableId="example.todos.list"`; `widgets/injection-table.ts` registers action ID `example.todos.mark-done` from `widgets/injection/todo-bulk-complete/widget.ts` at `data-table:example.todos.list:bulk-actions`.

The action creates one UUID `idempotencyKey` per invocation and POSTs `{ ids, idempotencyKey }` to `api/todos/bulk-complete/route.ts`; `ids` is a unique array of 1–500 UUIDs. Add module-owned `TodoBulkOperation` in `data/entities.ts` with `tenant_id`, non-null `organization_id`, `user_id`, `idempotency_key`, request hash, selected IDs, `progress_job_id` as a plain UUID (no cross-module ORM relation), publish state/attempt timestamps, execution state/lease owner/lease expiry, next-item checkpoint, bounded result summary, and timestamps; its migration has a unique constraint on `(tenant_id, organization_id, user_id, idempotency_key)`. The route requires the existing Todo manage feature, derives scope from authenticated server context, verifies every selected ID in that scope before starting, and uses one transaction/unique-constraint claim helper in `lib/todoBulkComplete.ts` to create or reuse the operation and progress job. Duplicate requests return the recorded `progressJobId` and may safely nudge publication recovery; they never create a second logical operation/progress job.

`TodoBulkOperation` is also the module-owned transactional outbox. After commit, the route calls the shared dispatcher for low latency. `setup.ts` registers an idempotent organization-scoped scheduler target for `example:todos-bulk-dispatch`; `workers/todos-bulk-dispatch.ts` scans scoped unpublished operations and expired execution leases, enqueues only `{ operationId, scope }` on `example-todos-bulk-complete`, and records publish attempts. Publication is explicitly at least once: a crash after queue acceptance but before marking published may create two physical queue messages, and this is safe because the leased execution claim below permits one effective executor. A crash before publication leaves the durable row pending for the next scheduler tick or same-key request. The API returns HTTP 202 `{ ok: true, progressJobId }` after the durable row/job commit; an immediate enqueue failure does not erase it. Malformed, repeated IDs, missing, foreign-scope, or unauthorized input creates neither row nor job.

Worker `example:todos-bulk-complete` acquires or renews a compare-and-swap lease on the operation (the same queue job may renew; another job waits until expiry), resumes from `nextItemIndex`, calls `startJob`, checks `isCancellationRequested()` before every item, loads the current scoped Todo version, and executes existing command ID `example.todos.update` with `is_done: true` and that record's optimistic-lock version. Already-completed Todos are idempotent successes. After every attempted item it atomically advances the checkpoint, persists bounded result codes, renews the lease, and updates progress. A cancellation request stops before the next command and calls `markCancelled`; zero successful mutations with failures calls `failJob`; mixed success/failure calls `completeJob` with `{ affectedCount, failedCount, failedItems: [{ id, code }] }`; full success calls `completeJob`. Terminal CAS clears the lease and makes duplicate messages no-ops. A mid-worker crash is recovered by the queue retry with the same lease owner or by the dispatcher after lease expiry, preserving the same operation/progress job and checkpoint. The activated fixture provisions the least required example mutation features plus `progress.view` and the server-side progress create/update/cancel capabilities; the browser never receives broader progress management merely to make the bar appear. Client-side write loops, timers that simulate progress, the host-owned bulk-action prop, or a page-local progress widget do not satisfy this reference capability.

Optional customers, catalog, sales, and portal hosts degrade gracefully. The example never gains a hard `requires` dependency or cross-module ORM relationship. All cross-module contributions retain stable typed context, ACL checks, tenant/organization scope, and absent-host tests.

## Standalone Skill-to-Example Contract

The standalone `om-module-scaffold`, `om-system-extension`, `om-backend-ui-design`, `om-data-model-design`, `om-eject-and-customize`, and harness-evolution guidance must route to the exact relevant files under `src/modules/example/**`.

Each rule has one owner:

- skills/guides own requirements and decision rules;
- `example` owns compiling executable examples;
- `surface-inventory.json` owns the finite machine-readable mapping; and
- `surface-map.md` owns the human navigation view.

Skills must tell agents to copy or adapt only the necessary files and rename module/entity/route/event/widget/ACL identifiers. Large duplicated snippets move to source links. Short syntax fragments may remain when they express a rule rather than an implementation. Tests reject dead links, directory-only links, line anchors, duplicate owners, missing emitted skills, and any instruction to use `ratelimit_probe` as a blueprint.

## Whole-Harness Direct Source-Link Contract

The implementation inventories every emitted text knowledge owner, not just case context: root `AGENTS.md` and provider/editor wrappers or rules; all `.ai/guides/*.md`; every installed local skill entrypoint/reference; spec templates, tracker descriptors, review/QA guidance, harness README/release/case/oracle descriptions; generated module fact sheets/upstream snapshots; and any other emitted Markdown/template/rule file that can direct implementation. Operational owners such as the root safety/router, delivery workflow tables, report templates, versioned upgrade instructions, tracker commands, harness execution procedure, and enforcement hooks may be classified `self-authoritative`; generated identifiers may be classified `generated-fact`. Every other implementation-bearing topic is `source-required` and must show at least one visible Markdown link to an exact regular file in its declared current owner. A backticked path, directory link, wildcard, manifest-only record, or evaluator allowance is not a visible source link.

The controller generates `packages/create-app/agentic/shared/ai/harness/source-link-inventory.json`, emitted as `.ai/harness/source-link-inventory.json`, from the complete emitted owner scan, canonical example inventory, generated module-fact provenance, case/oracle references, package/preset matrix, and the checked `main` parity ledger. It is a derived asset and must never be hand-edited or treated as an independent authority. Each record contains `topicId`, emitted `originAsset`, optional heading/anchor, `requirement` (`source-required`, `self-authoritative`, `generated-fact`, or `retained-normative-snippet`), `targetKind` (`canonical-example`, `installed-package`, or `local-owner`), `readStatus` (`readable` or `qa-only`), exact owner-relative rendered `href`, logical app-root `resolvedPath`, capability/module/package IDs, installed version and content hash where applicable, preset/tier applicability, integration-test evidence paths, affected case IDs, and the `main` baseline IDs it replaces. The controller computes each owner-relative `href` from `originAsset` plus logical `resolvedPath`; mirrored example files therefore keep only app-root-stable local links/reference IDs, while location-specific installed-package hrefs live in generated owners outside the synchronized tree. The manifest is a completeness/drift oracle; it never substitutes for the link rendered in `originAsset`. Cases may cite only records with `readStatus: "readable"`; QA-only test evidence cannot grant source reads.

Add checked `packages/create-app/agentic/shared/ai/harness/source-link-baseline.json` plus `source-link-baseline.schema.json` for the resolved `main` audit. The root object has the exact 40-hex `baselineSha`, the exact `baselineAssets` table below, and `blocks`. Each asset record contains `path`, full-file `sha256`, and `expectedFenceCount`. Every block has stable ID `main:<asset>#fence:<ordinal>`, `asset`, nearest `heading`, one-based asset `ordinal`, opening line, fence info string, content `sha256`, `topicIds` (empty only for `not-implementation`), and one disposition: `linked`, `retained-normative-snippet`, `superseded-with-current-rule-and-source`, or `not-implementation`. `linked` and `superseded-with-current-rule-and-source` require non-empty `targetTopicIds` that resolve exactly to source-link inventory topics. `retained-normative-snippet`, `superseded-with-current-rule-and-source`, and `not-implementation` require a checked non-empty `rationale`; `linked` may omit it. IDs are unique. The validator loads exactly the eight pinned files, verifies each full-file hash, parses every CommonMark backtick/tilde fence including fences indented by up to three spaces, derives IDs/positions/hashes, requires exactly the per-asset count and 136 one-to-one block records, and rejects a missing/substituted asset, missing/extra/hash-mismatched fence, unresolved target topic, or conditionally missing field. Semantically duplicate blocks may map to the same compiling file, and short invariant syntax may stay inline, but no old topic may disappear merely because new prose mentions the concept.

| Exact baseline asset at pinned `main` | SHA-256 | Fences |
|---|---|---:|
| `packages/create-app/agentic/shared/AGENTS.md.template` | `b124b38a32f13fd4ef6202922dacfaadc1594e3af17fdd5e862510151f612b70` | 4 |
| `packages/create-app/agentic/shared/ai/skills/om-backend-ui-design/SKILL.md` | `a0820bba96eb9871e3a4ba9bfe534ddb6f458e86f85b19616a931b2d55863aac` | 13 |
| `packages/create-app/agentic/shared/ai/skills/om-data-model-design/SKILL.md` | `92a91dff9ad6ea997bf15ca5b44a19e9005b4b0d4f1275181ebeab3c968765b4` | 19 |
| `packages/create-app/agentic/shared/ai/skills/om-eject-and-customize/SKILL.md` | `40d6b197644e752c575460e8dcdb6ba5d152615a491c9164e490f4bd2d74f3da` | 8 |
| `packages/create-app/agentic/shared/ai/skills/om-integration-builder/SKILL.md` | `b3fdc1dd56314f5588db8b51945d467e47d286fee09f9de38ccedcc4623de475` | 30 |
| `packages/create-app/agentic/shared/ai/skills/om-module-scaffold/SKILL.md` | `2a025d500c355b59db881548c7288eaa7cade3357a27fb94b0fe90f54da1f2e6` | 24 |
| `packages/create-app/agentic/shared/ai/skills/om-system-extension/SKILL.md` | `1f85d73d725268b8e9e5743f523ea45975f578ac5a6502d9c8cb2dc9c0e0a4d0` | 20 |
| `packages/create-app/agentic/shared/ai/skills/om-troubleshooter/SKILL.md` | `2b0ca22e63843e1a6e5cddbda8165013cecd230d91d4957430a16f714909d052` | 18 |
| **Total** |  | **136** |

The eight owner families and source strategy are:

| Emitted owner family | Prior implementation coverage | Required visible source strategy |
|---|---|---|
| Root instructions | Module anatomy, locking, common imports | Keep the root a budget-safe safety/router owner with one compact visible README/inventory entrypoint; map the old detailed topics to exact links in the selected architecture/contracts/UI owners rather than restoring them in root. |
| `om-backend-ui-design` and backend UI guide/references | Page shell, DataTable, CrudForm, dialogs, detail/states/API/custom fields | Link exact example pages/components plus installed UI files for primitive implementation contracts. |
| `om-data-model-design` | Entities, relations, queries, validators, migrations, locking, encryption | Link exact example data/command/migration/encryption files; use an installed module source for relation/helper patterns the example intentionally does not implement. |
| `om-eject-and-customize` | Safe installed-module modification | Link the exact framework-context-resolved installed file plus the example migration/entity mechanics; never a package directory. |
| `om-integration-builder` | Registration, adapters, webhooks, health, widgets, tests | Link exact installed provider/hub source shipped in the applicable preset and exact local mock-adapter files only where they are reference-quality. |
| `om-module-scaffold` | Complete CRUD/module vertical slice | Link exact capability files in `src/modules/example`, starting from its README/map. |
| `om-system-extension` | Enrichers, interceptors, guards, injections, row/bulk actions, subscribers, overrides | Link exact example UMES contributor/caller/test files and exact generated host-source files. |
| `om-troubleshooter` | Discovery, database/API/extension diagnostics, page metadata repair | Link exact app scripts/config/tests/page metadata or a version-resolved installed defect call site. |

Generated fact sheets also stop rendering unreadable source-root directory links. Every entity, API/page route, event, ACL feature, DI key, search/notification surface, extension host, and UMES contribution that advertises source provenance renders an exact-file link when the extractor knows it. Roots and patterns may remain non-clickable explanatory text only. Existing extractor `source` fields must be rendered rather than discarded.

### Minimum Direct Targets

The emitted links use paths relative to their emitted owner. The table below pins the minimum app-root targets and links their current authoring equivalents for review:

| Capability | Emitted exact target(s) | Current authoring evidence |
|---|---|---|
| Todo CRUD/DataTable | `src/modules/example/api/todos/route.ts`, `src/modules/example/components/TodosTable.tsx`, `src/modules/example/backend/todos/create/page.tsx`, `src/modules/example/backend/todos/[id]/edit/page.tsx` | [CRUD route](../../apps/mercato/src/modules/example/api/todos/route.ts), [Todo table](../../apps/mercato/src/modules/example/components/TodosTable.tsx), [create page](../../apps/mercato/src/modules/example/backend/todos/create/page.tsx), [edit page](../../apps/mercato/src/modules/example/backend/todos/[id]/edit/page.tsx) |
| DataTable bulk action and global progress | `src/modules/example/components/TodosTable.tsx`, `src/modules/example/widgets/injection/todo-bulk-complete/widget.ts`, `src/modules/example/api/todos/bulk-complete/route.ts`, `src/modules/example/lib/todoBulkComplete.ts`, `src/modules/example/workers/todos-bulk-dispatch.ts`, `src/modules/example/workers/todos-bulk-complete.ts`, `node_modules/@open-mercato/ui/src/backend/DataTable.tsx`, `node_modules/@open-mercato/ui/src/backend/progress/ProgressTopBar.tsx` | [existing injected bulk action](../../apps/mercato/src/modules/example/widgets/injection/customer-priority-bulk-actions/widget.ts), [current separate progress demo](../../apps/mercato/src/modules/example/backend/umes-next-phases/page.tsx), [DataTable progress contract](../../packages/ui/src/backend/DataTable.tsx), [top progress bar](../../packages/ui/src/backend/progress/ProgressTopBar.tsx), [production bulk worker precedent](../../packages/core/src/modules/customers/lib/bulkDeals.ts) |
| Data/commands/locking | `src/modules/example/data/entities.ts`, `src/modules/example/data/validators.ts`, `src/modules/example/commands/todos.ts`, an exact migration file | [entities](../../apps/mercato/src/modules/example/data/entities.ts), [validators](../../apps/mercato/src/modules/example/data/validators.ts), [commands](../../apps/mercato/src/modules/example/commands/todos.ts) |
| UMES | Exact example `api/interceptors.ts`, `commands/interceptors.ts`, `data/{guards,enrichers,extensions}.ts`, `widgets/injection-table.ts`, individual widget files, `widgets/components.ts`, and subscriber files | [API interceptors](../../apps/mercato/src/modules/example/api/interceptors.ts), [guards](../../apps/mercato/src/modules/example/data/guards.ts), [enrichers](../../apps/mercato/src/modules/example/data/enrichers.ts), [injection table](../../apps/mercato/src/modules/example/widgets/injection-table.ts), [component replacements](../../apps/mercato/src/modules/example/widgets/components.ts) |
| Specialist provider | Exact files such as `node_modules/@open-mercato/gateway-stripe/src/modules/gateway_stripe/integration.ts` and `.../lib/webhook-handler.ts`; only in presets/tiers that install the package | [Stripe registration](../../packages/gateway-stripe/src/modules/gateway_stripe/integration.ts), [webhook handler](../../packages/gateway-stripe/src/modules/gateway_stripe/lib/webhook-handler.ts) |
| AI/workflow specialist | Exact files such as `node_modules/@open-mercato/core/src/modules/customers/ai-agents.ts`, `.../ai-tools.ts`, and `.../workflows/lib/workflow-executor.ts` | [customer agent](../../packages/core/src/modules/customers/ai-agents.ts), [customer tools](../../packages/core/src/modules/customers/ai-tools.ts), [workflow executor](../../packages/core/src/modules/workflows/lib/workflow-executor.ts) |

Installed-package links are first-class declared references, not `installedVersionFallback`. They are permitted only when the target is present in the actual packed artifact for every applicable preset/tier, the package is selected through the app's lockfile/module registry, and the link resolves under that selected package's `src/**` to a regular read-only file. If source is not published, the owner must link an exact shipped `dist`/type file only after the evaluator/tool contract explicitly supports it and labels the degraded reference; it must not publish a dead link. Optional-package links are conditional on package emission. A missing, directory-only, symlinked, unpublished, wrong-version, or workspace-only target fails the generated-app link gate.

## Harness Regression

The source-selection case gives the agent a generated lean app and a small module task. `src/modules/example/**` is immutable harness context: a case may read declared files but may not write, rename, or delete them even when its writable roots otherwise include `src/modules/**`. Its ordered trace must show:

1. the relevant skill/guide is read;
2. `src/modules/example/README.md` is the first module-source entrypoint;
3. only capability-linked example files are read within the case budget;
4. no read under `ratelimit_probe` occurs; and
5. a visible declared installed-package link may be followed directly for a specialist/exact-host topic, while undeclared installed source still requires a named local/versioned contract gap.

The output oracle rejects copied `example`, `example:todo`, route, event, ACL, and widget identifiers and rejects whole-tree copies, while requiring a distinct plural snake_case module ID, scoped entities, guarded/locked writes, translations, and generated-registry discipline. A classic-preset assertion proves the source is present but disabled; it no longer needs to choose between two example modules.

The linked [Standalone Harness Example and Linked-Source Read Policy](./2026-08-01-standalone-harness-example-read-policy.md) owns generic schema, path safety, budgets, declared installed-source reads, and fallback semantics. This spec registers case-specific roots such as:

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

Deduplication must inspect at least OMH-027 (generic DataTable extension), OMH-181 (bulk-action implementation), and OMH-035 (progress routing). Their current assertions do not prove a canonical-example bulk action returning `progressJobId` or a visible top-bar lifecycle. Prefer strengthening the smallest existing cases and relating them over adding wording variants, but the final coverage must include one source-selection assertion for `ui.datatable.bulk-actions`, one for `runtime.operation-progress`, and one behavioral writable/oracle lane that proves the connected flow. Each records the exact `sourceReferenceIds` it followed.

## Testing and Validation

### Focused Coverage

1. Exact-tree parity: sorted paths and SHA-256 hashes match between monorepo and template; template-sync has no example exception or transform.
2. Preset matrix: `classic`, `empty`, and `crm` contain `src/modules/example/**` and do not register `example`.
3. Template fixture: the disabled tree typechecks in every preset; no example route, page, migration, seed, event, widget, worker, navigation entry, or dead home quick link is generated.
4. Activated fixture: explicitly register `example`, run generation, assert `E.example.todo`, and exercise existing CRUD/UI/UMES tests plus each new extension.
5. Regression preservation: current Todo command scope/redo, API, UI, injection, override, dashboard, notification, adapter, and integration suites remain green after reconciliation.
6. Security: tenant/org isolation, 403, cross-scope 404, stale 409, encryption leakage, cache isolation, worker retry/idempotency, and audience scoping.
7. Source-map parity: every capability has one owner and exact live paths in all three layouts; repository-only tests are evidence but are not claimed as emitted files; no shadow implementation path remains.
8. Whole-harness link parity: all emitted knowledge owners are classified; every `source-required` topic has a visible exact-file link; all 136 fences across the exact eight baseline assets have a disposition; all links resolve in fresh packed-package fixtures; undeclared/orphan links, directories, wildcards, stale hashes, symlink escapes, wrong presets, and workspace-only paths fail.
9. Harness: fail-before/pass-after source selection, bounded read-only example/declared-installed access, mutation denial, renamed output, required-link trace, and affected certified lane evidence.
10. Instruction and source budgets: emitted `AGENTS.md`, README, surface map, and link inventory remain bounded; the compact root entrypoint replaces/moves existing prose instead of restoring old implementation blocks; new client components stay focused and do not grow existing oversized files.

Every added or materially changed runtime/discovery extension surface in the verified-gap table must name at least one module-local self-contained integration test in `surface-inventory.json`; adding a surface to an existing row does not bypass the gate. Unit/static/generator coverage is additive and cannot replace it. Tests create their own tenant-scoped fixtures, remove them in `finally`, declare every required optional module in `__integration__/meta.ts`, never rely on seeded/demo data, and pass both alone and in order-randomized/repeated execution. The authoring and template test trees stay byte-identical even though normal app scaffolding continues to filter `__tests__`/`__integration__`; the create-app integration controller stages the declared repository test against the activated disposable app and records it as repository-only QA evidence with `readStatus: "qa-only"`, never as emitted/readable source. The minimum activated-example matrix is:

| New extension | Exact integration test | Required modules | Required integration proof |
|---|---|---|---|
| Encryption | `__integration__/TC-EXAMPLE-004-encryption.spec.ts` | `example` | Create/read/update the sensitive field in two scopes, inspect ciphertext at rest, and prove no plaintext enters response-excluded surfaces. |
| Extension hosts and entity links | `__integration__/TC-EXAMPLE-005-extension-links.spec.ts` | `example`, `customers` | Exercise contributor-to-host read/write round trips, absent optional host, feature denial, and cross-scope rejection. |
| Search | `__integration__/TC-EXAMPLE-006-search.spec.ts` | `example`, `search`, `query_index` | Create/update/delete a Todo, reindex, query within scope, and prove sensitive/cross-scope data is absent. |
| Cache | `__integration__/TC-EXAMPLE-007-cache.spec.ts` | `example` | Exercise miss/hit plus create/update/delete invalidation and tenant/organization isolation through the real API. |
| DataTable bulk operation and progress | `__integration__/TC-EXAMPLE-003-todo-bulk-progress.spec.ts` | `example`, `progress`, `events`, `scheduler` | Separately assert the bulk-action source/registration and progress source/lifecycle: create at least two Todos, select them, start once, observe feedback and top-bar updates, verify refresh/cleared selection, race duplicate requests with one idempotency key and assert one progress ID/logical execution, simulate crash before publish and recover from the durable outbox, simulate a mid-worker crash after one checkpoint and resume without repeating its mutation, tolerate duplicate physical messages, force mixed and total failures, cancel between items, deny cross-scope IDs, assert terminal events, and clean up. |
| Client notification renderer | `__integration__/TC-EXAMPLE-008-notification-renderer.spec.ts` | `example`, `notifications`, `events` | Trigger success/failure notifications, verify audience/deduped rendering, and clean them up. |
| Translatable fields | `__integration__/TC-EXAMPLE-009-translations.spec.ts` | `example`, `translations` | Save/read the field across configured locales and verify fallback plus generated registration. |
| Defaults/example seeds | `__integration__/TC-EXAMPLE-010-setup-seeding.spec.ts` | `example` | Create isolated tenant fixtures, run defaults twice and opt-in examples twice, and prove idempotency plus no seed while disabled. |
| Shared form and complete locking | `__integration__/TC-EXAMPLE-011-form-locking.spec.ts` | `example` | Create/edit/delete through both forms, clear values, submit stale update/delete, and exercise unified reload/retry conflict behavior. |
| Inactive override reference | `__integration__/TC-UMES-022-overrides.spec.ts` | `example` | Compile/generate the typed reference and run the existing override integration path without enabling the canonical example by default. |

The source-routing README/inventory itself uses fresh-scaffold link/inventory tests rather than inventing a runtime integration test, because it adds no runtime extension. Any future added/materially changed runtime or discovery surface with `coverageKind: "example"` is rejected unless it declares its focused integration-test paths and dependency modules, regardless of whether its containing capability row already existed.

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

### Milestone A, Phase 1 — Reconcile and Lock the Canonical Tree

1. Classify the current 20 differing paths, preserve the correct monorepo behavior, and make the two example trees byte-identical through `yarn template:sync:fix`.
2. Add the exact parity test and prohibit example-specific template exceptions/transforms.
3. Add the README, finite inventory, and surface map using only verified existing paths and capability owners.

Exit criterion: `yarn template:sync` and the focused parity test pass, and the map distinguishes existing coverage from verified gaps.

### Milestone A, Phase 2 — Ship the Example Inert in Every Preset

1. Stop deleting `src/modules/example` from `empty`/`crm` and remove its default classic registration.
2. Remove or registry-gate example-only home quick links, then add source-present/registration-absent tests for all presets and negative runtime-surface assertions.
3. Add an explicit activation fixture that generates, compiles, and exercises the existing Todo slice.

Exit criterion: every scaffold ships the exact source, none activates it, and explicit activation remains functional.

### Milestone B — Extend Only Missing Core and Runtime Surfaces

1. Deliver each verified encryption, extension/link, search, translations, defaults/examples, shared-form, cache/invalidation, Todo bulk-progress, and client-notification row as an independently green vertical slice against the existing Todo domain.
2. For the bulk-progress slice, land the exact injected action, scoped/idempotent 202 route, durable operation/outbox helper, scheduler dispatcher, leased/checkpointed worker lifecycle, progress result contract, and `TC-EXAMPLE-003-todo-bulk-progress.spec.ts` together.
3. Add the self-contained integration test named by every added/materially changed example extension surface, plus focused unit/security/isolation/retry/conflict/event/search/cache/notification/generation/migration tests as appropriate.

Exit criterion: every `example` inventory row has a real caller/test and no duplicate domain or placeholder file exists.

### Milestone C — Synchronize Skills and Harness

1. Classify the complete emitted owner set and all 136 fences in the exact eight `main` baseline assets, then render visible exact-file links in every `source-required` guide/skill/reference/fact owner while preserving normative rule ownership and emitted tiers.
2. Generate the source-link inventory, register canonical-example and declared-installed references, and add failure-first source-selection/read-policy cases after semantic deduplication.
3. Synchronize validators/oracles, release matrix, counts/docs, knowledge manifest, link hashes, package/preset applicability, and generated harness copies through the owning workflows.

Exit criterion: relevant agents follow visible exact links within budget, all baseline topics have a checked disposition, local and installed targets resolve from packed fresh scaffolds, unrelated reads fail, and every affected harness surface agrees.

### Milestone D — Certify Monorepo and Standalone Behavior

1. Run monorepo example tests, every declared new-extension integration test alone and repeated/order-randomized, template parity, preset matrix, activated standalone fixture, packed-package link validation, create-app integration, and the configured validation gate.
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
| Harness | Every emitted owner and prior implementation topic is classified; visible exact local/installed links, packed resolution, capability budgets, source-selection traces, and synchronized release assets are specified. |
| Bulk progress | The Todo DataTable selected-row action, guarded route, real queue/worker, `progressJobId`, and platform top-bar lifecycle form one canonical end-to-end reference. |
| Integration coverage | Every added or materially changed runtime/discovery extension surface declares self-contained activated integration tests and dependencies; static/unit proof alone is rejected. |
| Compatibility | No shipped framework contract changes; the fresh-classic default behavior change is explicit and tested. |
| Open questions | None; reuse, disablement, exact sync, and additive extension were explicitly directed. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Source ownership matches delivery | Pass | `apps/mercato` authors; template mirrors; emitted app copies the mirror. |
| Inventory matches implementation strategy | Pass | Existing surfaces are linked; verified gaps extend Todo/example only. |
| Runtime boundary matches tests | Pass | Preset negative assertions and activated fixture cover both states. |
| Skill routing matches harness reads | Pass | Both use `src/modules/example` plus the same capability inventory. |
| Prior example coverage matches visible links | Pass | All 136 fences in the exact eight baseline assets receive a checked disposition and every source-required owner renders an exact-file link. |
| Risks cover writes and synchronization | Pass | Scope, locking, encryption, queues, cache, audiences, and drift are explicit. |

### Non-Compliant Items

None at design level. Implementation remains blocked from completion until the baseline tree drift is reconciled and all configured gates pass.

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-07-31: Initial draft based on the observed `ratelimit_probe` selection trace and the standalone harness merged in PR #4529.
- 2026-08-01: Expanded the proposed reference coverage and split spec-first routing, generic read policy, and harness governance into companion specs.
- 2026-08-03: Replaced the proposed duplicate teaching module with the existing `example` module as the sole standalone reference; required source-present/runtime-disabled delivery in every preset, additive gap extensions, exact skill/harness source links, byte-identical synchronization from `apps/mercato` to the create-app template, and an explicit `referenceStatus` separate from capability coverage kind.
- 2026-08-03: Added whole-harness `main` snippet parity, visible exact canonical/installed links, packed-package link validation, a connected Todo DataTable bulk-operation progress reference, and mandatory self-contained integration tests for every new example extension.
- 2026-08-03: Made delivery/per-gap/harness/certification milestones independently mergeable; specified the historical-block ledger schema, location-independent mirrored links, the concrete injected Todo bulk-progress protocol, and exact integration-test/dependency rows for every new extension.
- 2026-08-03: Pinned the exact eight historical assets, hashes, and 136 CommonMark fences; made Todo bulk publication at-least-once through a durable operation outbox plus scheduler recovery and leased/checkpointed execution.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent fresh-context scope-cohesion and cross-spec consistency passes.
- **Scope cohesion:** The fresh pass identified an atomic-delivery risk. Q7 now keeps the umbrella invariant while defining independently mergeable canonical-delivery, per-gap, harness-migration, and certification milestones; generic policies remain independently deliverable in the three companion specs.
- **Security:** Passed at design level; exposed example files require scoped, locked, encrypted, reference-quality behavior or `referenceStatus: "qa-only"` exclusion.
- **Performance:** Passed; emitted-size facts, bounded reads, and focused-file growth constraints replace the invalid small-module budget.
- **Cache:** Passed at design level; the missing cache example is DI-resolved, tenant/org tagged, and invalidated on every Todo write path.
- **Commands:** Passed; existing scoped command, undo/redo, and optimistic-lock behavior is preserved and regression-tested.
- **Risks:** Passed; baseline drift, accidental activation, dead links, classic behavior change, context breadth, and source-link drift are explicit.
- **Verdict:** Approved for design review under the explicit Q7 milestone boundaries.
