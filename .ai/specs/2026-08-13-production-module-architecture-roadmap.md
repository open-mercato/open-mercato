# Manufacturing Product Roadmap and Capability Architecture

## TLDR

This document is the long-term product roadmap and architecture map for Open Mercato Manufacturing. It defines capability boundaries, ownership, dependency direction, and readiness gates. It is not a release calendar, delivery commitment, or detailed implementation specification.

Manufacturing readiness is staged. Draft BOM/routing CRUD may proceed before stock execution exists. Releasing an executable order requires the minimal site, exact quantity, work-centre, released-definition, and append-only fact contracts. Stock-affecting execution additionally requires exact WMS precision/evidence and an atomic production-posting contract. Planning, advanced numbering, full QMS/MES, costing, and enterprise packaging are not first-MVP blockers.

Production material issues, returns, and finished- or intermediate-goods receipts belong to the Manufacturing business process. Manufacturing owns their intent, semantics, authorization, order/operation correlation, idempotency, ordering, reversals, and reconciliation. WMS remains the authoritative owner of physical inventory, lots, serials, reservations, balances, and movements, and executes the atomic stock postings requested through its contracts. Manufacturing therefore uses WMS mechanisms; WMS does not own the production workflow.

## Executive Summary for Business Stakeholders

Open Mercato Manufacturing is a long-term product direction for organizations that need to plan, execute, and improve production while keeping inventory, quality, planning, and shop-floor data consistent. It starts with a complete, reliable discrete-manufacturing flow and can grow into process, batch, repetitive, project, subcontract, and remanufacturing models without forcing every customer into the same operating model.

The first product objective is not to deliver every manufacturing capability at once. It is to establish the foundations that make later capabilities safe and composable: a clear plant identity, reliable material issue and receipt flows, controlled production definitions, trusted production history, and a consistent view of stock that is available for production.

The roadmap deliberately keeps responsibilities clear. Manufacturing owns production decisions and the history of work performed. Warehouse Management owns the physical inventory and stock movements. Quality, planning, maintenance, costing, and shop-floor systems can add their specialist capabilities through controlled integrations. This avoids duplicate records, conflicting decisions, and costly rework as customers adopt more advanced capabilities.

Before stock-affecting execution is approved, the minimum foundations must prove that postings are exact, atomic, idempotent, reversible, scoped, and reconcilable; stock cannot be consumed twice; and accepted confirmations retain an auditable history. Advanced shop-floor/offline behaviour remains a later MES/edge contract. These are readiness conditions, not delivery dates or commercial commitments.

After Wave 0, capabilities such as material planning, finite scheduling, quality management, traceability, costing, shop-floor execution, and specialist manufacturing models may be specified and prioritized independently based on customer evidence, product fit, and the required operating model. This lets Open Mercato offer value incrementally without turning the first manufacturing release into an inflexible monolith.

## Purpose and Document Status

**Status:** Approved product roadmap. Draft definition authoring may proceed; executable order release and stock-affecting execution remain gated by their named minimum dependencies.

The roadmap describes the complete manufacturing capability landscape Open Mercato may grow into and the architectural constraints that keep those capabilities composable. Positions in the dependency map mean "requires this contract or trusted data first", never "will be delivered next".

Each capability that becomes a product candidate requires its own implementation spec, readiness review, package/licensing decision, and self-contained integration coverage. This roadmap governs those later specs but does not pre-approve their scope, package placement, or implementation.

This roadmap is the source of truth for product boundaries and records its binding architectural decisions directly. Historical review notes that were not committed to the repository are not normative dependencies.

### Document set and decision provenance

The roadmap is intentionally self-contained. Supporting documents refine delivery or implementation detail but do not redefine the ownership and dependency rules stated here.

| Document | Role | Status in this roadmap |
|---|---|---|
| This roadmap | Product boundaries, architecture laws, capability landscape, and Wave 0 gates | Normative source of truth |
| [`2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`](2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) | Delivery-oriented grouping and dependency order for Wave 0 work | Execution companion |
| [`2026-08-13-wms-production-sites.md`](2026-08-13-wms-production-sites.md) | P1.2 WMS-owned site identity and warehouse-role assignments | Capability specification |
| [`2026-08-13-catalog-quantity-normalization.md`](2026-08-13-catalog-quantity-normalization.md) | P1.3a Catalog quantity normalization | Capability specification |
| [`2026-08-13-wms-quantity-precision-alignment.md`](2026-08-13-wms-quantity-precision-alignment.md) | P1.3b WMS precision and profile alignment | Capability specification |
| [`2026-08-13-wms-quantity-evidence-reversal.md`](2026-08-13-wms-quantity-evidence-reversal.md) | P1.3c immutable quantity evidence and correlated reversal | Capability specification |
| Dedicated advanced production number-range specification | Configurable order/batch/lot/serial formats, reset and offline allocation | Future necessary capability; not an MVP gate; not yet authored |

Decisions C1-C3, H1-H6, M1-M4, and S1-S3 below consolidate the architectural review outcome into this source-of-truth document. Their rationale is preserved by the surrounding architecture laws, kernel boundaries, ownership matrix, risks, and validation gates; no unavailable review file is required to interpret or approve a downstream specification.

## Product Thesis

Open Mercato Manufacturing begins with a complete discrete-manufacturing flow and grows through independent, optional capabilities. The product must support medium, large, and enterprise organizations without turning the first core into a monolith.

The platform is discrete-first, but not discrete-only. Discrete, process/batch, repetitive, configure-to-order, engineer-to-order, project, subcontract, remanufacturing, and hybrid manufacturing are sibling models composed over a small shared manufacturing kernel. A specialist model must not inherit an aggregate whose semantics do not fit it.

## Scope and Non-Goals

This roadmap covers product architecture, capability ownership, dependencies, degradation behavior, compatibility rules, risks, and readiness gates.

It does not define final entities, endpoints, UI, event payloads, migration SQL, release dates, staffing, commercial packaging, or implementation estimates. Those belong to capability-specific specs after Wave 0.

The initial discrete core must not absorb MRP, finite scheduling, MES, QMS, costing, process recipes, subcontracting, client-specific substitution rules, full PLM/CAD, finance posting, HR, or generic document management.

## Problem Statement

The previous map described the right enterprise capabilities but left foundational ownership and dependency questions unresolved. A detailed core spec written against it could make a warehouse the permanent plant identity, duplicate resource/calendar masters, lose non-reconstructable facts, couple production to Sales through WMS, or create cycles between execution, traceability, quality, assets, and scheduling.

The most important ambiguity concerned inventory operations generated by production. Treating issue and receipt as WMS-owned workflows would place production authorization and lifecycle rules in the physical-stock domain. Treating their stock effects as Manufacturing-owned balances would duplicate the WMS ledger. The roadmap needs one explicit orchestration boundary that preserves both domains.

## Proposed Solution

Establish a small manufacturing kernel and stage readiness per slice. Draft discrete definitions may be implemented before execution contracts. Released orders and stock effects unlock only after their named minimum safety gates. Keep discrete and process models as siblings, place authoritative concepts in existing shared domains, capture immutable Manufacturing facts, and classify every inter-module relationship explicitly.

For production inventory transactions, Manufacturing owns the business command and WMS owns its physical execution. The integration is semantic, atomic or durably compensatable, idempotent, reversible, tenant/organization/site scoped, and reconcilable. This boundary is a roadmap law for all later discrete, process, repetitive, subcontracting, and remanufacturing specs.

## Architecture Laws

- `catalog` owns product and variant identity and the unit-of-measure master.
- A minimal WMS-owned site/plant identity and current site-to-warehouse role assignments exist before released manufacturing definitions or orders. A warehouse is not a permanent substitute for a plant, and every released record snapshots the concrete assignment it used.
- `wms` owns physical inventory, lots, serials, reservations, balances, locations, movements, and the physical inventory ledger.
- Manufacturing owns manufacturing definitions, order and operation intent, manufacturing confirmations, and manufacturing-specific history.
- Production issues, returns, and receipts are Manufacturing use cases executed through semantic WMS commands. Generic `manual` or `adjust` movements must not represent normal production postings.
- Shared `resources` owns reusable resource identity and base capacity; `planner` owns reusable calendars and availability rules. Manufacturing adds minimal work centres and routing constraints through IDs, never duplicate masters. Calendars and finite-capacity checks are not required for a manual first-core order.
- Every manufacturing definition used for execution is released atomically and versioned. Child BOM revisions are selected and frozen when the parent definition is released. A draft order becomes executable only when release selects the top-level definition by item/variant, site, and `plannedStartDate` and freezes the execution snapshot.
- The core captures non-reconstructable append-only facts from day one. Optional traceability, quality, costing, and intelligence modules derive advanced decisions, valuations, graphs, and read models from those facts.
- Cross-module data uses FK IDs plus snapshots where historical interpretation must survive module absence or later master-data changes. No direct ORM relationships cross module boundaries.
- Optional consumers own integration glue and degrade gracefully when peers are absent. A product dependency is not automatically a runtime `ModuleInfo.requires` dependency.
- All scoped records and operations validate `tenantId`, `organizationId`, and, where applicable, `siteId`; cross-scope links and postings fail closed.
- Commands, events, workers, optimistic locking, mutation guards, cache, queue, and progress use canonical Open Mercato mechanisms.
- Foundation configuration UI uses canonical `CrudForm`/`DataTable` extension hosts but enables only controls justified by workflow frequency. Setup-once tables do not inherit CRM-scale search, filters, perspectives, exports, or bulk actions by default.
- The first Manufacturing UI is limited to list/detail, create/edit, release, confirm, and reverse flows. Bulk actions, saved views, advanced analytics, approval workflows, and segregation-of-duties policy are later capabilities; MVP ACL is bounded to view, manage, execute, and reverse.
- Manufacturing list/read caching is omitted initially. Bounded import/export may run synchronously with explicit limits; cache invalidation, queued bulk migration, and progress UI are introduced only with measured need.
- Tenant-defined custom fields are supported on WMS Site in the first foundation. Manufacturing BOM/order custom fields are a later extension, not a draft/release gate.
- Basic instructions and attachment references may be frozen into a released snapshot. Controlled document packages, approval/signature semantics, and full document-control lifecycle remain separate capabilities.
- Public contracts follow `BACKWARD_COMPATIBILITY.md`; additive changes must also be operationally backward compatible.
- The manufacturing kernel is a standalone package; every specialist model depends on the kernel, never on discrete `production`.
- `wms` owns the basic status/expiry-aware availability projection; no other module recomputes availability. A future optional quality disposition provider may refine that projection without becoming an MVP requirement.
- Production orders use UUID identity plus a simple concurrency-safe, site-scoped display number owned by `production`. Output lot/serial values may be supplied explicitly and WMS validates their identity and uniqueness. Configurable formats, reset policies, generated batch/lot/serial numbers, block reservation, and offline allocation belong to later P1.13.
- Physical stock commitment lives only in WMS reservations/allocations. Release does not reserve automatically; an explicit optional reservation command may convert planning intent into a WMS reservation, and issue/backflush always rechecks eligibility.
- Released definitions carry date-based `validFrom`/`validTo` effectivity. Every fact carries UTC `recordedAt` and `occurredAt`; external sources may additionally supply their timestamp/timezone. Full bitemporal correction and general "as-of" analytics are later capabilities.
- Manufacturing facts are domain events persisted in a dedicated append-only table owned by the module; current operational state remains in normal order/operation entities. The platform event bus is transport, not the system of record, and full aggregate event sourcing is not required.
- Client-specific data, terminology, rules, metrics, and integrations remain outside this OSS product roadmap until validated as generic product capabilities.

