# Manufacturing Product Roadmap and Capability Architecture

## TLDR

This document is the long-term product roadmap and architecture map for Open Mercato Manufacturing. It defines capability boundaries, ownership, dependency direction, and readiness gates. It is not a release calendar, delivery commitment, or detailed implementation specification.

Before a detailed `production` specification may be approved, Wave 0 must establish a minimal site identity, shared resource/calendar ownership, released manufacturing definitions, production-capable WMS posting contracts, minimum append-only manufacturing facts, quality-aware availability, and the ERP-to-MES confirmation boundary.

Production material issues, returns, and finished- or intermediate-goods receipts belong to the Manufacturing business process. Manufacturing owns their intent, semantics, authorization, order/operation correlation, idempotency, ordering, reversals, and reconciliation. WMS remains the authoritative owner of physical inventory, lots, serials, reservations, balances, and movements, and executes the atomic stock postings requested through its contracts. Manufacturing therefore uses WMS mechanisms; WMS does not own the production workflow.

## Executive Summary for Business Stakeholders

Open Mercato Manufacturing is a long-term product direction for organizations that need to plan, execute, and improve production while keeping inventory, quality, planning, and shop-floor data consistent. It starts with a complete, reliable discrete-manufacturing flow and can grow into process, batch, repetitive, project, subcontract, and remanufacturing models without forcing every customer into the same operating model.

The first product objective is not to deliver every manufacturing capability at once. It is to establish the foundations that make later capabilities safe and composable: a clear plant identity, reliable material issue and receipt flows, controlled production definitions, trusted production history, and a consistent view of stock that is available for production.

The roadmap deliberately keeps responsibilities clear. Manufacturing owns production decisions and the history of work performed. Warehouse Management owns the physical inventory and stock movements. Quality, planning, maintenance, costing, and shop-floor systems can add their specialist capabilities through controlled integrations. This avoids duplicate records, conflicting decisions, and costly rework as customers adopt more advanced capabilities.

Before implementation of the initial `production` module is approved, Wave 0 must prove that these foundations work together: production postings are safe and reversible, stock is not consumed twice, changes remain traceable, unavailable stock is not planned as usable, and integrations with shop-floor systems can handle delayed or repeated confirmations. These are readiness conditions, not delivery dates or commercial commitments.

After Wave 0, capabilities such as material planning, finite scheduling, quality management, traceability, costing, shop-floor execution, and specialist manufacturing models may be specified and prioritized independently based on customer evidence, product fit, and the required operating model. This lets Open Mercato offer value incrementally without turning the first manufacturing release into an inflexible monolith.

## Purpose and Document Status

**Status:** Approved product roadmap; Wave 0 gates are not yet met; implementation is not approved.

The roadmap describes the complete manufacturing capability landscape Open Mercato may grow into and the architectural constraints that keep those capabilities composable. Positions in the dependency map mean "requires this contract or trusted data first", never "will be delivered next".

Each capability that becomes a product candidate requires its own implementation spec, readiness review, package/licensing decision, and self-contained integration coverage. This roadmap governs those later specs but does not pre-approve their scope, package placement, or implementation.

The analysis in `.ai/specs/analysis/ANALYSIS-2026-08-13-production-module-architecture-roadmap-revision-2.md` is the architectural review input for this revision. This file is the product roadmap and source of truth for product boundaries.

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

Establish a small manufacturing kernel and eight Wave 0 foundation contracts before specifying discrete core entities. Keep discrete and process models as siblings, place authoritative concepts in the existing shared domains, capture immutable Manufacturing facts, and express every inter-module relationship as a hard runtime requirement, product/data prerequisite, or optional provider with explicit fallback.

For production inventory transactions, Manufacturing owns the business command and WMS owns its physical execution. The integration is semantic, atomic or durably compensatable, idempotent, reversible, tenant/organization/site scoped, and reconcilable. This boundary is a roadmap law for all later discrete, process, repetitive, subcontracting, and remanufacturing specs.

## Architecture Laws

