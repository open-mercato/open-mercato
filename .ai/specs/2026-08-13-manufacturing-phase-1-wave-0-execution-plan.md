# Manufacturing Phase 1 / Wave 0 Execution Plan

## TLDR

This document turns the Manufacturing roadmap into an execution-oriented Phase 1 plan with staged readiness. It permits real draft BOM/routing CRUD before stock execution, identifies the smaller gate for releasing production orders, and reserves exact WMS prerequisites for stock-affecting execution.

The plan deliberately allows early implementation of **manufacturing-definition drafts**: BOMs, optional sequential routings, operations, and work-centre applicability. Draft CRUD/API/UI does not alter physical stock. A draft cannot become an executable released order until the smaller release gate passes, and it cannot post material movements until exact WMS precision/evidence and the atomic posting contract pass.

The target composition is:

```text
manufacturing (single opt-in Wave 0 module; hard-requires catalog)
  └─ compatible WMS provider for all stock-affecting execution
```

`manufacturing` may not silently complete a stock-affecting operation without WMS. WMS, `resources`, and `planner` are optional peers rather than hard module requirements. Projects, time tracking, and service operations are separate business domains and must not be modelled as a WMS-free variant of Manufacturing.

## Overview and Status

**Status:** Proposed planning baseline aligned with the roadmap under maintainer/community review. No implementation scope is approved by this document.

**Parent roadmap:** `2026-08-13-manufacturing-product-roadmap.md`.

**P1.3 capability specifications:**

- P1.3a: `2026-08-13-catalog-quantity-normalization.md`;
- P1.3b: `2026-08-13-wms-quantity-precision-alignment.md`;
- P1.3c: `2026-08-13-wms-quantity-evidence-reversal.md`.

**Relationship to roadmap readiness:** The parent roadmap defines Gate A (drafts), Gate B (released orders), Gate C (stock execution), a standalone-packaging gate, and deferred capability gates. This document groups them into deliverable-sized epics without turning deferred planning, numbering, MES/QMS, costing, or packaging work into first-MVP blockers.

**Phase 1 meaning in this document:** Draft definition authoring, the minimum released-order lifecycle, and one safe stock-affecting discrete flow. It is not a release promise for MRP, APS, full MES/QMS, advanced numbering, costing, genealogy UI, process manufacturing, subcontracting, or enterprise operations.

## Problem Statement

Manufacturing needs a realistic plan that permits progress before every inventory contract is implemented, without accidentally freezing a production model that later conflicts with WMS, sites, UoM precision, or execution history.

Treating BOM and routing authoring as fully blocked by WMS would waste parallel development capacity. Treating them as already executable production data would be unsafe: release semantics, site applicability, immutable snapshots, quantity precision, and material posting correlations are cross-module contracts.

The plan must therefore answer three questions for every large task:

1. Which module primarily owns the change?
2. What trusted prerequisite or module contract does it need?
3. What concrete capability does it unblock?

## Proposed Solution

Run three coordinated workstreams:

```text
Platform and inventory readiness
  WMS sites → exact UoM/precision/evidence → generic atomic WMS posting groups
  WMS–Sales decoupling proceeds in parallel as a standalone-packaging gate

Definition authoring in `manufacturing`
  draft BOMs → draft routings → work-center extension → release/snapshot semantics

Execution readiness
  minimum fact ledger → production order/execution snapshot/basic confirmations → material execution through WMS
```

The first two workstreams can begin in parallel. The third can define contracts and test scenarios early, but cannot ship a stock-affecting production workflow until the WMS contract is available.

## Phase 1 Workstream Table