## Wave 0 Contract Decisions

The following decisions resolve thirteen contract-shaping questions and three governance notes. They are binding on the relevant readiness slice and all later capability specs.

| # | Decision | Binding rule |
|---|---|---|
| C1 | Kernel is its own package | The manufacturing kernel ships as a standalone `manufacturing` package, not inside `production`. Discrete `production`, `production_process`, `production_repetitive`, and `production_remanufacturing` each depend on `manufacturing`, never on each other or on discrete `production`. |
| C2 | WMS owns the availability projection | WMS computes and serves basic status/expiry-aware availability. No other module recomputes it. A future optional disposition provider may refine the result; present-but-unreachable fails closed, while absence preserves the basic WMS result. |
| C3 | Basic identity first; advanced number ranges later | UUID is canonical identity. `production` provides a simple concurrency-safe site-scoped order display number. Lot/serial values may be supplied explicitly and WMS validates uniqueness. P1.13 later adds configurable order/batch/lot/serial formats, resets, generated values, block reservation, and offline allocation without blocking the MVP. |
| H1 | Backflush is a first-class posting mode | The WMS posting contract supports explicit issue AND backflush (issue-on-completion derived from the released definition), with a defined backflush point per operation, symmetric reversal, and precision cases. |
| H2 | Multi-level BOMs and manual order links are mandatory | The first discrete core supports a multi-level BOM tree. A subassembly may be stock-supplied or produced by a manually linked child order. The MVP hand-off is receive-to-stock followed by explicit parent issue. Direct issue and automatic child-order creation remain later capabilities. |
| H3 | Demand signal belongs to planning | A provider-neutral demand contract is a prerequisite of future `production_planning`, not the first production flow. Manual/API-created orders work without it. When planning ships, it must run on manual independent plus released-order dependent demand without requiring Sales/forecast providers. |
| H4 | Facts use a dedicated append-only table | Manufacturing facts are domain events stored in the module's append-only fact table. Normal entities store current operational state. Correlation/causation IDs align with the event-bus envelope; the bus is transport, the fact table is historical truth, and no full event-sourcing framework is required. |
| H5 | BOM lines are distinct component occurrences | A BOM line is an occurrence, not a unique product reference. The same product or variant may appear on multiple lines in one BOM, including with identical quantity/UoM, and each occurrence retains its own stable line identity, position, role/operation context when applicable, and execution-snapshot path. Definitions and explosions must not silently merge or deduplicate occurrences; planning may offer an aggregate view derived from them. |
| H6 | BOM applicability and consumption are deterministic | Each released BOM revision records output item/variant, base output quantity/UoM, site scope, and effectivity. Each occurrence records exact quantity/UoM, `variable` or `fixed` basis, and `yieldFactor` in `(0, 1]`. Gross requirement is nominal divided by yield. `fixed` applies once per order/occurrence; `variable` backflush is a cumulative `good + scrap` target minus already posted net consumption. Missing or overlapping applicability fails closed. Alternatives, substitutes, phantom explosion, and unit/serial effectivity are later capabilities. |
| M1 | Minimal temporal model | Released definitions have date-based `validFrom`/`validTo`. Facts have UTC `recordedAt` and `occurredAt`; external source timestamp/timezone is optional. Full bitemporal queries, retroactive correction policy, and clock-skew handling are later MES/reporting work. |
| M2 | WMS is the single source of committed stock | Physical commitment lives only in WMS reservations/allocations. Release creates no automatic reservation; a planning peg may later request an explicit optional WMS reservation. No module persists a competing "committed" balance, and issue/backflush rechecks availability. |
| M3 | Facts retain WMS posting evidence | Stock facts require WMS posting IDs, quantity/UoM evidence, and posting time. An opaque valuation-context reference is optional when WMS provides it; the mandatory valuation contract is a prerequisite of future `production_costing`, not MVP execution. |
| M4 | Durable MVP idempotency | Stock commands and external confirmations require idempotency keys. Deduplication records live with the related order/fact/posting in MVP. Retention windows, pruning, and replay-after-expiry policy are later scale/MES work. |
| S1 | Spike-then-freeze for the hardest stock contracts | One explicitly non-shippable vertical spike (one site, one discrete order, explicit issue + backflush + output receipt through one atomic WMS batch, minimum facts) MAY validate atomicity, precision, cumulative backflush, and reversal before contracts freeze. It is throwaway and never becomes a de-facto contract. |
| S2 | Early bounded-context test for fuzzy pairs | Before splitting, `production_data_collection`↔`production_execution` and `production_tooling`↔`asset_management`↔`production_workforce` must pass the bounded-context gate; if they fail it, they ship merged. |
| S3 | Dependency diagram shows costing and pegging | The logical dependency map includes the costing read-model consumer and the optional planning peg → explicit WMS reservation-request flow. |

### Manufacturing kernel package contents (C1)

The standalone `manufacturing` kernel owns only what every manufacturing model shares:

- release identity, site reference, product/item + UoM references, effectivity (valid-time);
- quantity/configuration applicability and readiness;
- the abstract released-definition and order/operation lifecycle contracts (state machine), implemented by sibling aggregates;
- the minimum append-only fact contract, correlation/causation IDs, and reversal/compensation semantics;
- the WMS posting interface (issue/return/scrap/output/reversal **and** backflush mode) and the MES/edge confirmation interface;
- mandatory multi-level BOM occurrence and explosion contract, including cycle detection and stable occurrence paths in released/execution snapshots;
- a minimal work-centre boundary over shared resource IDs and an optional single-sequence routing contract;
- reserved seams: alternate/parallel routing, overlap/setup/queue/move time, phantom explosion, rework/transform/disassembly/split-merge, direct-issue order networks, and orderless reporting.

The kernel owns no discrete-only or process-only aggregate. Discrete `ProductionDefinition`/`ProductionOrder` and process `Formula`/`Recipe`/`BatchOrder`/`Campaign` are sibling implementations in their own packages that depend on the kernel.

## Foundation Contracts Required Before the Core Spec

### 1. Site and warehouse scope

A minimal WMS-owned site foundation owns stable plant/site identity within a tenant and organization. It stores current assignments between a site and one or more WMS warehouses under fixed roles such as raw material, line-side, WIP, finished goods, quarantine, and shipping. A configured role has exactly one default warehouse; explicit operations may select another assigned warehouse. A new site is inactive. Activation for discrete production requires default `raw_material` and `finished_goods` assignments; the same warehouse may serve both roles.

Every released manufacturing definition and order has a `siteId`. Administrators may change current assignments, but released definitions, orders, postings, and historical facts retain immutable site and warehouse-role snapshots needed for interpretation. Audit history does not replace those snapshots. The later `production_network` capability may extend the site model but must not introduce the first site identity.

The site record is an extensible business master and supports tenant-defined custom fields through the canonical entity/CrudForm/command/undo pipeline. Warehouse-role assignments remain a closed configuration contract and do not accept custom fields. Because site setup is infrequent and normally small, the first UI uses minimal paginated DataTables and stable injection surfaces, but no built-in search bar, advanced filters, column chooser, saved views, export, selection, or bulk actions. The API retains narrow search/filter parameters for integrations and lookup consumers.

In the MVP a warehouse may serve several roles but may belong to only one active site. Shared warehouses across active sites require a later production-network/shared-stock policy. Scheduled/effective-dated assignment changes and site timezone/calendars are future capabilities, not prerequisites of current-assignment CRUD. Before timezone-sensitive execution ships, a dedicated contract must add and migrate site timezone. Advanced production number ranges remain later P1.13 rather than a site-activation or MVP gate.

### 2. Resource, work-center, asset, staff, and calendar ownership

Reusable resource identity, capacity unit, and active state remain in `resources`; reusable timezone-aware availability rules remain in `planner`. Manufacturing owns minimal work centres and routing applicability linked by scalar IDs. The MVP routing is optional and sequential and may record basic setup/run time and instructions. Calendars, queue/move/overlap, alternate resources, crews, tools, and finite-capacity enforcement are later capabilities.

Assets, tools, and people remain separate identities. Maintenance downtime, calibration state, tool life, skills, and qualifications are optional constraint-provider inputs to scheduling and execution. Scheduling never becomes the master of those states.

### 3. Released manufacturing definition

The shared manufacturing kernel defines release identity, site, product/item and UoM references, effectivity, quantity/configuration applicability, readiness, document package identity, and immutable revision semantics. It ships as a standalone `manufacturing` package (see "Manufacturing kernel package contents") that discrete and process models depend on; it encodes no model-specific aggregate.

Discrete manufacturing uses sibling aggregates such as `ProductionDefinition` and `ProductionOrder`. Process manufacturing uses `Formula`/`Recipe` and `BatchOrder`/`Campaign`. Releasing a definition atomically selects and freezes every applicable child BOM revision using site and the definition's business-effective date. A production order begins as an editable draft. Transition to `released` selects exactly one top-level released definition using item/variant, site, and `plannedStartDate`, then freezes the execution snapshot; later master-data changes never reinterpret existing work.