- `catalog` owns product and variant identity and the unit-of-measure master.
- A minimal site/plant identity and effective site-to-warehouse role mapping exist before released manufacturing definitions or orders. A warehouse is not a permanent substitute for a plant.
- `wms` owns physical inventory, lots, serials, reservations, balances, locations, movements, and the physical inventory ledger.
- Manufacturing owns manufacturing definitions, order and operation intent, manufacturing confirmations, and manufacturing-specific history.
- Production issues, returns, and receipts are Manufacturing use cases executed through semantic WMS commands. Generic `manual` or `adjust` movements must not represent normal production postings.
- Shared `resources` owns reusable resource identity and base capacity; `planner` owns reusable calendars and availability rules. Manufacturing adds work-center and manufacturing constraint extensions through IDs, never duplicate masters.
- Every manufacturing definition used for execution is released atomically and versioned. An order retains immutable snapshots of the exact definition, documents, applicability, site, UoM conversions, and instructions used.
- The core captures non-reconstructable append-only facts from day one. Optional traceability, quality, costing, and intelligence modules derive advanced decisions, valuations, graphs, and read models from those facts.
- Cross-module data uses FK IDs plus snapshots where historical interpretation must survive module absence or later master-data changes. No direct ORM relationships cross module boundaries.
- Optional consumers own integration glue and degrade gracefully when peers are absent. A product dependency is not automatically a runtime `ModuleInfo.requires` dependency.
- All scoped records and operations validate `tenantId`, `organizationId`, and, where applicable, `siteId`; cross-scope links and postings fail closed.
- Commands, events, workers, optimistic locking, mutation guards, cache, queue, and progress use canonical Open Mercato mechanisms.
- Public contracts follow `BACKWARD_COMPATIBILITY.md`; additive changes must also be operationally backward compatible.
- The manufacturing kernel is a standalone package; every specialist model depends on the kernel, never on discrete `production`.
- `wms` owns the quality-aware availability projection and resolves an optional disposition provider; no other module recomputes availability.
- Lot/serial numbers are assigned by Manufacturing at production time from a site/type-scoped number range owned by the sites/`wms` numbering authority; WMS records and validates identity and uniqueness.
- Physical stock commitment lives only in WMS reservations/allocations; planning pegs are proposals that resolve into reservations at release.
- Released definitions carry valid-time effectivity; every fact carries transaction-time, source-event-time, and timezone; "as-of" queries resolve against valid-time.
- Manufacturing facts are domain events persisted in the module's own append-only store; the platform event bus is their transport and the fact store is the system of record.
- Client-specific data, terminology, rules, metrics, and integrations remain outside this OSS product roadmap until validated as generic product capabilities.

## Wave 0 Contract Decisions (Revision 3)

Revision 3 resolves eleven contract-shaping questions and three governance notes from `.ai/specs/analysis/ANALYSIS-2026-08-13-production-module-architecture-roadmap-revision-3.md`. These decisions are binding on Wave 0 and all later capability specs.

| # | Decision | Binding rule |
|---|---|---|
| C1 | Kernel is its own package | The manufacturing kernel ships as a standalone `manufacturing` package, not inside `production`. Discrete `production`, `production_process`, `production_repetitive`, and `production_remanufacturing` each depend on `manufacturing`, never on each other or on discrete `production`. |
| C2 | WMS owns the availability projection | WMS computes and serves quality-aware availability by resolving an optional disposition provider. No other module recomputes it. Present-but-unreachable provider fails closed; absent provider falls back to WMS-controlled availability. |
| C3 | Production assigns lot/serial numbers from a shared range | The lot/serial number is assigned at production time by Manufacturing, drawn from a site/type-scoped number range owned by the sites/`wms` numbering authority. Manufacturing supplies the pre-assigned identifier to WMS at posting; WMS records and validates uniqueness. Manufacturing never invents identity outside a valid range. |
| H1 | Backflush is a first-class posting mode | The WMS posting contract supports explicit issue AND backflush (issue-on-completion derived from the released definition), with a defined backflush point per operation, symmetric reversal, and precision cases. |
| H2 | Order networks are a reserved kernel seam | The kernel models parent/child production-order links and a hand-off policy (receive-to-stock vs. direct-issue). First core may support single-level only, but the seam is frozen now. |
| H3 | Minimal demand-signal contract | Planning consumes a provider-neutral demand contract: manually entered independent demand plus dependent demand from released orders. Sales/forecast are optional providers. Planning runs without any commercial demand module. |
| H4 | Facts are the module's own event store | Manufacturing facts are domain events persisted in the module's own append-only store. Correlation/causation IDs align with the platform event-bus envelope; the bus is transport, the fact store is system of record. Facts are neither the audit log nor a second copy of bus history. |
| M1 | Bitemporal time model | Every released definition carries valid-time (effectivity). Every fact carries transaction-time, source-event-time, and timezone. "As-of" queries resolve against valid-time. |
| M2 | WMS is the single source of committed stock | Physical commitment lives only in WMS reservations/allocations. Planning pegs are proposals that resolve into WMS reservations at release. No module persists a competing "committed" balance. |
| M3 | Facts capture an as-of valuation reference | At posting time, facts store a stable valuation reference (WMS posting id + valuation-context/as-of reference) sufficient for deterministic later costing. |
| M4 | Idempotency/dedup retention policy | Posting and confirmation contracts define an idempotency-key retention window and a dedup window beyond which a replayed message is rejected rather than deduplicated. |
| S1 | Spike-then-freeze for the hardest contracts | One explicitly non-shippable vertical spike (one site, one discrete order, explicit issue + backflush + output receipt through one WMS posting command, minimum facts) MAY be built to validate the atomicity, precision, backflush, and lot-numbering contracts before they freeze. It is marked throwaway and never becomes a de-facto contract. All other Wave 0 contracts freeze analytically. |
| S2 | Early bounded-context test for fuzzy pairs | Before splitting, `production_data_collection`↔`production_execution` and `production_tooling`↔`asset_management`↔`production_workforce` must pass the bounded-context gate; if they fail it, they ship merged. |
| S3 | Dependency diagram shows costing and pegging | The logical dependency map includes the costing read-model consumer and the planning peg → WMS reservation flow. |

