# Manufacturing BOM Draft Authoring and Integrity

## TLDR

P1.4a adds implementation-ready authoring of standalone, versioned bill-of-materials (BOM) drafts inside the opt-in `@open-mercato/manufacturing` package and its single `manufacturing` runtime module. A tenant- and organization-scoped BOM family targets one Catalog product and optionally one variant, owns at most one editable draft revision, and stores ordered direct component occurrences without deduplicating repeated items.

Every quantity is a canonical decimal string normalized through the Catalog-owned P1.3a resolver. Every existing-draft mutation uses the draft revision as its optimistic-lock aggregate root. Every graph-changing write, undo, and redo is serialized by an organization-scoped PostgreSQL transaction advisory lock and validates the complete candidate `produce` dependency graph before commit.

This slice includes data, migration, direct-level CRUD/API/UI, commands, undo/redo, ordering, ACL, events, exact quantity/UoM evidence, child-resolution warnings, and direct/indirect/concurrent cycle prevention. Bounded recursive draft preview/explosion is the independently deliverable P1.4b capability specified in [`2026-08-19-manufacturing-bom-draft-preview.md`](2026-08-19-manufacturing-bom-draft-preview.md).

**Specification status:** Full implementation-ready design. Product implementation remains gated by acceptance of P1.0, delivery of P1.0a, and a ready/published P1.3a Catalog quantity resolver.