The first discrete core must support a multi-level BOM tree. A component may be a raw material or an assembly whose applicable released BOM is expanded beneath the component occurrence. The released-definition and execution snapshots retain the selected BOM revisions and the full occurrence path, so later master-data changes cannot change the meaning of an in-flight order.

A BOM line is a distinct occurrence identified by its own stable line ID and line position. `componentProductId` or `componentVariantId` is deliberately **not** unique within a BOM revision: the same item may occur more than once, even at the same level and with the same quantity/UoM. For example, two separate `5`-unit rolls of the same material remain two lines when they represent different physical feed points, operations, roles, instructions, or traceability contexts. The system may derive an aggregate planning demand of `10`, but it must preserve both occurrences in the definition, explosion, execution snapshot, UI, and posting correlation.

Before a BOM revision can be released, and again before an execution snapshot is created, validation must reject direct or indirect BOM cycles. Repeated use of the same item in separate occurrences is valid and is not a cycle. The persistence model must therefore key line uniqueness by BOM revision plus line identity/position, never by BOM revision plus component item alone.

Parent/child order links are required for a subassembly produced for the parent. The MVP hand-off receives child output to WMS stock and then explicitly issues it to the parent, retaining correlation between both postings. Direct issue, automatic child-order creation, MRP-driven explosion choices, phantom behaviour, and configure/engineer-to-order specialisation remain later capabilities.

Every BOM revision declares its output item/variant, base output quantity/UoM, site scope, effectivity interval, and release status. Every BOM line declares exact component quantity/UoM, `consumptionBasis` (`variable` or `fixed`), and `yieldFactor` greater than `0` and at most `1` (default `1`). Gross requirement equals nominal requirement divided by yield. `fixed` is planned once per production order and occurrence and may be issued in parts; first qualifying backflush posts its remaining amount. `variable` backflush calculates a cumulative target from accepted `good + scrap` at the occurrence's operation/order backflush point and posts only the delta from already posted net consumption. Exact cumulative arithmetic avoids per-confirmation drift. Reversal copies and negates persisted posting values rather than recalculating them.

The first core uses an explicit applicability resolver based on output item/variant, site, and business-effective date. It must resolve exactly one released BOM revision for each assembly occurrence, or fail closed with an actionable error. Overlapping applicable released revisions are rejected in the first core; it does not invent a priority, silently choose the newest revision, or substitute another component. Lot-size alternatives, manual/automatic substitutes, phantom flattening, and unit/serial effectivity are deliberately later extensions.

The first production-order lifecycle is `draft → released → in_progress → completed`, with controlled `cancelled`. Draft intent is editable and has no stock effects. Release validates the active site and definition and freezes the execution snapshot. The first accepted issue or confirmation starts work. Normal completion requires cumulative `good + scrap` to reach planned quantity and a successful atomic posting of required backflush/output/scrap. Overproduction is rejected. `complete_short` closes an unexecuted remainder with a required reason. Cancellation after stock effects requires reversal of every posting; later hold/close/archive and approval states are additive capabilities.

### 4. Production-capable WMS posting contract

WMS must expose semantic manufacturing operations for optional reservation/allocation, component issue, component backflush, component return, output receipt, scrap movement, and reversal. Co-/by-products, external operations, and direct-issue hand-off are later capabilities. Each request carries tenant, organization, site, warehouse role, production order/operation, occurrence path where applicable, item/variant, optional explicit lot/serial, quantity/UoM snapshot, actor/source, correlation ID, and idempotency key.

The built-in WMS provider exposes an atomic batch command that commits all movements in one posting group or none. Backflush plus output receipt at completion is one group; an explicit issue posted earlier is a separate group. A future external WMS provider may use a durable saga internally, but it must satisfy the same public result, compensation, idempotency, and reconciliation contract.

Manufacturing owns orchestration and business validity. WMS owns stock validation and the resulting physical ledger entries. WMS returns stable posting identifiers; Manufacturing stores them in its append-only transaction facts. Reversal creates compensating records and never deletes history.

Backflush is a first-class posting mode: on operation/order completion WMS posts cumulative-delta component issues and the output receipt in one atomic group, reverses exact persisted amounts symmetrically, and is covered by the §5 precision cases. New reservation sources, movement reference types, and movement types are added additively to the WMS enums for production issue/return/scrap/output/backflush; `manual` and `adjust` must never represent production postings.

In the MVP an output lot/serial value is supplied explicitly by the user or integration before receipt, and WMS records and validates uniqueness. Automatic generation, configurable formats/resets, pre-assigned offline pools, and block allocation belong to later P1.13.

WMS reservations/allocations are the single source of truth for committed physical stock. Release does not reserve automatically. Planning pegs remain proposals until an explicit optional command requests a WMS reservation; no module persists a competing committed balance, and issue/backflush rechecks availability.

Each posting result returns stable WMS posting IDs, quantity evidence, and posting time. An opaque valuation-context reference is optional when WMS provides it; the mandatory valuation contract belongs to `production_costing`. MVP deduplication records live with the related order/fact/posting and do not expire automatically.

The existing `wms` hard requirement on `sales` does not block the first MVP in the standard composition that includes Sales. P1.1 remains mandatory before claiming or packaging a standalone WMS/Manufacturing composition; the optional integration must preserve existing Sales reservation behaviour through a compatibility bridge.

### 5. UoM precision and immutable conversions

Catalog remains the UoM master. P1.3 is delivered through three specifications: [`2026-08-13-catalog-quantity-normalization.md`](2026-08-13-catalog-quantity-normalization.md) freezes variant policy and exact normalization; the WMS-owned [`2026-08-13-wms-quantity-precision-alignment.md`](2026-08-13-wms-quantity-precision-alignment.md) aligns WMS storage, arithmetic, and profile identity; and the WMS-owned [`2026-08-13-wms-quantity-evidence-reversal.md`](2026-08-13-wms-quantity-evidence-reversal.md) adds provider-neutral immutable evidence and correlated exact reversal. The latter two record an existing WMS inconsistency and are non-critical backlog for current Catalog/Sales/WMS operation: they do not block Site, draft BOM/routing, kernel, or non-stock order work. They remain mandatory before P1.8 freezes stock-posting payloads or P1.11 enables stock-affecting production. The detailed core spec consumes the accepted contracts rather than redefining them. The first discrete core owns its bounded `yieldFactor` rule; broader process loss, potency, tolerance, and variance policies remain with their specialist manufacturing capabilities.

The current Catalog precision and WMS `numeric(16,4)` storage already differ. P1.3a must freeze canonical normalization before a BOM or order quantity schema freezes. P1.3b–c track the existing WMS inconsistency as non-critical WMS backlog for current and non-stock work, but they must align storage/evidence before production posts inventory so the new module does not amplify that debt.

### 6. Minimum append-only manufacturing facts

The core records non-reconstructable facts with correlation and causation IDs: definition/order snapshot references, operation state transitions, quantities started/completed/scrapped, resource/time confirmations when supplied, WMS posting IDs, consumed and produced lot/serial links, quality-state references when present, and cost-driver quantities. Every fact has UTC `recordedAt` and `occurredAt`; an external source may add its timestamp/timezone. Rework and mandatory valuation context are later capabilities.

Manufacturing facts are domain events persisted in a dedicated append-only table; normal order/operation entities retain current operational state. The platform event bus is transport. Reconciliation authority is the fact table plus WMS posting references, not the bus or audit log, and aggregates need not be rebuilt by event replay.

These facts are the ERP manufacturing transaction history, not a substitute for WMS movements, the audit log, a genealogy graph, QMS decisions, or financial valuation. Append-only facts are not user-editable CRUD entities and are exempt from optimistic locking; commands that change operational state remain undoable through explicit reversal/compensation.

### 7. Quality disposition and planning availability

A basic WMS status/expiry contract represents whether stock is unrestricted, held, quarantined, rejected, expired, or otherwise ineligible. WMS remains the source of physical quantities and owns the availability projection. Allocation and execution consume that projection and never recompute eligibility independently. A future optional disposition provider may refine decisions; when configured but unreachable it fails closed. Its absence does not block MVP production.

Without a QMS module, deployments retain basic WMS-controlled availability and no advanced inspection/CAPA behavior. Planning must never assume held or expired stock is usable merely because it exists physically.

### 8. ERP production ledger to MES/edge confirmation boundary

Manufacturing core is the Level 4 authority for released orders, permitted operations, material intent, and accepted manufacturing transactions. MES is the Level 3 authority for dispatch, operator interaction, detailed execution capture, and local sequencing within granted bounds.

The MVP confirmation command covers partial/final good quantity, scrap, order/operation and backflush point, `occurredAt`, optional source timestamp/timezone, correlation, idempotency, acceptance/rejection, and explicit correction/reversal. UI and API use the same command. Offline buffering, arbitrary out-of-order replay, device sequence windows, multiple-edge conflict policy, rework, and detailed labor/machine capture belong to the later MES/edge contract. External data becomes ERP truth only after Manufacturing validates and accepts it.

Telemetry/read paths are separate from machine command/control paths. Command support requires a dedicated safety and security profile, including zones/conduits, device and certificate lifecycle, allowlists, safety-interlock ownership, audit, replay protection, and reconciliation.

## Ownership Matrix