### Manufacturing kernel package contents (C1)

The standalone `manufacturing` kernel owns only what every manufacturing model shares:

- release identity, site reference, product/item + UoM references, effectivity (valid-time);
- quantity/configuration applicability and readiness;
- the abstract released-definition and order/operation lifecycle contracts (state machine), implemented by sibling aggregates;
- the minimum append-only fact contract, correlation/causation IDs, and reversal/compensation semantics;
- the WMS posting interface (issue/return/scrap/output/reversal **and** backflush mode) and the MES/edge confirmation interface;
- reserved seams: alternate/parallel routing, overlap/setup/queue/move time, phantom explosion, rework/transform/disassembly/split-merge, order-network links, and orderless reporting.

The kernel owns no discrete-only or process-only aggregate. Discrete `ProductionDefinition`/`ProductionOrder` and process `Formula`/`Recipe`/`BatchOrder`/`Campaign` are sibling implementations in their own packages that depend on the kernel.

## Foundation Contracts Required Before the Core Spec

### 1. Site and warehouse scope

A minimal site foundation owns stable plant/site identity within a tenant and organization. It supports effective-dated mappings between a site and one or more WMS warehouses with explicit roles such as raw material, line-side, WIP, finished goods, quarantine, and shipping.

Every released manufacturing definition and order has a `siteId`. Warehouse mappings may change prospectively, but released definitions, orders, postings, and historical facts retain the site and warehouse-role snapshots needed for interpretation. The later `production_network` capability may extend the site model but must not introduce the first site identity.

The site foundation also owns site/type-scoped number ranges for production orders, batches, and lot/serial identity, guaranteeing uniqueness within tenant and organization. Manufacturing draws numbers from these ranges at production time; WMS records and validates the resulting lot/serial identity (see §4).

### 2. Resource, work-center, asset, staff, and calendar ownership

Reusable resource identity, capacity unit, and active state remain in `resources`; reusable timezone-aware availability rules remain in `planner`. Manufacturing owns work centers, routing applicability, setup/queue/move semantics, and manufacturing-specific resource extensions linked by scalar IDs.

Assets, tools, and people remain separate identities. Maintenance downtime, calibration state, tool life, skills, and qualifications are optional constraint-provider inputs to scheduling and execution. Scheduling never becomes the master of those states.

### 3. Released manufacturing definition

The shared manufacturing kernel defines release identity, site, product/item and UoM references, effectivity, quantity/configuration applicability, readiness, document package identity, and immutable revision semantics. It ships as a standalone `manufacturing` package (see "Manufacturing kernel package contents") that discrete and process models depend on; it encodes no model-specific aggregate.

Discrete manufacturing uses sibling aggregates such as `ProductionDefinition` and `ProductionOrder`. Process manufacturing uses `Formula`/`Recipe` and `BatchOrder`/`Campaign`. Releasing a definition atomically binds all applicable BOM/formula, routing/recipe, site, document, UoM, and readiness inputs. Creating an order freezes an exploded execution snapshot; later master-data changes never reinterpret existing work.

Extension seams must permit alternate/parallel routing, overlap, setup, queue and move time, phantom explosion, rework, transform, disassembly, split/merge, prototypes, parent/child order-network links, per-operation backflush points, and orderless reporting without changing the meaning of the discrete aggregate. The first core may support single-level orders only, but the parent/child order-network seam is frozen now so multi-level and configure/engineer-to-order flows are additive later.

### 4. Production-capable WMS posting contract

WMS must expose semantic manufacturing operations for reservation/allocation, component issue, component backflush (issue-on-completion), component return, output receipt, by-product/co-product receipt where applicable, scrap movement, transfer to/from external operations, and reversal. Each request carries tenant, organization, site, warehouse role, production order/operation, item/variant, lot/serial, quantity/UoM snapshot, actor/source, correlation ID, and idempotency key.

