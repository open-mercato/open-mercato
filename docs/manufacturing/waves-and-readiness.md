# Manufacturing Waves and Readiness Dashboard

> A business-readable map of Manufacturing capabilities and a navigation dashboard for Wave 0 specification readiness.

**Last verified:** 2026-08-19
**Status:** Operational documentation dashboard. It is not a release schedule, implementation approval, delivery promise, or licensing commitment.

## How to read this document

- **MVP is the outcome of Wave 0**, not a separate wave.
- Wave 0 is governed by the accepted architecture gates and P1 workstreams.
- Waves 1–4 are a proposed business grouping of later capabilities already present in the product roadmap. The grouping is not yet a normative delivery order.
- The normative architecture source is the [Manufacturing product roadmap](../../.ai/specs/2026-08-13-production-module-architecture-roadmap.md). Detailed requirements belong to capability specifications, not this dashboard.
- Placement and licensing are decided separately for each capability. A row in this OSS repository does not promise that capability under any particular license.

## Business capability waves

| Wave | Business objective | Main capabilities | User outcome | Current standing |
|---|---|---|---|---|
| **MVP / Wave 0** | Run a safe, real discrete-production flow | WMS Sites and warehouse roles; exact quantities/UoM; versioned multi-level BOMs; simple sequential routings and Work Centers; production orders; issue, return, backflush, scrap, output receipt and reversal; explicit lot/serial input; status/expiry availability; facts, audit, API and bounded import/export | Define a product, release an order, consume material, receive output and reconstruct what happened | Formal first-core direction with Gate A/B/C readiness; implementation is unlocked per slice, not all at once |
| **Wave 1 — material planning** | Reduce manual planning and material shortages | MRP, netting, pegging, proposals, explicit reservation requests, automatic child orders, planning exceptions, advanced numbering and a basic traceability view | See what must be made, bought or transferred and detect shortages earlier | Proposed grouping; capabilities exist in the roadmap, but wave scope and placement are not approved |
| **Wave 2 — shop floor and optimization** | Improve throughput and reduce downtime | Finite scheduling, calendars, shop-floor execution, MES/data collection, scanning, edge/offline support, OEE, advanced genealogy, tooling and workforce constraints | Sequence work, capture trustworthy floor data and react to resource constraints | Proposed grouping; each capability requires its own specification and validation |
| **Wave 3 — quality, cost and enterprise operation** | Control risk, compliance and profitability at scale | QMS, sampling, SPC, NCR/CAPA, regulated traceability, costing/WIP/variance, finance integration, PLM/ECO, document control, multi-site operation and enterprise controls | Control quality, cost and compliance across a larger organization | Proposed grouping; no delivery or packaging decision is implied |
| **Wave 4 — specialist manufacturing models** | Support additional operating models and industries | Process/batch, recipes/formulas, campaigns, co-/by-products, potency, repetitive, remanufacturing, configure-to-order, project/ETO, additive and industry-specific extensions | Run production that cannot be represented safely by the first discrete model | Product candidates over the shared kernel; domain evidence is required before specification |
| **Later / research** | Explore evidence-backed advanced capabilities | Digital twins, predictive capabilities, AI-assisted optimization, machine control and other specialist models | Use simulation or decision support over trusted production data | Research only; no early product, safety, release or licensing claim |

## Readiness status vocabulary

| Status | Meaning |
|---|---|
| **Approved baseline** | The architecture decision is accepted and may govern downstream specifications; it is not itself an implementation deliverable |
| **Design complete — readiness review pending** | A dedicated specification exists and is internally coherent, but implementation must wait for the standard readiness review |
| **Ready for implementation** | A dedicated specification passed readiness review and all named prerequisites have accepted evidence |
| **Specification not authored** | Architecture direction may exist, but implementation-level data/API/UI/failure/testing contracts are missing |
| **Deferred — placement undecided** | The capability does not block the current slice and has no approved package/licensing placement |
| **Implemented — evidence linked** | Implementation and required validation evidence are complete and linked; moving a spec to `implemented/` still follows repository rules |

## Wave 0 specification-readiness matrix

`Decisions confirmed` means the architecture direction is accepted. `Implementation ready` is stricter: it requires a dedicated specification, readiness approval and satisfied prerequisites.

