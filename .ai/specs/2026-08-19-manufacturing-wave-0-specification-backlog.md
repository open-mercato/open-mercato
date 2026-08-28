# Manufacturing Wave 0 Specification Backlog

## TLDR

This planning specification turns the accepted Manufacturing roadmap into a spec-first backlog. It does not approve every implementation slice by itself. It defines which Wave 0 capabilities require a new specification, which existing specifications require readiness review, which work may proceed in parallel, and which dependency gates prevent a specification from being finalized or implemented.

The backlog adds the missing package/module bootstrap work item as P1.0a, narrows P1.7 to definition release, narrows P1.9 to the model-neutral fact ledger, places order-release snapshots and discrete confirmations in P1.10, splits P1.8 into independently deployable WMS and Manufacturing specifications, treats P1.12 as a shared evidence policy rather than a standalone product specification, and keeps P1.13 deferred outside the first MVP flow.

Every capability specification must follow the accepted parent roadmap before it freezes a public contract. Skeleton authoring, code audits, benchmark research, and readiness analysis remain valid only when they preserve the named dependency gates.

## Overview

This document is the planning and governance specification for turning Manufacturing Wave 0 into independently reviewable capability specifications and readiness reports. Its status is **accepted as the Wave 0 specification backlog**. The [parent architecture](2026-08-13-manufacturing-product-roadmap.md) is the accepted staged-delivery baseline.

The intended readers are the roadmap owner, maintainers, specification authors and implementers. The output is an ordered specification backlog with stable ownership boundaries, start and finalization gates, shared evidence requirements and a GitHub tracking model.

## Problem Statement

The roadmap identifies the required Wave 0 outcomes, but it is not yet executable as a specification programme. Four prerequisite specifications exist but have not passed formal pre-implementation readiness review; the remaining capability specifications are missing; package bootstrap work has no owner; generic WMS atomicity and Manufacturing-specific stock orchestration are bundled under one work-item label; and there is no shared evidence contract for promoting work from design to implementation.

Without a decomposition and readiness model, authors can freeze downstream contracts before their prerequisites, mix model-neutral and discrete responsibilities inside `manufacturing`, duplicate WMS ownership, or create implementation Issues whose designs are still unresolved.

## Proposed Solution

Use this document as the umbrella backlog for specification work. Create one artifact per independently deployable capability, add P1.0a for package/module bootstrap, split P1.8 into a generic WMS capability and its Manufacturing adapter, narrow P1.7/P1.9 to cohesive responsibilities, and put discrete order release and confirmation orchestration in P1.10. Apply the P1.12 evidence matrix to every capability instead of treating it as a product feature.

Progress is controlled through three separate states: skeleton-ready, full-spec-ready and implementation-ready. GitHub tracking begins after this backlog is accepted; implementation tracking remains blocked until the corresponding capability specification passes its readiness and compliance gates.

## Decision Status

| Decision | Status | Result / gate |
|---|---|---|
| Q1 — Manufacturing workspace package/module | Accepted by the roadmap owner on 2026-08-19 | Create one OSS workspace package at `packages/manufacturing`, published as `@open-mercato/manufacturing`, containing one opt-in runtime module `manufacturing`; hard-require `catalog`, keep WMS/Resources/Planner optional, and expose entrypoints only. |
## Scope

This backlog covers Manufacturing-owned Wave 0 specification authoring and readiness work for P1.0a, P1.2, P1.4 through P1.12. It also records the owner-approved, non-blocking post-Wave 0 BOM candidates P1.4c through P1.4h and P1.13; neither group is an implementation commitment.

The backlog will define:

- one bootstrap specification for the Manufacturing package and single initial module;
- readiness reviews for the four existing P1.2/P1.3 specifications;
- one specification per independently deployable capability;
- the order in which skeletons, full specifications, readiness audits, and implementation tasks may be produced;
- a shared Definition of Ready and Definition of Done;
- the issue structure and dependency metadata required before implementation work is tracked.

It will not define the entities, APIs, UI, events, migrations, or implementation steps belonging to an individual capability. Those details remain in the dedicated specifications.

## Proposed Specification Decomposition