The contract must provide one of the following, chosen in the detailed spec:

- an atomic batch command that commits all required inventory changes together; or
- a durable saga with persisted step state, compensations, replay, and reconciliation.

Manufacturing owns orchestration and business validity. WMS owns stock validation and the resulting physical ledger entries. WMS returns stable posting identifiers; Manufacturing stores them in its append-only transaction facts. Reversal creates compensating records and never deletes history.

Backflush is a first-class posting mode: on operation/order completion WMS posts the derived component issues and the output receipt in one atomic unit, reverses them symmetrically on reversal, and is covered by the §6 precision cases. New reservation sources, movement reference types, and movement types are added additively to the WMS enums for production issue/return/scrap/output/backflush; `manual` and `adjust` must never represent production postings.

Lot/serial identity is assigned by Manufacturing at production time from the site/type-scoped number range (§1), so labels/travelers can be produced and offline capture works before posting. Manufacturing supplies the pre-assigned identifier on the output-receipt request; WMS records it and validates uniqueness, and never mints a competing identity.

WMS reservations/allocations are the single source of truth for committed physical stock. Planning pegs are proposals that resolve into WMS reservations at release; no module persists a competing committed balance.

Each posting request captures a stable as-of valuation reference (posting id plus valuation context) so `production_costing` can value the immutable facts deterministically. The contract defines an idempotency-key retention window and a dedup window beyond which a replayed request is rejected rather than deduplicated.

Before this contract is frozen, the existing `wms` hard requirement on `sales` must be extracted into optional sales-owned glue or explicitly approved as an intentional platform coupling. A manufacturing-only composition must not silently require Sales.

### 5. UoM precision and immutable conversions

Catalog remains the UoM master. The core spec must define variant policy, canonical normalization, rounding, allowable loss, and immutable conversion snapshots for definitions, orders, and postings.

The current Catalog precision and WMS `numeric(16,4)` storage differ. Wave 0 must either align supported precision safely or define validated conversion and rounding rules that prevent silent inventory drift. No BOM or order schema may freeze before this decision.

### 6. Minimum append-only manufacturing facts

The core records non-reconstructable facts with correlation and causation IDs: definition/order snapshots, operation state transitions, quantities started/completed/scrapped/reworked, resource/time confirmations when supplied, WMS posting IDs, consumed and produced lot/serial links, quality-state references, cost-driver quantities, an as-of valuation reference, and — on every fact — transaction-time, source-event-time, and timezone (valid-time effectivity lives on the released definition, per M1).

Manufacturing facts are domain events persisted in the module's own append-only store; the platform event bus is their transport and the fact store is the system of record. Reconciliation and replay authority are the fact store, not the bus and not the audit log.

These facts are the ERP manufacturing transaction history, not a substitute for WMS movements, the audit log, a genealogy graph, QMS decisions, or financial valuation. Append-only facts are not user-editable CRUD entities and are exempt from optimistic locking; commands that change operational state remain undoable through explicit reversal/compensation.

### 7. Quality disposition and planning availability

A foundational disposition/availability contract represents whether stock is unrestricted, held, quarantined, rejected, expired, or otherwise ineligible. WMS remains the source of physical quantities and owns the quality-aware availability projection, resolving an optional disposition provider that owns disposition decisions. MRP, ATP, allocation, and execution consume that single projection and never recompute eligibility independently. A present-but-unreachable provider fails closed; an absent provider falls back to basic WMS-controlled availability.

Without a QMS module, deployments retain basic WMS-controlled availability and no advanced inspection/CAPA behavior. Planning must never assume held or expired stock is usable merely because it exists physically.

### 8. ERP production ledger to MES/edge confirmation boundary

Manufacturing core is the Level 4 authority for released orders, permitted operations, material intent, and accepted manufacturing transactions. MES is the Level 3 authority for dispatch, operator interaction, detailed execution capture, and local sequencing within granted bounds.

The canonical confirmation contract covers partial/final confirmations, scrap, rework, resource/labor/machine time, sequence number, source timestamp and timezone, provenance, deduplication, ordering, acceptance/rejection, reversal, replay authority, offline capture, and reconciliation. MES or edge data becomes ERP truth only after Manufacturing validates and accepts it.

Telemetry/read paths are separate from machine command/control paths. Command support requires a dedicated safety and security profile, including zones/conduits, device and certificate lifecycle, allowlists, safety-interlock ownership, audit, replay protection, and reconciliation.

## Ownership Matrix

