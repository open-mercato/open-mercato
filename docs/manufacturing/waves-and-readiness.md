# Manufacturing Waves and Readiness Dashboard

> A business-readable map of Manufacturing capabilities and a navigation dashboard for Wave 0 specification readiness.

**Last verified:** 2026-08-19
**Status:** Operational documentation dashboard. It is not a release schedule, implementation approval, delivery promise, or licensing commitment.

## How to read this document

- **MVP is the outcome of Wave 0**, not a separate wave.
- Wave 0 is governed by the architecture gates and P1 workstreams once the proposed roadmap is accepted through repository review.
- Waves 1–4 are a proposed business grouping of later capabilities already present in the product roadmap. The grouping is not yet a normative delivery order.
- The proposed normative architecture source is the [Manufacturing product roadmap](../../.ai/specs/2026-08-13-manufacturing-product-roadmap.md); it becomes governing after repository acceptance. Detailed requirements belong to capability specifications, not this dashboard.
- Placement and licensing are decided separately for each capability. A row in this OSS repository does not promise that capability under any particular license.

## Business capability waves

| Wave | Business objective | Main capabilities | User outcome | Current standing |
|---|---|---|---|---|
| **MVP / Wave 0** | Run a safe, real discrete-production flow | WMS Sites and warehouse roles; exact quantities/UoM; versioned multi-level BOMs; simple sequential routings and Work Centers; production orders; issue, return, backflush, scrap, output receipt and reversal; explicit lot/serial input; status/expiry availability; facts, audit, API and bounded import/export | Define a product, release an order, consume material, receive output and reconstruct what happened | Formal first-core direction with Gate A/B/C readiness; implementation is unlocked per slice, not all at once |
| **Wave 1 — material planning** | Reduce manual planning and material shortages | MRP, netting, pegging, proposals, explicit reservation requests, automatic child orders, planning exceptions, advanced numbering and a basic traceability view | See what must be made, bought or transferred and detect shortages earlier | Proposed grouping; capabilities exist in the roadmap, but wave scope and placement are not approved |
| **Wave 2 — shop floor and optimization** | Improve throughput and reduce downtime | Finite scheduling, calendars, shop-floor execution, MES/data collection, scanning, edge/offline support, OEE, advanced genealogy, tooling and workforce constraints | Sequence work, capture trustworthy floor data and react to resource constraints | Proposed grouping; each capability requires its own specification and validation |
| **Wave 3 — quality, cost and enterprise operation** | Control risk, compliance and profitability at scale | QMS, sampling, SPC, NCR/CAPA, regulated traceability, costing/WIP/variance, finance integration, PLM/ECO, document control, multi-site operation and enterprise controls | Control quality, cost and compliance across a larger organization | Proposed grouping; no delivery or packaging decision is implied |
| **Wave 4 — specialist manufacturing models** | Support additional operating models and industries | Process/batch, recipes/formulas, campaigns, co-/by-products, potency, repetitive, remanufacturing, configure-to-order, project/ETO, additive and industry-specific extensions | Run production that cannot be represented safely by the first discrete model | Product candidates over model-neutral Manufacturing contracts; module/package extraction requires real consumer evidence |
| **Later / research** | Explore evidence-backed advanced capabilities | Digital twins, predictive capabilities, AI-assisted optimization, machine control and other specialist models | Use simulation or decision support over trusted production data | Research only; no early product, safety, release or licensing claim |

## Readiness status vocabulary

| Status | Meaning |
|---|---|
| **Proposed baseline — review pending** | The architecture candidate is internally coherent but awaits maintainer/community acceptance; it does not authorize implementation |
| **Accepted baseline** | The architecture decision has repository-review evidence and may govern downstream specifications; it is not itself an implementation deliverable |
| **Design complete — readiness review pending** | A dedicated specification exists and is internally coherent, but implementation must wait for the standard readiness review |
| **Ready for implementation** | A dedicated specification passed readiness review and all named prerequisites have accepted evidence |
| **Specification not authored** | Architecture direction may exist, but implementation-level data/API/UI/failure/testing contracts are missing |
| **Deferred — placement undecided** | The capability does not block the current slice and has no approved package/licensing placement |
| **Implemented — evidence linked** | Implementation and required validation evidence are complete and linked; moving a spec to `implemented/` still follows repository rules |

## Wave 0 specification-readiness matrix