| ID | Capability | Dedicated specification | Decisions confirmed | Consistency status | Implementation ready | Missing evidence / next action |
|---|---|---|---|---|---|---|
| **P1.0** | Phase 1 boundaries, kernel and dependency semantics | [Architecture roadmap](../../.ai/specs/2026-08-13-production-module-architecture-roadmap.md) and [execution plan](../../.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) | Yes | Approved baseline; cross-document alignment checked | N/A — governance baseline | Keep every downstream spec aligned with C1–C3, H1–H6, M1–M4 and staged gates |
| **P1.1** | Decouple WMS from Sales for standalone packaging | None | Boundary accepted | Architecture direction is coherent; implementation contract is absent | **No** | Author compatibility, module metadata, events/subscribers, migration and disabled-module test specification; not a standard-composition MVP blocker |
| **P1.2** | WMS Site and current warehouse-role assignments | [WMS Sites and Warehouse Roles](../../.ai/specs/2026-08-13-wms-production-sites.md) | Yes | Design complete and aligned with roadmap | **No — readiness review pending** | Run readiness audit; confirm activation concurrency, migration, API/UI and integration evidence before implementation |
| **P1.3a** | Exact Catalog/Sales quantity normalization | [Catalog Quantity Normalization](../../.ai/specs/2026-08-13-catalog-quantity-normalization.md) | Yes | Design complete and aligned with BOM/yield arithmetic | **No — readiness review pending** | Run readiness audit and freeze the exact-decimal/UoM resolver before quantity-bearing Manufacturing contracts |
| **P1.3b** | WMS quantity precision, arithmetic and profile alignment | [WMS Quantity Precision and Profile Alignment](../../.ai/specs/2026-08-13-wms-quantity-precision-alignment.md) | Yes | Design complete; stock-gate dependency is explicit | **No — readiness review pending** | Audit real WMS data distribution and migration envelope; required before stock-affecting production |
| **P1.3c** | Immutable WMS quantity evidence and correlated reversal | [WMS Quantity Evidence and Correlated Reversal](../../.ai/specs/2026-08-13-wms-quantity-evidence-reversal.md) | Yes | Design complete; exact reversal direction is aligned | **No — readiness review pending** | Complete readiness audit after P1.3b; required before stock-affecting production |
| **P1.4** | Draft multi-level BOM authoring | None | Core BOM rules accepted | Architecture-level consistency checked | **No** | Author CRUD/API/UI/data-model spec using occurrence identity, cycle rejection, exact UoM, fixed/variable basis and yield; P1.3a precedes contract freeze |
| **P1.5** | Draft routing and operation authoring | None | Bounded scope accepted | Optional single-sequence direction is coherent | **No** | Author CRUD/API/UI/data-model spec for sequential operations, setup/run time, instructions and Work Center references |
| **P1.6** | Minimal Work Center/resource boundary | None | Ownership accepted | No duplicate resource/calendar master; calendars are non-blocking | **No** | Author the Work Center identity, applicability, snapshot, API and disabled-calendar behavior specification |
| **P1.7** | Released definitions and immutable snapshots | None | Lifecycle and selection rules accepted | Child selection, effectivity, overlap rejection and snapshots are coherent | **No** | Author release transaction, revision state, attachment reference, snapshot, error and concurrency contracts |
| **P1.8** | Production-capable WMS posting contract | None | Posting boundary accepted | Built-in atomic batch, idempotency, evidence, reversal and reconciliation are coherent | **No** | Author semantic commands/results for issue, return, backflush, scrap, receipt and reversal after P1.3a–c |
| **P1.9** | Minimum Manufacturing facts and confirmations | None | Minimum fact model accepted | Append-only facts plus normal current-state entities are coherent | **No** | Author fact schema, confirmation/correction command, correlation, timestamps, rejection and reconciliation behavior |
| **P1.10** | First discrete production-order lifecycle | None | Lifecycle accepted | `draft → released → in_progress → completed/cancelled`, `complete_short` and snapshot rules are coherent | **No** | Author aggregate/API/UI/ACL/state-transition spec after P1.2, P1.3a, P1.7 and P1.9 evidence |
| **P1.11** | Stock-affecting production execution | None | Execution rules accepted | Explicit issue, cumulative backflush, output, scrap, exact reversal and child hand-off are coherent | **No** | Author execution orchestration spec only after P1.3b–c, P1.8 and P1.10 contracts are ready |
| **P1.12** | Cross-cutting readiness and integration evidence | No standalone capability spec; applies to every epic | Yes | Required evidence categories are defined | Per epic | Maintain tenant/org/site isolation, optimistic-lock, disabled-module, partial-failure, idempotency, reversal and compatibility evidence with each implementation |
| **P1.13** | Advanced production number ranges | None | Deferral accepted | UUID/basic order number boundary is coherent | **No — deferred** | Specify formats, resets, generated lot/serial values, block reservation and offline allocation when selected; not an MVP gate |

## Current implementation-readiness summary

| Group | Current result |
|---|---|
| Architecture baseline | **Approved** |
| Dedicated specs with completed design | **P1.2 and P1.3a–c** |
| Dedicated specs fully ready for implementation | **None recorded yet — readiness reviews remain pending** |
| Architecture direction accepted but dedicated spec missing | **P1.1 and P1.4–P1.11** |
| Evidence maintained per epic | **P1.12** |
| Deliberately deferred, non-blocking capability | **P1.13** |

## Update protocol

Update this dashboard in the same change whenever any of the following occurs:

1. an architecture or scope decision is accepted, reversed or deferred;
2. a dedicated capability specification is created or materially changed;
3. a readiness review changes implementation status;
4. implementation starts, is blocked, or is completed;
5. validation evidence, an Issue or a Pull Request becomes available;
6. a capability moves between Wave 0 and a later proposed wave;
7. a later wave receives a normative scope or delivery-order decision.

Every status promotion must link its evidence. Do not mark a capability `Ready for implementation` merely because its architecture direction is accepted. Do not mark it `Implemented` without implementation and validation evidence. If this dashboard conflicts with a dedicated specification, correct the dashboard; if specifications conflict with the normative roadmap, resolve the architecture conflict explicitly rather than hiding it here.

## Source priority

1. [Manufacturing product roadmap](../../.ai/specs/2026-08-13-production-module-architecture-roadmap.md) — normative architecture and readiness gates.
2. Dedicated capability specification — implementation contract for that capability.
3. [Wave 0 execution plan](../../.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) — dependency-aware delivery grouping.
4. This dashboard and the [Manufacturing README](README.md) — navigation and operational status only.