| Concept | Authoritative owner | Manufacturing responsibility | Integration rule |
|---|---|---|---|
| Product, variant, UoM master | `catalog` | Snapshot applicable IDs, quantities, conversions, and rounding | FK IDs plus immutable snapshots |
| Site/plant identity | Minimal shared site foundation | Require site on releases/orders/facts | Same tenant/organization; effective mapping |
| Warehouse, location, physical WIP stock | `wms` | Select role; request semantic postings | WMS commands and returned posting IDs |
| Resource identity/base capacity | `resources` | Manufacturing extension and work-center membership | Scalar IDs; no duplicate resource master |
| Calendars/availability rules | `planner` | Consume effective capacity snapshots | Provider/service contract; snapshot when released |
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
| Quality-aware availability projection | `wms` | Consume the projection | WMS resolves optional disposition provider; consumers never recompute |
| Lot/serial number range and identity | sites/`wms` numbering authority | Assign number at production time from the range | WMS records/validates uniqueness; Manufacturing never invents identity |
| Planning peg (supply↔demand link) | `production_planning` | Emit peg proposals | Pegs resolve into WMS reservations; WMS owns committed stock |
| Temporal/effectivity authority | Manufacturing kernel | Stamp valid-time on definitions, transaction/source time on facts | As-of queries resolve against valid-time |
| Demand signal | Minimal demand-signal contract | Consume independent + dependent demand | Sales/forecast are optional providers |
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
| Catalog and product master | Products, variants, UoM and conversions | Existing Catalog requirements | Product configuration, compliance | Manufacturing snapshots released values | Existing OSS foundation |
| Minimal sites | Site identity and effective warehouse roles | Auth/organization scope | Directory, network planning | Required before released production; no warehouse-as-site fallback | Dedicated spec decides package |
| WMS and inventory | Warehouses, locations, stock, lots, serials, reservations and movement ledger | Current code: Catalog, Sales, feature toggles; Sales coupling is a Wave 0 blocker | Sales and Manufacturing consumers | Physical ledger remains usable without manufacturing | Existing OSS foundation; sales glue must become optional consumer |
| Resources and calendars | Resource identity/capacity and planner availability rules | Current code: `resources` requires `planner` | Assets, workforce, manufacturing extensions | Released work snapshots applicable capacity inputs | Existing foundations; boundary frozen in Wave 0 |
| Attachments, audit and workflows | Generic files, audit evidence and workflow orchestration | Their existing package contracts | Document control, engineering and approvals | Manufacturing remains authoritative when workflow is absent | Existing foundations |
| Manufacturing kernel | Site/applicability/effectivity, released-definition contract, accepted facts and posting/confirmation interfaces | Auth/organization, Catalog, sites; exact runtime composition frozen by core spec | WMS posting provider, resources/calendars, documents, quality, MES | Cannot execute stock-affecting production without a compatible WMS provider | Standalone `manufacturing` package that all manufacturing models depend on; encodes no discrete- or process-only aggregate |

