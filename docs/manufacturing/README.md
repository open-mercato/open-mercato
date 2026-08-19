# Manufacturing — work overview and dependency map

> A single operational view of the Manufacturing programme. It links the product roadmap, delivery workstreams, capability specifications, and the relevant GitHub Issues and Pull Requests.

**Last reviewed:** 2026-08-19
**Programme status:** The product roadmap is an internally coherent proposal under maintainer and community review. It does not approve implementation. After acceptance, each slice may proceed only through a dedicated ready specification and its named safety gates.

## How to use this document

- The roadmap defines **where the product is going** and its architectural boundaries.
- The waves/readiness dashboard gives a **business-readable capability map** and records which Wave 0 slices have implementation-ready specifications.
- The execution plan defines **the dependency-aware delivery order**.
- A capability specification defines **what a specific workstream must deliver**.
- GitHub Issues and PRs show **tracked work and its current state**.
- The **Next step** column is the operational entry point: it states what should happen next for each workstream.

## Direction in one sentence

First establish safe foundations: plant identity, warehouse-role rules, exact quantity and unit handling, versioned manufacturing definitions, and a WMS posting contract. Only then build an executable production-order lifecycle.

Manufacturing owns production intent, semantic commands, derived posting lines, and production history. WMS remains the owner of physical stock, reservations, lots, serials, and inventory movements through a generic atomic posting-group contract. `manufacturing_discrete` must not create a competing inventory ledger, and WMS must not interpret Manufacturing definitions or calculate backflush.

## Current work overview

| ID | Workstream | Status | Can start now? | Dependencies | Next step |
|---|---|---|---|---|---|
| P1.0 | Freeze Phase 1 boundaries and dependency semantics | Proposed architectural baseline; review pending | Specification/refinement only | Parent roadmap | Obtain maintainer/community acceptance and keep downstream specifications aligned with the accepted roadmap laws |
| P1.1 | Decouple WMS from Sales through candidate `wms_sales` | Option B proposed; specification not authored | Yes, as specification work; packaging gate, not first-MVP blocker | Backward-compatibility plan | Author the optional integration, compatibility bridge and disabled-module contract; preserve current Sales behavior |
| P1.2 | Establish the minimal WMS Site and current warehouse-role model | Design complete — baseline acceptance and readiness review pending | Readiness review after baseline acceptance; implementation after pass | Tenant and organisation scope invariants | Accept the baseline, run readiness review, then implement inactive-by-default Sites and safe warehouse-role activation rules |
| P1.3a | Establish exact Catalog/Sales quantity normalisation | Design complete — baseline acceptance and readiness review pending | Readiness review after baseline acceptance; implementation after pass | Current Catalog UoM contract | Accept the baseline, finalise the resolver contract and compatibility coverage before quantity-bearing Manufacturing contracts freeze |
| P1.3b | Align WMS quantity precision, arithmetic, and profile UoM | Design complete — baseline acceptance and readiness review pending; non-critical WMS backlog | Data audit/spec refinement now; implementation after P1.3a readiness | P1.3a | Measure production data shape, choose the precision envelope, and ship an additive migration before stock execution |
| P1.3c | Add immutable WMS quantity evidence and correlated reversal | Design complete — baseline acceptance and readiness review pending | Spec refinement after P1.3b; implementation after readiness | P1.3a–P1.3b | Implement quantity snapshots and exact, correlated reversal before stock execution |
| P1.4 | Author draft multi-level BOMs | Planned | After roadmap acceptance and a dedicated ready spec | Catalog references; P1.3a before stable quantity contracts | Author the implementation-level data/API/UI specification for editable recursive drafts with distinct occurrences; release remains gated |
| P1.5 | Author draft routings and operations | Planned | After roadmap acceptance and a dedicated ready spec | Existing resource references; P1.6 before the stable release contract | Author the implementation-level specification for an optional single-sequence routing draft without scheduling semantics |
| P1.6 | Establish the work-centre extension boundary | Planned | Specification work pending baseline acceptance | P1.0 | Finalise resource and calendar ownership |
| P1.7 | Define the released-definition lifecycle and immutable snapshots | Planned | Specification work pending baseline acceptance | P1.2, P1.3a, P1.6 | Freeze multi-level child revisions at definition release and create the execution snapshot at order release |
| P1.8 | Define the generic WMS posting group and Manufacturing adapter | Planned; critical stock gate | Specification/benchmark work pending baseline acceptance | P1.2, P1.3a–P1.3c | Specify generic atomic physical lines and opaque source/reason references; `manufacturing_discrete` derives issue, return, backflush, output, scrap, and reversal semantics |
| P1.9 | Define minimum Manufacturing facts and confirmations | Planned; spike possible | Specification or explicitly non-shippable spike pending baseline acceptance | P1.0; stock correlation needs P1.8 | Define an append-only fact table and a basic idempotent UI/API confirmation command |
| P1.10 | Add the first discrete production-order lifecycle | Blocked as a shippable feature | No | P1.2, P1.3a, P1.7, P1.9 | Ship draft → released → in-progress → completed/cancelled without depending on advanced numbering or planning |
| P1.11 | Add stock-affecting production execution | Blocked | No | P1.3b–P1.3c, P1.8–P1.10 | Do not begin implementation before exact WMS posting/reversal is proven safe |
| P1.12 | Cross-cutting readiness and integration coverage | Ongoing with each epic | Yes | Respective implementation | Add isolation, conflict, reversal, partial-failure, compatibility, and disabled-module coverage |
| P1.13 | Add advanced production number ranges | Not authored; future necessary capability | Later; not an MVP gate | Basic production identities plus site/type requirements | Specify configurable order/batch/lot/serial formats, resets, block reservation, and offline allocation |