| Order | Work item | Artifact | Current state |
|---|---|---|---|
| 1 | P1.0 roadmap acceptance | Repository decision record | Accepted as the staged-delivery baseline on 2026-08-20 |
| 2 | P1.0a Manufacturing package and module bootstrap | Full specification | Design resolved; scope-cohesion review **KEEP**; accepted for staged implementation |
| 3 | P1.2 WMS Sites and warehouse roles | Readiness analysis of existing specification | Design complete |
| 4a | P1.4a BOM draft authoring and integrity | Full specification | Implementation-ready design; fresh-context review **PASS**; upstream gates remain |
| 4b | P1.4b bounded multi-level BOM draft preview | Full specification | Implementation-ready read-only design; fresh-context review **PASS**; upstream gates remain |
| Post-W0 1 | P1.4c BOM list workspace | New specification | Decision queue accepted; tracker [#5408](https://github.com/open-mercato/open-mercato/issues/5408) open |
| Post-W0 2 | P1.4d BOM business identity | New specification | Decision queue accepted; tracker [#5409](https://github.com/open-mercato/open-mercato/issues/5409) open |
| Post-W0 3 | P1.4e BOM history, change context and comments | New specification | Decision queue accepted; tracker [#5410](https://github.com/open-mercato/open-mercato/issues/5410) open |
| Post-W0 4 | P1.4f BOM revision comparison and where-used | New specification | Decision queue accepted; tracker [#5411](https://github.com/open-mercato/open-mercato/issues/5411) open |
| Post-W0 5 | P1.4g BOM copy | New specification | Decision queue accepted; tracker [#5412](https://github.com/open-mercato/open-mercato/issues/5412) open |
| Post-W0 6 | P1.4h BOM extensibility and document control | New specification | Decision queue accepted; tracker [#5413](https://github.com/open-mercato/open-mercato/issues/5413) open |
| 5 | P1.6 Work Center boundary | New specification | Missing |
| 6 | P1.5 routing and operation drafts | New specification | Missing; finalization depends on P1.6 |
| 7 | P1.7 released definitions and immutable definition snapshots | New specification | Missing |
| 8 | P1.8b Manufacturing inventory posting adapter | New `manufacturing` specification | Missing; consumes an external WMS posting contract |
| 9 | P1.9 minimum Manufacturing fact ledger | New `manufacturing` specification | Missing |
| 10 | P1.10 discrete production-order lifecycle, execution snapshot and basic confirmations | New `manufacturing` specification | Missing |
| 11 | P1.11 stock-affecting discrete execution | New `manufacturing` specification | Missing; final stock gate |
| 12 | P1.12 cross-cutting readiness and integration evidence | Shared checklist applied to every spec and implementation epic | No standalone capability spec |
| 13 | P1.13 advanced number ranges | Deferred capability | Outside first MVP backlog |

## Decisions Already Carried Forward

- P1.0 remains a governance baseline, not an implementation epic.
- P1.0a is required because no existing work item owns workspace-package creation, module registration, auto-discovery, dependency tests, or initial public exports.
- P1.7 owns definition release and immutable definition snapshots only. P1.10 owns top-level definition selection and the execution snapshot created when a discrete order is released.
- P1.9 owns the model-neutral append-only fact ledger, acceptance/correction primitives and opaque evidence-reference envelope only. P1.10 owns order/operation-aware basic confirmations and their UI/API orchestration.
- P1.8b consumes a provider-neutral WMS posting contract that is independently deployable and usable without Manufacturing.
- P1.4a and P1.4b are separate because direct-level BOM authoring/integrity remains useful without recursive preview, while bounded explosion is an independently deployable read capability over that aggregate.
- P1.4c through P1.4h are separate post-Wave 0 candidates: list workspace; business identity; history/comments; revision comparison/where-used; copy; and extensibility/document control. They do not change the P1.4a/P1.4b contract or gate Wave 0 delivery.
- P1.4a is reusable definition master data and therefore carries no customer, sales-order, required-date, or planned-date fields. P1.7 owns definition effectivity/Site applicability; P1.10 owns demand source and scheduling dates; a future ETO/order-specific BOM requires a separate snapshot/overlay specification.
- P1.12 is evidence attached to every capability; it does not own product data or a lifecycle.
- P1.13, MRP, APS, full MES/QMS, costing, advanced genealogy, automatic numbering, and enterprise packaging do not block the first production flow.
- Existing P1.2 documentation requires a formal pre-implementation readiness report before it may be marked ready. Catalog and WMS work retains its own owner documentation and tracking.

## Deferred Future Consideration: Collaborative BOM Drafting

This is a future feature candidate, not a Wave 0 work item and not a prerequisite for P1.4a. P1.4a uses the same optimistic-concurrency behavior as Sales documents: the editor sends the revision token it loaded, a stale write receives the standard conflict response, and the user refreshes before intentionally reapplying the change.

Only revisit richer collaboration after evidence that concurrent authorship of the same BOM draft is frequent and costly. A future, cross-domain proposal may evaluate:

- visible "currently editing" presence or short-lived soft locks;
- explicit editor ownership/handoff for a draft;
- a change summary or comparison before refresh/reapply;
- selective merge or recovery of non-overlapping field/line edits;
- whether this should extend the existing shared/Enterprise record-locking capability rather than create a Manufacturing-only mechanism.

It must not weaken the always-required graph transaction lock, row locking, or complete candidate-cycle validation. Those mechanisms preserve BOM data integrity even for a single user and are not collaboration UX.

## Post-Wave 0 Candidate Work Items: BOM Usability and Control

These are independent post-Wave 0 candidates with owner-approved identifiers and GitHub trackers. They are a decision queue, not approved implementation scope. Each needs its own short specification after the stated product decision; none reopens the direct-authoring, graph-integrity, or lifecycle boundaries of P1.4a/P1.7.

| Candidate | Outcome | Decision required before specification | Suggested dependency / order |
|---|---|---|---|
| [P1.4c — BOM list workspace](https://github.com/open-mercato/open-mercato/issues/5408) | A Sales-level list experience adapted to BOMs: text search over product code/name and revision label; product, variant, unresolved-`produce`, line-count and modified-date filters; supported sort fields; personal `perspective` for visible/order/width of columns, filters, sorting, search and page size. | Confirm the search fields and which aggregate counters are worth indexing; do not copy Sales customer, amount, payment, or fulfillment filters. | First usability candidate after P1.4a. Must retain keyset pagination; no bulk mutation. |
| [P1.4d — BOM business identity](https://github.com/open-mercato/open-mercato/issues/5409) | A clear human reference beyond the current product/variant plus system revision number and optional revision label. | Decide whether the Catalog target is sufficient, or whether BOM family needs a unique code and/or name; define ownership and uniqueness if added. | Decide alongside the list workspace, before global search/export. |
| [P1.4e — BOM history, change context and comments](https://github.com/open-mercato/open-mercato/issues/5410) | A visible version/action history plus team comments and, if required, an explicit change-reason field. It should reuse the platform action log/history and Notes patterns used by Sales. | Decide whether comments and reason belong to a BOM family, editable revision, or individual line; define what becomes immutable on release. | After P1.4a; any released-revision behavior consumes P1.7 rather than blocking it. |
| [P1.4f — BOM revision comparison and where-used](https://github.com/open-mercato/open-mercato/issues/5411) | Compare two revisions and show the reverse dependency impact of a component/BOM before a change or release. | Define the comparison granularity and whether reverse use includes drafts only, released definitions, or later production-order snapshots. | After P1.4b; final released/execution semantics consume P1.7/P1.10. |
| [P1.4g — BOM copy](https://github.com/open-mercato/open-mercato/issues/5412) | Copy a BOM into a new target, with complete quantity/UoM, scope, uniqueness and graph revalidation. | Define allowed copy sources and target rebinding. Import and export are deliberately not included. | After P1.4a and the Catalog public quantity/UoM contract. |
| [P1.4h — BOM extensibility and document control](https://github.com/open-mercato/open-mercato/issues/5413) | Tenant-configurable fields, optional tags, and controlled links/attachments for drawings, instructions and certificates. | Choose the provider and whether each field/reference belongs to family, revision or line; define release snapshot/audit and retention rules. | After P1.4a; released-document semantics consume P1.7. |

### Explicitly excluded from the BOM decision queue

Sales-document behavior remains outside reusable BOM master data: customer/contact/address data, currency/pricing/taxes, payments, shipments, returns, fulfillment and payment statuses, and sales-order demand dates. P1.10 owns production-order demand, planned dates and execution snapshots; it must not be backfilled into a BOM family or draft revision.

## Architecture and Package Topology

Wave 0 uses one new workspace package:

```text
packages/manufacturing/                    @open-mercato/manufacturing
  src/modules/manufacturing/               one opt-in runtime module
    internal model-neutral boundaries      facts, lifecycle primitives, provider seams
    discrete capability boundaries         BOM/routing/order aggregates, UI, orchestration, WMS adapter
```

The package bootstrap specification defines the workspace manifest, build/test exports, auto-discovery participation, single module metadata, entrypoint-only public imports, hard `catalog` dependency, opt-in activation, package-level test configuration, strict Design System lint escalation, and module-decoupling coverage. It introduces no domain entities, UI, WMS calls, or placeholder implementations of reserved seams.

## Dependency Graph and Authoring Lanes

```text
P1.0 roadmap acceptance
  +--> P1.0a package/module bootstrap

P1.0a + Catalog public quantity/UoM contract --> P1.4a BOM draft authoring/integrity
P1.4a --> P1.4b bounded draft preview
P1.4a --> P1.4c list workspace, P1.4d business identity, P1.4e history/comments, P1.4g copy
P1.4a + P1.4b --> P1.4f revision comparison/where-used
P1.4a --> P1.4h extensibility/document control
P1.7/P1.10 add released/execution semantics to P1.4e, P1.4f and P1.4h; none of P1.4c-h gates Wave 0.
P1.0a --> P1.6 Work Centers --> P1.5 routing drafts
P1.0a --> P1.9 fact ledger

P1.2 + Catalog public quantity/UoM contract + P1.4a + P1.5 + P1.6 --> P1.7 definition release
P1.2 + Catalog public quantity/UoM contract + P1.7 + P1.9 --> P1.10 order lifecycle + execution snapshot + basic confirmations
External WMS posting contract + P1.9 + P1.10 --> P1.8b Manufacturing adapter
External WMS quantity/evidence/posting contracts + P1.8b + P1.10 --> P1.11 stock execution

P1.12 evidence applies to every specification and implementation epic.
P1.13 remains deferred.
```

The lanes describe contract-finalization order, not a ban on earlier skeletons or research. A downstream skeleton may be drafted before its inputs are accepted, but it must expose the unresolved dependency as an Open Question and cannot pass readiness review until the upstream contract is stable.

## Planned Specification and Readiness Artifacts

| Work item | Planned artifact | Owner | May start | Cannot finalize until |
|---|---|---|---|---|
| P1.0 | Existing roadmap and repository review evidence | Maintainers/community | In progress | PR #5256 is accepted or revised |
| P1.0a | `2026-08-19-manufacturing-package-module-bootstrap.md` | `@open-mercato/manufacturing` / `manufacturing` | Full spec complete | P1.0 package/module decision is accepted through repository review |
| P1.2 | `analysis/ANALYSIS-2026-08-19-wms-sites-and-warehouse-roles.md` | WMS | Readiness audit now | P1.0 accepted and all critical findings remediated |
| P1.4a | `2026-08-19-manufacturing-bom-drafts.md` | `manufacturing` | Full specification complete; implementation gated | P1.0 accepted; P1.0a package contract and Catalog public quantity/UoM contract available |
| P1.4b | `2026-08-19-manufacturing-bom-draft-preview.md` | `manufacturing` | Full specification complete; implementation gated | P1.0 accepted; P1.0a, Catalog public quantity/UoM contract and P1.4a ready |
| P1.4c | `manufacturing-bom-list-workspace.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4a | Search/filter/index/sort/perspective decisions resolved; P1.4a list contract stable |
| P1.4d | `manufacturing-bom-business-identity.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4a | Code/name ownership, uniqueness and compatibility decision resolved |
| P1.4e | `manufacturing-bom-history-and-comments.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4a | History/comment ownership and immutable-release behavior resolved where P1.7 is consumed |
| P1.4f | `manufacturing-bom-revision-comparison-and-where-used.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4b | Diff/reverse-use scope and released/execution visibility resolved |
| P1.4g | `manufacturing-bom-copy.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4a and the Catalog public quantity/UoM contract | Eligible source/target and revalidation behavior resolved |
| P1.4h | `manufacturing-bom-extensibility-and-document-control.md` | `manufacturing` | Post-Wave 0 decision/specification work after P1.4a | Field/reference ownership, provider, retention and release behavior resolved |
| P1.6 | `2026-08-19-manufacturing-work-centres.md` | `manufacturing` with optional `resources` input | Skeleton/code audit now | Ownership, resource cardinality, snapshot and planner-absent behavior resolved |
| P1.5 | `2026-08-19-manufacturing-routing-drafts.md` | `manufacturing` | Skeleton after P1.6 questions are known | P1.6 Work Center contract ready |
| P1.7 | `2026-08-19-manufacturing-released-definitions.md` | `manufacturing` | Skeleton after P1.4a/P1.5 release inputs and P1.6 ownership shapes are known | P1.2, Catalog public quantity/UoM contract, P1.4a, P1.5 and P1.6 ready; scope stops before order release; P1.4b is not a release prerequisite |
| P1.8b | `2026-08-19-manufacturing-inventory-posting-adapter.md` | `manufacturing` | Semantic-command research now | External WMS posting contract, P1.9 fact-writer contract and P1.10 execution-snapshot/confirmation contract ready |
| P1.9 | `2026-08-19-manufacturing-fact-ledger.md` | `manufacturing` | Skeleton/research now | P1.0a ready; neutral fact, correction, idempotency and opaque evidence-reference contracts resolved without WMS vocabulary |
| P1.10 | `2026-08-19-manufacturing-orders-and-confirmations.md` | `manufacturing` | Use-case preparation after P1.7/P1.9 skeletons | P1.2, Catalog public quantity/UoM contract, P1.7 and P1.9 ready |
| P1.11 | `2026-08-19-manufacturing-stock-execution.md` | `manufacturing` | Acceptance-scenario preparation only | External WMS quantity, evidence and posting contracts, P1.8b, P1.9 and P1.10 ready; validation spike accepted |
| P1.12 | No standalone spec; evidence matrix below | Every owner | With each artifact | The related epic cannot be ready without its evidence |
| P1.13 | No Wave 0 MVP artifact | Future owner | Deferred | Selected as a later capability |

Planned filenames may take their actual authoring date if created after 2026-08-19. The work-item identity and capability boundary are stable; the date prefix is not a cross-spec contract.

## Product Contracts, Migration and Compatibility

This planning specification introduces no product entities, database schema, APIs, events, UI routes or runtime behavior, so detailed data-model, API, UI and migration designs are not applicable here. Each capability specification must define those contracts where applicable and must inventory its backward-compatibility surface before implementation readiness.

The only repository-level structural decision recorded here is the accepted Manufacturing workspace package and its single opt-in `manufacturing` module. P1.0a defines how that additive package participates in builds, discovery, generated outputs and tests without changing existing application behavior while the module is disabled.

## Definition of Ready

### Ready for skeleton authoring

A work item may receive a skeleton when:

1. it represents one independently deployable capability;
2. its primary owner, user/business outcome, in-scope behavior, and explicit non-goals are known;
3. candidate hard requirements, product/data prerequisites, optional peers, and absent behavior are listed;
4. related roadmap decisions and existing specifications are linked;
5. critical unknowns are short, numbered Open Questions that stop full design work.

### Ready for full specification

A skeleton may proceed to research and full design when:

1. every critical Open Question is answered or converted into an explicit upstream decision gate;
2. actual module metadata, entities, migrations, commands, events, routes, widgets, and tests affected by the capability have been audited;
3. package/module placement and integration-glue ownership are decided;
4. contract-shaping behavior has the required official-source benchmark;
5. compatibility surfaces and migration obligations are inventoried;
6. upstream interfaces used by the design are stable enough to reference without placeholders.

### Ready for implementation

A specification becomes implementation-ready only when:

1. all required sections from `.ai/specs/AGENTS.md` and the spec-writing checklist are complete;
2. data, APIs, UI, ACL, commands/events, transactions, undo/reversal, failures, cache/indexing, performance, observability, migration and compatibility agree internally;
3. every API path and key UI path has self-contained integration coverage planned in the same implementation change;
4. the pre-implementation analysis covers all backward-compatibility surfaces and has no unresolved critical finding;
5. the Final Compliance Report is fully compliant;
6. every named prerequisite has accepted evidence;
7. a GitHub Issue owns the implementation and links the approved specification.

## P1.12 Shared Evidence Matrix

Every capability specification and implementation epic must record the applicable evidence below. `N/A` requires a written reason.

| Evidence category | Minimum proof |
|---|---|
| Tenant/organization/site isolation | Cross-scope API and command tests fail closed; queries include required scope |
| Module isolation | Disabled-optional-module tests; no forbidden `requires`, direct ORM relation, or cross-module side-effect import |
| Concurrency | `updated_at`/`updatedAt`, update/delete optimistic-lock tests, action-command conflict behavior |
| Atomicity and partial failure | Transaction rollback or durable compensation tests for each multi-write flow |
| Idempotency | Duplicate command/event/request tests prove no duplicate accepted state or stock effect |
| Undo/reversal | Exact state and evidence restoration/compensation without deleting history |
| Backward compatibility | Audit of discovery, imports, types, commands, events, routes, database, DI, ACL, notifications, CLI and generated contracts |
| API integration | Auth, ACL, validation, success, conflict, failure, scope and compatibility cases for every affected route |
| UI integration | Key list/detail/create/edit/action/error/conflict paths with fixture setup and cleanup |
| Data integrity | Constraint, migration/backfill, reference-deletion, precision and reconciliation coverage as applicable |
| Performance and scale | Indexes for every query pattern; pagination/bounds; worker threshold for operations over 1,000 rows |
| Operational evidence | Structured logs, metrics/reconciliation signals, actionable errors and no sensitive-data leakage |
| Generated/discovery evidence | `yarn generate` plus relevant module registry, OpenAPI and module-decoupling checks |

## Required Current-State Audits Before Full Specs

| Work item | Audit required |
|---|---|
| P1.0a | Workspace/package conventions, module auto-discovery, app enablement, generator outputs, public export and test patterns from existing standalone module packages |
| P1.2 | Existing WMS topology, scope helpers, custom-field hosts, activation concurrency, migration and backend configuration UI |
| P1.4a | Catalog product/variant/UoM contracts, revision-like entities, commands/undo, locking, CRUD/API/UI extension hosts, ACL/events and disabled-module conventions |
| P1.4b | Recursive/batched read patterns, exact-decimal explosion, transaction isolation, custom action routes/OpenAPI, bounded tree UI, cache/event and performance conventions |
| P1.4c | Sales DataTable filters/search/export/perspective patterns, BOM keyset cursor contract, per-user perspective persistence and required list indexes |
| P1.4d | Catalog product identifiers, existing code/name uniqueness and migration/compatibility patterns |
| P1.4e | Action-log/version-history, Notes, comments ACL, author display and released-record immutability patterns |
| P1.4f | Revision diff, reverse-dependency/where-used, query bounds and released/execution snapshot visibility patterns |
| P1.4g | Command-based copy/clone, Catalog rebinding, quantity/UoM and graph validation, source-provenance patterns |
| P1.4h | Custom fields, tags, attachments/document-control provider, retention and immutable-snapshot patterns |
| P1.6/P1.5 | `resources` and `planner` ownership, capacity/calendar data, module requirements, resource references and existing scheduling/UI extension points |
| P1.9 | Event envelope, append-only evidence, correction/idempotency patterns, audit-vs-domain-fact boundaries and generic opaque evidence references |
| P1.10-P1.11 | Order-state examples, command/compound-command conventions, confirmation UI/API patterns, execution snapshots and extension behavior for stock-affecting confirmation |

## Specification Delivery Phases

| Phase | Outcome | Exit condition |
|---|---|---|
| 0. Backlog approval | Owners accept this decomposition and the documented parent-document alignment | This document is approved; P1.0 remains subject to PR #5256 |
| 1. Foundations | First authoring batch produces bootstrap/base skeletons and prerequisite readiness evidence | P1.0a, P1.2, P1.4a-b, P1.6 and P1.9 have the evidence required for their next state |
| 2. Gate A specifications | Draft-definition capabilities become implementation-ready | P1.2, P1.4a, P1.4b, P1.5 and P1.6 pass their individual compliance reviews; Catalog quantity/UoM is consumed as an external public contract |
| 3. Gate B specifications | Released definitions, fact ledger, order lifecycle and basic stock-free confirmations become implementation-ready | P1.7, P1.9 and P1.10 pass their individual compliance reviews |
| 4. Gate C specifications | Manufacturing adapter and stock-affecting execution become implementation-ready | External WMS quantity, evidence and posting contracts, P1.8b and P1.11 pass their respective readiness and validation gates |
| 5. Implementation planning | Approved specs are decomposed into concrete implementation Issues/tasks | Each task links one implementation-ready specification and its required P1.12 evidence |

Phases express readiness dependencies, not one serial delivery train. Work may proceed in parallel wherever the dependency graph permits it.

## First Authoring Batch

The first batch starts only artifacts that can make independent progress without inventing downstream contracts:

1. **P1.0a skeleton** — package manifest, two module boundaries, discovery/testing contract and no domain behavior.
2. **P1.2 readiness analysis** — formal pre-implementation report for the existing Site specification.
3. **P1.4a/P1.4b full specifications** — occurrence-preserving direct-level BOM authoring/integrity and its independently bounded read-only multi-level preview; no release or stock behavior.
4. **P1.6 skeleton** — Work Center ownership over `resources`; no scheduling semantics.
5. **P1.9 skeleton** — model-neutral append-only fact ledger, correction/idempotency and opaque evidence references; no discrete confirmation UI or order orchestration.

P1.5, P1.7, P1.8b, P1.10 and P1.11 remain preparation-only until the named upstream contracts expose stable shapes.

## Scope Refinements Requiring Parent-Document Alignment

After this backlog is approved, the roadmap, execution plan, README and readiness dashboard must be aligned in one documentation change:

1. P1.7 must stop at child-revision selection, effectivity, definition release and immutable definition snapshots.
2. P1.9 must stop at the model-neutral fact ledger inside `manufacturing`, including fact acceptance/correction/idempotency primitives and opaque evidence references.
3. P1.10 must own discrete order release, top-level definition selection by `plannedStartDate`, creation of the execution snapshot, and the basic stock-free confirmation/correction flow.
4. P1.8b must consume the P1.10 execution/confirmation contract and the P1.9 fact writer while preserving internal separation between model-neutral facts and discrete orchestration.
5. Gate B still requires all three outcomes — released definitions, minimum facts and a basic confirmable order lifecycle — but their ownership becomes internally cohesive.

## GitHub Tracking Structure

Tracking was created on 2026-08-19. [Issue #5386](https://github.com/open-mercato/open-mercato/issues/5386) is the parent specification-readiness tracker; #5255/#5256 remain the architecture discussion/review evidence.

| Work item | Tracker |
|---|---|
| P1.0a | [#5387](https://github.com/open-mercato/open-mercato/issues/5387) |
| P1.2 | [#5389](https://github.com/open-mercato/open-mercato/issues/5389) |
| P1.4a | [#5393](https://github.com/open-mercato/open-mercato/issues/5393) |
| P1.4b | [#5405](https://github.com/open-mercato/open-mercato/issues/5405) |
| P1.4c | [#5408](https://github.com/open-mercato/open-mercato/issues/5408) |
| P1.4d | [#5409](https://github.com/open-mercato/open-mercato/issues/5409) |
| P1.4e | [#5410](https://github.com/open-mercato/open-mercato/issues/5410) |
| P1.4f | [#5411](https://github.com/open-mercato/open-mercato/issues/5411) |
| P1.4g | [#5412](https://github.com/open-mercato/open-mercato/issues/5412) |
| P1.4h | [#5413](https://github.com/open-mercato/open-mercato/issues/5413) |
| P1.6 | [#5394](https://github.com/open-mercato/open-mercato/issues/5394) |
| P1.5 | [#5395](https://github.com/open-mercato/open-mercato/issues/5395) |
| P1.7 | [#5396](https://github.com/open-mercato/open-mercato/issues/5396) |
| P1.8b | [#5398](https://github.com/open-mercato/open-mercato/issues/5398) |
| P1.9 | [#5399](https://github.com/open-mercato/open-mercato/issues/5399) |
| P1.10 | [#5400](https://github.com/open-mercato/open-mercato/issues/5400) |
| P1.11 | [#5401](https://github.com/open-mercato/open-mercato/issues/5401) |

Every child records its work-item ID, owner, planned artifact, upstream dependencies, start/finalization gates and P1.12 evidence obligation. Do not create an implementation Issue until its specification is implementation-ready, or keep implementation tasks explicitly blocked beneath the spec Issue. Update `docs/manufacturing/README.md` and `waves-and-readiness.md` whenever a specification, readiness verdict or implementation state changes.

## Risks and Impact Review

### Architecture review remains unaccepted

- **Scenario:** Downstream specs freeze names or contracts before maintainers accept P1.0, causing coordinated rewrites.
- **Severity:** High
- **Affected area:** Every Wave 0 artifact
- **Mitigation:** Permit skeletons/research, but make P1.0 acceptance a finalization and implementation gate.
- **Residual risk:** Some skeleton text may still need revision after review.

### Bootstrap scope absorbs domain behavior

- **Scenario:** P1.0a becomes a hidden implementation of BOM, order, facts or WMS orchestration and prematurely turns the `manufacturing` module into a monolith.
- **Severity:** High
- **Affected area:** `@open-mercato/manufacturing` public contracts
- **Mitigation:** Limit P1.0a to package/module mechanics, discovery entrypoints and isolation tests; forbid entities, UI, WMS calls, domain exports and speculative seams.
- **Residual risk:** A later real consumer may require an additive model-neutral package subpath.

### P1.8 recombines independent domains

- **Scenario:** One specification lets WMS learn Manufacturing vocabulary or forces the Manufacturing adapter into the WMS lifecycle.
- **Severity:** High
- **Affected area:** WMS, `manufacturing`, future inventory consumers
- **Mitigation:** Keep the WMS provider-neutral contract external to Manufacturing and prove independent disabled-module behavior for the Manufacturing adapter.
- **Residual risk:** Cross-domain reporting still needs opaque reference registration and durable fallback design.

### Parallel skeletons invent upstream contracts

- **Scenario:** Downstream authors fill missing dependencies with assumptions that later conflict.
- **Severity:** Medium
- **Affected area:** P1.5, P1.7-P1.11
- **Mitigation:** Allow preparation but require numbered Open Questions and block full-spec readiness until upstream interfaces are accepted.
- **Residual risk:** Research and use-case sections may require small alignment edits.

### Tracking status diverges from evidence

- **Scenario:** Issues, README and readiness dashboard report different states.
- **Severity:** Medium
- **Affected area:** Programme governance
- **Mitigation:** Every state-changing PR updates the dashboard and operational README; every promotion links evidence.
- **Residual risk:** External reviewer decisions still require manual synchronization.

## Final Compliance Report — 2026-08-19

### AGENTS.md Files and Guides Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/docs/module-development.md`
- `.ai/skills/om-spec-writing/SKILL.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/compliance-review.md`
- `.ai/skills/om-pre-implement-spec/SKILL.md`

### Compliance Matrix

| Rule | Status | Notes |
|---|---|---|
| One independently deployable capability per spec | Compliant | P1.8b is the Manufacturing adapter over an external WMS contract; P1.7 is definition-only; P1.9 is fact-ledger-only; model-specific order snapshots and confirmations belong to P1.10. |
| Correct OSS spec location and filename format | Compliant | Backlog and planned specs use `.ai/specs/{date}-{title}.md`; analyses use `.ai/specs/analysis/`. |
| Module/package placement explicit | Compliant | Manufacturing topology is accepted by the roadmap owner. |
| Optional integration owns glue and degrades when absent | Compliant | P1.8b owns Manufacturing semantics; optional consumers retain their own integration glue. |
| No implementation before a ready spec | Compliant | Skeleton, full-spec and implementation readiness are distinct gates. |
| Backward compatibility audited before implementation | Compliant | Definition of Ready requires all public contract surfaces. |
| Integration coverage ships with implementation | Compliant | P1.12 evidence matrix requires API/UI, isolation, failure, reversal and compatibility coverage. |
| Deferred capabilities do not block MVP | Compliant | P1.4c-h, P1.13 and later planning/enterprise capabilities remain outside the first flow. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Work-item boundaries match the roadmap outcome | Pass with documented alignment change | P1.0a is additive planning work; P1.4 and P1.8 are split; P1.7/P1.9 are narrowed and their discrete behavior moves to P1.10 without changing Gate B outcomes. |
| Dependency graph matches finalization gates | Pass | Gate A/B/C prerequisites are preserved. |
| Existing specs are not treated as implementation-ready | Pass | Each requires a formal readiness analysis. |
| P1.12 has a concrete role | Pass | Shared evidence matrix, not a fake product capability. |
| Data/API/UI contracts | N/A | This planning backlog introduces no product contract. |

### Verdict

**Internally coherent planning backlog, ready for owner review.** After approval, the first authoring batch and GitHub tracking structure may be created. No implementation is authorized by this document.

## Changelog

- 2026-08-19: Created the Wave 0 specification backlog skeleton with P1.0a, Manufacturing adapter planning, readiness artifacts, and deferred P1.13.
- 2026-08-19: Accepted one `packages/manufacturing` workspace package containing one opt-in `manufacturing` runtime module; hard dependency `catalog`, optional WMS/Resources/Planner, and entrypoint-only exports.
- 2026-08-19: Added dependency lanes, planned filenames, readiness definitions, the P1.12 evidence matrix, current-state audits, first authoring batch, tracking structure, risks and compliance review.
- 2026-08-19: Scope-cohesion review narrowed P1.7 to definition release and P1.9 to the model-neutral fact ledger; moved order-release execution snapshots and basic discrete confirmations into P1.10 and recorded the required parent-document alignment.
- 2026-08-19: Final self-review made P1.4a/P1.5 explicit prerequisites of P1.7 and added the formal overview, problem, solution, applicability and delivery-phase sections.
- 2026-08-19: Owner approved the backlog; created parent tracker #5386 and child specification/readiness trackers #5387–#5401, then aligned their artifact paths and governance state.
- 2026-08-19: Fresh-context review split P1.4 into P1.4a direct-level BOM draft authoring/integrity (#5393) and P1.4b bounded read-only multi-level preview (#5405); the roadmap owner accepted the boundary.
- 2026-08-19: Completed both split specifications, fresh-context reviews (**PASS**), P1.12 mappings and final compliance gates; implementation remains blocked by their named P1.0/P1.0a/Catalog-contract/P1.4a prerequisites.
- 2026-08-28: Removed Catalog and WMS delivery work from the Manufacturing backlog. Manufacturing consumes public contracts and does not own, track or wait on those tasks as module dependencies.
- 2026-08-19: Re-ran the P1.4a pre-implementation audit, remediated framework/data/API/UI/export findings, and recorded that reusable BOMs exclude customer/order/due-date context owned by P1.10.
- 2026-08-19: Added deferred future consideration for collaborative BOM drafting. P1.4a remains aligned with the standard Sales/platform optimistic-lock pattern; presence, ownership, comparison, merge, and recovery stay outside Wave 0 pending real collaboration evidence.
- 2026-08-19: Added a post-Wave 0 BOM decision queue for list perspectives/filtering, business identity, history/comments, revision impact analysis, reuse/import/export, extensibility/document control, and alternatives. Each remains an independent candidate rather than an unapproved expansion of P1.4a.
- 2026-08-19: Owner assigned the approved post-Wave 0 BOM decision queue to P1.4c-h and created trackers #5408-#5413: list workspace, business identity, history/comments, revision comparison/where-used, copy only, and extensibility/document control. Import/export and alternatives remain unassigned future work.
- 2026-08-20: Accepted the parent roadmap as the staged Wave 0 delivery baseline. P1.0a is authorized for implementation; all other capability slices continue to require their dedicated readiness evidence and dependency gates.
- 2026-08-28: Removed the unrelated WMS/Sales packaging concern from the Manufacturing backlog and closed its specification tracker; a future owner must create a new, separately scoped artifact if the work is needed.