| Concept | Authoritative owner | Manufacturing responsibility | Integration rule |
|---|---|---|---|
| Product, variant, UoM master | `catalog` | Snapshot applicable IDs, quantities, conversions, and rounding | FK IDs plus immutable snapshots |
| Site/plant identity | WMS `Site` foundation | Require site on releases/orders/facts and snapshot concrete assignments | Same tenant/organization; current assignment plus immutable consumer snapshot |
| Warehouse, location, physical WIP stock | `wms` | Select role; request semantic postings | WMS commands and returned posting IDs |
| Resource identity/base capacity | `resources` | Manufacturing extension and work-center membership | Scalar IDs; no duplicate resource master |
| Calendars/availability rules | `planner` | Optional input to later scheduling | Not required for manual MVP release; snapshot only when a capability uses it |
| Work center and routing constraints | Manufacturing kernel/discrete or process capability | Own semantics and applicability | Extensions over shared resource IDs |
| Asset condition, maintenance, calibration | Reusable asset domain | Consume constraints; correlate usage | Optional provider/events; asset domain does not require APS |
| Skills and qualifications | Staff/workforce domain | Validate execution/scheduling eligibility | Optional provider; absence behavior specified per deployment |
| Released definition and order intent | Corresponding manufacturing model | Full authority | Immutable release/order snapshots |
| Production issue/return/receipt workflow | Manufacturing | Validate and orchestrate business transaction | WMS performs atomic physical posting |
| Inventory balances, lots, serials, movement ledger | `wms` | Reference and reconcile | Never duplicated as Manufacturing balance tables |
| Operational WIP state | Manufacturing | Order/operation progress and accepted facts | Physical WIP remains WMS; monetary WIP remains costing/finance |
| Minimum manufacturing facts | Manufacturing kernel | Append, correlate, reverse/compensate | Advanced modules consume facts |
| Genealogy graph and recall investigation | `production_traceability` | Emit minimum lot/serial correlations | Consumer of Manufacturing and WMS facts |
| Quality disposition decision | Quality capability/provider | Enforce eligibility and retain reference | Availability projection combines quality with WMS quantity |
| Cost-driver quantities | Manufacturing | Capture consumed/output/time/scrap facts | Costing values facts; finance owns postings |
| Manufacturing kernel package | Standalone `manufacturing` package | Own shared contracts/seams only | Discrete/process/repetitive/reman depend on kernel, never on `production` |
| Status/expiry-aware availability projection | `wms` | Consume the projection | Basic WMS result works alone; an optional disposition provider may refine it; consumers never recompute |
| Production display numbers | `production` | Generate a simple concurrency-safe site-scoped number over canonical UUID identity | Configurable formats/resets and offline ranges move to P1.13 |
| Output lot/serial identity | WMS validates authoritative inventory identity | Manufacturing supplies an explicit value in MVP and snapshots it | Automatic generation and offline pools move to P1.13 |
| Planning peg (supply↔demand link) | `production_planning` | Emit peg proposals | An explicit optional command may request a WMS reservation; WMS owns committed stock |
| Temporal/effectivity authority | Manufacturing kernel | Stamp date effectivity on definitions and `recordedAt`/`occurredAt` on facts | Full bitemporal/as-of analytics are later |
| Demand signal | Future `production_planning` contract | Consume independent + dependent demand when planning is installed | Not required for manual/API production orders; Sales/forecast remain optional providers |
| Controlled document package | `production_document_control` | Snapshot released package ID/hash/revision | Generic attachments remain file storage only |
| Audit trail | `audit_logs` | Emit command/action context | Audit supports evidence; never replaces production ledger |

## Dependency Semantics and Packaging Gate

Every detailed capability spec must use these meanings:

- **Hard runtime requirement**: a module cannot register or provide its minimum valid behavior without the peer and may declare `ModuleInfo.requires` only after code verification.
- **Product/data prerequisite**: trusted data or a contract must exist, but may be supplied by another package or provider and does not automatically imply runtime `requires`.
- **Soft integration/provider**: the optional consumer owns subscribers, enrichers, widgets, or `tryResolve` glue and degrades gracefully when the peer is absent.
- **Snapshot/fallback**: historical data and minimum behavior when an optional peer is disabled or unavailable.
- **Placement/licensing**: OSS core, official module, provider package, or enterprise placement is decided in the capability's dedicated spec. Inclusion in this OSS roadmap is not a licensing commitment.

## Capability Landscape

### Shared foundation and manufacturing kernel

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| Catalog and product master | Products, variants, UoM and conversions | Existing Catalog requirements | Product configuration, compliance | Manufacturing snapshots released values | Existing OSS foundation; P1.3a exact normalization is the blocking quantity-schema contract |
| WMS sites | Stable, custom-field-extensible site identity and closed current warehouse-role assignments | Existing WMS requirements; site contract itself adds no Manufacturing requirement | Manufacturing consumers, directory, network planning | Inactive by default; discrete activation requires raw-material and finished-goods defaults; one warehouse belongs to only one active site in MVP | Existing OSS `wms` module per P1.2 spec; setup-once UI remains deliberately minimal |
| WMS and inventory | Warehouses, locations, stock, lots, serials, reservations and movement ledger | Current code: Catalog, Sales, feature toggles; Sales coupling is a standalone-packaging gate, not a standard-composition MVP blocker | Sales and Manufacturing consumers | Physical ledger remains usable without manufacturing | Existing OSS foundation; P1.3b–c remain mandatory before stock-affecting production |
| Resources and calendars | Resource identity/capacity and planner availability rules | Current code: `resources` requires `planner` | Assets, workforce, manufacturing extensions | Manual MVP uses active resource references without calendar enforcement | Existing foundations; minimal work-centre boundary freezes before released routing, advanced calendars before scheduling |
| Attachments, audit and workflows | Generic files, audit evidence and workflow orchestration | Their existing package contracts | Document control, engineering and approvals | Manufacturing remains authoritative when workflow is absent | Existing foundations |
| Manufacturing kernel | Site/applicability/effectivity, released-definition contract, accepted facts and posting/confirmation interfaces | Auth/organization and Catalog; WMS Site is required at executable release | WMS posting provider, resources/calendars, documents, quality, MES | Draft authoring works before stock execution; stock-affecting execution requires a compatible WMS provider | Standalone `manufacturing` package that all manufacturing models depend on; encodes no discrete- or process-only aggregate |

### Discrete core, engineering, and traceability

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production` | Discrete `ProductionDefinition`, BOM/routing releases, `ProductionOrder`, operation intent and manufacturing transactions | Manufacturing kernel; compatible WMS posting contract only for stock-affecting execution | Resources/planner, documents, workflows, quality, execution, costing | Drafts and non-stock lifecycle remain separable; manual confirmations work without MES/QMS/APS | Dedicated spec decides OSS/official placement |
| `production_engineering` | ECR/ECO, impact analysis, effectivity and release decisions | Catalog and released-definition contract | Workflows, documents, external PLM | Deterministic internal release lifecycle when workflows are absent | Dedicated spec decides placement |
| `production_document_control` | Controlled packages, checksums, revisions and release links | Attachments and released-definition contract | Engineering, signatures/compliance | Production snapshots package identity/hash; generic attachment alone is not controlled release | Dedicated spec decides placement |
| `production_traceability` | Genealogy graph/read models, recall and investigation | Minimum Manufacturing facts and WMS movement facts | Execution, quality, serialization/labeling | Base lot/serial correlations remain in core facts; no advanced graph UI | Dedicated spec decides placement |

Traceability consumes core/WMS/execution facts. `production_execution` must not hard-require the advanced traceability graph that depends on execution-produced facts.

### Planning and supply decisions

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production_planning` | MRP scenarios, netting, pegging, proposals and exceptions | Its own provider-neutral demand contract (manual independent + released-order dependent demand), released supply contracts, site policy, WMS availability | Substitute resolver, procurement/sales/forecast demand, external-operation sources | Runs without Sales/forecast providers; primary released components are used without substitution | Dedicated spec decides placement; not a first-production prerequisite |
| `production_material_substitution` | Technical equivalence, directional substitutions and contextual eligibility | Catalog and released component applicability | Quality/compliance and inventory availability | Planning proceeds with primary material when resolver is absent | Optional provider before/inside MRP; not downstream of MRP |
| `production_network` | Cross-site sourcing, transfer proposals and distributed plans | Planning and WMS `Site` foundation | WMS transfers, procurement | Single-site planning continues when absent | Dedicated spec decides placement |
| `production_scheduling` | Finite schedules, sequences, scenarios and exceptions | Released operations, calendars and planning inputs | Execution feedback, asset downtime/calibration, tools, workforce, solvers | Deterministic/infinite-capacity dates remain available without optional constraints | Solver is replaceable; package decided by spec |
| `production_commitment` | ATP and CTP promise calculations and evidence | ATP: trusted inventory/supply planning; CTP: finite-capacity scheduling | Sales integration | ATP remains available when APS is absent; CTP is unavailable with an explicit reason | Sales-facing capability; placement decided by spec |
| `production_sales_and_operations` | Demand/capacity scenarios and consensus decisions | Planning and forecast contracts | Sales, finance and external forecasting | No S&OP behavior when absent | Requires separate market validation |

MRP prerequisites include site/material policies, lead times, calendars, lot sizing, time fences, quality availability, and formal buy/transfer/subcontract release contracts. A minimal external-operation/source contract must exist before full subcontracting is productized.

