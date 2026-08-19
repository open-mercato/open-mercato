# Manufacturing Wave 0 Specification Backlog

## TLDR

This planning specification turns the proposed direction of the Manufacturing roadmap into a spec-first backlog. It does not approve implementation. It defines which Wave 0 capabilities require a new specification, which existing specifications require readiness review, which work may proceed in parallel, and which dependency gates prevent a specification from being finalized or implemented.

The backlog adds the missing package/module bootstrap work item as P1.0a, narrows P1.7 to definition release, narrows P1.9 to the model-neutral fact ledger, places order-release snapshots and discrete confirmations in P1.10, splits P1.8 into independently deployable WMS and Manufacturing specifications, treats P1.12 as a shared evidence policy rather than a standalone product specification, and keeps P1.13 deferred outside the first MVP flow.

No capability specification may freeze a public contract until the parent roadmap is accepted through repository review. Skeleton authoring, code audits, benchmark research, and readiness analysis may proceed before that acceptance when they do not create an implementation commitment.

## Overview

This document is the planning and governance specification for turning Manufacturing Wave 0 into independently reviewable capability specifications and readiness reports. Its status is **proposed and ready for owner review**. The [parent architecture](2026-08-13-manufacturing-product-roadmap.md) remains under repository review in [PR #5256](https://github.com/open-mercato/open-mercato/pull/5256), while the Sales-specific WMS extraction remains an explicit external decision in [Issue #5260](https://github.com/open-mercato/open-mercato/issues/5260).

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
| Q2 — Sales-specific WMS integration | Open in [Issue #5260](https://github.com/open-mercato/open-mercato/issues/5260) | The Issue recommends Option B, an optional `wms_sales` module, but has no comments or accepted decision and does not settle module-vs-package placement. P1.1 may be researched and skeletonized, but its full specification cannot freeze placement or migration until #5260 is decided. |

Q2 does not block Gate A, Gate B, or the first standard composition containing Sales. It blocks only the claim that WMS/Manufacturing can be packaged without Sales and the finalization of the P1.1 implementation specification.

## Scope

This backlog covers specification authoring and readiness work for P1.0 through P1.12. It records P1.13 as deferred and non-blocking but does not create its specification.

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
| 1 | P1.0 roadmap acceptance | Repository review evidence | Review pending in PR #5256 |
| 2 | P1.0a Manufacturing package and module bootstrap | Full specification | Design resolved; scope-cohesion review **KEEP**; implementation gated by P1.0 acceptance |
| 3 | P1.1 optional `wms_sales` integration | New specification | Issue #5260 exists; specification missing |
| 4 | P1.2 WMS Sites and warehouse roles | Readiness analysis of existing specification | Design complete |
| 5 | P1.3a Catalog quantity normalization | Readiness analysis of existing specification | Design complete |
| 6 | P1.3b WMS quantity precision | Data audit plus readiness analysis of existing specification | Design complete; final precision envelope open until audit |
| 7 | P1.3c WMS quantity evidence and reversal | Readiness analysis of existing specification | Design complete; depends on P1.3b |
| 8a | P1.4a BOM draft authoring and integrity | Full specification | Implementation-ready design; fresh-context review **PASS**; upstream gates remain |
| 8b | P1.4b bounded multi-level BOM draft preview | Full specification | Implementation-ready read-only design; fresh-context review **PASS**; upstream gates remain |
| 9 | P1.6 Work Center boundary | New specification | Missing |
| 10 | P1.5 routing and operation drafts | New specification | Missing; finalization depends on P1.6 |
| 11 | P1.7 released definitions and immutable definition snapshots | New specification | Missing |
| 12 | P1.8a generic atomic WMS posting groups | New WMS specification | Missing |
| 13 | P1.8b Manufacturing inventory posting adapter | New `manufacturing` specification | Missing; depends on P1.8a |
| 14 | P1.9 minimum Manufacturing fact ledger | New `manufacturing` specification | Missing |
| 15 | P1.10 discrete production-order lifecycle, execution snapshot and basic confirmations | New `manufacturing` specification | Missing |
| 16 | P1.11 stock-affecting discrete execution | New `manufacturing` specification | Missing; final stock gate |
| 17 | P1.12 cross-cutting readiness and integration evidence | Shared checklist applied to every spec and implementation epic | No standalone capability spec |
| 18 | P1.13 advanced number ranges | Deferred capability | Outside first MVP backlog |

## Decisions Already Carried Forward

- P1.0 remains a governance baseline, not an implementation epic.
- P1.0a is required because no existing work item owns workspace-package creation, module registration, auto-discovery, dependency tests, or initial public exports.
- P1.7 owns definition release and immutable definition snapshots only. P1.10 owns top-level definition selection and the execution snapshot created when a discrete order is released.
- P1.9 owns the model-neutral append-only fact ledger, acceptance/correction primitives and opaque evidence-reference envelope only. P1.10 owns order/operation-aware basic confirmations and their UI/API orchestration.
- P1.8a and P1.8b are separate because generic WMS posting groups are independently deployable and usable without Manufacturing.
- P1.4a and P1.4b are separate because direct-level BOM authoring/integrity remains useful without recursive preview, while bounded explosion is an independently deployable read capability over that aggregate.
- P1.12 is evidence attached to every capability; it does not own product data or a lifecycle.
- P1.13, MRP, APS, full MES/QMS, costing, advanced genealogy, automatic numbering, and enterprise packaging do not block the first production flow.
- Existing P1.2 and P1.3a-c documents require formal pre-implementation readiness reports before they may be marked ready.

## Architecture and Package Topology

Wave 0 uses one new workspace package:

```text
packages/manufacturing/                    @open-mercato/manufacturing
  src/modules/manufacturing/               one opt-in runtime module
    internal model-neutral boundaries      facts, lifecycle primitives, provider seams
    discrete capability boundaries         BOM/routing/order aggregates, UI, orchestration, WMS adapter
```

The package bootstrap specification defines the workspace manifest, build/test exports, auto-discovery participation, single module metadata, entrypoint-only public imports, hard `catalog` dependency, opt-in activation, package-level test configuration, strict Design System lint escalation, and module-decoupling coverage. It introduces no domain entities, UI, WMS calls, or placeholder implementations of reserved seams.

The final P1.1 topology remains deliberately outside this decision. If #5260 accepts Option B, its specification must still decide whether `wms_sales` is a module in `packages/core` or a separate workspace package. That choice must follow actual release, ownership, and independent-distribution needs rather than naming symmetry.

## Dependency Graph and Authoring Lanes

```text
P1.0 roadmap acceptance
  +--> P1.0a package/module bootstrap

P1.0a + P1.3a --> P1.4a BOM draft authoring/integrity
P1.4a --> P1.4b bounded draft preview
P1.0a --> P1.6 Work Centers --> P1.5 routing drafts
P1.0a --> P1.9 fact ledger

P1.2 + P1.3a + P1.4a + P1.5 + P1.6 --> P1.7 definition release
P1.3a --> P1.3b data audit/readiness --> P1.3c readiness
P1.2 + P1.3a + P1.3b + P1.3c --> P1.8a WMS posting groups
P1.2 + P1.3a + P1.7 + P1.9 --> P1.10 order lifecycle + execution snapshot + basic confirmations
P1.8a + P1.9 + P1.10 --> P1.8b Manufacturing adapter
P1.3b + P1.3c + P1.8b + P1.10 --> P1.11 stock execution

P1.1 wms_sales decision/specification runs in parallel and gates standalone packaging only.
P1.12 evidence applies to every specification and implementation epic.
P1.13 remains deferred.
```

The lanes describe contract-finalization order, not a ban on earlier skeletons or research. A downstream skeleton may be drafted before its inputs are accepted, but it must expose the unresolved dependency as an Open Question and cannot pass readiness review until the upstream contract is stable.

## Planned Specification and Readiness Artifacts

| Work item | Planned artifact | Owner | May start | Cannot finalize until |
|---|---|---|---|---|
| P1.0 | Existing roadmap and repository review evidence | Maintainers/community | In progress | PR #5256 is accepted or revised |
| P1.0a | `2026-08-19-manufacturing-package-module-bootstrap.md` | `@open-mercato/manufacturing` / `manufacturing` | Full spec complete | P1.0 package/module decision is accepted through repository review |
| P1.1 | `2026-08-19-wms-sales-optional-integration.md` | Owner selected by #5260 | Code audit and skeleton now | #5260 selects Option A/B and, for B, module/package placement |
| P1.2 | `analysis/ANALYSIS-2026-08-19-wms-sites-and-warehouse-roles.md` | WMS | Readiness audit now | P1.0 accepted and all critical findings remediated |
| P1.3a | `analysis/ANALYSIS-2026-08-19-catalog-quantity-normalization.md` | Catalog | Readiness audit now | P1.0 accepted and all critical findings remediated |
| P1.3b | `analysis/ANALYSIS-2026-08-19-wms-quantity-precision-alignment.md` | WMS | Real-data audit now | P1.3a ready; precision envelope selected from evidence; critical findings remediated |
| P1.3c | `analysis/ANALYSIS-2026-08-19-wms-quantity-evidence-reversal.md` | WMS | Audit preparation now | P1.3b ready and storage/arithmetic envelope frozen |
| P1.4a | `2026-08-19-manufacturing-bom-drafts.md` | `manufacturing` | Full specification complete; implementation gated | P1.0 accepted; P1.0a package contract and P1.3a quantity contract ready |
| P1.4b | `2026-08-19-manufacturing-bom-draft-preview.md` | `manufacturing` | Full specification complete; implementation gated | P1.0 accepted; P1.0a, P1.3a and P1.4a ready |
| P1.6 | `2026-08-19-manufacturing-work-centres.md` | `manufacturing` with optional `resources` input | Skeleton/code audit now | Ownership, resource cardinality, snapshot and planner-absent behavior resolved |
| P1.5 | `2026-08-19-manufacturing-routing-drafts.md` | `manufacturing` | Skeleton after P1.6 questions are known | P1.6 Work Center contract ready |
| P1.7 | `2026-08-19-manufacturing-released-definitions.md` | `manufacturing` | Skeleton after P1.4a/P1.5 release inputs and P1.6 ownership shapes are known | P1.2, P1.3a, P1.4a, P1.5 and P1.6 ready; scope stops before order release; P1.4b is not a release prerequisite |
| P1.8a | `2026-08-19-wms-atomic-posting-groups.md` | WMS | Current-state audit, benchmark and skeleton now | P1.2 and P1.3a-c ready; reference/reason registry and BC strategy resolved |
| P1.8b | `2026-08-19-manufacturing-inventory-posting-adapter.md` | `manufacturing` | Semantic-command research now | P1.8a provider contract, P1.9 fact-writer contract and P1.10 execution-snapshot/confirmation contract ready |
| P1.9 | `2026-08-19-manufacturing-fact-ledger.md` | `manufacturing` | Skeleton/research now | P1.0a ready; neutral fact, correction, idempotency and opaque evidence-reference contracts resolved without WMS vocabulary |
| P1.10 | `2026-08-19-manufacturing-orders-and-confirmations.md` | `manufacturing` | Use-case preparation after P1.7/P1.9 skeletons | P1.2, P1.3a, P1.7 and P1.9 ready |
| P1.11 | `2026-08-19-manufacturing-stock-execution.md` | `manufacturing` | Acceptance-scenario preparation only | P1.3b-c, P1.8a-b, P1.9 and P1.10 ready; validation spike accepted |
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
| P1.1 | Every WMS-owned Sales surface: `requires`, assignment entity/migration, commands, routes, subscribers, response enrichers, widgets, notifications, feature toggle and integration tests |
| P1.2 | Existing WMS topology, scope helpers, custom-field hosts, activation concurrency, migration and backend configuration UI |
| P1.3a | All Catalog/Sales normalization call sites and exact-decimal helpers; public input compatibility |
| P1.3b | Real WMS integer magnitude/fractional scale distribution, every `numeric(16,4)` quantity column, JavaScript-number arithmetic and reconciliation/import paths |
| P1.3c | Movement/reservation evidence, reversal commands, legacy rows, idempotency and existing movement API contracts |
| P1.4a | Catalog product/variant/UoM contracts, revision-like entities, commands/undo, locking, CRUD/API/UI extension hosts, ACL/events and disabled-module conventions |
| P1.4b | Recursive/batched read patterns, exact-decimal explosion, transaction isolation, custom action routes/OpenAPI, bounded tree UI, cache/event and performance conventions |
| P1.6/P1.5 | `resources` and `planner` ownership, capacity/calendar data, module requirements, resource references and existing scheduling/UI extension points |
| P1.8a | WMS balance/movement/reservation commands, transaction boundaries, location/lot/serial selection, movement enums, references, reversal and reconciliation surfaces |
| P1.9 | Event envelope, append-only evidence, correction/idempotency patterns, audit-vs-domain-fact boundaries and generic opaque evidence references |
| P1.10-P1.11 | Order-state examples, command/compound-command conventions, confirmation UI/API patterns, execution snapshots and extension behavior for stock-affecting confirmation |

## Specification Delivery Phases

| Phase | Outcome | Exit condition |
|---|---|---|
| 0. Backlog approval | Owners accept this decomposition and the documented parent-document alignment | This document is approved; P1.0 remains subject to PR #5256 |
| 1. Foundations | First authoring batch produces bootstrap/base skeletons and prerequisite readiness evidence | P1.0a, P1.2, P1.3a-b, P1.4a-b, P1.6, P1.8a and P1.9 have the evidence required for their next state |
| 2. Gate A specifications | Draft-definition capabilities become implementation-ready | P1.2, P1.3a, P1.4a, P1.4b, P1.5 and P1.6 pass their individual compliance reviews |
| 3. Gate B specifications | Released definitions, fact ledger, order lifecycle and basic stock-free confirmations become implementation-ready | P1.7, P1.9 and P1.10 pass their individual compliance reviews |
| 4. Gate C specifications | Generic WMS posting groups, Manufacturing adapter and stock-affecting execution become implementation-ready | P1.3b-c, P1.8a-b and P1.11 pass their individual compliance reviews and validation gates |
| 5. Implementation planning | Approved specs are decomposed into concrete implementation Issues/tasks | Each task links one implementation-ready specification and its required P1.12 evidence |

Phases express readiness dependencies, not one serial delivery train. Work may proceed in parallel wherever the dependency graph permits it.

## First Authoring Batch

The first batch starts only artifacts that can make independent progress without inventing downstream contracts:

1. **P1.0a skeleton** — package manifest, two module boundaries, discovery/testing contract and no domain behavior.
2. **P1.2 readiness analysis** — formal pre-implementation report for the existing Site specification.
3. **P1.3a readiness analysis** — formal report for the Catalog normalization contract.
4. **P1.3b data-audit task** — measure real and schema-supported quantity envelopes before selecting precision.
5. **P1.4a/P1.4b full specifications** — occurrence-preserving direct-level BOM authoring/integrity and its independently bounded read-only multi-level preview; no release or stock behavior.
6. **P1.6 skeleton** — Work Center ownership over `resources`; no scheduling semantics.
7. **P1.8a skeleton and WMS audit** — generic atomic posting group only; no Manufacturing vocabulary.
8. **P1.9 skeleton** — model-neutral append-only fact ledger, correction/idempotency and opaque evidence references; no discrete confirmation UI or order orchestration.
9. **P1.1 audit/skeleton** may run in parallel but retains #5260 as an explicit Open Question and cannot freeze placement.

P1.5, P1.7, P1.8b, P1.10 and P1.11 remain preparation-only until the named upstream contracts expose stable shapes.

## Scope Refinements Requiring Parent-Document Alignment

After this backlog is approved, the roadmap, execution plan, README and readiness dashboard must be aligned in one documentation change:

1. P1.7 must stop at child-revision selection, effectivity, definition release and immutable definition snapshots.
2. P1.9 must stop at the model-neutral fact ledger inside `manufacturing`, including fact acceptance/correction/idempotency primitives and opaque evidence references.
3. P1.10 must own discrete order release, top-level definition selection by `plannedStartDate`, creation of the execution snapshot, and the basic stock-free confirmation/correction flow.
4. P1.8b must consume the P1.10 execution/confirmation contract and the P1.9 fact writer while preserving internal separation between model-neutral facts and discrete orchestration.
5. Gate B still requires all three outcomes — released definitions, minimum facts and a basic confirmable order lifecycle — but their ownership becomes internally cohesive.

## GitHub Tracking Structure

Tracking was created on 2026-08-19. [Issue #5386](https://github.com/open-mercato/open-mercato/issues/5386) is the parent specification-readiness tracker; #5255/#5256 remain the architecture discussion/review evidence and #5260 remains the unresolved P1.1 decision tracker.

| Work item | Tracker |
|---|---|
| P1.0a | [#5387](https://github.com/open-mercato/open-mercato/issues/5387) |
| P1.1 | [#5388](https://github.com/open-mercato/open-mercato/issues/5388), gated by [#5260](https://github.com/open-mercato/open-mercato/issues/5260) |
| P1.2 | [#5389](https://github.com/open-mercato/open-mercato/issues/5389) |
| P1.3a | [#5390](https://github.com/open-mercato/open-mercato/issues/5390) |
| P1.3b | [#5391](https://github.com/open-mercato/open-mercato/issues/5391) |
| P1.3c | [#5392](https://github.com/open-mercato/open-mercato/issues/5392) |
| P1.4a | [#5393](https://github.com/open-mercato/open-mercato/issues/5393) |
| P1.4b | [#5405](https://github.com/open-mercato/open-mercato/issues/5405) |
| P1.6 | [#5394](https://github.com/open-mercato/open-mercato/issues/5394) |
| P1.5 | [#5395](https://github.com/open-mercato/open-mercato/issues/5395) |
| P1.7 | [#5396](https://github.com/open-mercato/open-mercato/issues/5396) |
| P1.8a | [#5397](https://github.com/open-mercato/open-mercato/issues/5397) |
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
- **Mitigation:** Keep P1.8a and P1.8b separate, with a provider-neutral contract and independent disabled-module tests.
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
| One independently deployable capability per spec | Compliant | P1.8 is split into WMS P1.8a and Manufacturing P1.8b; P1.7 is definition-only; P1.9 is fact-ledger-only; model-specific order snapshots and confirmations belong to P1.10. |
| Correct OSS spec location and filename format | Compliant | Backlog and planned specs use `.ai/specs/{date}-{title}.md`; analyses use `.ai/specs/analysis/`. |
| Module/package placement explicit | Compliant with one external gate | Manufacturing topology is accepted by the roadmap owner; P1.1 placement remains gated by #5260. |
| Optional integration owns glue and degrades when absent | Compliant | P1.1 must preserve this rule regardless of Option A/B; P1.8b owns Manufacturing semantics. |
| No implementation before a ready spec | Compliant | Skeleton, full-spec and implementation readiness are distinct gates. |
| Backward compatibility audited before implementation | Compliant | Definition of Ready requires all public contract surfaces. |
| Integration coverage ships with implementation | Compliant | P1.12 evidence matrix requires API/UI, isolation, failure, reversal and compatibility coverage. |
| Deferred capabilities do not block MVP | Compliant | P1.13 and later planning/enterprise capabilities remain outside the first flow. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Work-item boundaries match the roadmap outcome | Pass with documented alignment change | P1.0a is additive planning work; P1.4 and P1.8 are split; P1.7/P1.9 are narrowed and their discrete behavior moves to P1.10 without changing Gate B outcomes. |
| Dependency graph matches finalization gates | Pass | Gate A/B/C prerequisites are preserved. |
| Existing specs are not treated as implementation-ready | Pass | Each requires a formal readiness analysis. |
| Q2 absence behavior is explicit | Pass | It gates P1.1/standalone packaging only. |
| P1.12 has a concrete role | Pass | Shared evidence matrix, not a fake product capability. |
| Data/API/UI contracts | N/A | This planning backlog introduces no product contract. |

### Verdict

**Internally coherent planning backlog, ready for owner review.** After approval, the first authoring batch and GitHub tracking structure may be created. No implementation is authorized by this document.

## Changelog

- 2026-08-19: Created the Wave 0 specification backlog skeleton with P1.0a, the P1.8a/P1.8b split, readiness artifacts, and deferred P1.13.
- 2026-08-19: Accepted one `packages/manufacturing` workspace package containing one opt-in `manufacturing` runtime module; hard dependency `catalog`, optional WMS/Resources/Planner, and entrypoint-only exports.
- 2026-08-19: Kept P1.1 placement open under Issue #5260; the issue recommends Option B but has no accepted decision or comments.
- 2026-08-19: Added dependency lanes, planned filenames, readiness definitions, the P1.12 evidence matrix, current-state audits, first authoring batch, tracking structure, risks and compliance review.
- 2026-08-19: Scope-cohesion review narrowed P1.7 to definition release and P1.9 to the model-neutral fact ledger; moved order-release execution snapshots and basic discrete confirmations into P1.10 and recorded the required parent-document alignment.
- 2026-08-19: Final self-review made P1.4a/P1.5 explicit prerequisites of P1.7 and added the formal overview, problem, solution, applicability and delivery-phase sections.
- 2026-08-19: Owner approved the backlog; created parent tracker #5386 and child specification/readiness trackers #5387–#5401, then aligned their artifact paths and governance state.
- 2026-08-19: Fresh-context review split P1.4 into P1.4a direct-level BOM draft authoring/integrity (#5393) and P1.4b bounded read-only multi-level preview (#5405); the roadmap owner accepted the boundary.
- 2026-08-19: Completed both split specifications, fresh-context reviews (**PASS**), P1.12 mappings and final compliance gates; implementation remains blocked by their named P1.0/P1.0a/P1.3a/P1.4a prerequisites.