## Delivery sequence

```text
Parallel foundation work
  P1.1 WMS–Sales decoupling (parallel packaging work; not a first-MVP gate)
  P1.2 WMS Site
  P1.3a Catalog/Sales quantity normalisation → P1.3b precision → P1.3c evidence/reversal
  P1.4 real draft BOM CRUD with occurrence identity, P1.5 optional sequential routing drafts, P1.6 work-centre boundary

Foundation contracts
  P1.2 + P1.3a + P1.6 → P1.7 released definitions and snapshots
  P1.2 + P1.3a + P1.3b + P1.3c → P1.8 generic WMS posting group + Manufacturing adapter
  P1.0 → P1.9 Manufacturing facts / ERP–MES confirmations; P1.8 supplies stock correlation before Gate C

First shippable production flow
  P1.2 + P1.3a + P1.7 + P1.9 → P1.10 production-order lifecycle
  P1.3b + P1.3c + P1.8 + P1.10 → P1.11 stock-affecting execution

Later capability
  P1.13 configurable order/batch/lot/serial number ranges and offline allocation
```

The first safe increment after roadmap acceptance is parallel specification/readiness work on P1.1, P1.2, P1.3a, draft multi-level BOM/routing authoring, and the work-centre boundary. P1.10 and P1.11 are not implementation work to start now.

## Mandatory BOM rules

- A BOM is a multi-level, acyclic occurrence tree. A component may be a raw material or an assembly with its own applicable BOM.
- The same product or variant may appear more than once in one BOM. Each use is a separate BOM line with its own stable identity and position; it must remain distinct through release, explosion, UI, execution snapshots, and posting correlation.
- For example, two separate five-unit rolls of the same material remain two lines even though a planning view may derive a total demand of ten units.
- Aggregation is a derived planning/reporting view only. It must never replace occurrence-level master data or execution data.
- Direct and indirect BOM cycles are invalid and must be rejected before release and again before production-order creation.
- A subassembly may be fulfilled from stock or through a manually linked child production order. Automatic child-order creation is a later planning capability.
- Releasing a parent definition resolves one applicable child revision at every assembly node by output item/variant, site, and the definition's business-effective date. Missing or overlapping applicability fails closed; later child changes do not reinterpret the released parent.
- Releasing a production order selects one top-level released definition by item/variant, site, and `plannedStartDate`, then freezes its execution snapshot. Draft orders remain editable and have no stock effects.
- Every BOM has a base output quantity/UoM. Every component line has an exact quantity/UoM, `variable` or `fixed` consumption basis, and `yieldFactor` in `(0, 1]`, defaulting to `1`. Gross requirement is nominal requirement divided by yield.
- `fixed` is planned once per production order and BOM occurrence. It may be issued partially; the first qualifying backflush posts the remainder, and reversal reopens the exact reversed amount. `variable` backflush uses a cumulative `good + scrap` execution basis and posts only the exact delta from already posted net consumption, avoiding partial-confirmation drift.
- Reversal copies and negates the exact persisted posting; it never recalculates from current definitions or Catalog policy.
- Alternatives, substitutes, phantom flattening, and unit/serial effectivity are not first-core behaviour. They require their own specifications and must extend, rather than replace, the occurrence-preserving model.

## First-core simplifications

- Routing is optional and, when present, is one sequential path with basic setup/run time and work-centre/resource references. Calendars, parallel/alternate routings, overlap, setup matrices, and finite scheduling are later capabilities.
- The first WMS implementation uses a generic atomic posting-group command. `manufacturing_discrete` calculates the concrete physical lines, including cumulative backflush; WMS validates and records them without Manufacturing-specific enums. Durable saga support is reserved for external WMS providers.
- Production orders use UUID identity plus a simple concurrency-safe site-scoped display number. Lot/serial values may be supplied explicitly and are validated by WMS. Advanced number ranges remain P1.13.
- Basic WMS status/expiry rules own availability; full QMS and an external disposition provider are not required.
- Order release creates no automatic stock reservation. An explicit optional WMS reservation may be requested; issue and backflush still recheck availability.
- Manual confirmations support partial/final good quantity, scrap, timestamps, correlation, idempotency, and explicit correction/reversal. Offline buffering, out-of-order windows, device sequencing, and replay retention policy are later MES/edge work.
- Manually linked child orders use receive-to-stock followed by explicit parent issue. Direct issue and automatic child-order creation are later capabilities.
- Normal completion requires cumulative `good + scrap` to reach planned quantity. Overproduction is rejected; `complete_short` closes the remaining quantity with a required reason.
- No MRP/demand-signal contract, full bitemporal query engine, mandatory costing valuation context, advanced quality provider, or automatic lot/serial numbering blocks the first production flow.
- Initial UI and ACL stay narrow: list/detail, create/edit, release, confirm, reverse, with view/manage/execute/reverse permissions; no bulk actions, saved views, advanced analytics, approvals, or segregation-of-duties engine.
- Manufacturing starts without list/read caching. Basic bounded BOM/routing import/export and production-order/fact export may run synchronously; advanced mappings, connectors, and queued migration remain later capabilities.
- Custom fields remain on Site for this slice. BOM/order custom fields and full document control are later; the first core may retain basic instructions and immutable attachment references in release snapshots.