### Shop-floor execution and industrial connectivity

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production_execution` | Dispatch state, operator interaction and detailed execution capture | Released manufacturing orders and canonical confirmation contract | Documents, QMS, traceability UI, workforce, connectivity | ERP/manual confirmations remain available; regulated policy may require optional peers by deployment | Dedicated spec decides placement |
| Edge/device connectivity foundation | Device identity, connection state, buffered envelopes and transport provenance | Integrations/security foundation | MES, assets, quality and sustainability adapters | Domain modules work without telemetry; buffered data reconciles after outage | Reusable foundation; protocol adapters use dedicated provider packages |
| `production_data_collection` | Capture sessions and device-assisted production inputs | Confirmation contract | WMS, scanners, RFID, scales and label providers | Manual validated entry when devices are absent | May begin inside execution and split only when boundary is proven |
| `production_intelligence` | OEE/throughput/downtime/yield read models | Trusted Manufacturing facts | Quality, connectivity, assets | Historical operational reports degrade to available facts | Analytics only; never system of record |
| `production_digital_twin` | Simulation/visualization models | Trusted intelligence and topology data | Connectivity and scheduling | No claimed twin behavior when absent | Research candidate; no early commitment |

Connectivity is not a mandatory child of MES. Telemetry ingestion and condition monitoring may operate without `production_execution`. Machine control is a separate, stronger profile and is not approved by this roadmap.

### Quality, compliance, and safety

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| Quality disposition foundation | Availability/disposition contract and references | WMS quantity/lot identity | QMS provider | Basic WMS availability only; no advanced inspection decisions | Foundation contract; implementation placement decided in spec |
| `production_quality` | Plans, sampling, inspections, SPC, NCR/CAPA and disposition decisions | Quality disposition contract | Manufacturing, WMS, MES, traceability | Production may run under explicit non-QMS policy; held stock remains unavailable | Generic QMS first; regulated overlays separate |
| `production_laboratory` | Requests, samples, methods, results, specifications and certificates of analysis | Quality/sample identity | Process engineering, traceability | External lab references may be attached without LIMS workflow | Formulation authoring belongs to process engineering/PLM, not LIMS by default |
| `production_compliance` umbrella | Capability map only until bounded contexts are selected | None at roadmap level | Product/material compliance, regulated records, vertical packs, labeling, submissions | No generic compliance claim | Must split before implementation/package decision |
| `production_environment_health_safety` | Safety events, permits, exposure and environmental controls | Organization/site identity | Execution, assets, compliance | No EHS workflow when absent | Research candidate; likely broader platform domain |
| `production_sustainability` | Evidence-backed energy, waste, carbon and footprint calculations | Defined accounting boundary and trusted facts | WMS, execution, costing, traceability | No sustainability claims without evidence model | Research candidate |

`production_compliance` must be decomposed before implementation into product/material compliance adapters, cross-cutting regulated-record controls, vertical overlays, EHS, labeling/serialization, and external submissions. Electronic signatures, retention, deviations, and batch/device history require explicit ownership in their dedicated specs.

### Cost, collaboration, and operational support

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production_costing` | Planned/actual manufacturing valuation, WIP value, overhead and variance | Manufacturing cost-driver facts | WMS, resources and finance posting provider | Quantity facts remain; no monetary valuation when absent | Finance retains financial ledger ownership |
| `production_subcontracting` | Outside-operation production context and supplier execution state | Released external-operation contract | WMS, procurement, quality, traceability | Core planning may emit external-source proposals without full collaboration | Dedicated spec decides placement |
| `production_supplier_collaboration` | Supplier capacity/commitment and controlled exchange | Subcontracting or supply contract | Planning, quality, integrations | Procurement/manual exchange remains | Research candidate |
| Reusable `asset_management` | Asset identity, maintenance, downtime, calibration and spare-parts context | Site/organization foundation | Production adapters and WMS spare-parts flow | Scheduling omits unavailable provider constraints explicitly | Asset domain must not depend on APS |
| `production_tooling` | Tool/fixture/mold life, availability and setup requirements | Manufacturing resource references | Asset/calibration and scheduling | Manual eligibility or unconstrained scheduling under explicit policy | Dedicated spec decides placement |
| `production_workforce` | Skills, certifications, crews and authorization | Staff/resource identity | Execution and scheduling | Manual authorization under explicit policy | Must not duplicate HR |

### Specialist manufacturing models

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production_process` | Formula/recipe releases, batch orders, campaigns, yields, co-/by-products, potency and parameters | Shared manufacturing kernel and compatible WMS postings | Quality, LIMS, traceability, execution, planning | First valid batch need not hard-require advanced QMS/LIMS/traceability modules | Sibling of discrete `production`, not its child |
| `production_configuration` | Options, constraints and configured definition generation | Catalog configuration and released-definition contract | Engineering and planning | Standard products continue without configuration | CTO candidate |
| `production_projects` | Project-specific supply, milestones and operational WIP context | Project and manufacturing contracts | Engineering, planning and costing | Standard order production remains | ETO candidate |
| `production_repetitive` | Rate-based flow, takt, kanban and line-side execution | Shared kernel and WMS postings | Planning and execution | Discrete order flow remains | Sibling execution model |
| `production_remanufacturing` | Disassembly, inspection, repair, recovery and returned-asset genealogy | Shared kernel | Quality, traceability and assets | Standard production remains | Sibling lifecycle model |
| `production_additive` | Build preparation, powder/material tracking and post-processing | Shared kernel | Execution, connectivity and traceability | No additive behavior when absent | Research candidate |
| `production_packaging_and_labeling` | Packaging specifications and production packaging intent | Released-definition contract | WMS execution, traceability, quality and label providers | Basic WMS packing may continue where semantically sufficient | Product-fit decision determines WMS extension or manufacturing capability |

## Corrected Logical Dependency Map

```text
organization/auth + catalog + WMS sites + simple production order number
       |                 |                  |
       |                 |                  +--> resources (planner calendars optional for MVP)
       |                 +--> WMS physical inventory + semantic posting contract
       |                          |          (WMS owns availability projection + reservations)
       |                          +--> status/expiry-aware availability <-- optional quality/disposition provider
       v
manufacturing kernel (standalone package: shared contracts, facts, seams)
       |                     |
       v                     v
discrete production      process/batch (sibling)   <-- both depend on kernel, not on each other
       |                     |
       +----------+----------+
                  |
                  +--> accepted manufacturing facts <---- MES/manual confirmations
                  |            |                                ^
                  |            +--> traceability / costing /    |
                  |                 intelligence read models    +-- reusable edge connectivity
                  |
   future demand signal (manual independent + dependent) --> MRP / supply planning
                  |                                <---- optional substitution/source providers
                  |            (planning emits pegs --> optional explicit WMS reservation request)
                  +--------------------+--------------------+
                  |                                         |
                  v                                         v
                 ATP                          finite scheduling <---- assets/tools/workforce
                                                            |             + execution feedback
                                                            v
                                                           CTP