| ID | Large task | Primary owner/module | Modules and contracts touched | Can start now? | Depends on | Unblocks |
|---|---|---|---|---|---|---|
| P1.0 | Freeze Phase 1 boundaries and dependency semantics | Manufacturing planning / specs | `wms`, `catalog`, `resources`, `planner`, `events`, `queue` | Yes, as review/refinement only | Parent roadmap | Accepted implementation baseline; no accidental hard dependency or duplicated ownership |
| P1.0a | Bootstrap the Manufacturing workspace package and single opt-in module | `@open-mercato/manufacturing` / `manufacturing` | Workspace manifest, module discovery, entrypoint exports, build/test and opt-in app conventions | Full specification ready for review; implementation only after P1.0 acceptance | P1.0 | Stable package/module home without domain behavior; hard `catalog`, optional WMS/Resources/Planner |
| P1.1 | Decouple WMS from Sales through candidate `wms_sales` | Optional integration module requiring `wms` and `sales` | `feature_toggles`, commands, events, API routes, widgets, module metadata | Yes as specification work; not first-standard-composition blocker | Backward-compatibility plan | Standalone WMS/Manufacturing packaging while preserving current Sales behavior through a compatibility bridge |
| P1.2 | Establish minimal WMS site and current warehouse-role model | `wms` | auth/organization scope, custom-field framework, CrudForm/DataTable extension hosts, and WMS warehouse topology | Readiness review after baseline acceptance; implementation only after pass | Tenant/organization invariants | Inactive-by-default Site; raw-material/finished-goods activation defaults; one warehouse in one active Site; immutable consumer snapshots |
| P1.3a | Establish exact Catalog/Sales quantity normalization | `catalog` | Existing Catalog/Sales UoM contract and exact decimal utilities | Readiness review after baseline acceptance; implementation only after pass | None; begins with current-state audit | One Catalog-owned resolver and deterministic quantity snapshots |
| P1.3b | Align WMS quantity precision, arithmetic, and profile UoM | `wms` | Inventory profiles, balances, movements, reservations, import/reconciliation | Data audit/spec refinement now; implementation after baseline acceptance and P1.3a | P1.3a | WMS no longer narrows accepted normalized quantities or drifts under fractional arithmetic |
| P1.3c | Add WMS immutable quantity evidence and correlated reversal | `wms` | Reservations, movements, idempotency, reconciliation | Spec refinement after P1.3b; implementation after baseline acceptance/readiness | P1.3a–b | Historical UoM evidence and exact full/partial reversal; mandatory for P1.8a/P1.11 |
| P1.4a | Author direct-level BOM drafts and enforce aggregate integrity | `manufacturing` discrete definition capability | `catalog` | Specification complete; implementation after roadmap acceptance and upstream readiness | P1.0a; P1.3a before quantity contracts freeze | Editable versioned drafts with stable direct occurrences, base output, fixed/variable basis, yield, optimistic locking, undo and cycle-safe graph writes; `siteId` remains absent until release |
| P1.4b | Preview bounded multi-level BOM drafts | `manufacturing` discrete read capability | `catalog`; P1.4a internal reader/events | Specification complete; implementation after P1.4a readiness | P1.0a, P1.3a, P1.4a | Read-only occurrence tree with exact fixed/variable/yield calculation, variant fallback, unresolved warnings, repeatable-read consistency and hard depth/node bounds |
| P1.4c | BOM list workspace | `manufacturing` post-Wave 0 usability capability | P1.4a list/read contract; shared DataTable perspectives | Specification task [#5408](https://github.com/open-mercato/open-mercato/issues/5408); not a Wave 0 gate | P1.4a | BOM-specific search/filter/sort plus personal column/filter/sort perspectives; retain keyset pagination and exclude bulk mutation |
| P1.4d | BOM business identity | `manufacturing` post-Wave 0 master-data capability | P1.4a family/revision identity; Catalog product identifiers | Specification task [#5409](https://github.com/open-mercato/open-mercato/issues/5409); not a Wave 0 gate | P1.4a | Decide code/name necessity, owner, uniqueness, migration and compatibility without duplicating production-order numbering |
| P1.4e | BOM history, change context and comments | `manufacturing` post-Wave 0 collaboration-context capability | P1.4a action log/events; shared Version History and Notes | Specification task [#5410](https://github.com/open-mercato/open-mercato/issues/5410); not a Wave 0 gate | P1.4a; P1.7 only for released-record semantics | History/comments/change reason without presence, merge or edit locks |
| P1.4f | BOM revision comparison and where-used | `manufacturing` post-Wave 0 read capability | P1.4a graph/revisions; P1.4b read patterns | Specification task [#5411](https://github.com/open-mercato/open-mercato/issues/5411); not a Wave 0 gate | P1.4a, P1.4b; P1.7/P1.10 for released/execution visibility | Deterministic revision diff and bounded reverse-dependency impact; no planning/remediation |
| P1.4g | Copy a BOM | `manufacturing` post-Wave 0 authoring capability | P1.4a commands/graph; P1.3a quantity/UoM | Specification task [#5412](https://github.com/open-mercato/open-mercato/issues/5412); not a Wave 0 gate | P1.4a, P1.3a | One explicit copy command with new IDs and full scope/Catalog/quantity/graph revalidation; no import/export |
| P1.4h | BOM extensibility and document control | `manufacturing` post-Wave 0 extension capability | P1.4a hosts; platform custom fields/tags/attachments; P1.7 snapshots | Specification task [#5413](https://github.com/open-mercato/open-mercato/issues/5413); not a Wave 0 gate | P1.4a; P1.7 for released-document semantics | Decide custom-field/tag/reference ownership, provider, retention and immutable release evidence |
| P1.5 | Author draft routings and operations | `manufacturing` discrete definition capability | optional `resources` | Yes, including CRUD/API/UI after roadmap acceptance and spec readiness | P1.6 before release contract freezes | Optional single-sequence routing drafts with work centre, setup/run time, and instructions; no scheduling semantics |
| P1.6 | Establish work-center extension boundary | `manufacturing` | optional `resources`; `planner`, assets, tools, and existing workforce owners as later inputs | Yes as specification work | P1.0 | Minimal work centres without duplicate resource/calendar masters |
| P1.7 | Define released-definition lifecycle and immutable definition snapshots | `manufacturing` | WMS `Site`, `catalog`, attachments, P1.3a, accepted BOM/routing contracts | Specification preparation after upstream shapes are known; implementation follows Gate B prerequisites | P1.2, P1.3a, P1.4a, P1.5, P1.6 | Child revisions and occurrence-preserving multi-level definition snapshots frozen atomically at definition release; no order release; P1.4b is not a release prerequisite |
| P1.8a | Define generic atomic WMS posting groups | `wms` | WMS Site, balances, movements, reservations, quantity evidence, commands and reconciliation | Specification/benchmark work only pending baseline acceptance | P1.2, P1.3a–c | Consumer-neutral atomic physical lines with opaque source/reason references, exact reversal and reconciliation |
| P1.8b | Define the Manufacturing inventory posting adapter | `manufacturing` | P1.8a provider, P1.9 fact writer, P1.10 execution/confirmation contracts | Semantic-command preparation only | P1.8a, P1.9, P1.10 | Manufacturing-derived issue, return, cumulative backflush, output, scrap and reversal orchestration without WMS learning Manufacturing vocabulary |
| P1.9 | Define the minimum Manufacturing fact ledger | `manufacturing` model-neutral internal boundary | `events`, opaque external evidence references, optional future MES/edge provider | Specification or explicitly non-shippable ledger spike only pending baseline acceptance | P1.0a | Model-neutral append-only fact table with acceptance, correction and persistent idempotency primitives; no discrete UI/orchestration |
| P1.10 | Add the first discrete production-order lifecycle, execution snapshot and basic confirmations | `manufacturing` | WMS `Site`, released definitions | No as a shippable feature until Gate B passes | P1.2, P1.3a, P1.7, P1.9 | `draft → released → in_progress → completed/cancelled`, provider-neutral demand source (`sourceType/sourceId/sourceLineId`), `requiredByAt` and planned dates, top-level definition selection, immutable execution snapshot, simple order number, `complete_short`, stock-free partial/final/scrap confirmations and corrections |
| P1.11 | Add stock-affecting production execution | `manufacturing` | optional `wms`, WMS `Site`, P1.3 | No | P1.3b–c, P1.8a–b, P1.9–P1.10 | Manufacturing-derived issue/return/backflush/output/scrap groups, exact reversal, explicit lot/serial, and on-demand reconciliation |
| P1.12 | Cross-cutting readiness and integration coverage | Each owning module | `shared`, `events`, `queue`, UI, module-discovery and compatibility contracts | Starts with each accepted implementation epic | Respective implementation | Tenant/org/site isolation, disabled-module, conflict, reversal, partial-failure, and compatibility evidence |
| P1.13 | Add advanced production number ranges | Dedicated later capability | order/batch/lot/serial formats, reset, block reservation, and offline allocation | Later; not an MVP gate | Proven basic identities and real numbering demand | Configurable generated identifiers without changing UUID identity or explicit-input compatibility |

## BOM and Routing Scope Boundary

### Safe to implement before WMS execution

| Capability | Primary module | Why it is safe before WMS |
|---|---|---|
| Multi-level BOM draft CRUD/API/UI | Future discrete definition capability | It persists real editable drafts without inventory effects. Each line is a distinct occurrence. `siteId` may be absent in draft; P1.3a must pass before quantity contracts freeze; incomplete or ambiguous drafts cannot release. |
| Optional sequential routing draft CRUD | Future discrete definition capability | It stores operation order, basic setup/run time, instructions, work-centre/resource references, and no calendar/scheduling semantics |
| Work-center applicability | `manufacturing` with an optional `resources` seam | It links manufacturing constraints by scalar IDs and does not replace resource/calendar ownership |
| Draft versioning and validation | Future discrete definition capability | It can reject incomplete definitions without making any WMS claim |
| UX research, mocks, and acceptance scenarios | Planning/UI work | It informs later implementation without creating an executable workflow |

### Must wait for the corresponding foundation contract

| Capability | Required before it can be implemented or released |
|---|---|
| Release of a manufacturing definition | active `siteId`, raw-material and finished-goods defaults, current warehouse-role snapshot, deterministic child revision selection, base-output/fixed/variable/yield semantics, P1.3a, work-centre ownership, and immutable definition snapshot |
| Release of an executable production order | Top-level definition selection by `plannedStartDate`, multi-level occurrence snapshot, cycle validation, simple order number, minimum fact table, and basic confirmation contract |
| Component issue, return, and backflush | Generic atomic WMS posting-group contract, Manufacturing semantic adapter, and idempotency/reversal semantics |
| Output receipt, explicit lot/serial identity, and scrap | WMS atomic posting contract, WMS uniqueness validation, and P1.3 precision/evidence rules |
| Completion of a physical production operation | A successful, correlated atomic WMS posting or, only for a future external provider, an explicitly compensatable durable saga |

## Module Ownership and Dependency Rules

| Area | Authoritative owner | Manufacturing may do | Manufacturing must not do |
|---|---|---|---|
| Product, variant, UoM | `catalog` | Reference and snapshot released values/conversions | Duplicate product or UoM masters |
| Site identity and current warehouse roles | `wms` | Reference `siteId` and snapshot the exact role/warehouse choices used | Treat a warehouse as permanent plant identity or reconstruct history from current mappings |
| Physical stock, lots, serials, reservations, movements | `wms` | Submit already-derived physical lines through a generic atomic posting group and store returned posting IDs/evidence | Make WMS interpret Manufacturing definitions or maintain a competing inventory ledger/committed-stock balance |
| Shared resource identity and base capacity | `resources` | Add manufacturing work-center extensions by IDs | Duplicate resource master data |
| Basic stock availability | `wms` | Consume the status/expiry-aware projection | Recompute eligibility or require QMS for MVP |
| Calendars | `planner` | Consume later when scheduling needs them | Become calendar master or block manual MVP release |
| Definition, order, operation intent and facts | `manufacturing` | Own lifecycle, confirmation, history, authorization, backflush calculation and reconciliation while preserving internal capability boundaries | Turn WMS generic manual adjustments into normal production semantics or move Manufacturing calculation into WMS |
| Sales-order reservation automation | Candidate optional `wms_sales` integration | Consume WMS reservation services and own Sales-specific subscribers/routes/widgets | Keep `sales` as a hard WMS requirement or leave Sales workflow in core WMS |

## Suggested Sequencing

| Sequence | Work items | Reason |
|---|---|---|
| First parallel increment | P1.1 WMS–Sales decoupling, P1.2 WMS Site, P1.3a normalization, P1.4a BOM authoring, P1.4b bounded preview, P1.5 routing draft CRUD, P1.6 work-centre boundary | Delivers usable authoring and its independently bounded read view early; only P1.3a blocks stable quantity contracts and P1.6 blocks released resource contracts |
| Released-order increment | P1.7 definition release, P1.9 fact ledger, then P1.10 lifecycle/execution snapshot/basic confirmations | Produces a safe non-stock order lifecycle once Gate B evidence passes |
| Stock-readiness increment | P1.3b precision, P1.3c evidence/reversal, P1.8a generic WMS posting and P1.8b Manufacturing adapter | These are the only additional blockers for physical execution |
| Validation increment | Throwaway vertical spike: one site, one discrete order, explicit issue, cumulative backflush, output receipt, minimum facts, reversal | Validates atomicity, exact partial arithmetic, yield/fixed rules, and reversal before stock contracts freeze |
| First shippable production increment | P1.10 production order lifecycle followed by P1.11 execution | Only after the prerequisite contracts and spike outcomes are accepted |
| Post-Wave 0 BOM usability/control lane | P1.4c–P1.4h | Independent enhancements after their decision/specification gates; none delays Gate A, B or C |

## Out of Scope for Phase 1

- MRP, finite scheduling/APS, ATP/CTP, S&OP, and optimisation;
- MES UI, offline/out-of-order replay, device sequencing, or edge-device product delivery beyond the basic confirmation command/spike;
- QMS provider, advanced genealogy/traceability graph, costing valuation, finance posting, PLM, document-control product, subcontracting, and process/batch aggregates;
- advanced order/batch/lot/serial ranges, direct-issue child hand-off, shared warehouses across active sites, and automatic child-order generation;
- Manufacturing list/read cache, bulk/advanced-analytics UI, approval/segregation-of-duties workflows, scheduled reconciliation/alerts, and queued migration/progress UX. Personal BOM list perspectives/search/filtering are separately tracked as post-Wave 0 P1.4c; BOM customisation/document control is P1.4h;
- a WMS-free production mode for projects, time reporting, consulting, or service delivery;
- replacing project management, field service, service operations, or time tracking with `manufacturing`.

## Architecture, Data Models, and API Contracts

This planning specification introduces no endpoint, entity, migration, route, event ID, ACL, UI, or public API contract. Each implementation epic requires its own detailed specification before code changes begin.

The following future boundaries are candidate rules from the parent roadmap and become binding after that roadmap is accepted:

- cross-module links are scalar IDs plus historical snapshots, never direct ORM relations;
- all operational records validate tenant, organization, active site, and applicable warehouse-assignment scope;
- every user-editable entity uses `updated_at` and optimistic locking;
- manufacturing facts are append-only; reversals are compensating facts and postings, never deletion;
- operational current state remains in ordinary entities; the append-only `manufacturing_facts` table is the evidence ledger, not a full event-sourcing model;
- released definitions use date-only `validFrom`/`validTo`; operational facts persist `recordedAt` in UTC and `occurredAt`, with source timestamp/timezone only when supplied;
- WMS owns physical stock and physical commitment; Manufacturing owns production intent and orchestration;
- `manufacturing` translates each semantic production command into one generic atomic WMS posting group of concrete physical lines; a future external provider may use a durable saga while preserving the same public result contract;
- production cannot report a stock-affecting operation as completed without a WMS success result or, for a future external provider, a persisted durable saga state.

## Risks and Mitigations

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Draft BOM/routing work is mistaken for executable production | High | Name the early scope "manufacturing-definition drafts"; allow `siteId` to be absent on drafts, but require the release gate and an active Site before release | Stakeholders must maintain scope discipline |
| Repeated BOM components are merged or a cycle enters the released structure | High | Persist BOM lines as distinct occurrences keyed by line identity/position, preserve their paths in snapshots, derive aggregates only for planning views, and reject direct/indirect cycles before release and order creation | Incorrect material issue, traceability loss, or unbounded explosion is prevented before execution |
| WMS–Sales decoupling breaks existing Sales reservation behaviour | High | Preserve public contracts with a compatibility bridge; test WMS+Sales and WMS-only compositions | Migration and auto-discovery details require a dedicated implementation spec |
| WMS and Manufacturing both calculate stock commitment | High | WMS remains the only owner of reservations/allocations; planning pegs are proposals | Provider integration must enforce the rule |
| Premature data schemas freeze unsuitable process-manufacturing semantics | High | Keep model-neutral contracts internally isolated from discrete aggregates and publish reusable seams only when a real second consumer requires them | A future model may require additive extraction or orchestration |
| WMS learns Manufacturing definitions or production-specific movement enums | High | P1.8b derives concrete lines; P1.8a accepts generic atomic groups with opaque namespaced references and durable display fallback | P1.8a must still define registration/disabled-module display/provider compatibility, and P1.8b must preserve semantic ownership |
| UoM/rounding mismatch creates inventory drift | High | Reference cases for fractional use, conversion, partial completion and reversal before WMS production postings freeze | Physical measurement variance remains policy-specific |
| Optional peer modules become accidental hard dependencies | Medium | Classify each dependency as runtime requirement, prerequisite or soft provider; add disabled-module tests | Deployment policy may intentionally require optional modules |

## Validation and Exit Criteria

Readiness is staged. Evidence is required only for the capability being enabled.

### Gate A — draft authoring

1. Real BOM and optional sequential-routing CRUD/API/UI work in tenant and organization scope without stock effects.
2. Draft BOMs preserve repeated component occurrences, reject direct and indirect cycles, and may omit `siteId` until release.
3. P1.3a provides the shared exact-decimal and UoM normalization contract before Manufacturing quantity schemas freeze.
4. Minimal Work Centers, setup/run time, instructions, audit, ACL, and optimistic locking work without requiring calendars or finite-capacity planning.

### Gate B — released definitions and production orders

1. An inactive Site cannot be used operationally. Activation requires default `raw_material` and `finished_goods` warehouses; one warehouse may fill both roles but may belong to only one active Site in the MVP.
2. P1.7 released definitions have non-overlapping site/date applicability and preserve the exact child revisions and occurrence tree chosen at definition release.
3. P1.10 order release selects exactly one top-level definition by item/variant, Site and planned start date, then persists an immutable execution and warehouse-role snapshot.
4. The lifecycle is `draft -> released -> in_progress -> completed`, with controlled `cancelled`; normal completion requires `good + scrap == planned`, while `complete_short` records an explicit reason.
5. Required quantities reproduce the accepted base-output, fixed/variable basis, `0 < yieldFactor <= 1`, and occurrence-level multi-level BOM rules.
6. P1.9 records accepted facts append-only with correction and persistent idempotency primitives; P1.10 owns stock-free partial/final good, scrap and order/operation confirmation orchestration.
7. UUID is canonical identity. A concurrency-safe Site-scoped order display number is sufficient; lot and serial identifiers remain explicit user/integration input validated by WMS. P1.13 is a necessary future capability, not an MVP gate.

### Gate C — stock-affecting execution

1. P1.3b–c prove non-narrowing WMS storage, immutable quantity/UoM evidence, and exact reversal before production postings are enabled.
2. P1.8a makes the built-in WMS provider accept a generic atomic idempotent posting group of concrete issue/receipt/transfer/write-off/reversal lines with opaque namespaced source/reason references; it returns posting ID, quantity, UoM, and `postedAt`. `valuationContextRef` remains optional until costing defines it.
3. P1.8b makes `manufacturing` derive the group from the P1.10 execution snapshot/confirmation and correlate the response through P1.9. Explicit issue uses the actual requested quantity. Variable backflush contributes only the delta between cumulative accepted `good + scrap` demand and net quantity already posted. Fixed consumption applies once per order and BOM occurrence; partial issue is allowed, the first qualifying backflush contributes the remainder, and exact reversal reopens it from persisted evidence. WMS never reads the BOM/execution snapshot or calculates these amounts.
4. The P1.10 confirmation extension supplies order/operation/backflush point, partial/final good quantity, scrap and `occurredAt`; P1.9 supplies correlation/idempotency and compensating facts. Offline sequencing, arbitrary out-of-order replay, devices, and retention-window policy are not MVP requirements.
5. WMS status/expiry-aware availability excludes ineligible stock without requiring a QMS provider. Physical reservations remain WMS-owned; release creates no automatic reservation, and issue/backflush rechecks availability.
6. Corrections create compensating facts/postings, and on-demand reconciliation can compare P1.9 facts with WMS evidence. Scheduled reconciliation, alerting, and a full event-sourcing model remain later work.

P1.1 is required before claiming standalone WMS/Manufacturing packaging. It does not block the first MVP in the standard composition that includes Sales. Disabled optional modules and every changed API/UI path still require proportionate integration coverage.

## Migration and Backward Compatibility

This document itself changes no contract. After the parent roadmap is accepted, implementations governed by this plan must follow `BACKWARD_COMPATIBILITY.md`.

The WMS–Sales work is especially contract-sensitive: current sales-order event IDs, routes, commands, ACLs, widgets, and integrations may not be removed or renamed in one release. If they move to an optional integration boundary, the implementation spec must define a deprecation period, compatibility bridge, upgrade notes, and regression coverage.

## Changelog

- 2026-08-13: Created the Phase 1/Wave 0 execution plan from the proposed Manufacturing roadmap, separating early manufacturing-definition draft work from WMS-dependent execution work.
- 2026-08-13: Assigned the minimal `Site` and current site-to-warehouse-role model to `wms`.
- 2026-08-13: Revision aligned P1.2 with current-only assignments, one default warehouse per configured role, and immutable consumer snapshots; scheduled/effective-dated assignments and site timezone are later features. Identified advanced production number ranges as a separate follow-up capability.
- 2026-08-13: Refined the P1.2 UI baseline for infrequent setup: full canonical custom fields and field injection on `Site`, no custom fields on assignments, minimalist DataTables with stable extension hosts, and no built-in CRM-scale search/filter/view/export/bulk controls.
- 2026-08-13: Split P1.3 into Catalog/Sales exact normalization and two WMS-owned work items. P1.3a blocks quantity-schema freeze; P1.3b–c document the existing WMS mismatch as non-critical backlog for current/early work but remain mandatory before stock-affecting production.
- 2026-08-19: Updated P1.4/P1.7 scope from a generic multi-level BOM direction to a deterministic, occurrence-preserving BOM contract: base-output and component consumption semantics, fixed/variable basis, yield, site/date applicability, and fail-closed revision selection. Alternatives, substitutions, phantom behaviour, and unit/serial effectivity remain dedicated later work.
- 2026-08-19: Replaced the all-or-nothing readiness list with staged draft, release, and stock-execution gates; recorded the proposed bounded MVP lifecycle, facts, timing, numbering, availability, routing, reservation, confirmation, completion, and reversal contracts; moved advanced numbering and integrations to future capabilities without making public delivery or licensing commitments.
- 2026-08-19: Initially proposed `manufacturing_base` and `manufacturing_discrete`; later consolidated them into one opt-in `manufacturing` module while retaining internal model-neutral/discrete capability boundaries. Replaced production-specific WMS commands with a generic atomic posting group plus Manufacturing-owned semantic adapter and backflush calculation.
- 2026-08-19: Marked this plan and its parent roadmap as proposals pending maintainer/community acceptance; implementation still requires a dedicated ready specification.
- 2026-08-19: Selected candidate P1.1 Option B for review: optional `wms_sales` owns Sales-specific integration glue and the compatibility bridge while core WMS becomes consumer-neutral.
- 2026-08-19: Added P1.0a package bootstrap and aligned cohesive ownership: P1.7 definition release, P1.9 neutral facts, P1.10 order release/execution snapshot/basic confirmations, P1.8a generic WMS postings and P1.8b Manufacturing stock orchestration.
- 2026-08-19: Split P1.4 after fresh-context review and owner approval: P1.4a owns direct-level BOM draft authoring/integrity, while P1.4b owns the independently deployable bounded read-only multi-level preview. Only P1.4a is a P1.7 release prerequisite.
- 2026-08-19: Assigned provider-neutral demand references and required/planned dates explicitly to P1.10 rather than the reusable P1.4a BOM aggregate.
- 2026-08-19: Added the owner-approved post-Wave 0 P1.4c-h lane with specification trackers #5408-#5413: list workspace, business identity, history/comments, revision comparison/where-used, copy, and extensibility/document control. These candidates do not gate Wave 0 delivery.
