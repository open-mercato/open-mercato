# Manufacturing Wave 0 — Business Scope

## Document metadata

- **Type:** business scope for the Manufacturing Wave 0/MVP programme
- **Status:** scope closed by product-owner decisions
- **Decision date:** 9 September 2026
- **Supersedes:** earlier Manufacturing MVP business-scope drafts
- **Next step:** split the scope into small slice specifications and deliver them as an end-to-end sequence

> Wave 0 is delivered as a sequence of independently reviewable slices and has one MVP definition. A slice or gate is not a separate MVP and cannot remove a capability required by the final end-to-end process. Earlier roadmaps, backlogs, prototypes, and specifications remain historical or technical context unless they are explicitly aligned with this document.

This document defines the business result that must work for a user. It is not a technical specification. It does not decide the database model, API shape, events, migrations, screens, or implementation mechanism. Those decisions belong in the relevant slice specification as long as they do not change the product boundary, the meaning of facts, or the acceptance criteria defined here.

## 1. Business outcome

Wave 0 delivers a simple, manually controlled, auditable core for discrete production. An authorised user can:

1. define a single-level BOM for a product variant;
2. prepare a draft BOM revision and release it for use;
3. create an order using a manually selected released BOM revision;
4. issue materials manually from a WMS location;
5. return materials to inventory;
6. record partial good output and scrap, while receiving good output into inventory;
7. complete or cancel the order;
8. reverse an incorrectly posted document without deleting history, when WMS accepts the compensating movement;
9. find an order and reconstruct its production facts and inventory effects.

Wave 0 records what actually happened instead of forcing execution to match the plan. The plan remains a reference point; actual materials, quantities, and output may differ from it.

## 2. Customer problem and value

Small discrete-production and assembly teams often keep BOMs, production orders, and inventory movements in separate spreadsheets, documents, or employee knowledge. This creates duplicate data entry, anonymous inventory movements, weak traceability, and unclear correction of mistakes.

Wave 0 provides:

- one place to define the material structure;
- an order connecting the plan with actual issues, returns, and receipts;
- a clear separation between the current plan and posted facts;
- support for partial execution;
- durable movement history and full-document reversals;
- basic access control;
- a simple operational order list.

The MVP does not optimise production, calculate demand, schedule capacity, or control the shop floor.

## 3. Supported operating profile

Wave 0 is intended for order-driven discrete production where:

- material, component, and finished-product variants can be handled without lots, serial numbers, or expiry dates;
- material reservation is not required;
- work can be controlled manually at order level;
- the basic product-variant and base-unit model supplied by Catalog is sufficient;
- users accept that routing, operations, MES, advanced scheduling, and finite-capacity planning are out of scope.

Wave 0 supports only variants for which the effective WMS policy does not require lot, serial-number, or expiry tracking. Genealogy, reservations, multi-level execution, child orders, and operation-level shop-floor control are outside this profile.

## 4. Ownership boundaries

### 4.1 Manufacturing owns

- product-variant BOMs, revisions, and BOM lines;
- the production order, its current plan, number, and status;
- the production meaning of issue, return, confirmation, scrap, receipt, and reversal;
- production facts and their references to inventory effects.

### 4.2 WMS owns

- sites, warehouses, zones, and locations;
- physical stock and availability;
- physical inventory movements;
- lots, serial numbers, expiry dates, reservations, and inventory policies.

Manufacturing must not create a parallel Site or inventory ledger. Manufacturing sends movement intent to WMS; WMS makes the final decision according to its own rules, including whether negative stock is allowed. WMS re-evaluates its current policy for every movement.

The absence of a Site contract does not block the Wave 0 process. Site selection, location filtering, and Site-membership validation are follow-up integration work after WMS provides that contract.

### 4.3 Catalog owns

Catalog owns products, variants, and base units of measure. Manufacturing references those records and must not maintain a parallel product catalogue. Manufacturing permissions do not replace the required Catalog or WMS permissions.

## 5. BOM and revisions

### 5.1 Structure

A BOM identifies a finished product variant, a positive base quantity, and direct component variants with positive proportional quantities. The same component variant may appear more than once as separate BOM lines. Lines are not merged before plan calculation; each line is rounded separately, while execution facts and variance are aggregated by component variant.

Wave 0 uses the product's base Catalog unit only. Additional units, conversions, expected yield, and fixed per-order consumption are deferred.

### 5.2 Structural boundary