```

This graph shows product/data direction, not automatic runtime `requires`. Full QMS, MES, advanced traceability, asset management, tooling, workforce, and connectivity remain optional unless a deployment policy explicitly mandates them.

## Manufacturing-Type Coverage

| Manufacturing type | Target capability composition |
|---|---|
| Discrete assembly, MTS, MTO | Shared kernel, discrete production, engineering, WMS, optional planning/scheduling/execution |
| Repetitive and lean | Shared kernel, repetitive, WMS, planning and execution |
| Process and batch | Shared kernel, process, WMS, optional quality/LIMS/traceability/execution/planning |
| Continuous | Process, execution, connectivity, scheduling and intelligence after domain validation |
| Configure-to-order | Configuration, engineering, discrete or process definition, planning |
| Engineer-to-order/project | Engineering, projects, configuration, production, planning and costing |
| Subcontracting | External-operation contract, subcontracting, WMS, procurement, optional quality/traceability |
| Remanufacturing/MRO | Remanufacturing, WMS, optional quality/traceability/assets/planning |
| Hybrid/mixed-mode | Composition of sibling models over shared contracts; never a separate monolith |

## Product Readiness Waves, Not Release Phases

Readiness is evaluated per delivered slice. A later capability is not an implicit blocker for an earlier safe slice.

### Gate A: draft definition authoring

Draft multi-level BOM and optional sequential-routing CRUD/API/UI may be implemented immediately. Before quantity-bearing public contracts freeze, P1.3a must provide one Catalog-owned exact-decimal/UoM policy. Before released routing references freeze, P1.6 must confirm the minimal work-centre extension over `resources`. Drafts may omit `siteId`; they have no stock effects and cannot create executable work.

### Gate B: released definitions and production-order lifecycle

Before P1.10 releases an executable order:

1. P1.2 provides inactive-by-default WMS Sites, required raw-material/finished-goods defaults, one-active-site-per-warehouse semantics, scoping, and immutable consumer snapshots.
2. P1.3a is accepted for exact definition/order quantities.
3. P1.6 defines minimal work centres; calendars and finite scheduling remain optional.
4. P1.7 defines atomic definition release, child-revision selection, occurrence-preserving multi-level snapshots, cycle rejection, optional sequential routing, and order release by `plannedStartDate`.
5. P1.9 defines normal order/operation entities plus the append-only fact table and the basic idempotent confirmation/correction lifecycle.
6. `production` provides UUID identity and a simple concurrency-safe site-scoped order display number.
7. Cross-scope, optimistic-lock, audit, backward-compatibility, and self-contained API/UI integration tests pass.

P1.1 WMS–Sales decoupling is not a blocker for the first standard composition that includes Sales. It remains a gate before claiming or packaging standalone WMS/Manufacturing operation without Sales.

### Gate C: stock-affecting execution

Before P1.11 issues, backflushes, returns, scraps, receives output, or reverses stock:

1. P1.3b proves non-narrowing WMS precision and exact authoritative arithmetic.
2. P1.3c proves immutable quantity evidence plus exact, correlated full/partial reversal.
3. P1.8 provides the built-in atomic WMS batch, stable posting IDs, persistent idempotency, exact reversal, and on-demand reconciliation.
4. WMS basic status/expiry availability excludes ineligible stock; no external QMS provider is required.
5. Reference tests cover fractional conversion, cumulative partial completion, fixed consumption, yield, `good + scrap`, duplicate requests, rollback, reversal, and scope isolation.

### Deferred readiness gates

The following do not block the first production flow and receive dedicated specifications when their capability is selected:

- P1.13 configurable order/batch/lot/serial formats, resets, generated values, block reservation, and offline allocation;
- demand-signal, MRP, pegs, and automatic child-order generation in `production_planning`;
- direct-issue child hand-off, shared warehouses across active sites, and production-network sourcing;
- full QMS/disposition provider, genealogy graph, costing valuation context, and controlled-document product;
- offline/out-of-order MES replay, device sequencing, dedup retention/pruning, clock-skew, and full bitemporal analytics;
- durable saga implementations for external WMS providers.

### Readiness evidence register

| Slice | Primary owner | Required evidence | Current document status |
|---|---|---|---|
| Draft quantities | Catalog | Exact normalization and immutable snapshot contract | P1.3a design complete — readiness review pending |
| WMS Site | WMS | Scope, activation roles, one-active-site-per-warehouse, snapshots, migration, setup UI | P1.2 design complete — readiness review pending |
| Work centres | `resources`, `planner`, Manufacturing | Minimal work-centre/resource boundary and optional sequential routing | Not authored |
| Released definitions | Manufacturing kernel and `production` | Lifecycle, child selection, occurrence snapshots, cycle validation, fixed/variable/yield semantics | Not authored |
| Minimum facts/confirmations | Manufacturing kernel | Append-only fact table, basic partial/final/scrap/idempotency/correction contract | Not authored |
| Exact WMS execution | Catalog and WMS | P1.3b precision plus P1.3c evidence/reversal | P1.3b–c design complete — readiness reviews pending |
| Atomic production postings | WMS with Manufacturing consumer | Issue/return/backflush/output/scrap/reversal atomic batch and reconciliation | Not authored |
| Standalone packaging | WMS and Sales | P1.1 optional integration boundary with compatibility bridge | Not authored; not first-MVP blocker |

One explicitly non-shippable validation spike (single site, single discrete order, explicit issue, cumulative backflush, output receipt, minimum facts, and reversal through one atomic WMS batch) MAY validate the hardest stock contracts before they freeze. It is throwaway and never becomes a de-facto contract.

### Later capability waves

After Wave 0, capabilities may be specified independently when customer evidence, architecture readiness, and package/licensing decisions exist. No ordering in the landscape is a delivery promise. Every capability spec must demonstrate that its aggregate/lifecycle is independently coherent and that optional peers can be disabled safely.

## Mandatory Validation Scenarios for Detailed Specs

- Draft BOM/routing CRUD works without stock postings; an incomplete or site-less draft cannot be released.
- Discrete release and order creation retain exact site, definition, document, and UoM snapshots after masters change.
- Definition release freezes the selected child revision at every assembly node; order release selects the top-level definition by `plannedStartDate` and freezes the execution snapshot.
- A built-in component posting group commits atomically or not at all; backflush plus output receipt is one atomic group.
- Repeated requests with the same idempotency key do not double-consume or double-receive stock.
- Reversals preserve both Manufacturing and WMS histories and restore the exact persisted quantity without current-policy recalculation.
- Cross-tenant, cross-organization, cross-site, and invalid warehouse-role requests fail closed.
- Held, quarantined, rejected, and expired lots are unavailable to allocation/execution under the basic WMS policy.
- Basic confirmations handle partial/final good quantity, scrap, duplicate, rejected, corrected, and reversed requests; no MES installation is required.
- The append-only fact table retains state transitions, quantity facts, occurrence paths, WMS posting IDs, and consumed/produced lot/serial correlations without replacing current order entities.
- Every optional integration has a disabled-module test and documented fallback.
- Cumulative backflush produces the same exact result across one or many partial confirmations, includes `good + scrap`, posts fixed consumption once per order/occurrence, and reverses exact persisted deltas.
- An explicitly supplied output lot/serial is accepted only when WMS uniqueness rules pass.
- A manually linked child is received to stock and explicitly issued to its parent with correlation and no double counting.
- A released multi-level BOM expands into the same occurrence tree in the execution snapshot, including the selected BOM revision at every assembly node.
- Two BOM lines for the same component item (for example, two separate five-unit rolls) remain two distinct occurrences through release, explosion, UI, execution, and posting correlation; an aggregate demand view may show ten units but cannot replace the two lines.
- Direct and indirect BOM cycles are rejected before release and before order creation, while repeated component occurrences remain valid.
- A BOM revision with no applicable or more than one overlapping applicable revision at an assembly occurrence fails closed.
- Base output, exact UoM, fixed/variable basis, and `yieldFactor` in `(0, 1]` produce reproducible required quantities from the snapshot.
- Normal order completion requires cumulative `good + scrap` to reach planned quantity; overproduction is rejected and `complete_short` requires a reason.
- An optional single-sequence routing works without calendars or finite scheduling; released resource references remain interpretable after master changes.
- Availability is served only by the WMS projection; no consumer recomputes held/quarantined/expired eligibility independently.
- No specialist manufacturing model (`production_process`, `production_repetitive`, `production_remanufacturing`) declares a runtime requirement on discrete `production`.
- Every affected API path and key UI path has self-contained integration tests with fixture setup and cleanup.

When later capabilities are selected, their own specs add the corresponding scenarios: generated/offline number ranges, direct issue, MRP without Sales/forecast, scheduling with optional constraints, advanced genealogy, costing valuation, full bitemporal/as-of queries, offline/out-of-order MES replay, dedup retention/pruning, and queue/progress for long-running workloads.

## Migration and Backward Compatibility

No production contracts are released yet, so this roadmap revision changes no current public contract. The detailed specs must nevertheless treat every published surface below as frozen/stable/additive according to `BACKWARD_COMPATIBILITY.md`.

| Contract surface | Roadmap rule |
|---|---|
| Auto-discovery conventions | Add new convention files/exports only; never rename released files, exports, or discovery paths. |
| Public types/interfaces | Add types or optional fields; never remove, narrow, or reinterpret released fields. |
| Function/command signatures | Freeze Manufacturing and WMS command IDs/payloads after release; additions remain optional and old behavior stays bridged. |
| Import paths | Preserve documented paths through re-export and `@deprecated` bridges for at least one minor release. |
| Event IDs/payloads | Use singular entity and past-tense action IDs; never rename/remove; add optional payload fields only; dual-emit during replacement. |
| Widget spot IDs/context | Never rename/remove spots or narrow context; add optional context only. |
| API URLs/methods/responses | Add routes/optional fields only; deprecate and bridge old routes with OpenAPI guidance. |
| Database schema | Add tables, indexes, and nullable/defaulted columns. Site migration must backfill mappings before any non-null constraint. Never narrow quantity types. |
| DI service names/interfaces | Keep keys stable and extend interfaces with optional methods only. Optional peers use safe resolution. |
| ACL feature IDs | IDs are frozen after release; new features are synced through setup/default grants. |
| Notification type IDs | IDs are frozen after publication. |
| AI agent/tool/UI-part IDs | N/A until a capability spec introduces Manufacturing AI; then the standard frozen registry and mutation-approval rules apply. |
| CLI commands | Names and required flags remain stable after release; additions are optional. |
| Generated contracts | Add registries/optional fields only; never remove or rename generated exports. |

Operational compatibility requirements:

- Adding a required field to an API/event or a non-null database field without safe default/backfill is breaking even when syntactically additive.
- Site introduction requires deterministic backfill/default mapping and a compatibility period for warehouse-scoped drafts; released production records may only be created after valid site mapping.
- Quantity precision changes require widening migrations and reconciliation checks; never silently round existing balances.
- Replaced commands/events/routes require deprecation, bridge/dual behavior, `UPGRADE_NOTES.md`, and the minimum one-minor-version window.

## Risks and Impact Review

| Severity | Failure scenario and impact | Mitigation and detection | Residual risk |
|---|---|---|---|
| High | Warehouse becomes a plant surrogate, forcing later migration of definitions, orders, resources, costs, and genealogy | Minimal site foundation; invariant tests; migration/backfill audit | Site hierarchy may still need additive extension for enterprise networks |
| High | Partial or duplicate production posting diverges Manufacturing and WMS ledgers | Built-in atomic batch, persistent idempotency, exact compensations, and on-demand reconciliation; external providers must prove equivalent saga behaviour | External outages can delay convergence for future providers but not lose accepted state |
| High | Production issues/receipts are modeled as generic WMS adjustments, losing business meaning and authorization | Manufacturing-owned semantic commands; WMS posting IDs; contract tests reject generic types | Legacy manual corrections remain distinct and require audit |
| High | Minimum genealogy or quantity facts are absent until optional modules are installed | Append-only facts and immutable lot/serial/posting correlations from first release | Advanced genealogy, costing, and quality views remain limited to captured facts |
| High | Catalog/WMS precision mismatch creates cumulative inventory drift | P1.3 exact arithmetic, conversion snapshots, cumulative-delta tests, exact reversal, and reconciliation evidence | Physical measurement variance remains a later policy |
| High | Quality-blind availability uses held or expired stock | Basic WMS status/expiry projection, fail-closed eligibility and scenario tests | A configured future provider outage may reduce availability conservatively |
| High | Discrete aggregates are reused for process manufacturing and later require semantic breaking changes | Small shared kernel plus sibling aggregates and extension seams | Some hybrid flows may require new additive orchestration |
| High | Dependency graph creates cycles or forces Sales/MES/QMS in minimal deployments | Staged gates, optional-consumer glue, module-decoupling tests, and P1.1 before standalone packaging | The first standard-composition MVP temporarily includes Sales through current WMS metadata |
| High | Kernel placed inside discrete `production`, forcing process/repetitive/reman to depend on discrete semantics | Standalone `manufacturing` package; siblings depend on kernel; module-decoupling test asserts no `requires` on `production` | Hybrid flows may need additive kernel seams |
| High | Availability recomputed inconsistently across MRP/ATP/allocation/execution | WMS owns a single availability projection; consumers call it; contract tests | Provider outage reduces available stock conservatively |
| Medium | Explicit lot/serial input collides or loses genealogy | Manufacturing snapshots the supplied value and WMS validates authoritative uniqueness before receipt | Automatic/offline allocation remains unavailable until P1.13 |
| Medium | Backflush omitted from posting contract, blocking repetitive/lean and drifting quantities | Backflush as a first-class posting mode with symmetric reversal and precision cases | Physical measurement variance remains a domain policy |
| Medium | Planning pegs and WMS reservations diverge on committed stock | WMS is single source of truth; pegs are proposals resolving into reservations | Late peg changes require re-reservation |
| Medium | Later temporal analysis cannot interpret first-core history | Date effectivity plus `recordedAt`/`occurredAt` and optional source timestamp/timezone exist from day one | Retroactive correction, site timezone, and clock-skew policy remain later work |
| Medium | Resource/calendar duplication causes execution and APS to disagree | Reuse `resources`/`planner`; ownership contract and snapshot tests | Specialized capacity models may require additive extensions |
| Medium | Asset/tool/workforce constraints become cyclic APS dependencies | Provider inputs point into scheduling; provider domains remain independent | Missing provider data may yield less constrained schedules |
| Medium | Connectivity combines telemetry and machine control without adequate safeguards | Separate read/control profiles; security review and control-path ban until approved | OT integration remains vendor/site specific |
| Medium | Capability proliferation produces thin modules without independent lifecycles | Bounded-context and placement gate in every dedicated spec | Product packaging may consolidate modules without merging ownership |
| Medium | Compliance umbrella creates conflicting ownership or unsupported regulatory claims | Split into bounded contexts and vertical overlays before implementation | Regulations evolve and require ongoing domain review |
| Medium | MRP/APS/intelligence overload web/database workloads | Queue/progress contracts, bounded concurrency, workload budgets and operational metrics | Large tenants may require dedicated workers/storage |

## Module Catalogue and Business Capabilities

This is the business view of the roadmap: what each capability owns and what it enables a user to do. It explains product intent, not a delivery order or package commitment.

### Foundation, core, and controlled data

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| WMS `Site` foundation | Stable plant identity and current plant-to-warehouse roles | Define sites and assign one or more warehouses to each fixed raw-material, line-side, WIP, finished-goods, quarantine, or shipping role, with one current default per configured role. |
| `production` | Discrete definitions and order lifecycle | Maintain released BOMs/routings; define work centers and operations; create production orders; orchestrate material issue, return, and output receipt through WMS. |
| `production_engineering` | Controlled technical/manufacturing change | Submit, assess, approve, and apply changes; define effectivity; identify affected released definitions and open work. |
| `production_document_control` | Controlled execution documents | Bind instructions, drawings, specifications, and certificates to revisions; release an immutable instruction package with work. |
| Minimum manufacturing facts | Accepted manufacturing history | Review immutable confirmations, quantities, WMS posting correlations, and the factual history needed by later capabilities. |
| `production_traceability` | Genealogy and investigation | Trace materials, lots, serials, outputs, operations, rework, and recall scope forward and backward. |

### Planning and promise-making

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| `production_planning` | MRP and supply-demand decisions | Net demand against stock and supply; create planned production/purchase/transfer proposals; investigate shortages, pegging, exceptions, and scenarios. |
| `production_material_substitution` | Generic equivalence and substitution | Define technical equivalence, directional substitutes, conversions, eligibility rules, and policies MRP can use to select material. |
| `production_network` | Distributed manufacturing | Select producing plants; plan inter-site supply and transfers; compare sources across a production network. |
| `production_scheduling` | APS / finite scheduling | Sequence operations under material, machine, labor, tool, calendar, and setup constraints; compare and re-plan scenarios. |
| `production_commitment` | ATP and CTP | Provide sales with evidence-backed available/capable-to-promise delivery dates. |
| `production_sales_and_operations` | S&OP / IBP | Reconcile forecasts, demand, capacity, supply, and financial scenarios across a medium- and long-term horizon. |

### Shop-floor execution and industrial data

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| `production_execution` | MES | Dispatch work; show released instructions; confirm operations, quantities, labor/machine time, scrap, rework, and execution events. |
| Edge/device connectivity foundation | Secure OT data exchange | Connect devices and edge gateways; buffer/replay envelopes; preserve provenance before accepted Manufacturing confirmation. |
| `industrial_connectivity` adapters | PLC, SCADA, and machine integration | Translate approved protocol data into operational events; integrate telemetry and, only under a dedicated safety profile, machine commands. |
| `production_data_collection` | Operator/device-assisted capture | Capture work by barcode, RFID, terminal, scale, label, or machine data, including offline-tolerant workflows where needed. |
| `production_intelligence` | Operational analytics | Monitor OEE, throughput, downtime, yield, scrap, utilization, trends, and root-cause signals. |
| `production_digital_twin` | Visualisation/simulation | Visualize plant/line topology and simulate flows only after trusted operational and topology data exists. |

### Quality, compliance, and sustainability

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| Quality disposition foundation | Planning/execution eligibility | Determine whether stock is usable, held, quarantined, rejected, expired, or otherwise unavailable for a process. |
| `production_quality` | Manufacturing QMS | Define inspections and sampling; record results/SPC; manage NCR, disposition, CAPA, quality holds, and release decisions. |
| `production_laboratory` | LIMS | Request tests; manage samples, methods, specifications, and results; issue certificates of analysis. |
| Product/material compliance capabilities | Compliance evidence | Maintain declarations, regulated evidence, hazardous-material requirements, and customer certificates after bounded contexts are chosen. |
| `production_environment_health_safety` | Production-linked EHS | Record safety/environmental events, permits, exposures, incidents, and corrective actions related to work. |
| `production_sustainability` | Evidence-backed sustainability accounting | Analyze energy, waste, material origin, emissions, and footprint when the accounting boundary and evidence model are defined. |

### Cost, collaboration, and operational support

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| `production_costing` | Cost and WIP analysis | Calculate planned/actual cost, WIP value, overhead, yield, scrap, and variance; provide evidence to finance posting. |
| `production_subcontracting` | Outside operations | Send materials/work to a subcontractor; track confirmation, return/receipt, and external-quality context under the production order. |
| `production_supplier_collaboration` | Supplier production collaboration | Exchange forecasts, capacity commitments, production status, controlled documents, and supplier-quality information. |
| Reusable `asset_management` | Asset condition and maintenance constraints | Plan around maintenance, calibration, downtime, spare parts, and service windows without making production the asset master. |
| `production_tooling` | Tools, fixtures, molds, and dies | Manage availability, calibration, life/usage limits, setup needs, and scheduling constraints of tooling. |
| `production_workforce` | Skills, certifications, crews | Track authorizations and qualifications; assign eligible workers/crews to operations and scheduling constraints. |

### Specialist manufacturing models

| Module / capability | Business responsibility | What users can do |
|---|---|---|
| `production_process` | Process, batch, and continuous production | Maintain released formulas/recipes; run batches/campaigns; manage yield, co-/by-products, potency, parameters, and batch genealogy. |
| `production_configuration` | Configure-to-order | Define options and constraint rules; validate a configuration; derive the applicable released BOM/routing. |
| `production_projects` | Engineer-to-order/project manufacturing | Link work to projects, milestones, project-specific supply, operational WIP, resources, and cost. |
| `production_repetitive` | Lean/repetitive production | Operate takt, kanban, rate-based flows, line-side replenishment, and repetitive execution. |
| `production_remanufacturing` | Repair, recovery, and remanufacturing | Disassemble, inspect, repair, replace, recover, and reuse components while retaining configuration/history. |
| `production_additive` | Additive manufacturing | Prepare build jobs; track powder/material, post-processing, and machine-level execution. |
| `production_packaging_and_labeling` | Packaging and compliant labeling | Maintain packaging specifications; create lot/serial labels; perform final packing with traceability. |

## Topics Requiring Deliberate Future Analysis

| Topic | Decision required before productization |
|---|---|
| Site hierarchy and network model | Extend the minimal site without equating warehouses, plants, legal entities, or lines. |
| PLM boundary | Keep released manufacturing data authoritative while avoiding CAD/PLM authoring replacement unless separately validated. |
| Resource and capacity model | Define alternate/parallel capacity, setup matrices, overlap, queue/move, crews, tools, and calendars as additive contracts. |
| Material substitution | Validate technical equivalence, directionality, context, compliance, approval, and effectivity across industries. |
| WIP accounting | Keep operational state in Manufacturing, physical stock in WMS, and monetary valuation in costing/finance. |
| Financial integration | Define WIP, valuation, variance, posting, reversal, and close-period ownership with finance architecture. |
| Solver strategy | Keep MRP deterministic and APS heuristics/solvers replaceable; do not freeze one optimizer into the public model. |
| OT resilience/security | Define ordering, deduplication, clocks, provenance, offline authority, certificates, zones/conduits, and safety ownership. |
| Regulated records | Assign electronic signatures, retention, deviation, batch/device history, labeling/serialization, and submissions. |
| Analytics and retention | Separate transactional truth, persistent event/fact history, and analytical/time-series storage. |
| Sustainability accounting | Define boundaries, factors, provenance, recalculation, and evidence before making product claims. |
| AI and digital twins | Treat as decision support over trusted records, never substitutes for controlled production truth. |

## What Not to Productize Prematurely

- Do not put MRP, APS, MES, QMS, costing, process recipes, or client-specific substitution policy into discrete `production` core.
- Do not make a WMS warehouse the permanent plant identity.
- Do not make WMS own production workflow merely because it executes inventory postings.
- Do not duplicate WMS inventory, Catalog product/UoM masters, shared resources/calendars, finance postings, HR, generic document storage, or full PLM/CAD.
- Do not use `manual` or `adjust` inventory movements as the normal production issue/receipt contract.
- Do not make advanced traceability a prerequisite for execution facts, QMS a prerequisite for every valid production deployment, or asset management dependent on scheduling.
- Do not expose machine-control commands before a separately approved OT safety/security architecture exists.
- Do not market digital twins, AI optimization, sustainability, or regulated compliance before their evidence and governance foundations are proven.
- Do not generalize a single customer's terminology, workflow, substitution, quality, or costing rules into the public model without cross-industry validation.
- Do not put automatic BOM-alternative selection, material substitution, phantom flattening, unit/serial effectivity, or customer-specific BOM rules into the first discrete core without a dedicated specification and evidence that the generic model is insufficient.

## External Research Signals

Enterprise suites consistently separate manufacturing, planning, execution, quality, warehouse, maintenance, PLM, costing, and connectivity while integrating them through controlled contracts. The following references support the capability landscape and the site/resource/ERP-MES boundaries; they do not define Open Mercato's package structure:

- [ISA-95 enterprise-control system integration](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
- [Siemens Opcenter MOM](https://www.siemens.com/en-gb/products/opcenter/)
- [Siemens OT-to-MES architecture](https://www.siemens.com/en-us/content/architecture-hub/op-center/)
- [Oracle Manufacturing](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/overview-of-oracle-manufacturing-cloud.html)
- [Oracle Fusion SCM applications](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faips/about-oracle-fusion-cloud-supply-chain-manufacturing.html)
- [Oracle BOM component occurrence and quantity model](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/oedsc/mscstbomcomponents-12762.html)
- [Dynamics 365 production lifecycle](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/production-process-overview)
- [Dynamics 365 master planning](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-home-page)
- [Dynamics 365 BOM versions and multi-level structures](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/bill-of-material-bom)
- [SAP multi-level BOM explosion](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/18ee18df146f46e9a7738186eebceaa7/eeb1b853ff98b44ce10000000a174cb4.html)
- [SAP BOM alternative selection](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/34de0103497c4b80a7c7fbf6952ff971/c701b753128eb44ce10000000a174cb4.html)
- [IFS Product Structures](https://docs.ifs.com/ifsclouddocs/26r1/lang/en/MfgStandard/AboutProductStructures.htm)
- [IFS structure components](https://docs.ifs.com/ifsclouddocs/26r1/MfgStandard/ActivityAddProductStructureComponent.htm)
- [Infor LN BOM documentation](https://docs.infor.com/ln/latest/en-us/lnolh/tiolh/tiomtibom.html)
- [Epicor Kinetic production management](https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/production-management/)

## Specification Rules for Every Capability

Before implementation, every capability spec must:

1. Define scope, aggregate/lifecycle ownership, package/licensing, data, API, UI, ACL, encryption, failure handling, undo/reversal, cache/index strategy, performance, migration/backward compatibility, and observability.
2. Identify hard runtime requirements, product/data prerequisites, optional integrations, glue owner, and absent behavior against the actual module metadata.
3. Define transaction boundaries, idempotency, durable side effects, compensations/reversals, and reconciliation.
4. Use tenant/organization/site scoping, scalar cross-module IDs, immutable snapshots, canonical commands/events, mutation guards, and zod validation.
5. Give every new user-editable entity `updated_at`, expose `updatedAt`, and cover update/delete optimistic locking; append-only facts are exempt.
6. Use queue workers and progress jobs for long-running MRP/APS/intelligence/bulk work, with bounded concurrency and idempotent retry.
7. Include self-contained integration tests for every affected API path and key UI path, disabled optional modules, conflicts/concurrency, reversals, partial failure, and scope isolation.
8. Complete a pre-implementation review against all public contract surfaces and confirm that the capability is generic product rather than client-specific customization.
9. For ownership, lifecycle, data-model, effectivity, posting, and public-contract decisions, benchmark current official documentation for SAP S/4HANA, Oracle Fusion Cloud SCM, IFS Cloud, Microsoft Dynamics 365 Supply Chain Management, and Infor CloudSuite Industrial. A capability-specific analysis may omit non-material products only with an explicit rationale. Routine CRUD/UI/ACL or implementation-detail work may rely on an accepted architecture decision without repeating the benchmark. A single vendor is never sufficient evidence for a new architecture rule.
10. Preserve basic data portability: document bounded BOM/routing import and export plus production-order/fact export when those records ship. Small jobs may run synchronously with explicit limits. Advanced mappings, cross-version migration, continuous synchronization, connectors, and queued bulk migration are separate capabilities.

## Final Compliance Report - 2026-08-13

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/compliance-review.md`