### Discrete core, engineering, and traceability

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production` | Discrete `ProductionDefinition`, BOM/routing releases, `ProductionOrder`, operation intent and manufacturing transactions | Manufacturing kernel and compatible WMS posting contract | Resources/planner, documents, workflows, quality, execution, costing | Manual ERP confirmations remain possible without MES/QMS/APS | Dedicated spec decides OSS/official placement |
| `production_engineering` | ECR/ECO, impact analysis, effectivity and release decisions | Catalog and released-definition contract | Workflows, documents, external PLM | Deterministic internal release lifecycle when workflows are absent | Dedicated spec decides placement |
| `production_document_control` | Controlled packages, checksums, revisions and release links | Attachments and released-definition contract | Engineering, signatures/compliance | Production snapshots package identity/hash; generic attachment alone is not controlled release | Dedicated spec decides placement |
| `production_traceability` | Genealogy graph/read models, recall and investigation | Minimum Manufacturing facts and WMS movement facts | Execution, quality, serialization/labeling | Base lot/serial correlations remain in core facts; no advanced graph UI | Dedicated spec decides placement |

Traceability consumes core/WMS/execution facts. `production_execution` must not hard-require the advanced traceability graph that depends on execution-produced facts.

### Planning and supply decisions

| Capability | Owned data | Hard runtime requirements | Soft integrations/providers | Snapshot/fallback when absent | Placement/licensing |
|---|---|---|---|---|---|
| `production_planning` | MRP scenarios, netting, pegging, proposals and exceptions | Minimal demand-signal contract (independent + dependent demand), released supply contracts, site policy, quality-aware availability | Substitute resolver, procurement/sales/forecast demand, external-operation sources | Runs on manual independent demand plus released-order dependent demand when sales/forecast providers are absent; primary released components used without optional substitution | Dedicated spec decides placement |
| `production_material_substitution` | Technical equivalence, directional substitutions and contextual eligibility | Catalog and released component applicability | Quality/compliance and inventory availability | Planning proceeds with primary material when resolver is absent | Optional provider before/inside MRP; not downstream of MRP |
| `production_network` | Cross-site sourcing, transfer proposals and distributed plans | Planning and minimal sites | WMS transfers, procurement | Single-site planning continues when absent | Dedicated spec decides placement |
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
organization/auth + catalog + minimal sites + number ranges
       |                 |                  |
       |                 |                  +--> resources + planner calendars
       |                 +--> WMS physical inventory + semantic posting contract
       |                          |          (WMS owns availability projection + reservations)
       |                          +--> quality-aware availability <-- quality/disposition provider
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
   demand signal (manual independent + dependent) --> MRP / supply planning
                  |                                <---- optional substitution/source providers
                  |            (planning emits pegs --> resolve into WMS reservations)
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

### Wave 0: architecture and contract readiness

All gates below must pass before the detailed `production` core spec is approved:

1. Minimal site identity and effective site-to-warehouse roles are specified, including tenant/organization invariants and migration/backfill strategy.
2. Resource, work-center, asset, staff, and calendar ownership is frozen against the actual `resources` and `planner` contracts.
3. Released-definition and immutable order/document/UoM snapshot semantics are specified for discrete and process sibling models.
4. WMS supports named production reservation/issue/return/output/scrap/reversal semantics with atomicity or durable saga behavior, stable posting IDs, idempotency, and reconciliation.
5. WMS-to-Sales hard coupling is removed from the manufacturing composition or consciously approved and documented.
6. Quantity precision and rounding pass reference cases for fractional consumption, conversion, reversal, partial completion, and cumulative drift.
7. Minimum manufacturing facts and the ERP-to-MES confirmation lifecycle cover partial, final, duplicate, out-of-order, offline, rejected, reversed, and replayed confirmations.
8. Quality-aware availability excludes held/quarantined/rejected/expired stock from MRP/ATP and allocation reference scenarios.
9. Dependency tables distinguish hard runtime requirements from product prerequisites and optional providers; disabled-module tests are planned.
10. The full backward-compatibility, risk, security, queue/progress, and integration-test gates below are accepted.
11. The manufacturing kernel is specified as a standalone package with the contents in "Manufacturing kernel package contents"; no specialist model requires discrete `production`.
12. Lot/serial numbering authority, number-range ownership, and the production-assigns/WMS-records direction are specified; backflush is a defined posting mode with symmetric reversal and precision cases.
13. The bitemporal time model, the facts-as-module-event-store rule, the WMS-owned availability projection, single-source-of-truth reservations, the as-of valuation reference on facts, and the idempotency/dedup retention windows are all specified.
14. The minimal provider-neutral demand-signal contract and the reserved parent/child order-network seam are specified.

One explicitly non-shippable validation spike (single site, single discrete order, explicit issue, backflush, and output receipt through one WMS posting command, minimum facts) MAY be built to empirically validate the atomicity, precision, backflush, and lot-numbering contracts before they freeze; it is marked throwaway and never becomes a de-facto contract. All other Wave 0 contracts freeze analytically.

### Later capability waves

After Wave 0, capabilities may be specified independently when customer evidence, architecture readiness, and package/licensing decisions exist. No ordering in the landscape is a delivery promise. Every capability spec must demonstrate that its aggregate/lifecycle is independently coherent and that optional peers can be disabled safely.

## Mandatory Validation Scenarios for Detailed Specs

- Discrete release and order creation retain exact site, definition, document, and UoM snapshots after masters change.
- A component issue plus output receipt is atomic or recoverably reconciled after failure at every step.
- Repeated requests with the same idempotency key do not double-consume or double-receive stock.
- Reversals preserve both Manufacturing and WMS histories and restore quantities within defined rounding tolerance.
- Cross-tenant, cross-organization, cross-site, and invalid warehouse-role requests fail closed.
- Held, quarantined, rejected, and expired lots are unavailable to planning and allocation under the defined policy.
- MES confirmations handle partial/final, duplicate, out-of-order, offline, rejected, corrected, and reversed messages.
- Advanced traceability reconstructs genealogy from core/WMS/execution facts without becoming a prerequisite for fact production.
- MRP works without a substitution provider; ATP works without APS; CTP reports unavailable when finite scheduling is absent.
- Scheduling consumes optional asset/tool/workforce constraints without those provider domains depending on APS.
- Discrete and process orders coexist without sharing incompatible aggregate semantics.
- Every optional integration has a disabled-module test and documented fallback.
- Long-running MRP/APS/intelligence jobs use queue workers, progress jobs, bounded concurrency, idempotent retries, and scenario retention limits.
- Backflush completion posts component issues and output receipt atomically, reverses symmetrically, and stays within rounding tolerance across repeated cycles.
- A lot/serial number pre-assigned at production time (including offline) is accepted and validated as unique by WMS at posting, with no parallel identity.
- Parent/child production orders hand off WIP under the defined policy without double-counting quantity.
- An "as-of" query returns the definition and disposition valid on a past date after later master-data and effectivity changes.
- MRP runs on manual independent demand plus released-order dependent demand with no sales/forecast provider present.
- Availability is served only by the WMS projection; no consumer recomputes held/quarantined/expired eligibility independently.
- Idempotency/dedup stores honor the retention window; a replayed message beyond the window is rejected, not silently deduplicated.
- No specialist manufacturing model (`production_process`, `production_repetitive`, `production_remanufacturing`) declares a runtime requirement on discrete `production`.
- Every affected API path and key UI path has self-contained integration tests with fixture setup and cleanup.

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
| High | Partial or duplicate production posting diverges Manufacturing and WMS ledgers | Atomic batch or durable saga, idempotency sequence, compensations, reconciliation job and mismatch alert | External outages can delay convergence but not lose state |
| High | Production issues/receipts are modeled as generic WMS adjustments, losing business meaning and authorization | Manufacturing-owned semantic commands; WMS posting IDs; contract tests reject generic types | Legacy manual corrections remain distinct and require audit |
| High | Minimum genealogy, cost, or quality facts are absent until optional modules are installed | Append-only core facts and immutable correlations from first release | Advanced historical views remain limited to captured facts |
| High | Catalog/WMS precision mismatch creates cumulative inventory drift | Wave 0 precision decision, conversion snapshots, tolerance/reversal reference tests and reconciliation metrics | Physical measurement variance remains a domain policy |
| High | Quality-blind availability plans held or expired stock | Quality-aware availability projection, fail-closed eligibility and scenario tests | Provider outage may reduce available stock conservatively |
| High | Discrete aggregates are reused for process manufacturing and later require semantic breaking changes | Small shared kernel plus sibling aggregates and extension seams | Some hybrid flows may require new additive orchestration |
| High | Dependency graph creates cycles or forces Sales/MES/QMS in minimal deployments | Hard/soft matrix, optional-consumer glue, module-decoupling tests, WMS-Sales Wave 0 gate | Deployment policies may deliberately require optional capabilities |
| High | Kernel placed inside discrete `production`, forcing process/repetitive/reman to depend on discrete semantics | Standalone `manufacturing` package; siblings depend on kernel; module-decoupling test asserts no `requires` on `production` | Hybrid flows may need additive kernel seams |
| High | Availability recomputed inconsistently across MRP/ATP/allocation/execution | WMS owns a single availability projection; consumers call it; contract tests | Provider outage reduces available stock conservatively |
| Medium | Lot identity invented in two places (production vs WMS) breaks genealogy | Production assigns from the sites/WMS-owned range; WMS validates uniqueness | Offline pre-assignment needs reconciliation on reconnect |
| Medium | Backflush omitted from posting contract, blocking repetitive/lean and drifting quantities | Backflush as a first-class posting mode with symmetric reversal and precision cases | Physical measurement variance remains a domain policy |
| Medium | Planning pegs and WMS reservations diverge on committed stock | WMS is single source of truth; pegs are proposals resolving into reservations | Late peg changes require re-reservation |
| Medium | Bitemporal/effectivity retrofitted onto frozen fact schema | Valid-time on definitions and transaction/source time on facts from day one | Time-zone and clock-skew policy remains operational |
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
| Minimal `sites` foundation | Plant identity and plant-to-warehouse roles | Define plants and their raw-material, line-side, WIP, finished-goods, quarantine, and shipping warehouse roles. |
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

## External Research Signals

Enterprise suites consistently separate manufacturing, planning, execution, quality, warehouse, maintenance, PLM, costing, and connectivity while integrating them through controlled contracts. The following references support the capability landscape and the site/resource/ERP-MES boundaries; they do not define Open Mercato's package structure:

- [ISA-95 enterprise-control system integration](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
- [Siemens Opcenter MOM](https://www.siemens.com/en-gb/products/opcenter/)
- [Siemens OT-to-MES architecture](https://www.siemens.com/en-us/content/architecture-hub/op-center/)
- [Oracle Manufacturing](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/overview-of-oracle-manufacturing-cloud.html)
- [Oracle Fusion SCM applications](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faips/about-oracle-fusion-cloud-supply-chain-manufacturing.html)
- [Dynamics 365 production lifecycle](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/production-process-overview)
- [Dynamics 365 master planning](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-home-page)
- [Infor industrial manufacturing portfolio](https://www.infor.com/en/industries/industrial-manufacturing)
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
| Quality and availability order | Pass | Foundational disposition precedes MRP/ATP; full QMS remains optional. |
| Asset/tool/workforce direction | Pass | Providers feed scheduling and do not require APS. |
| Traceability/execution cycle | Pass | Traceability consumes facts; execution does not require the graph. |
| API/data/UI consistency | N/A | Detailed contracts are intentionally deferred. |
| Risks cover critical cross-module writes | Pass | Atomicity/saga, idempotency, reversals, precision, isolation, and reconciliation are covered. |

### Verdict

**Roadmap architecture approved conditionally.** It is suitable to govern product discussion and Wave 0 foundation specs. The detailed `production` implementation spec remains blocked until all Wave 0 gates pass.

## Changelog

- 2026-08-13: Reframed the document as the Manufacturing product roadmap and capability architecture.
- 2026-08-13: Added Wave 0 foundation contracts for sites, shared resources/calendars, released definitions, WMS postings, UoM precision, minimum facts, quality-aware availability, and ERP-MES confirmations.
- 2026-08-13: Established that production issues, returns, and receipts belong to Manufacturing while WMS executes and owns physical inventory postings.
- 2026-08-13: Replaced ambiguous dependencies with hard/runtime, soft/provider, fallback, and placement semantics; corrected traceability, quality, asset, connectivity, substitution, ATP/CTP, and process-model directions.
- 2026-08-13: Added ownership, backward-compatibility, risk, validation, readiness, and compliance sections based on the revision-2 architecture review.
- 2026-08-13: Added a business-facing module catalogue explaining responsibility and user capabilities for each roadmap area.
- 2026-08-13 (Revision 3): Added the "Wave 0 Contract Decisions" section resolving C1–C3, H1–H4, M1–M4, and S1–S3 from the revision-3 analysis; froze the kernel as a standalone `manufacturing` package with defined contents.
- 2026-08-13 (Revision 3): Made WMS the owner of the quality-aware availability projection and the single source of truth for committed stock; planning pegs are proposals.
- 2026-08-13 (Revision 3): Fixed lot/serial numbering direction (production assigns from a sites/WMS-owned range; WMS records/validates), added backflush as a first-class posting mode, a bitemporal time model, an as-of valuation reference, idempotency/dedup retention, the facts-as-module-event-store rule, a minimal demand-signal contract, and the parent/child order-network seam.
- 2026-08-13 (Revision 3): Expanded Wave 0 gates (11–14), risks, validation scenarios, ownership matrix, and the dependency diagram (now shows costing and the peg→reservation flow) to match the above.

### Review - 2026-08-13

- **Reviewer**: Agent
- **Security**: Passed at roadmap level; detailed OT, encryption, and endpoint controls remain gated by capability specs.
- **Performance**: Passed at roadmap level; long-running workloads require queue/progress and bounded concurrency.
- **Cache**: N/A; no read API or cache contract is defined in this roadmap.
- **Commands**: Passed at roadmap level; semantic commands, idempotency, reversal/compensation, and reconciliation are mandatory.
- **Risks**: Passed; concrete severity, detection, mitigation, and residual risk are documented.
- **Verdict**: Approved as product roadmap; detailed `production` spec remains blocked by Wave 0.

### Review - 2026-08-13 (Revision 3)

- **Reviewer**: Agent
- **Input**: `.ai/specs/analysis/ANALYSIS-2026-08-13-production-module-architecture-roadmap-revision-3.md`
- **Decisions applied**: C1 kernel as standalone package (+ defined contents); C2 WMS owns availability projection; C3 production-assigns/WMS-records lot numbering from a shared range; H1 backflush posting mode; H2 order-network seam; H3 minimal demand-signal contract; H4 facts-as-module-event-store; M1 bitemporal model; M2 WMS single source of committed stock; M3 as-of valuation reference; M4 dedup/idempotency retention; S1 optional throwaway spike; S2 early bounded-context test; S3 diagram shows costing + pegging.
- **Verdict**: Roadmap architecture ready for Wave 0 contract authoring. All revision-3 findings are resolved at roadmap level. The detailed `production` core spec remains blocked until the Wave 0 gates (now 14 + spike allowance) are individually specified and passed.