Wave 0 uses a single-level BOM. A line points directly to the component issued to the order. The system does not build a BOM tree, expand material requirements, detect cross-BOM cycles, or execute child BOMs. Multi-level BOM execution is a later stage.

### 5.3 Revisions

BOMs have draft and released revisions. A draft revision cannot be selected for a production order. The user manually selects an available released revision.

A released revision is immutable. Changing the definition requires another revision. Existing orders keep the selected revision as their reference. Availability can be disabled for new orders and later restored without changing the revision content; existing orders retain their reference.

Releasing an empty BOM is allowed but marks it as incomplete and shows a warning before use. A saved BOM line must still reference an existing component variant and a positive quantity. Before release, Manufacturing checks the effective WMS policy for the finished variant and every component variant.

An optional note is supported. Attachments, controlled documents, and engineering-document links are outside Wave 0.

## 6. Production order

An order identifies a finished variant, a positive planned quantity, one issue location, one receipt location, and a manually selected available released BOM revision. The finished variant must match the variant identified by the revision.

Before creation, Manufacturing rechecks the effective WMS policy for the finished variant and all BOM components. Creation is blocked when any of these variants requires lot, serial-number, or expiry tracking.

The system assigns a simple organisation-unique order number. The number is stable and searchable. Configurable numbering schemes, separate series, and resets are deferred. An optional due date is organisational information only; it does not automatically change status or block execution.

At creation, the order stores the current material plan derived from the selected revision and planned quantity. Before the first execution operation, the user may replace the product, compatible BOM revision, planned quantity, and default locations. After the first execution operation, the product and BOM revision are immutable; quantity and locations may still change. The material plan is recalculated from the current revision and quantity, and is not edited line by line.

Wave 0 statuses are **Draft**, **Released**, **In progress**, **Completed**, and **Cancelled**. Status is a deliberate user declaration. An issue, return, or confirmation does not change it automatically. Status does not post inventory.

Draft orders cannot receive a new issue or confirmation until the user releases the order. Completed orders may still receive new material issues, returns, production confirmations, and reversals. Cancellation is rejected while an issue or production-confirmation operation is in progress or has an unresolved result. Cancelled orders cannot receive new issues or confirmations, but returns and reversals of previously posted documents remain possible. Cancellation is irreversible in Wave 0.

The operational list supports search by order number and filtering at least by product variant, status, and due date.

## 7. Production execution

Wave 0 records actual execution and does not add hidden business restrictions. A user may issue a material not listed in the BOM, issue more or less than planned, confirm more or less than planned, and complete an order at any level of execution. Those differences remain visible as variances.

User-entered quantities are positive and have no more than four decimal places. Automatically calculated plan quantities are rounded to four decimal places using half-up rounding. Invalid or over-precise input is rejected with a clear message.

### 7.1 Manual material issue

Issues are explicit, user-triggered operations. An issue:

- belongs to one order;
- records the selected material, quantity, and location;
- changes stock only through WMS;
- is posted only after WMS accepts the movement;
- records a durable document, production fact, and WMS correlation;
- can be retried idempotently with the same `operationId`.

The supported compatibility profile may limit a document to one WMS movement when shared transaction support is unavailable. The preferred profile uses the WMS transaction seam for an all-or-nothing multi-line document.

### 7.2 Material return

A return is a separate inventory receipt fact. It does not edit the earlier issue. A return may exceed the earlier issue or may return material that was not issued earlier; both are explicit, visible variances and remain subject to WMS policy.
The return uses the Work Order's current issue location at posting time and persists that location as an immutable snapshot on the return document and production fact.

### 7.3 Production confirmation and receipt

A confirmation contains a positive good quantity or a positive scrap quantity. A good quantity creates the finished-goods receipt in WMS as part of the same business action. Scrap remains a production fact and does not create an inventory movement in Wave 0.

A confirmation containing only scrap creates no zero-quantity WMS receipt. A confirmation containing good output and scrap creates one production fact plus the applicable finished-goods receipt.

Partial confirmations are allowed. Multiple confirmations produce separate facts, and the order remains auditable as a sequence of actual results.

### 7.4 WMS result handling

Every issue, return, production confirmation, and reversal has a durable `operationId` owned by Manufacturing.

A known WMS rejection creates no posted Manufacturing document or fact. The user may correct the input and start a new operation with a new identifier.

