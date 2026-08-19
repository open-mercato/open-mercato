# Manufacturing Multi-Level BOM Drafts

## TLDR

P1.4 adds tenant- and organization-scoped authoring of standalone, versioned, multi-level bill-of-materials drafts inside the opt-in `manufacturing` module. A BOM family targets one Catalog product and optionally one variant; it owns one editable draft revision whose direct component lines retain stable occurrence identity, exact quantities, consumption basis, yield, position, and explicit `stock | produce` supply mode.

This slice provides CRUD, API, UI, commands with undo, and a bounded read-only tree preview. It introduces no release lifecycle, immutable released snapshot, routing/operation link, inventory effect, import/export, alternative BOM, substitution, phantom behavior, or production order.

**Status:** Skeleton with owner-approved design decisions. Repository research, market benchmark, detailed contracts, checklist review, and final compliance review remain required before implementation readiness.

**Tracker:** [Issue #5393](https://github.com/open-mercato/open-mercato/issues/5393), under [Wave 0 tracker #5386](https://github.com/open-mercato/open-mercato/issues/5386).

## Overview

Open Mercato needs a useful Manufacturing authoring increment before released definitions and WMS-backed execution are ready. P1.4 supplies that increment without coupling draft composition to routing, Sites, inventory, or production-order behavior.

The capability uses three normalized records:

```text
ManufacturingBom
  └─ ManufacturingBomRevision (maximum one active draft)
       └─ ManufacturingBomLine[] (direct component occurrences)
```

Multi-level structure is derived rather than stored as one nested document. A `produce` line resolves the component's BOM family, preferring a variant-specific family over the product-level fallback. A `stock` line is always a leaf. P1.4 preview follows active drafts; P1.7 will later own authoritative released-revision selection by Site and business-effective date.

## Problem Statement

Without a dedicated draft-authoring contract, the first implementation could merge repeated components, store an unqueryable JSON tree, couple BOMs to routing or WMS, allow concurrent edits to introduce cycles, or freeze release semantics prematurely. It could also make a BOM inseparable from a single production definition, preventing safe reuse and revision history.

P1.4 must establish a cohesive authoring aggregate that is valuable on its own while leaving release, execution, planning, and stock ownership to their named Wave 0 work items.

## Accepted Design Decisions

| Decision | Accepted rule |
|---|---|
| Aggregate ownership | BOM is a standalone, versioned aggregate; a later `ProductionDefinition` references a BOM revision. |
| Draft lifecycle | A draft revision is editable with optimistic locking. Release freezes it; later changes clone a new draft from the prior revision. Release/clone behavior belongs to P1.7. |
| Catalog target | `productId` is required and `variantId` is optional. A variant-specific BOM wins over the product-level fallback. |
| Family uniqueness | Wave 0 permits one BOM family for each product-level or product+variant target. Alternative BOM families are deferred. |
| Multi-level storage | Each revision stores direct components only; child levels are resolved through component BOM families. |
| Revision identity | The system allocates a monotonically increasing revision number; a user-supplied revision label is optional. |
| Concurrent drafts | A BOM family has at most one active draft. Parallel draft branches and merge behavior are deferred. |
| Cycle policy | A line mutation that would create a direct or indirect `produce` cycle is rejected; cyclic drafts are never persisted. |
| Routing boundary | P1.4 contains no operation/routing reference. P1.5 may add an optional link after its routing contract is approved. |
| Import/export | P1.4 contains no import/export. A separate follow-up may add bounded import/export after the schema is stable. |
| Supply mode | Every line explicitly selects `stock` or `produce`; the default is `stock`. |
| UI boundary | P1.4 includes family/draft CRUD, direct-line editing, ordering, and bounded read-only tree preview. |

## Proposed Boundary

### In scope

- `ManufacturingBom`, `ManufacturingBomRevision`, and `ManufacturingBomLine` persistence in `manufacturing`;
- tenant/organization isolation and scalar Catalog product, variant, and UoM IDs;
- one product-level family and one family per concrete variant;
- one active draft per family and atomic revision-number allocation;
- exact base-output and component quantities through the Catalog-owned UoM resolver;
- occurrence-preserving direct lines with stable ID and position;
- `consumptionBasis: variable | fixed`, `yieldFactor` in `(0, 1]`, and `supplyMode: stock | produce`;
- transactional create/update/delete/reorder commands with undo and optimistic locking;
- direct and indirect cycle prevention, including concurrent graph mutations;
- variant-first/product-fallback child resolution for bounded draft-tree preview;
- canonical `DataTable`, `CrudForm`, guarded mutations, ACL, i18n, OpenAPI, and error contracts;
- disabled-peer tests proving draft authoring works without WMS, `resources`, or `planner`.

### Out of scope

- BOM release, effectivity, Site applicability, immutable definition snapshots, or cloning after release (P1.7);
- routing, operations, Work Centers, or line-to-operation assignment (P1.5/P1.6);
- production definitions, orders, confirmations, facts, or execution (P1.7/P1.9/P1.10);
- WMS reservation, issue, backflush, receipt, scrap, reversal, or reconciliation (P1.8/P1.11);
- alternative BOM families, substitutes, alternates, phantom flattening, unit/serial effectivity, or automatic child-order creation;
- import/export, custom fields, bulk actions, saved views, advanced search, approval workflows, or document control.

## Architecture Direction

All writes use canonical commands. Creating a BOM family and its first draft is one atomic compound command. Line mutations validate Catalog ownership/UoM, expected `updatedAt`, occurrence constraints, and graph acyclicity before commit. Mutations that change `produce` graph edges use an organization-scoped transactional serialization mechanism so concurrent individually-valid writes cannot commit a combined cycle.

The read-only explosion preview is derived and never persisted as the draft source of truth. It preserves full occurrence paths, repeated components, and unresolved `produce` edges, and enforces explicit depth/node limits. Missing child BOMs remain authoring warnings in P1.4 and become release blockers in P1.7.

Planned command families:

- `manufacturing.bom.create|update|delete`;
- `manufacturing.bom_line.create|update|delete|reorder`.

Planned ACL boundary:

- `manufacturing.bom.view`;
- `manufacturing.bom.manage`.

## Validation Focus for the Full Specification

- repeated identical components remain separate occurrences throughout CRUD and preview;
- product-level fallback and variant-specific precedence are deterministic;
- direct, indirect, and concurrently introduced cycles are rejected;
- one-active-draft and revision-number races are deterministic;
- exact quantity/UoM, `fixed | variable`, and yield constraints align with P1.3a;
- optimistic conflicts return a stable `409` and every mutation has a tested undo path;
- tree preview reports unresolved `produce` lines and stops safely at configured bounds;
- all queries and commands fail closed across tenant/organization scope;
- the feature works when WMS, `resources`, and `planner` are disabled.

## Next Specification Stage

The next pass must audit current Catalog selection/UoM services, command/undo patterns, CRUD routes, DataTable/CrudForm patterns, graph-locking precedents, pagination, and module-decoupling tests. It must also benchmark multi-level BOM draft/revision behavior using the official-source policy in the Manufacturing roadmap before completing data models, APIs, UI states, risks, implementation phases, and the Final Compliance Report.

## Changelog

- 2026-08-19: Created the P1.4 skeleton from the owner-approved aggregate, revision, targeting, occurrence, cycle, routing, import/export, and supply-mode decisions.