**Tracker:** [Issue #5393](https://github.com/open-mercato/open-mercato/issues/5393), under [Wave 0 tracker #5386](https://github.com/open-mercato/open-mercato/issues/5386).

## Overview

P1.4a is one cohesive write capability: author a safe direct-level BOM draft aggregate. Each revision stores only direct lines. Multi-level dependencies exist because a `produce` occurrence can resolve another BOM family, but P1.4a uses that graph only for integrity validation and direct-line resolution status. It does not expose or calculate a recursive tree.

```text
ManufacturingBom (family and Catalog target)
  └─ ManufacturingBomRevision (one active draft; system revision number)
       └─ ManufacturingBomLine[] (direct, ordered component occurrences)

produce line ──variant-first/product-fallback──> child BOM family
stock line   ──────────────────────────────────> no dependency edge
```

P1.4b reads this aggregate to render a bounded tree. P1.7 later owns release, effectivity, Site applicability, clone-after-release, immutable child-revision selection, and definition snapshots.

### Goals

- Make real direct-level BOM draft authoring useful before release or stock execution exists.
- Preserve repeated component occurrences with stable IDs and positions.
- Establish exact quantity/UoM, fixed/variable consumption, yield, and supply-mode persistence.
- Prevent direct, indirect, and concurrently introduced `produce` cycles at write time.
- Keep Catalog authoritative without cross-module ORM relations.
- Leave additive seams for P1.4b preview, P1.5 routing, and P1.7 release.

### Non-goals

- Recursive preview, explosion, rolled-up quantities, or occurrence paths (P1.4b).
- Release readiness, approval, effectivity, Site selection, or immutable snapshots (P1.7).
- Routing, operations, Work Centers, execution, planning, inventory, costing, or child orders.

### Use-case traceability

| User outcome | Data/API/UI owner |
|---|---|
| Create a BOM family and first editable draft | Family+revision entities; compound `bom.create`; create route and `CrudForm`. |
| Maintain exact direct component occurrences | Line entity/snapshots; line CRUD commands/routes; paged line `DataTable` and dialog. |
| Reorder without losing occurrence identity | Stable line ID/position; reorder command/action route; Move up/down controls. |
| Detect conflicting or unsafe concurrent work | Revision token, graph lock and cycle validator; stable `version_conflict`/`cycle_detected`; conflict banner. |
| Recover an accidental authoring action | Soft deletion and before/after command evidence; command undo/redo; operation metadata exposed to platform UX. |

## Problem Statement

Without a dedicated authoring contract, an initial implementation could store an unqueryable nested JSON document, merge repeated components, duplicate Catalog conversion logic, expose cross-scope references, treat each line as an independent concurrency root, or allow two concurrent writes to create a cycle neither observed alone. It could also couple the BOM to one production definition and prevent later revision reuse.

Standard `makeCrudRoute` writes assume one row-shaped CRUD resource. This aggregate requires an atomic family-plus-first-draft create, parent-versioned line subresources, graph serialization, Catalog normalization, keyset pagination, and conditional undo/redo. P1.4a therefore uses canonical commands and custom guarded routes while preserving the framework's surrounding contracts.

## Scope and Accepted Decisions

### In scope

- `ManufacturingBom`, `ManufacturingBomRevision`, and `ManufacturingBomLine` persistence;
- tenant and concrete organization isolation on every read and write;
- scalar Catalog product, variant, and UoM references;
- one product-level family and one family per concrete product/variant target;
- one active draft per family and atomic, never-reused revision numbers;
- required `productId`, optional `variantId`, and server-side pair validation;
- ordered, occurrence-preserving direct component lines;
- exact quantity/UoM snapshots, `variable | fixed`, yield `(0,1]`, and explicit `stock | produce`;
- variant-first/product-fallback child resolution for integrity and direct-line warnings;
- transactional CRUD commands, mutation guards, optimistic locking, undo, and redo;
- direct, indirect, and concurrently introduced cycle prevention;
- canonical `DataTable`, `CrudForm`, Catalog pickers, ACL, i18n, events, and OpenAPI;
- keyset pagination and disabled-peer evidence.

### Out of scope

- recursive draft preview/explosion, recursive quantity calculation, depth/node caps, and tree UI (P1.4b);
- release, approval, clone-after-release, effectivity, Site applicability, and immutable snapshots (P1.7);
- routing, `operationId`, operations, and Work Centers (P1.5/P1.6);
- production definitions beyond their later BOM revision reference;
- production orders, facts, confirmations, WMS effects, or planning;
- alternative BOM families, substitutes, alternates, phantoms, and automatic child orders;
- formulas/recipes, co-/by-products, batch, repetitive, rework, or remanufacturing semantics;
- import/export, custom fields, bulk actions, saved views, global search, attachments, and document control.

### Accepted design decisions

| Area | Rule |
|---|---|
| Aggregate | BOM is a standalone versioned aggregate; a later `ProductionDefinition` references a BOM revision. |
| Draft lifecycle | Draft is editable with optimistic locking. P1.7 freezes release and clones a later draft. |
| Target | `productId` is required; optional `variantId` must belong to it. |
| Resolution | A variant family wins over the product-level fallback. |
| Family cardinality | One family per exact product or product/variant target in Wave 0. |
| Storage | Revision stores direct component occurrences only. |
| Revision identity | System number is monotonic; user label is optional. |
| Active drafts | At most one active draft; no branches or merge. |
| Cycles | No direct or indirect `produce` cycle may persist. |
| Supply mode | Every line stores `stock | produce`; default is `stock`. |
| Occurrences | Identical component selections remain separate stable lines. |
| Missing child | Unresolved `produce` is an authoring warning; P1.7 makes it a release blocker. |
| Ordering | MVP uses Move up/Move down; no drag-and-drop. |

## Repository Research

| Concern | Repository evidence | P1.4a decision |
|---|---|---|
| Catalog pickers | Sales `LineItemDialog` uses `LookupSelect`, `/api/catalog/products`, and product-scoped `/api/catalog/variants` | Reuse interaction and existing APIs; variant remains optional; commands revalidate. |
| UoM | Catalog conversion rows plus the P1.3a exact resolver/snapshot contract | UI choices are convenience only; commands persist resolver output and never recalculate independently. |
| Cross-module reads | WMS enrichers use `QueryEngine` with generated Catalog entity IDs | Batch-enrich labels for responses; store scalar IDs only. |
| Entities/migrations | UUIDs, `timestamptz`, numeric strings, explicit indexes, soft deletion for undo | Follow conventions with composite internal scope FKs and partial unique indexes. |
| Atomic writes | `withAtomicFlush` supports phased transactions and ambient `transactionalEm` | One command handler owns every aggregate mutation. |
| Undo/redo | Handlers use `extractUndoPayload`; redo restores stable IDs; APIs return `x-om-operation` | Implement all seven commands with conditional undo/redo and same-ID restoration. |
| Optimistic locking | Command helper and `CrudForm` use the canonical `updated_at` header | Active revision `updatedAt` is the aggregate token for every existing-draft mutation. |
| Mutation guards | Custom writes use `runRouteMutationGuards` and post-commit callbacks | Guard all custom routes; compare the authoritative version once inside the transaction. |
| Serialization | Attachments demonstrate fail-closed transaction advisory locks; row locks protect existing roots | Add one organization BOM-graph transaction lock plus scoped pessimistic row locks. |
| Pagination | Existing custom routes use opaque keyset cursors; DataTable footer is offset-based | Use `(updatedAt,id)` keyset and custom previous/next controls around DataTable. |
| Events | `createModuleEvents` supports persistent CRUD/custom events and client broadcasts | Declare BOM/line events and refresh list/editor after commit. |
| Cache/search | Both require explicit projections/invalidation; MVP excludes them | Direct indexed reads; no cache or `search.ts`. |
| Module isolation | Generator and reduced-registry fixtures prove disabled-module behavior | Require Catalog, operate without WMS/Resources/Planner, disappear when disabled. |

### Why custom routes are justified

`makeCrudRoute` remains the default for row-shaped CRUD. P1.4a writes must perform graph lock, aggregate row lock, expected-version comparison, Catalog normalization, candidate graph validation, multi-row persistence, timestamp bump, and undo snapshot capture in one transaction. Collection reads also require keyset pagination plus batch Catalog enrichment. Custom routes are the narrow exception and must retain metadata, zod, ACL, mutation guards, commands, OpenAPI, stable errors, events, and operation headers.

### Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| Nested JSON tree as source of truth | Reject | Duplicates descendants, obscures occurrence identity and makes reuse/cycle validation unsafe. |
| Independent line versions | Reject | Lines belong to one revision aggregate; separate tokens allow incompatible partial writes. |
| Lock only the edited edge | Reject | Family creation/deletion/retargeting can rebind fallback edges elsewhere. |
| Deduplicate identical components | Reject | A BOM line is an occurrence, not a unique product reference. |
| Block missing child during draft save | Reject | Top-down authoring must work; direct editor warns and P1.7 owns release readiness. |

## Official Product Benchmark

Only vendor-owned sources are used.

| Product | Official evidence | Relevant behavior | Open Mercato decision |
|---|---|---|---|
| SAP S/4HANA | [Maintain Bill of Material](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/82cc8757c483ad6be10000000a4450e5.html?locale=en-US&state=PRODUCTION&version=2025.001) | BOMs may be version-based, alternative, copied, plant-assigned, and change-controlled. | Adopt independent version identity; defer alternatives, plants/effectivity, ECN, copy, and attachments. |
| Oracle Fusion Cloud SCM | [How You Edit Work Definitions](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/how-you-edit-work-definitions.html), [How You Create Structures](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fapim/item-structures.html) | Find number distinguishes repeated component instances; item structures remain distinct from work definitions. | Adopt stable repeated occurrences and separation from routing; defer substitutes, flexfields, and operation assignment. |
| IFS Cloud | [Add Product Structure Components](https://docs.ifs.com/ifsclouddocs/26r1/MfgStandard/ActivityAddProductStructureComponent.htm), [Activate Product Structure](https://docs.ifs.com/ifsclouddocs/26r1/lang/en/DesignStandardProduct/ActivityActivateProdStruct.htm) | Components belong to revisioned structures; activation freezes editing and later change needs another revision. | Adopt new-revision-after-release direction; defer activation and operation links. |
| Microsoft Dynamics 365 SCM | [Bills of materials and formulas](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/bill-of-material-bom) | A BOM is a single-level entity with versions; approval/activation/applicability and line types are separate concerns. | Adopt direct-level persistence; defer approval, activation, Site/date/quantity applicability and extra line types. |
| Infor CloudSuite Industrial | [Current BOM](https://docs.infor.com/csi/latest/en-us/csbiolh/inventory_user_cl_sl/mergedprojects/sl_invprod/forms/invtopic/current_bom_gen2.html), [Copy Routing BOM](https://docs.infor.com/csi/latest/en-us/csbiolh/inventory_user_cl_sl/mergedprojects/sl_invprod/forms/sftopics/copy_routingbom_gen2.html) | Material sequence is generated; BOM and routing may be maintained together; special rework copies may recurse. | Adopt stable sequence; reject routing coupling and cycle exceptions; defer copy/import/rework. |

- **Adopt:** standalone family/revision, direct-level persistence, stable occurrence/position, immutable release/new-revision direction.
- **Reject:** routing co-ownership, component deduplication, draft cycles, and required child readiness during editing.
- **Defer:** release/effectivity, alternatives/substitution/phantom, operation assignment, copy/import, and process models.

## Proposed Solution

### Aggregate behavior

1. `manufacturing.bom.create` validates target and base output through Catalog, acquires the organization graph lock, validates uniqueness/candidate acyclicity, and inserts family plus revision `1` atomically.
2. Active draft revision is the optimistic-lock root. Header, target, line, delete, and reorder mutations require its exact `updatedAt`.
3. Every mutation updates changed rows, revision `updatedAt`, and family `updatedAt`. The next aggregate time is `max(now, previous+1 ms)` so serialized changes cannot expose the same token.
4. Every write/undo/redo takes the graph lock because family changes can alter variant-fallback edges even without touching a line.
5. Release and clone commands are absent; P1.7 reuses the allocator.

### Target and child resolution

A target key is `(productId, variantId|null)` inside tenant/organization.

- Family target is unique by exact key.
- A line without `componentVariantId` resolves only a product family.
- A variant line resolves its exact variant family first, then product family.
- `stock` contributes no graph edge even when a BOM exists.
- unresolved `produce` contributes no edge, remains valid draft data, and appears as `bom.child_unresolved` in direct-line detail.
- Catalog display enrichment does not influence identity or resolution.

### Quantity persistence

New HTTP contracts accept decimal strings only. JSON numbers, exponent notation, locale separators, whitespace, non-finite, zero/negative, and out-of-envelope values are rejected.

Revision base output and each line store canonical entered quantity, canonical entered unit, normalized base quantity, and immutable `QuantityNormalizationSnapshotV1`. Commands build all four from one P1.3a result. Lines additionally store:

- `consumptionBasis: variable | fixed`, default `variable`;
- `yieldFactor` in `(0,1]`, default `1`;
- `supplyMode: stock | produce`, default `stock`.

P1.4a validates and persists these semantics but does not recursively calculate demand. P1.4b owns draft-tree calculation; P1.7/P1.10 own released/execution interpretation.

## Architecture

### Module boundary

- All files live under `packages/manufacturing/src/modules/manufacturing`.
- No new package export/public subpath is added.
- Metadata remains `requires:['catalog']` only.
- Command handlers and routes resolve the Catalog P1.3a normalization service and BOM aggregate service through the module Awilix container; they never instantiate cross-module services directly. The final Catalog DI key/import is the one frozen by P1.3a.
- No import from WMS, `resources`, `planner`, or Sales.
- Internal `lib/structure/graph.ts` contains neutral cycle primitives; BOM-specific adapters live in `lib/bom/`.
- Cross-module interaction uses Catalog DI normalization, `QueryEngine`, and existing picker APIs; no Catalog ORM entity relation.

### Transaction and lock order

Every execute/undo/redo handler:

1. requires tenant plus concrete organization;
2. starts/joins one MikroORM transaction;
3. acquires fail-closed:

   ```sql
   select pg_advisory_xact_lock(
     hashtextextended('manufacturing:bom-graph:' || :tenantId || ':' || :organizationId, 0)
   );
   ```

4. pessimistically locks existing family/revision rows in stable UUID order;
5. re-reads records with tenant, organization, and live-row predicates;
6. requires/compares the expected revision token inside the transaction;
7. resolves Catalog inputs and maps dependency errors;
8. loads the scoped live family/draft/`produce` graph, applies the candidate mutation, resolves edges, and checks cycles;
9. persists all rows and monotonic timestamps atomically;
10. emits events and mutation-guard after-success callbacks after commit.

Lock acquisition/database failure aborts the command. Hash collisions may reduce concurrency but never correctness.

### Cycle algorithm

Each live family is a node. Every live active-draft `produce` line adds an edge from owning family to the variant-first/product-fallback child when resolved. Unresolved and `stock` lines add no edge. A deterministic tri-color DFS/topological equivalent validates the full scoped candidate graph.

- gray-node revisit returns `bom.cycle_detected` with scoped family and line occurrence IDs forming the path;
- direct self-reference is the one-edge case;
- repeated occurrences remain separate but duplicate edges do not change cycle truth;
- create, target update, family delete, every line write/reorder, undo, and redo all validate;
- organization serialization prevents two individually valid transactions from committing a combined cycle.

### Revision allocation

`ManufacturingBom.nextRevisionNumber` is internal. Family create allocates `1` and stores `2`. A reusable allocator locks the family, verifies no active draft, inserts the current number, and increments in the same transaction. Rollback consumes no number; a committed number is never reused or decremented. P1.7 uses this allocator.

### Stable line positioning

- Positive integer positions start at `1024`; append uses `max+1024` under revision lock.
- Read order is `(position asc,id asc)`.
- Move up/down swaps the selected and adjacent live lines through an unused temporary `max+1024` value in three statements.
- Delete leaves a gap; create does not fill gaps, allowing exact-position restore by undo.
- Component identity is never unique.

### Read architecture

- Collection uses direct scoped `(updatedAt desc,id desc)` keyset queries.
- Detail loads family, active draft, and direct-line summary only, then batch-enriches its target via `QueryEngine`.
- The line collection uses `(position asc,id asc)` keyset pages of at most 100 and resolves/enriches the returned page in scoped batches: `stock_leaf`, `variant`, `product_fallback`, or `unresolved`.
- A line cursor binds BOM ID, revision ID, revision `updatedAt`, organization, and page size. A later aggregate mutation invalidates it with `bom.version_conflict`, preventing skip/duplicate traversal of a reordered list.
- Catalog enrichment fails soft for reads: IDs remain visible with `catalogState:'missing'`; writes requiring validation fail closed.
- No recursive traversal or recursive quantity evaluation occurs in P1.4a.
- No result is cached.

## Data Models

All entities use UUID PKs, `timestamptz`, numeric strings, snake_case columns, repeated tenant/organization scope, and internal composite scope FKs. Catalog IDs have no database FK/ORM relation.

### `ManufacturingBom`

Table `manufacturing_boms`:

| Field | Storage/rule |
|---|---|
| `id` | UUID PK, `gen_random_uuid()` |
| `tenantId`, `organizationId` | required UUIDs |
| `productId` | required scalar Catalog UUID |
| `variantId` | nullable scalar Catalog UUID |
| `nextRevisionNumber` | positive integer; `2` after initial create |
| `createdAt`, `updatedAt` | required `timestamptz` |
| `deletedAt` | nullable `timestamptz` |

Indexes/constraints:

- unique `(id,tenant_id,organization_id)` for composite child FK;
- partial unique product target `(tenant_id,organization_id,product_id)` where live and variant null;
- partial unique variant target `(tenant_id,organization_id,product_id,variant_id)` where live and variant not null;
- partial keyset `(tenant_id,organization_id,updated_at desc,id desc)` where live;
- partial resolution `(tenant_id,organization_id,product_id,variant_id)` where live.

### `ManufacturingBomRevision`

Table `manufacturing_bom_revisions`:

| Field | Storage/rule |
|---|---|
| `id` | UUID PK |
| `bomId`, `tenantId`, `organizationId` | required, composite scope FK to family |
| `revisionNumber` | positive integer, system allocated |
| `revisionLabel` | nullable trimmed text, max 120 |
| `status` | text; P1.4a writes only `draft` |
| `baseOutputQuantity` | positive `numeric(18,6)` entered quantity |
| `baseOutputUnitCode` | canonical text |
| `baseOutputNormalizedQuantity` | positive `numeric(18,6)` |
| `baseOutputUomSnapshot` | validated snapshot V1 `jsonb` |
| `createdAt`, `updatedAt`, `deletedAt` | timestamps; `updatedAt` is aggregate token |

Indexes/constraints:

- composite family FK and unique `(id,tenant_id,organization_id)`;
- unique `(bom_id,revision_number)` including deleted rows;
- partial unique `(bom_id)` where live and status `draft`;
- partial scope lookup `(tenant_id,organization_id,bom_id,status)` where live;
- positive quantity/revision checks.

### `ManufacturingBomLine`

Table `manufacturing_bom_lines`:

| Field | Storage/rule |
|---|---|
| `id` | stable occurrence UUID PK |
| `revisionId`, `tenantId`, `organizationId` | required, composite scope FK to revision |
| `componentProductId` | required scalar Catalog UUID |
| `componentVariantId` | nullable scalar Catalog UUID |
| `quantity` | positive `numeric(18,6)` entered nominal quantity |
| `unitCode` | canonical text |
| `normalizedQuantity` | positive `numeric(18,6)` |
| `uomSnapshot` | validated snapshot V1 `jsonb` |
| `consumptionBasis` | `variable | fixed`, default `variable` |
| `yieldFactor` | `numeric(18,12)`, `>0` and `<=1`, default `1` |
| `supplyMode` | `stock | produce`, default `stock` |
| `position` | positive integer |
| timestamps | created/updated required; deleted nullable |

Indexes/constraints:

- composite revision scope FK;
- partial unique `(revision_id,position)` where live;
- partial ordered read `(tenant_id,organization_id,revision_id,position,id)` where live;
- partial graph lookup `(tenant_id,organization_id,component_product_id,component_variant_id)` where live and `produce`;
- enum/range/positive checks;
- intentionally no uniqueness on component identity.

### Snapshot, encryption, and security

Snapshot JSON and every route/command input are zod-validated before business logic. Duplicated columns and JSON come from one resolver result; mismatch is a data-integrity failure, not silently repaired. No field is secret/PII/free text about people, so `defaultEncryptionMaps` and decryption helpers are explicitly N/A. Scope remains mandatory and errors never disclose out-of-scope record existence.

ORM/query-builder parameters and advisory-lock bind values are parameterized; target IDs, cursor JSON, URLs, and response JSON use framework parsing/encoding rather than string-built SQL or paths. Catalog/user labels are rendered as text only—never unsafe HTML. Logs/events/errors exclude snapshots, arbitrary labels, request bodies, credentials, SQL, and cross-scope existence details. Authentication and immutable feature guards come from route/page `metadata`, never mutable role-name checks.

## API Contracts

All routes require auth, concrete organization, zod, feature metadata, scoped queries, exported `openApi`, and custom-route mutation guards. Successful changed mutations return `x-om-operation` and the new aggregate `updatedAt`.

```ts
type QuantityInput = { value: string; unitCode?: string | null }
type BomTargetInput = { productId: string; variantId?: string | null }
type BomLineInput = {
  component: BomTargetInput
  quantity: QuantityInput
  consumptionBasis?: 'variable' | 'fixed'
  yieldFactor?: string
  supplyMode?: 'stock' | 'produce'
}

type BomResolutionState =
  | { state: 'stock_leaf' }
  | { state: 'variant' | 'product_fallback'; childBomId: string; childRevisionId: string }
  | { state: 'unresolved'; warning: { code: 'bom.child_unresolved'; lineId: string } }

type BomLineDto = {
  id: string
  position: number
  componentProductId: string
  componentVariantId: string | null
  quantity: { value: string; unitCode: string; normalizedValue: string; baseUnitCode: string }
  consumptionBasis: 'variable' | 'fixed'
  yieldFactor: string
  supplyMode: 'stock' | 'produce'
  resolution: BomResolutionState
  createdAt: string
  updatedAt: string
}

type BomDetailDto = {
  id: string
  target: BomTargetInput
  targetLabel: { productName: string | null; variantName: string | null; catalogState: 'resolved' | 'missing' }
  activeDraft: {
    id: string
    revisionNumber: number
    revisionLabel: string | null
    baseOutput: { value: string; unitCode: string; normalizedValue: string; baseUnitCode: string }
    updatedAt: string
  }
  directLineSummary: { count: number; unresolvedProduceCount: number }
  createdAt: string
  updatedAt: string
}

type BomListItemDto = Pick<BomDetailDto, 'id' | 'target' | 'targetLabel' | 'activeDraft' | 'directLineSummary' | 'updatedAt'>
type BomMutationResult = { bom: BomDetailDto; updatedAt: string }
type BomLineMutationResult = { line: BomLineDto; updatedAt: string }
type BomDeleteResult = { id: string; deletedAt: string; updatedAt: string }
type BomLineDeleteResult = { lineId: string; deletedAt: string; updatedAt: string }
```

### Route matrix

| Method/route | Feature | Contract |
|---|---|---|
| `GET /api/manufacturing/boms` | `manufacturing.bom.view` | `limit=1..100` default 25, opaque cursor, optional exact `productId` and product-bound `variantId`; returns `{items:BomListItemDto[],nextCursor,hasMore}`. |
| `POST /api/manufacturing/boms` | manage | `{target,revisionLabel?,baseOutput}`; atomically creates family+revision 1; `201 BomMutationResult`. |
| `GET /api/manufacturing/boms/{bomId}` | view | `BomDetailDto`: family, active draft, target enrichment, and direct-line summary. |
| `GET /api/manufacturing/boms/{bomId}/lines` | view | `limit=1..100` default 50 and opaque `(position,id)` cursor bound to the revision token; returns `{items:BomLineDto[],nextCursor,hasMore,snapshotUpdatedAt}`. |
| `PUT /api/manufacturing/boms/{bomId}` | manage | Required lock header; at least one of complete `target` or `draft:{revisionLabel?,baseOutput?}`; `200 BomMutationResult`. |
| `DELETE /api/manufacturing/boms/{bomId}` | manage | Required lock header; soft-deletes family, draft, lines atomically; `200 BomDeleteResult`. |
| `POST /api/manufacturing/boms/{bomId}/lines` | manage | Required lock header; appends one `BomLineInput`; `201 BomLineMutationResult`. |
| `PUT /api/manufacturing/boms/{bomId}/lines/{lineId}` | manage | Required lock header; partial nested line input with at least one change; `200 BomLineMutationResult`. |
| `DELETE /api/manufacturing/boms/{bomId}/lines/{lineId}` | manage | Required lock header; deletes exact occurrence; `200 BomLineDeleteResult`. |
| `POST /api/manufacturing/boms/{bomId}/lines/{lineId}/reorder` | manage | Required lock header; `{direction:'up'|'down'}`; `200 {line,adjacentLine,updatedAt}`; boundary no-op returns `200 {line,adjacentLine:null,updatedAt,changed:false}` without operation header/action log. |

Each cursor is <=512-byte base64url versioned JSON. The BOM collection cursor contains last `updatedAt`, last `id`, organization, and filter digest. The line cursor contains last `position`, last `id`, BOM/revision IDs, revision `updatedAt`, organization, and page size. Both are zod-validated and rejected when malformed or replayed across scope/filter; a stale line cursor returns `409` plus `domainCode:'bom.version_conflict'`. Response decimals are strings. UoM snapshots remain server evidence and are not copied wholesale into list DTOs; detail/write responses return the typed fields required by the editor.

### Optimistic-lock contract

Canonical header:

```text
x-om-ext-optimistic-lock-expected-updated-at: <active revision updatedAt>
```

- mandatory for every mutation of an existing aggregate;
- missing/invalid → `428` with `domainCode:'bom.version_conflict'`;
- mismatch → platform `409 {error:'record_modified',code:'optimistic_lock_conflict',currentUpdatedAt,expectedUpdatedAt}` plus `domainCode:'bom.version_conflict'`;
- command input also requires the parsed expected token;
- UI uses canonical helpers/conflict banner.

### Stable domain errors

| Code | HTTP | Meaning |
|---|---:|---|
| `bom.target_conflict` | 409 | Exact live family target exists. |
| `bom.active_draft_conflict` | 409 | A second live draft is attempted. |
| `bom.version_conflict` | 428/409 | Expected aggregate version missing/invalid/stale. |
| `bom.cycle_detected` | 409 | Candidate direct/indirect graph is cyclic. |
| `bom.variant_product_mismatch` | 404 | Variant missing/out-of-scope/not owned by product. |
| `bom.quantity_invalid` | 422 | Quantity/yield invalid or overflowed. |
| `bom.uom_invalid` | 422 | Catalog base/conversion/configuration invalid. |
| `bom.child_unresolved` | 200 warning | Direct `produce` line has no variant/product child family. |

Other auth/ACL/UUID/body/cursor/not-found errors retain platform behavior. Constraint names map to domain codes. P1.3a variant failures map to mismatch, precision/input failures to quantity, and unit/conversion/factor failures to UoM.

OpenAPI documents all schemas, decimal strings, cursor opacity, warning model, ACL, operation header, optimistic compatibility shape, and errors. Tests assert `metadata`/`openApi` on every route.

## Commands, Events, Undo, and Redo

### Commands

| Command | Effect | Undo/redo |
|---|---|---|
| `manufacturing.bom.create` | Family+revision 1 compound create | Undo soft-deletes unchanged aggregate; redo restores same IDs. |
| `manufacturing.bom.update` | Target and/or draft header/base output | Before/after family+revision; undo revalidates uniqueness/graph. |
| `manufacturing.bom.delete` | Soft-deletes family/draft/lines | Restore IDs/markers after uniqueness/active-draft/cycle checks. |
| `manufacturing.bom_line.create` | Add one occurrence | Undo deletes exact ID; redo restores ID. |
| `manufacturing.bom_line.update` | Change one occurrence | Full before/after line and aggregate versions. |
| `manufacturing.bom_line.delete` | Soft-delete one occurrence | Restore exact ID/position. |
| `manufacturing.bom_line.reorder` | Swap adjacent positions | Both IDs/positions and aggregate versions. |

All set `isUndoable=true`, build snapshots/log metadata, use `extractUndoPayload`, and expose operation metadata. Undo/redo takes graph/row locks, verifies recorded current state, rechecks uniqueness/cycles, never overwrites later edits, and advances rather than restores timestamps.

`manufacturing.bom.create` uses the framework compound-command/`withAtomicFlush` path: family creation and revision-1 creation are internal ordered steps in one database transaction, one action-log/operation identity, and one undo boundary. An internal step cannot be invoked or undone independently; any failure rolls back both rows and emits no event.

### Events

Persistent, client-broadcast events:

- `manufacturing.bom.created|updated|deleted`;
- `manufacturing.bom_line.created|updated|deleted|reordered`.

Payloads contain scoped IDs, revision version, and framework correlation/undo context only—no Catalog labels, quantity snapshot, or recursive tree. Events and guard after-success run after commit. Injected event failure must not duplicate or roll back the committed aggregate.

## ACL and Authorization

- `manufacturing.bom.view`: list/detail and P1.4b preview read.
- `manufacturing.bom.manage`: all P1.4a writes.

Admins receive both; employees receive neither unless granted. UI gates affordances, while API/scoping remains authoritative.

## UI/UX

### Routes and list

- **Manufacturing → BOMs**: `/backend/manufacturing/boms`.
- Create: `/backend/manufacturing/boms/create`.
- Editor: `/backend/manufacturing/boms/[id]`.

The canonical `DataTable` (`entityId` and `extensionTableId` = `manufacturing.bom`) shows target product/variant, active revision number/label, direct line count, unresolved direct `produce` count, and update time. It receives the current cursor page as `data` and has no bulk actions, perspectives/saved views, exporter, or built-in offset footer. Product/variant filter plus previous/next cursor stack resets on filter/scope change. `ListEmptyState` offers Create only to managers. `LoadingMessage`/`ErrorMessage` own async states. Delete uses `useConfirmDialog`, current token, and conflict banner.

### Header form

`CrudForm` contains:

- product `LookupSelect` over `/api/catalog/products?pageSize=8&search=...`;
- optional product-scoped variant lookup, cleared when product changes;
- revision label;
- exact text quantity and base/conversion UoM options from existing Catalog APIs;
- defaults base output `1`, base unit, empty label;
- `optimisticLockUpdatedAt` for edit.

Create/update/delete submission uses canonical `createCrud`/`updateCrud`/`deleteCrud` adapters against the custom guarded endpoints and maps field failures with `createCrudFormError`; HTTP remains `apiCall`-based. The product/variant/base-output use case maps to create/update/detail routes and the family/revision entities above.

Commands remain authoritative. Missing Catalog enrichment keeps record readable by UUID with `Alert status="warning"`; re-normalizing writes require valid Catalog resolution.

### Direct component editor

An ordered direct-line `DataTable` (`entityId` and `extensionTableId` = `manufacturing.bom_line`) receives one keyset page as `data` and shows position, product/variant, entered and normalized quantity/UoM, basis, yield, supply, and direct child-resolution status. External previous/next cursor controls reset after every line mutation/reorder and whenever the server reports a stale page snapshot.

- Add/Edit uses keyboard-accessible `Dialog` plus embedded `CrudForm`; `Cmd/Ctrl+Enter` submits and `Escape` cancels.
- Defaults: quantity `1`, variable, yield `1`, stock.
- Repeated identical selections remain separate rows.
- Move up/down uses canonical icon buttons, tooltip, translated `aria-label`, disabled boundaries.
- No drag-and-drop.
- Mutations use `useGuardedMutation` and `apiCall`, attach revision version, surface conflicts, and replace local `updatedAt`.
- Unresolved `produce` displays `Alert status="warning"` and does not block save.
- P1.4a has no recursive tree panel; P1.4b mounts it as an independent read-only client leaf.
- `SectionHeader`, `FormField`, `StatusBadge`, `Alert`, `LoadingMessage`, `ErrorMessage`, and `ListEmptyState` are used where their canonical roles apply; no raw HTML status surface, hardcoded status color, arbitrary text size, inline SVG, or unsafe HTML rendering is introduced.

### Frontend architecture contract

Page roots remain server components. Focused client leaves:

| Client file | Exact browser-only reason | Imported by | Heavy dependency | Cleanup/hydration risk | Rejected alternative | Budget |
|---|---|---|---|---|---|---:|
| `BomListClient.tsx` | cursor/filter state and DataTable actions | list server page | DataTable only | abort request and reset cursors on scope/filter change | client page root | <=300 LOC |
| `BomHeaderFormClient.tsx` | CrudForm/picker state and guarded mutations | create/editor server shell | CrudForm only | conflict state must match active revision | raw form/server-only form | <=300 LOC |
| `BomEditorClient.tsx` | coordinates active detail/version and event refresh | editor server page | none | unsubscribe client event bridge | whole editor in one client file | <=200 LOC |
| `BomLinesEditor.tsx` | line cursor/DataTable/action state | editor coordinator | DataTable only | abort/reset cursor after mutations | unbounded all-lines render | <=300 LOC |
| `BomLineDialog.tsx` | modal form state and keyboard shortcuts | lines editor | Dialog/CrudForm | restore focus and clear stale input | inline editor inside each row | <=260 LOC |

Server `page.tsx` roots remain server components and are <=80 LOC; they import only the client leaves above. No new provider/bootstrap/global store or heavy browser library is added, and there is no duplicate server/client fetch. Files approaching 300 LOC split hooks/form config/presentation. Budgets are zero new client page roots, zero unapproved >300-LOC client files, and zero heavy dependencies at page/provider roots. Tests cover hydration for list/create/editor, provider-free render, keyboard dialogs, scope refresh, `yarn check:client-boundaries`, and route bundle/build/RAM evidence.

## Internationalization

Add `en`, `de`, `es`, `ko`, and `pl` keys for navigation, list, cursor controls, forms, line editor, supply/basis values, dialogs, direct resolution warnings, ACL, conflicts, and flashes. UI uses `useT`/`resolveTranslations`; API codes remain language-neutral. No hardcoded JSX user text is accepted.

## Search, Indexing, and Cache

No `search.ts` or query-index projection: the family has no stable owned business name and global search is out of scope. Direct list uses scoped indexed filters.

No cache: no keys/tags/aliases/invalidation/cache-status UI. Cold and warm paths are the same indexed direct queries. Future cache requires a separate invalidation design that includes P1.4b descendant reads.

## Migration and Compatibility

One additive migration creates the three tables, checks, internal composite FKs, partial uniques, and read/graph indexes. There is no backfill. It alters no Catalog/optional-peer table and adds no default activation or public package export. Soft-deleted rows retain audit/undo identity. P1.7 must preserve these drafts, reuse allocator, add release/clone/snapshots, and constrain deletion where released references exist.

No environment variable is added. Existing platform optimistic-lock configuration remains, while these new endpoints require the header by contract.

## Implementation Plan

### Phase 1 — Data and integrity utilities

1. Add entities, validators, migration, scope helpers, and generator participation.
2. Add P1.3a adapter, target resolution, cursor, monotonic version, and neutral graph/cycle utility.
3. Prove schema/constraint/decimal/resolution/cycle behavior with unit/database tests.

### Phase 2 — Commands

1. Add seven registered handlers.
2. Implement graph/row locks, allocator, normalization, constraints, snapshots, undo/redo.
3. Add event declarations/post-commit emission.

### Phase 3 — API

1. Add collection/detail/line/reorder custom routes.
2. Add zod, metadata, full guard registry, version adaptation, operation headers, OpenAPI.
3. Add keyset pagination and batch Catalog enrichment.

### Phase 4 — UI and i18n

1. Add nav/ACL/page server shells and focused clients.
2. Build list, create/edit header, direct-line editor, ordering, delete, warnings.
3. Add all locales and event-driven refresh.

### Phase 5 — Integration gates

1. Extend package/generator/module-decoupling fixtures.
2. Prove Catalog hard dependency and optional peers absent.
3. Run generate, migration validation, package build/typecheck/test, focused shared/UI tests, OpenAPI, and create-app packaging.

Expected internal paths include `data/*`, one migration, `lib/structure/graph.ts`, `lib/bom/{scope,target-resolution,quantity,cursor,locking,serialization}.ts`, `commands/*`, `api/boms/**`, backend server shells, focused BOM components, `events.ts`, `acl.ts`, and five locale files. P1.4a adds no explosion utility/route/tree component/search/cache/import/export/public export.

## Testing Strategy

### Unit and database

- target keys; variant-first/fallback/unresolved/stock behavior;
- repeated lines without deduplication;
- decimal strings, exact resolver mapping, fixed/variable/yield validation;
- direct/indirect paths and target create/delete/retarget effects;
- cursor scope/filter binding;
- position append/swap/boundary;
- migration/constraint mapping;
- atomic family+draft rollback;
- target, active-draft, and revision allocation races;
- concurrent combined-cycle race: exactly one commits;
- tenant/organization non-disclosure;
- missing/stale versions and monotonic changes;
- every command undo/redo, same IDs, stale/conflicting restore;
- advisory-lock/event failures.

### API and UI

- complete ten route/read operations and `401/403/404/428/409/422` cases;
- mutation guard block/transform/re-parse;
- operation header only on changed undoable writes;
- all stable errors and no SQL leakage;
- tied-timestamp family cursor traversal, position/ID line traversal, stale line cursor after mutation/reorder, and page limits <=100;
- batch enrichment and missing Catalog fallback;
- OpenAPI coverage;
- ACL, pickers, optional variant/clearing, create/edit/delete/conflict;
- duplicate occurrences across multiple line pages and after reload;
- dialog keyboard behavior, move buttons, unresolved warning, cursor reset, event refresh;
- hydration, responsive layout, client budgets.

### Module isolation and performance

- metadata requires exactly Catalog;
- Manufacturing+Catalog without WMS/Resources/Planner generates, migrates, and serves authoring;
- static imports reject optional peers/Sales;
- Manufacturing disabled exposes no entities/routes/nav/ACL/events;
- Manufacturing without Catalog fails dependency validation;
- source/dist discovery and no new exports;
- keyset plan bounded to 100 rows, detail bounded query count;
- `O(V+E)` graph validation benchmark at 1,000 families/10,000 `produce` lines with lock wait/hold evidence.

## P1.12 Evidence Mapping

| Category | Evidence |
|---|---|
| Isolation | Command/API/enrichment/cursor cross-scope tests |
| Optimistic concurrency | Required header, stale/gone, monotonic versions, stale undo/redo |
| Transaction failure | Compound/line/reorder rollback and post-commit event injection |
| Domain concurrency | Target/active-draft/allocator races and concurrent cycle |
| Exact quantity | P1.3a snapshot and decimal/UoM/basis/yield validation corpus |
| Compatibility | Additive migration, no export/default/API change |
| Disabled modules | Optional peers absent, Manufacturing disabled, Catalog-required failure |
| API/UI | All routes/guards/OpenAPI and critical accessible authoring paths |
| Cache/search | Explicit N/A with indexed direct reads |

## Alignment With Adjacent Specifications

| Work item | Contract |
|---|---|
| P1.0a | One package/module, Catalog only hard dependency, no public domain export. |
| P1.3a | Blocking decimal/UoM resolver and snapshot; no local fallback arithmetic. |
| P1.4b | Read-only recursive draft tree over P1.4a; adds no write/model/lifecycle behavior. |
| P1.5 | May add optional line-operation reference later; no placeholder here. |
| P1.6 | No Work Center/resource/calendar dependency or field. |
| P1.7 | Reuses identity/allocator; owns release, clone, applicability, immutable child selection, unresolved blocker, snapshots. |

Dedicated P1.5/P1.6/P1.7 full specs do not yet exist; alignment uses accepted roadmap/execution/backlog/tracker boundaries and does not pre-decide their internals.

## Risks & Impact Review

### Graph-lock contention

- **Severity:** Medium. Organization-wide authoring serializes.
- **Scenario/affected area:** A large organization performs many BOM writes; command latency and editor saves increase, but other organizations and read-only preview remain isolated.
- **Detection:** command latency plus advisory-lock wait/hold metrics and the 1,000-family/10,000-edge benchmark are recorded before merge.
- **Mitigation:** short transactions, indexed/batched graph reads, wait/hold benchmark.
- **Residual:** measured future evidence may justify subgraph/version projection; correctness first.

### Variant-family rebinding

- **Severity:** High. Create/delete/retarget can switch parent fallback edges.
- **Scenario/affected area:** A new variant BOM silently changes which child an existing parent draft resolves; authoring integrity and preview meaning are affected inside that organization.
- **Detection:** resolution-source changes are covered by command/event tests and visible in direct-line status; cycle rejection is logged by domain code without labels.
- **Mitigation:** every family mutation validates full candidate graph under same lock; direct detail exposes source.
- **Residual:** valid draft meaning can change until P1.7 freezes a release.

### Catalog-policy drift

- **Severity:** Medium. Stored draft normalization may differ from later policy.
- **Scenario/affected area:** Catalog base UoM/rounding changes after a line is saved; untouched definition evidence and later release validation diverge intentionally.
- **Detection:** snapshot/current-policy mismatch fixtures and P1.7 release-readiness evidence; P1.4b reports historical base-unit incompatibility fail-closed.
- **Mitigation:** evidence snapshot, current labels separate, changed values re-resolve, P1.7 release revalidation.
- **Residual:** untouched draft preserves old evidence intentionally.

### Unsafe undo

- **Severity:** High. Later work can make restore conflict/cycle.
- **Scenario/affected area:** Undoing a delete/update after another author changed the target or graph could overwrite later work or reintroduce a cycle.
- **Detection:** conditional-state/expected-version failures, command-log outcomes, and stale/conflicting restore tests.
- **Mitigation:** conditional state match, graph lock, uniqueness and cycle validation, stable errors.
- **Residual:** an old action may become intentionally non-undoable.

### Custom-route protection drift

- **Severity:** High. Hand routes could omit guards/ACL/scoping/OpenAPI/operation headers.
- **Scenario/affected area:** A newly added write route bypasses an extension guard or exposes another organization; all BOM API consumers are in the blast radius.
- **Detection:** static route inventory and integration matrix assert metadata, OpenAPI, guard invocation, scope, and operation header for every route.
- **Mitigation:** shared module route helper, route matrix, static/integration tests.
- **Residual:** framework evolution requires helper/test maintenance.

### Optional-peer leak and client bloat

- **Severity:** High/Medium.
- **Scenario/affected area:** An accidental WMS/Resources/Planner import breaks reduced compositions, or an editor client blob increases hydration/build memory for every BOM author.
- **Detection:** static module-decoupling/generator fixtures, client-boundary checks, LOC ledger, route bundle and RSS evidence.
- **Mitigation:** static/disabled-peer tests; server shells, explicit client ledger, <=300 LOC guardrail, no new provider.
- **Residual:** later capabilities require explicit seams; editor retains a small coordinator.

## Final Compliance Report

### Rules and guides reviewed

- `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/catalog/AGENTS.md`;
- `packages/shared/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`;
- `packages/events/AGENTS.md`, `packages/cache/AGENTS.md`, `packages/cli/AGENTS.md`, `.ai/qa/AGENTS.md`;
- `.ai/docs/module-development.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/ui-backend-components.md`;
- optimistic-locking guides/specifications named by the root Task Router and the spec-writing checklist/frontend contract.

### Compliance matrix

| Rule source/area | Status | Evidence |
|---|---|---|
| Spec scope | Compliant | Fresh-context verdict **PASS**: one direct-level authoring/integrity capability; recursive preview is P1.4b. |
| Module placement/naming | Compliant | One `manufacturing` runtime module; singular commands/events/features; no public subpath. |
| Cross-module coupling | Compliant | Scalar Catalog IDs, P1.3a DI, QueryEngine enrichment; no Catalog ORM relation or optional-peer import. |
| Tenant/security | Compliant | Tenant+organization columns/FKs and predicates, feature metadata, zod, parameterized queries, non-disclosing errors. |
| Encryption | N/A compliant | No PII, people-related free text, credential or secret field; no encryption map or hand-rolled crypto. |
| Data/migration | Compliant | Three scoped entities, exact snapshots, partial uniques/checks/indexes, additive migration and no backfill. |
| Concurrency | Compliant | Revision aggregate token, graph advisory lock, stable row-lock order, monotonic versions and atomic allocator. |
| Commands/undo | Compliant | Seven singular commands; compound first create; conditional same-ID undo/redo; post-commit events/guard callbacks. |
| API/OpenAPI | Compliant | Ten custom route/read operations justified; metadata, ACL, zod, mutation guards, operation headers, stable errors and exported OpenAPI. |
| Pagination/scale | Compliant | Family and direct-line keyset cursors, `limit<=100`, stale line snapshot detection, indexed/batched reads and graph benchmark. |
| UI/HTTP/DS | Compliant | DataTable/CrudForm canonical helpers, apiCall/useGuardedMutation, conflict UI, shared primitives, dialog keys, stable extension IDs. |
| Frontend architecture | Compliant | Server roots, exact client ledger, LOC/provider/heavy-dependency budgets, hydration/client-boundary/bundle/RAM evidence. |
| i18n/events | Compliant | Five locales; `createModuleEvents`-compatible post-commit events; no hardcoded user text. |
| Cache/search/bulk | N/A compliant | Explicitly excluded; direct indexed reads, no cache/search projection/bulk surface. |
| Compatibility/isolation tests | Compliant | Additive surface, disabled Manufacturing, Catalog-required failure, optional peers absent, source/dist/create-app gates. |

### Internal consistency check

| Check | Status | Notes |
|---|---|---|
| Data models match API/commands | Pass | Family/revision/line fields, aggregate token, occurrence IDs, positions and snapshots map to DTOs and seven writes. |
| API matches UI | Pass | Create/detail/list/line-page/mutation routes cover list, header form, direct editor, ordering and warnings. |
| Risks cover writes | Pass | Contention, fallback rebinding, Catalog drift, undo, custom routes and optional-peer/client risks have scenario/detection/mitigation/residual. |
| Adjacent contracts agree | Pass | P1.0a/P1.3a/P1.4b/P1.5/P1.6/P1.7 boundaries and gates are explicit. |
| Cache/search/PII decisions | Pass | Each is explicitly N/A with a reason; no hidden projection or sensitive field remains. |

### Non-compliant items

None.

### Verdict

**Fully compliant at specification level.** Approved as implementation-ready subject to P1.0 acceptance and ready P1.0a/P1.3a prerequisites.

Implementation remains gated by P1.0 acceptance, P1.0a, and ready P1.3a. No product code is authorized by this documentation task.

## Changelog

- 2026-08-19: Created the combined P1.4 skeleton from owner-approved BOM decisions.
- 2026-08-19: Expanded the combined draft after repository research and official vendor benchmarking.
- 2026-08-19: Fresh-context review returned **SPLIT**, identifying recursive preview/explosion as independently deliverable.
- 2026-08-19: Roadmap owner accepted the split. Refocused this file as P1.4a direct-level authoring/integrity and moved bounded recursive preview to P1.4b.
- 2026-08-19: Added bounded direct-line keyset reads, complete DTO/UI/frontend contracts, security/performance evidence, and final compliance mapping.

### Review — 2026-08-19

- **Reviewer:** Codex plus fresh-context scope reviewer.
- **Security:** Passed; scoped entities/queries, ACL/zod/parameter binding, non-disclosing errors and explicit encryption N/A.
- **Performance:** Passed; family/line keyset reads, batch enrichment, indexed graph validation and measured foreground-lock gate.
- **Cache:** N/A; no cache or search projection is introduced.
- **Commands:** Passed; all seven mutations, compound create, graph-safe conditional undo/redo and post-commit effects are specified.
- **Risks:** Passed; scenarios, blast radius/detection, mitigation and residual risk are recorded.
- **Verdict:** Approved. Fresh-context scope-cohesion review returned **PASS — no further split**.