`Decision status` distinguishes a proposed direction from one accepted through repository review. `Implementation ready` is stricter: it requires an accepted architecture baseline, a dedicated specification, readiness approval and satisfied prerequisites. Specification/readiness work is tracked by parent [Issue #5386](https://github.com/open-mercato/open-mercato/issues/5386).

| ID | Capability | Dedicated specification | Decision status | Consistency status | Implementation ready | Missing evidence / next action |
|---|---|---|---|---|---|---|
| **P1.0** | Phase 1 boundaries, single `manufacturing` module, namespace and dependency semantics | [Architecture roadmap](../../.ai/specs/2026-08-13-manufacturing-product-roadmap.md) and [execution plan](../../.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) | Proposed | Proposed baseline; maintainer/community review pending; cross-document alignment checked | N/A — governance baseline | Accept or revise C1–C3, H1–H6, M1–M4, naming policy, generic WMS boundary and staged gates through repository review |
| **P1.0a** | `@open-mercato/manufacturing` package and one opt-in `manufacturing` module | [Full specification](../../.ai/specs/2026-08-19-manufacturing-package-module-bootstrap.md); [task #5387](https://github.com/open-mercato/open-mercato/issues/5387) | Package/module topology accepted by roadmap owner | Full metadata-only boundary specified; scope review **KEEP**; hard `catalog`, optional WMS/Resources/Planner, entrypoint-only exports | **No — baseline acceptance pending** | Accept the specification after the parent architecture baseline, then implement the bootstrap |
| **P1.1** | Decouple WMS from Sales through candidate `wms_sales` | [Spec task #5388](https://github.com/open-mercato/open-mercato/issues/5388) | Option B proposed; placement open in [#5260](https://github.com/open-mercato/open-mercato/issues/5260) | Optional integration ownership is coherent; implementation contract is absent | **No** | Decide #5260, then author compatibility, module metadata, events/subscribers, migration and disabled-module test specification; not a standard-composition MVP blocker |
| **P1.2** | WMS Site and current warehouse-role assignments | [WMS Sites and Warehouse Roles](../../.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md); [readiness #5389](https://github.com/open-mercato/open-mercato/issues/5389) | Design proposed | Design complete and aligned with roadmap | **No — baseline acceptance and readiness review pending** | Run readiness audit; confirm activation concurrency, migration, API/UI and integration evidence before implementation |
| **P1.3a** | Exact Catalog/Sales quantity normalization | [Catalog Quantity Normalization](../../.ai/specs/2026-08-13-catalog-quantity-normalization.md); [readiness #5390](https://github.com/open-mercato/open-mercato/issues/5390) | Design proposed | Design complete and aligned with BOM/yield arithmetic | **No — baseline acceptance and readiness review pending** | Run readiness audit and freeze the exact-decimal/UoM resolver before quantity-bearing Manufacturing contracts |
| **P1.3b** | WMS quantity precision, arithmetic and profile alignment | [WMS Quantity Precision and Profile Alignment](../../.ai/specs/2026-08-13-wms-quantity-precision-alignment.md); [audit #5391](https://github.com/open-mercato/open-mercato/issues/5391) | Design proposed | Design complete; stock-gate dependency is explicit | **No — baseline acceptance and readiness review pending** | Audit representative/schema-supported WMS data distribution and migration envelope; required before stock-affecting production |
| **P1.3c** | Immutable WMS quantity evidence and correlated reversal | [WMS Quantity Evidence and Correlated Reversal](../../.ai/specs/2026-08-13-wms-quantity-evidence-reversal.md); [readiness #5392](https://github.com/open-mercato/open-mercato/issues/5392) | Design proposed | Design complete; exact reversal direction is aligned | **No — baseline acceptance and readiness review pending** | Complete readiness audit after P1.3b; required before stock-affecting production |
| **P1.4a** | Direct-level BOM draft authoring and integrity | [Full specification](../../.ai/specs/2026-08-19-manufacturing-bom-drafts.md); [spec task #5393](https://github.com/open-mercato/open-mercato/issues/5393) | P1.4 split and authoring boundary accepted by roadmap owner | Full aggregate/data/CRUD/API/UI/command/undo/concurrency design; fresh-context review **PASS** | **No — baseline and P1.0a/P1.3a readiness pending** | Accept upstream gates, then implement the reviewed direct-level authoring/integrity contract |
| **P1.4b** | Bounded read-only multi-level BOM draft preview | [Full specification](../../.ai/specs/2026-08-19-manufacturing-bom-draft-preview.md); [spec task #5405](https://github.com/open-mercato/open-mercato/issues/5405) | P1.4 split and preview boundary accepted by roadmap owner | Full explosion/API/UI/isolation/limit design; fresh-context review **PASS** | **No — baseline and P1.0a/P1.3a/P1.4a readiness pending** | Accept upstream gates, then implement the reviewed occurrence-tree and bounded exact read contract |
| **P1.5** | Draft routing and operation authoring | [Spec task #5395](https://github.com/open-mercato/open-mercato/issues/5395) | Bounded scope proposed | Optional single-sequence direction is coherent | **No** | Author CRUD/API/UI/data-model spec for sequential operations, setup/run time, instructions and Work Center references after P1.6 |
| **P1.6** | Minimal Work Center/resource boundary | [Spec task #5394](https://github.com/open-mercato/open-mercato/issues/5394) | Ownership proposed | No duplicate resource/calendar master; calendars are non-blocking | **No** | Author the Work Center identity, applicability, snapshot, API and disabled-calendar behavior specification |
| **P1.7** | Released definitions and immutable definition snapshots | [Spec task #5396](https://github.com/open-mercato/open-mercato/issues/5396) | Lifecycle and child selection proposed | Definition-only boundary is cohesive; order release moved to P1.10 | **No** | Author release transaction, revision state, attachment reference, immutable definition snapshot, error and concurrency contracts after P1.2/P1.3a/P1.4a/P1.5/P1.6; P1.4b is not a release prerequisite |
| **P1.8a** | Generic atomic WMS posting groups | [Spec task #5397](https://github.com/open-mercato/open-mercato/issues/5397) | Direction proposed | Consumer-neutral physical ownership, atomicity, idempotency, opaque references, reversal and reconciliation are coherent | **No** | Audit/benchmark WMS, then author the generic command/result, registration and historical-fallback contracts after P1.3a–c |
| **P1.8b** | Manufacturing inventory posting adapter | [Spec task #5398](https://github.com/open-mercato/open-mercato/issues/5398) | Direction proposed | Manufacturing owns semantic derivation; WMS remains unaware of Manufacturing vocabulary | **No** | Author the adapter after P1.8a, P1.9 and P1.10 contracts are ready |
| **P1.9** | Minimum Manufacturing fact ledger | [Spec task #5399](https://github.com/open-mercato/open-mercato/issues/5399) | Minimum fact model proposed | Append-only model-neutral fact boundary is cohesive; discrete confirmation orchestration moved to P1.10 | **No** | Author fact schema, acceptance/correction/idempotency primitives, timestamps and opaque evidence references after P1.0a |
| **P1.10** | First discrete production-order lifecycle, execution snapshot and basic confirmations | [Spec task #5400](https://github.com/open-mercato/open-mercato/issues/5400) | Lifecycle proposed | `draft → released → in_progress → completed/cancelled`, `complete_short`, snapshot and stock-free confirmation rules are coherent | **No** | Author aggregate/API/UI/ACL/state-transition/confirmation spec after P1.2, P1.3a, P1.7 and P1.9 evidence |
| **P1.11** | Stock-affecting production execution | [Spec task #5401](https://github.com/open-mercato/open-mercato/issues/5401) | Execution rules proposed | Explicit issue, cumulative backflush, output, scrap, exact reversal and child hand-off are coherent | **No** | Author execution orchestration only after P1.3b–c, P1.8a–b, P1.9 and P1.10 contracts are ready |
| **P1.12** | Cross-cutting readiness and integration evidence | No standalone capability spec; applies to every epic | Evidence policy proposed | Required evidence categories are defined | Per epic after baseline acceptance | Maintain tenant/org/site isolation, optimistic-lock, disabled-module, partial-failure, idempotency, reversal and compatibility evidence with each implementation |
| **P1.13** | Advanced production number ranges | None | Deferral proposed | UUID/basic order number boundary is coherent | **No — deferred** | Accept the baseline; specify formats, resets, generated lot/serial values, block reservation and offline allocation when selected; not an MVP gate |

## Current implementation-readiness summary

| Group | Current result |
|---|---|
| Architecture baseline | **Proposed — maintainer/community review pending** |
| Dedicated specs with completed design | **P1.2, P1.3a–c, P1.4a and P1.4b** |
| Dedicated specs fully ready for implementation | **None recorded yet — readiness reviews remain pending** |
| Architecture direction proposed but dedicated full spec missing | **P1.1 and P1.5–P1.11; all have trackers** |
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

Every status promotion must link its evidence. Do not mark a capability `Ready for implementation` merely because its architecture direction is accepted. Do not mark it `Implemented` without implementation and validation evidence. If this dashboard conflicts with a dedicated specification, correct the dashboard; if specifications conflict with the accepted normative roadmap, resolve the architecture conflict explicitly rather than hiding it here.

## Source priority

1. [Manufacturing product roadmap](../../.ai/specs/2026-08-13-manufacturing-product-roadmap.md) — proposed normative architecture and readiness gates; governing after repository acceptance.
2. [Wave 0 specification backlog](../../.ai/specs/2026-08-19-manufacturing-wave-0-specification-backlog.md) — owner-approved work-item decomposition, readiness definitions and tracker map.
3. Dedicated capability specification — implementation contract for that capability.
4. [Wave 0 execution plan](../../.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) — dependency-aware delivery grouping.
5. This dashboard and the [Manufacturing README](README.md) — navigation and operational status only.
