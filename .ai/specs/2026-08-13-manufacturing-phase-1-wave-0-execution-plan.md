# Manufacturing Phase 1 / Wave 0 Execution Plan

## TLDR

This document turns the Manufacturing roadmap into an execution-oriented Phase 1 plan. It does not approve implementation of the discrete `production` module. Instead, it groups Wave 0 readiness work into large, independently understandable workstreams, shows the primary modules affected, and distinguishes work that can start now from work that must wait for the production-capable WMS contract.

The plan deliberately allows early work on **manufacturing-definition drafts**: BOMs, routings, operations, and work-center applicability. That work does not alter physical stock and can proceed in parallel with WMS readiness. A definition cannot become an executable released definition, create an executable production order, or post material movements until the site, snapshot, precision, and WMS contracts are complete.

The target composition remains:

```text
manufacturing (shared kernel)
  └─ production (first discrete model)
       └─ compatible WMS provider for all stock-affecting execution
```

`production` may not silently complete a stock-affecting operation without WMS. Projects, time tracking, and service operations are separate business domains and must not be modelled as a WMS-free variant of production.

## Overview and Status

**Status:** Planning baseline. No implementation scope is approved by this document.

**Parent roadmap:** `2026-08-13-production-module-architecture-roadmap.md`.

**P1.3 capability specifications:**

- P1.3a: `2026-08-13-catalog-quantity-normalization.md`;
- P1.3b: `2026-08-13-wms-quantity-precision-alignment.md`;
- P1.3c: `2026-08-13-wms-quantity-evidence-reversal.md`.

**Relationship to Wave 0:** The parent roadmap has fourteen Wave 0 gates. This document groups those gates into deliverable-sized epics and defines their dependency order. It does not weaken a gate or create a shortcut around the requirement that the detailed `production` core specification remains blocked until Wave 0 passes.

**Phase 1 meaning in this document:** Wave 0 readiness plus the definition-authoring work that is safe to start before stock-affecting execution. It is not a release promise for MRP, APS, MES, QMS, costing, traceability, process manufacturing, subcontracting, or a full production-order execution flow.

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
  WMS–Sales decoupling → WMS sites → UoM/precision → production-capable WMS postings

Definition authoring and shared kernel
  draft BOMs → draft routings → work-center extension → release/snapshot semantics

Execution readiness
  manufacturing facts/MES contract → production order → material execution through WMS