Known rejections are durable operation results. Retrying a rejected operation with the same `operationId` and the same payload returns the stored rejection without another WMS call, document, fact, or movement. Reusing an `operationId` with a different payload is always rejected without another WMS call, document, fact, or movement.

An unknown result blocks a new operation for the same action until the user reads the result or safely retries with the same `operationId`. A safe retry must return the earlier accepted or rejected result and must not create a duplicate document, fact, or movement.

## 8. Facts, history, and correction

Manufacturing distinguishes three concepts:

1. the user-facing production document;
2. the immutable production fact;
3. the physical WMS movement.

The order detail and history show those concepts separately while keeping their correlation visible. Posted documents and facts are not edited or deleted. The order plan may change without rewriting historical execution.

A correction reverses the full original document and creates a new compensating document. It uses the immutable snapshot of variants, quantities, and locations stored on the source document, never the Work Order's current plan or defaults. It does not mutate or delete the source. Each document may be reversed only once. A reversing document may itself be reversed once, creating a directly linked correction chain. The history shows the full chain and the net inventory effect.

Reversal remains subject to WMS approval. A rejected reversal leaves the source document active and creates no accepted correction fact.

## 9. Access control

Wave 0 keeps four independent capability areas:

- BOM and definition management;
- production-order management;
- production execution;
- corrections and history.

Each area includes the minimum read context needed to perform its own work and does not silently depend on another Manufacturing grant. Execution and correction also require the relevant WMS permissions. Missing WMS permission blocks the operation without creating a document, fact, or movement.

## 10. Wave 0 blocking boundary

The following rules may block an action because they protect the meaning or integrity of the MVP:

- invalid product/BOM pairing;
- missing or non-positive required quantities;
- unsupported WMS tracking policy;
- missing required location or permission;
- known WMS rejection;
- duplicate operation or an unresolved operation with an unknown result;
- cancellation while an issue or production-confirmation operation is in progress or has an unresolved result;
- reuse of an `operationId` with a different payload;
- editing a released BOM revision;
- issuing or confirming a cancelled or draft order where the action is not allowed;
- reversing a document more than once;
- overwriting a record after an optimistic-lock conflict.

Variances from plan or BOM are informational and must not be turned into hidden blockers by a slice specification.

## 11. Delivery gates

### Gate A — definitions

Users can create, edit, inspect, release, disable, and revise BOMs. Released revisions are immutable, and the supported WMS policy is checked before release.

### Gate B — orders

Users can create and inspect an order, select a released revision, review the calculated material plan, change the pre-execution basis, and manage the declared status.

### Gate C — execution and history

Users can issue, return, confirm good output, record scrap, inspect facts and WMS effects, handle known and unknown WMS results, and perform a full correction chain.

No gate alone is the MVP. The final acceptance is the complete business flow from BOM to order, inventory movements, history, and correction.

## 12. Completion criteria

### 12.1 End-to-end business acceptance

The acceptance walkthrough must demonstrate at least:

1. creation and release of a single-level BOM;
2. creation of a compatible production order;
3. a material issue accepted by WMS;
4. a material return;
5. a partial or full production confirmation;
6. a finished-product receipt;
7. a scrap-only confirmation without a false WMS movement;
8. an order status change without an automatic inventory movement;
9. visible plan, facts, and variances;
10. an immutable history with document and WMS references;
11. a known WMS rejection without a posted fact;
12. safe retry of an unknown result without duplication;
13. a full document reversal and visible net effect.

### 12.2 Safety and integrity gate

Automated checks must cover tenant and organisation scoping, access control, optimistic locking, WMS mutation guards, cancellation versus in-flight or unresolved operations, idempotency for accepted and rejected replay plus payload mismatch, durable operation correlation, unknown-result retry behaviour, correction-chain integrity, immutable reversal snapshots, return-location snapshots, and the supported transaction/fallback profile.

## 13. Explicit Wave 0 exclusions

The following are intentionally outside the first release:

- multi-level BOM execution and automatic child orders;
- backflush;
- routing, operations, Work Centers, MES, finite scheduling, and APS;
- MRP and demand planning;
- costing and production accounting;
- quality management and regulatory genealogy;
- lots, serial numbers, expiry dates, reservations, and advanced traceability;
- automatic revision selection by date or effectivity;
- alternative BOMs and managed substitutes;
- mandatory reasons, reason dictionaries, and mandatory notes;
- item-level corrections or partial-document corrections;
- inventory-managed scrap;
- reopening cancelled orders;
- attachments, engineering instructions, and controlled documents;
- expanded order numbering;
- Site selection and Site-based location filtering until WMS provides the contract;
- additional units of measure, conversions, yield, and fixed per-order consumption;
- history of every intermediate plan edit;
- automatic retry, scheduled reconciliation, generic sagas, and a reusable workflow platform.