No closer `AGENTS.md` exists under `packages/core/src/modules/wms`, `resources`, or `planner`.

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root/Core AGENTS | No direct ORM relationships across modules | Compliant | Ownership matrix requires scalar IDs and snapshots. |
| Root/Core AGENTS | Tenant and organization scope every entity/query | Compliant at roadmap level | Site and posting invariants fail closed; detailed schemas are delegated. |
| Core AGENTS | Optional consumer owns glue and peers degrade gracefully | Compliant | Dependency semantics and disabled-module scenarios are explicit. |
| Core AGENTS | Domain writes use commands with undo and side effects after commit | Compliant at roadmap level | Posting/confirmation contracts require commands, reversal/compensation, and reconciliation. |
| Root/Core AGENTS | Zod, mutation guards, OpenAPI and canonical CRUD/UI mechanisms | N/A for roadmap | No endpoints or UI are specified; mandatory in every capability spec. |
| Root/Core AGENTS | Encryption maps and decryption helpers for sensitive data | N/A for roadmap | No fields are specified; capability specs must classify and encrypt sensitive fields. |
| Root/Core AGENTS | Optimistic locking on new editable entities | Compliant at roadmap level | Required downstream; append-only facts explicitly exempt. |
| Core AGENTS | Queue/progress for long-running operations | Compliant at roadmap level | Required for MRP, APS, intelligence, and bulk operations. |
| BACKWARD_COMPATIBILITY | Preserve all fourteen contract-surface categories | Compliant | Full matrix and migration rules are included. |
| Specs AGENTS | TLDR, problem/scope, solution, architecture, risks, compliance and changelog | Compliant | This roadmap intentionally delegates endpoint/UI implementation detail. |
| Root Design System/UI rules | Semantic tokens, shared primitives, i18n and dialog keyboard behavior | N/A for roadmap | No UI design or code is proposed; capability specs must apply these rules. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Ownership matches dependency direction | Pass | WMS owns physical stock; Manufacturing owns production workflow; advanced modules consume facts. |
| Discrete and process boundaries | Pass | Both are siblings over a small kernel. |
| ATP/CTP and planning/scheduling order | Pass | ATP follows trusted planning; CTP requires finite scheduling. |
| Quality and availability order | Pass | Basic WMS status/expiry availability supports MVP; an advanced disposition provider and full QMS remain optional. |
| Asset/tool/workforce direction | Pass | Providers feed scheduling and do not require APS. |
| Traceability/execution cycle | Pass | Traceability consumes facts; execution does not require the graph. |
| API/data/UI consistency | N/A | Detailed contracts are intentionally deferred. |
| Risks cover critical cross-module writes | Pass | Built-in atomicity, future-provider saga equivalence, idempotency, reversals, precision, isolation, and reconciliation are covered. |