## Research benchmark policy

Any contract-shaping Manufacturing, BOM, planning, execution, inventory, or traceability analysis must compare the relevant behaviour across leading ERP products before it recommends an ownership, lifecycle, data-model, effectivity, posting, or public-contract decision. Routine CRUD, UI, ACL, and implementation-detail work may rely on an already accepted architecture decision without repeating the full benchmark. Do not generalise an architecture rule from one vendor or one implementation.

The baseline set for major contract-shaping decisions is the current official documentation for SAP S/4HANA, Oracle Fusion Cloud SCM, IFS Cloud, Microsoft Dynamics 365 Supply Chain Management, and Infor CloudSuite Industrial. A capability-specific analysis may use a smaller relevant subset only when it records why the omitted products do not materially inform the decision. Include other widely used ERP/MES products when they cover an operating model absent from the baseline.

The analysis must record:

1. the official source for each product examined;
2. shared patterns and material differences;
3. which behaviour Open Mercato will adopt, defer, or deliberately reject; and
4. the rationale, including compatibility, operational, and data-model consequences.

If an official source is unavailable or a product does not document the relevant behaviour, record that gap explicitly. A single-vendor example is useful evidence, but never sufficient by itself to establish a Manufacturing architecture rule.

## GitHub links

| Item | Type | State | Role |
|---|---|---|---|
| [#5255 — Manufacturing domain and module architecture](https://github.com/open-mercato/open-mercato/issues/5255) | Issue | Open | Product and architecture discussion |
| [#5256 — docs(manufacturing): add product roadmap](https://github.com/open-mercato/open-mercato/pull/5256) | Pull Request | Open | PR containing the Manufacturing roadmap documentation |
| [#5260 — decouple WMS from Sales](https://github.com/open-mercato/open-mercato/issues/5260) | Issue | Open | Tracker for P1.1 |

The reviewed Manufacturing specifications do not currently link dedicated Issues or PRs for P1.2, P1.3a–P1.3c, P1.7–P1.9, or P1.13. Until a tracker exists, use the relevant specification as the source of detail; do not invent or hard-code tracker numbers.

## Source documents

| Document | Role |
|---|---|
| [`2026-08-13-manufacturing-product-roadmap.md`](../../.ai/specs/2026-08-13-manufacturing-product-roadmap.md) | Proposed normative product roadmap, ownership model, architecture laws, and readiness gates; governing after repository acceptance |
| [`waves-and-readiness.md`](waves-and-readiness.md) | Business capability waves and the evidence-linked Wave 0 specification-readiness dashboard |
| [`2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`](../../.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) | Workstream order and dependencies |
| [`2026-08-13-wms-sites-and-warehouse-roles.md`](../../.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md) | P1.2 capability specification |
| [`2026-08-13-catalog-quantity-normalization.md`](../../.ai/specs/2026-08-13-catalog-quantity-normalization.md) | P1.3a capability specification |
| [`2026-08-13-wms-quantity-precision-alignment.md`](../../.ai/specs/2026-08-13-wms-quantity-precision-alignment.md) | P1.3b capability specification |
| [`2026-08-13-wms-quantity-evidence-reversal.md`](../../.ai/specs/2026-08-13-wms-quantity-evidence-reversal.md) | P1.3c capability specification |
| [`wms-roadmap-and-estimates-en.md`](../wms/wms-roadmap-and-estimates-en.md) | Broader WMS context; not the authoritative Manufacturing delivery plan |

## Maintenance rules

After any change in direction or delivery status:

1. Update the workstream status and **Next step** in this table.
2. Add or update an Issue/PR link once a tracker exists.
3. Keep technical detail in the relevant capability specification, not in this overview.
4. If a dependency changes, update both this sequence and the execution plan.
5. Do not mark P1.10 or P1.11 as in progress until their named minimum safety dependencies have accepted evidence; deferred planning, enterprise, and packaging work is not an implicit blocker.
6. Update `waves-and-readiness.md` whenever a decision, specification, readiness review, implementation state, tracker, or validation evidence changes. Every promotion to `Ready for implementation` or `Implemented` must link its evidence.

This file is an operational index. It does not replace the roadmap or the capability specifications.