```

The first two workstreams can begin in parallel. The third can define contracts and test scenarios early, but cannot ship a stock-affecting production workflow until the WMS contract is available.

## Phase 1 Workstream Table

| ID | Large task | Primary owner/module | Modules and contracts touched | Can start now? | Depends on | Unblocks |
|---|---|---|---|---|---|---|
| P1.0 | Freeze Phase 1 boundaries and dependency semantics | Manufacturing planning / specs | `wms`, `catalog`, `resources`, `planner`, `events`, `queue` | Yes | Parent roadmap | Consistent implementation specs; no accidental hard dependency or duplicated ownership |
| P1.1 | Decouple WMS from Sales | `wms` | `sales`, `feature_toggles`, commands, events, API routes, widgets, module metadata | Yes | Backward-compatibility plan | WMS-only and Manufacturing-only deployments; future Procurement and ERP consumers |
| P1.2 | Establish minimal WMS site and current warehouse-role model | `wms` | auth/organization scope, custom-field framework, CrudForm/DataTable extension hosts, and WMS warehouse topology | Yes | Tenant/organization invariants | Stable custom-field-extensible `siteId`; closed role assignments; exactly one current default per configured role; minimal setup-once UI; immutable snapshots remain a consumer duty |
| P1.3a | Establish exact Catalog/Sales quantity normalization | `catalog` | Existing Catalog/Sales UoM contract and exact decimal utilities | Yes; blocking before quantity schemas freeze | None; begins with current-state audit | One Catalog-owned resolver and deterministic quantity snapshots |
| P1.3b | Align WMS quantity precision, arithmetic, and profile UoM | `wms` | Inventory profiles, balances, movements, reservations, import/reconciliation | Yes; WMS backlog, non-critical for current operation and early authoring | P1.3a | WMS no longer narrows accepted normalized quantities or drifts under fractional arithmetic |
| P1.3c | Add WMS immutable quantity evidence and correlated reversal | `wms` | Reservations, movements, idempotency, reconciliation | After P1.3b; WMS backlog, non-critical until stock-affecting production | P1.3a–b | Historical UoM evidence and exact full/partial reversal; mandatory for P1.8/P1.11 |
| P1.4 | Author draft BOMs | Discrete definition capability in future `production` | `catalog` | Yes | Product/variant and UoM references | Editable component structures and versioned drafts without inventory effects |
| P1.5 | Author draft routings and operations | Discrete definition capability in future `production` | `resources`, `planner` | Yes | Resource/calendar ownership decision | Editable operation sequences, routing times, and work-center applicability |
| P1.6 | Establish work-center extension boundary | `manufacturing` kernel / definition capability | `resources`, `planner`; assets and workforce as optional providers | Yes | P1.0 | Work centers without duplicate resource or calendar master data |
| P1.7 | Define released-definition lifecycle and immutable snapshots | `manufacturing` kernel + future `production` | WMS `Site`, `catalog`, attachments/documents, P1.3 | Yes as contract work; implementation follows prerequisites | P1.2, P1.3, P1.6 | Released BOM/routing/instruction package and safe order creation |
| P1.8 | Add production-capable WMS posting contract | `wms` | `manufacturing`, WMS `Site`, `catalog`, command/event contracts | Yes | P1.1–P1.3 | Semantic reservation, issue, return, backflush, output receipt, scrap, and reversal postings |
| P1.9 | Define manufacturing facts and ERP–MES confirmations | `manufacturing` kernel | `events`, `queue`, WMS posting IDs, optional MES/edge provider | Yes as contract and spike work | P1.0, P1.8 for final correlation | Append-only accepted facts, idempotency, replay, compensation, and offline confirmation handling |
| P1.10 | Add first discrete production-order lifecycle | `production` | `manufacturing`, WMS `Site`, released-definition and numbering contracts | No as a shippable feature until P1.7 and P1.13 are complete | P1.2, P1.7, P1.9, P1.13 | Orders created from an immutable released snapshot with an allocated production-order number; single-level first core |
| P1.11 | Add stock-affecting production execution | `production` | `wms`, `manufacturing`, WMS `Site`, P1.3, numbering contract | No | P1.8–P1.10, P1.13 | Material issue/return/backflush, output receipt, scrap, reversal, and reconciliation with valid lot/serial identity |
| P1.12 | Cross-cutting readiness and integration coverage | Each owning module | `shared`, `events`, `queue`, UI, module-discovery and compatibility contracts | Starts with each epic | Respective implementation | Tenant/org/site isolation, disabled-module, conflict, reversal, partial-failure, and compatibility evidence |
| P1.13 | Specify and implement production number ranges | Dedicated Wave 0 contract; exact WMS-local owner frozen by its spec | WMS `Site`, production-order/batch/lot/serial identity, concurrency and offline allocation | Contract work may start now; implementation follows identity decisions | P1.2 plus P1.7/P1.8 identity inputs | Site/type-scoped production numbers; mandatory before P1.10/P1.11 allocate any identifier |

## BOM and Routing Scope Boundary

### Safe to implement before WMS execution

| Capability | Primary module | Why it is safe before WMS |
|---|---|---|
| BOM draft domain/UI exploration | Future discrete definition capability | It may explore component structure and Catalog references without freezing quantity columns, public API shapes, or snapshot semantics before P1.3 passes |
| Routing draft CRUD | Future discrete definition capability | It stores proposed operation order, times, and applicability; it does not report physical completion |
| Work-center applicability | `manufacturing` extension over `resources` | It links manufacturing constraints by scalar IDs and does not replace resource/calendar ownership |
| Draft versioning and validation | Future discrete definition capability | It can reject incomplete definitions without making any WMS claim |
| UX research, mocks, and acceptance scenarios | Planning/UI work | It informs later implementation without creating an executable workflow |

### Must wait for the corresponding foundation contract

| Capability | Required before it can be implemented or released |
|---|---|
| Release of a manufacturing definition | active `siteId`, current warehouse-role assignment snapshot, definition effectivity, UoM/precision rules, work-center ownership, immutable snapshot contract |
| Creation of an executable production order | Released-definition contract and minimum manufacturing-fact contract |
| Component issue, return, and backflush | Production-capable WMS posting contract and idempotency/reversal semantics |
| Output receipt, lot/serial identity, and scrap | WMS posting contract, separate P1.13 number-range contract, and precision rules |
| Completion of a physical production operation | A successful, correlated WMS posting or an explicitly compensatable durable saga |

## Module Ownership and Dependency Rules

| Area | Authoritative owner | Manufacturing may do | Manufacturing must not do |
|---|---|---|---|
| Product, variant, UoM | `catalog` | Reference and snapshot released values/conversions | Duplicate product or UoM masters |
| Site identity and current warehouse roles | `wms` | Reference `siteId` and snapshot the exact role/warehouse choices used | Treat a warehouse as permanent plant identity or reconstruct history from current mappings |
| Physical stock, lots, serials, reservations, movements | `wms` | Request semantic production postings and store returned posting IDs | Maintain a competing inventory ledger or committed-stock balance |
| Shared resource identity and base capacity | `resources` | Add manufacturing work-center extensions by IDs | Duplicate resource master data |
| Availability and calendars | `planner` | Consume applicable calendar inputs | Become calendar master |
| Definition, order, operation intent and facts | `manufacturing` / `production` | Own lifecycle, confirmation, history, authorization and reconciliation | Turn WMS generic manual adjustments into normal production semantics |
| Sales-order reservation automation | Optional WMS–Sales integration | Consume WMS reservation services | Keep `sales` as a hard WMS requirement |

## Suggested Sequencing

| Sequence | Work items | Reason |
|---|---|---|
| First parallel increment | P1.1 WMS–Sales decoupling, P1.2 WMS site design, P1.3a Catalog/Sales normalization, P1.4 BOM domain/UI exploration, P1.5 routing drafts, P1.6 resource/work-center boundary | These have high learning value and do not require stock-affecting production execution; P1.4 may not freeze quantity schema/API before P1.3a–c pass |
| Second parallel increment | P1.2 WMS site implementation, P1.3b WMS precision alignment, P1.3c WMS evidence/reversal, P1.7 release/snapshot contract, P1.8 WMS posting contract, P1.9 facts/MES contract, P1.13 numbering contract | These establish the contracts that turn drafts into safe operational data; P1.3b follows P1.3a and P1.3c follows both |
| Validation increment | Throwaway vertical spike: one site, one discrete order, explicit issue, backflush, output receipt, minimum facts | Validates atomicity, precision, lot numbering, and reversal before public contracts freeze |
| First shippable production increment | P1.10 production order lifecycle followed by P1.11 execution | Only after the prerequisite contracts and spike outcomes are accepted |

## Out of Scope for Phase 1

- MRP, finite scheduling/APS, ATP/CTP, S&OP, and optimisation;
- MES UI or edge-device product delivery beyond the confirmation contract/spike;
- QMS, advanced genealogy/traceability graph, costing, finance posting, PLM, document-control product, subcontracting, and process/batch aggregates;
- a WMS-free production mode for projects, time reporting, consulting, or service delivery;
- replacing project management, field service, service operations, or time tracking with `production`.

## Architecture, Data Models, and API Contracts

This planning specification introduces no endpoint, entity, migration, route, event ID, ACL, UI, or public API contract. Each implementation epic requires its own detailed specification before code changes begin.

The following future boundaries are binding because they originate in the parent roadmap:

- cross-module links are scalar IDs plus historical snapshots, never direct ORM relations;
- all operational records validate tenant, organization, active site, and applicable warehouse-assignment scope;
- every user-editable entity uses `updated_at` and optimistic locking;
- manufacturing facts are append-only; reversals are compensating facts and postings, never deletion;
- WMS owns physical stock and physical commitment; Manufacturing owns production intent and orchestration;
- production cannot report a stock-affecting operation as completed without a WMS success result or a persisted durable saga state.

## Risks and Mitigations

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Draft BOM/routing work is mistaken for executable production | High | Name the early scope "manufacturing-definition drafts"; block release and order execution behind P1.7–P1.9 | Stakeholders must maintain scope discipline |
| WMS–Sales decoupling breaks existing Sales reservation behaviour | High | Preserve public contracts with a compatibility bridge; test WMS+Sales and WMS-only compositions | Migration and auto-discovery details require a dedicated implementation spec |
| WMS and Manufacturing both calculate stock commitment | High | WMS remains the only owner of reservations/allocations; planning pegs are proposals | Provider integration must enforce the rule |
| Premature data schemas freeze unsuitable process-manufacturing semantics | High | Keep shared lifecycle in `manufacturing`; discrete aggregates remain siblings | Some future hybrid flows may need additive orchestration |
| UoM/rounding mismatch creates inventory drift | High | Reference cases for fractional use, conversion, partial completion and reversal before WMS production postings freeze | Physical measurement variance remains policy-specific |
| Optional peer modules become accidental hard dependencies | Medium | Classify each dependency as runtime requirement, prerequisite or soft provider; add disabled-module tests | Deployment policy may intentionally require optional modules |

## Validation and Exit Criteria

Phase 1/Wave 0 is ready to approve the detailed discrete `production` specification only when the parent roadmap's fourteen gates have evidence. At a minimum, the evidence must demonstrate:

1. WMS operates without Sales and the optional WMS–Sales flow retains current behaviour.
2. A WMS-owned site and current warehouse-role assignments are available with tenant/org/site isolation, multiple warehouses per fixed role, and one default per configured role. Site custom fields round-trip through CrudForm/API/commands/undo; assignments reject custom fields; stable DataTable/CrudForm extension hosts exist without enabling unneeded search, filter, view, export, selection, or bulk controls.
3. Released definitions and orders preserve immutable, versioned site/warehouse snapshots even after administrators change the current WMS assignment; definition effectivity retains its own valid-time semantics.
4. Production WMS postings are semantic, idempotent, reversible, reconcilable, and safe under precision reference cases.
5. Facts and MES confirmation handling cover partial, duplicate, out-of-order, offline, rejected, reversed, and replayed messages.
6. Quality-aware availability excludes unavailable stock; WMS is the sole owner of committed physical stock.
7. Disabled optional modules degrade safely and all changed API/UI paths have self-contained integration coverage.
8. The separate P1.13 specification and implementation prove concurrency-safe site/type-scoped numbering before production orders, batches, lots, or serials allocate identifiers.
9. P1.3a proves one Catalog-owned exact-decimal policy before Manufacturing quantity schemas freeze. P1.3b–c remain visible WMS backlog and do not block Site, draft definitions, or other non-stock work, but must prove non-narrowing storage, immutable UoM evidence, and zero-drift reversal before P1.8/P1.11 stock-affecting production.

## Migration and Backward Compatibility

This document itself changes no contract. Implementations governed by it must follow `BACKWARD_COMPATIBILITY.md`.

The WMS–Sales work is especially contract-sensitive: current sales-order event IDs, routes, commands, ACLs, widgets, and integrations may not be removed or renamed in one release. If they move to an optional integration boundary, the implementation spec must define a deprecation period, compatibility bridge, upgrade notes, and regression coverage.

## Changelog

- 2026-08-13: Created Phase 1/Wave 0 execution plan from the approved Manufacturing roadmap, separating early manufacturing-definition draft work from WMS-dependent execution work.
- 2026-08-13: Assigned the minimal `Site` and current site-to-warehouse-role model to `wms`.
- 2026-08-13: Revision aligned P1.2 with current-only assignments, one default warehouse per configured role, and immutable consumer snapshots; scheduled/effective-dated assignments and site timezone are later features. Added P1.13 as the separate mandatory production-number-range gate before P1.10/P1.11 allocate identifiers.
- 2026-08-13: Refined the P1.2 UI baseline for infrequent setup: full canonical custom fields and field injection on `Site`, no custom fields on assignments, minimalist DataTables with stable extension hosts, and no built-in CRM-scale search/filter/view/export/bulk controls.
- 2026-08-13: Split P1.3 into Catalog/Sales exact normalization and two WMS-owned work items. P1.3a blocks quantity-schema freeze; P1.3b–c document the existing WMS mismatch as non-critical backlog for current/early work but remain mandatory before stock-affecting production.