### Verdict

**Roadmap architecture approved with staged readiness.** Draft definition authoring may proceed. Released-order and stock-execution specifications/implementation unlock only after their named Gate B or Gate C dependencies; deferred planning, numbering, MES/QMS, costing, and packaging work does not implicitly block the MVP.

## Changelog

- 2026-08-13: Reframed the document as the Manufacturing product roadmap and capability architecture.
- 2026-08-13: Added Wave 0 foundation contracts for sites, shared resources/calendars, released definitions, WMS postings, UoM precision, minimum facts, quality-aware availability, and ERP-MES confirmations.
- 2026-08-13: Established that production issues, returns, and receipts belong to Manufacturing while WMS executes and owns physical inventory postings.
- 2026-08-13: Replaced ambiguous dependencies with hard/runtime, soft/provider, fallback, and placement semantics; corrected traceability, quality, asset, connectivity, substitution, ATP/CTP, and process-model directions.
- 2026-08-13: Added ownership, backward-compatibility, risk, validation, readiness, and compliance sections.
- 2026-08-13: Added a business-facing module catalogue explaining responsibility and user capabilities for each roadmap area.
- 2026-08-13 (Revision 3): Added the "Wave 0 Contract Decisions" section resolving C1–C3, H1–H6, M1–M4, and S1–S3; froze the kernel as a standalone `manufacturing` package with defined contents.
- 2026-08-13 (Revision 3): Made WMS the owner of the quality-aware availability projection and the single source of truth for committed stock; planning pegs are proposals.
- 2026-08-13 (Revision 3): Fixed lot/serial numbering direction (production assigns from a sites/WMS-owned range; WMS records/validates), added backflush as a first-class posting mode, a bitemporal time model, an as-of valuation reference, idempotency/dedup retention, the facts-as-module-event-store rule, a minimal demand-signal contract, and the parent/child order-network seam.
- 2026-08-13 (Revision 3): Expanded Wave 0 gates (11–14), risks, validation scenarios, ownership matrix, and the dependency diagram (now shows costing and the peg→reservation flow) to match the above.
- 2026-08-13 (Revision 4): Aligned the roadmap with the accepted P1.2 WMS `Site` design: current warehouse-role assignments with one default replace effective-dated mappings in the MVP; consumers preserve history through immutable snapshots; site timezone/effective dating are future capabilities; production number ranges move to a separate mandatory Wave 0 specification.
- 2026-08-13 (Revision 5): Clarified that `Site` uses the full canonical custom-field/CrudForm/undo extension pipeline while warehouse-role assignments remain closed; the setup-once UI keeps stable DataTable injection hosts but deliberately omits CRM-scale search, filters, column chooser, saved views, exports, selection, and bulk actions.
- 2026-08-13 (Revision 6): Split the audited P1.3 quantity work into Catalog/Sales normalization plus two WMS-owned specifications for precision/profile alignment and evidence/reversal; corrected the backflush precision cross-reference. P1.3a blocks quantity-schema freeze, while the existing WMS mismatch is tracked as non-critical backlog until it becomes mandatory for stock-affecting production.
- 2026-08-19: Made multi-level BOM explosion and occurrence-preserving duplicate component lines mandatory for the first discrete core. Added cycle rejection, deterministic site/date revision selection, exact base-output and fixed/variable/yield line-consumption semantics, and a multi-vendor official-documentation benchmark rule. Deferred alternatives, substitutions, phantom flattening, and unit/serial effectivity to dedicated later specifications.
- 2026-08-14: Made the roadmap self-contained by consolidating decision provenance, linking the committed Wave 0 document set, identifying the number-range specification as not yet authored, and removing unverifiable references to uncommitted review files.
- 2026-08-19: Replaced the all-or-nothing fourteen-gate model with staged draft, released-order, stock-execution, packaging, and deferred-capability readiness. Allowed real draft BOM/routing CRUD before execution while retaining exact quantity and stock safety gates.
- 2026-08-19: Simplified the first production flow to optional sequential routing, inactive-by-default sites, one active site per warehouse, simple order numbering, explicit lot/serial input, receive-to-stock child hand-off, basic WMS availability, minimal timestamps, persistent idempotency without expiry, and atomic built-in WMS posting.
- 2026-08-19: Froze yield as `(0,1]` with nominal/yield grossing, fixed consumption per order/occurrence, cumulative `good + scrap` variable backflush, exact persisted reversal, the basic order lifecycle, and `complete_short`; moved demand signals, full number ranges, direct issue, advanced MES/QMS, costing valuation, and bitemporal analytics to later capabilities.

### Review - 2026-08-13

- **Reviewer**: Agent
- **Security**: Passed at roadmap level; detailed OT, encryption, and endpoint controls remain gated by capability specs.
- **Performance**: Passed at roadmap level; long-running workloads require queue/progress and bounded concurrency.
- **Cache**: N/A; no read API or cache contract is defined in this roadmap.
- **Commands**: Passed at roadmap level; semantic commands, idempotency, reversal/compensation, and reconciliation are mandatory.
- **Risks**: Passed; concrete severity, detection, mitigation, and residual risk are documented.
- **Verdict**: Approved as product roadmap with staged readiness; each production slice follows its named minimum gates.

### Document Integrity Check - 2026-08-14

- **Local references**: All explicitly named Markdown files resolve in the repository.
- **Pending document**: The advanced P1.13 number-range specification is intentionally not authored and is a future necessary capability, not an MVP gate or dangling link.
- **Decision provenance**: C1–C3, H1–H6, M1–M4, and S1–S3 are recorded directly in this roadmap and require no external review artifact for interpretation.
- **Verdict**: The roadmap is self-contained and suitable for staged contract authoring and implementation.