None of these may be added implicitly by a slice specification or used as a hidden condition for Wave 0 acceptance.

## 14. Planned increments

The programme is delivered through small, reviewable increments:

1. bootstrap the opt-in Manufacturing package and module;
2. define BOM drafts, revisions, release, and WMS-policy checks;
3. define production-order CRUD, snapshot, plan calculation, and status;
4. implement manual issue, return, confirmation, receipt, and scrap facts;
5. add history, evidence, idempotency, unknown-result handling, and full reversal;
6. connect the final flow to the end-to-end acceptance scenario.

Each increment must state its prerequisites, ownership boundary, acceptance evidence, and explicit non-goals.

## 15. Decisions reserved for slice specifications

Slice specifications decide only how to deliver the approved behaviour. They must cover architecture, data model, API contracts, security, concurrency, failure handling, migrations, and tests for their own slice.

They may decide the exact list layout, warning copy, modal structure, grouping of lines, history presentation, status controls, and technical fallback details. They may not introduce backflush, child orders, mandatory reasons, blocking variance rules, or any other excluded capability without an explicit product-scope change.

## 16. Business risks and response

| Risk | Wave 0 response |
|---|---|
| Users mistake the plan for a hard execution constraint | Show plan, facts, and variances separately; allowed variances remain non-blocking. |
| Manual flexibility reduces data quality | Preserve immutable facts and make deviations visible. |
| Status is confused with inventory movement | Status changes never post inventory and are shown separately from facts. |
| Plan edits rewrite execution history | Facts are immutable and plan changes do not mutate posted movements. |
| A retry duplicates a real movement | Manufacturing owns a durable `operationId` and reuses it for safe retry. |
| A WMS failure leaves a partial business result | Prefer a shared transaction; use a single-movement fallback profile when necessary. |
| Corrections become unreadable | Link every reversal directly to its predecessor and show the net chain effect. |
| Manufacturing starts owning stock or Sites | Keep physical stock, locations, policies, and Site ownership in WMS. |
| Users apply the MVP to unsupported traceability processes | Block unsupported WMS policies and state the operating profile clearly. |

## 17. Formal acceptance rule

Wave 0 is complete only when the end-to-end business walkthrough and the automated safety/integrity gate are both green. Screens, individual CRUD operations, or isolated unit tests are not sufficient. The result must be one coherent process from BOM through order, manual inventory effects, confirmation, history, and full reversal.

Customer pilots, market validation, organisation count, reuse frequency, and reduction of spreadsheet work are a follow-up discovery stage after MVP acceptance. They do not change the Wave 0 completion definition.

## 18. Topics after Wave 0

Post-Wave 0 decisions may cover multi-level execution, cycle detection, advanced quantity and UoM rules, nested BOM snapshots, item-level corrections, WMS policy inheritance, Site integration, production planning, routing, MES, quality, costing, and external pilot validation.

Each topic requires a separate business decision and specification. None may be added silently to Wave 0.

## 19. Source and precedence

This document is the English repository edition of the business-scope source decided on 9 September 2026. The source document, earlier roadmaps, backlog items, prototypes, and technical analyses are context only. They cannot restore a removed requirement, add a hidden business restriction, or change the acceptance criteria without an explicit update to this document.

## 20. Changelog

### 16 September 2026 — review clarifications

- defined cancellation behaviour for in-flight and unresolved issue or production-confirmation operations;
- made accepted and rejected operation replay and payload mismatch handling explicit;
- bound reversals and material returns to immutable location and execution snapshots;
- enumerated the facts allowed after completion and expanded the future safety-gate coverage.

### 9 September 2026 — reviewed scope

- separated end-to-end business acceptance from the automated safety gate;
- clarified component aggregation and per-line plan rounding;
- defined the pre-execution plan-edit boundary;
- separated the four access-control areas;
- defined known-rejection and unknown-result retry behaviour;
- defined full-document reversal and correction chains;
- made `operationId` a Manufacturing-owned identifier;
- documented the preferred shared-transaction profile and the limited fallback profile;
- recorded the explicit post-Wave 0 exclusions.
