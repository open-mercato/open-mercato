# Manufacturing Bounded Multi-level BOM Draft Preview

## TLDR

P1.4b adds a bounded, read-only multi-level preview of the editable BOM graph created by P1.4a. It resolves every `produce` occurrence variant-first with product fallback, keeps every repeated line as a distinct occurrence, treats every `stock` line as a leaf, calculates exact gross component requirements, and reports unresolved child BOMs as warnings.

The preview is evaluated from one tenant- and organization-scoped PostgreSQL `REPEATABLE READ` snapshot. It is all-or-error: the server returns the complete bounded tree or `bom.explosion_limit_exceeded`; it never silently truncates. Default limits are depth `8` and `500` nodes, with hard server caps of depth `20` and `2,000` nodes.

P1.4b adds no entity, migration, mutation, command, undo action, ACL feature, public package export, cache, or search projection. It is an independently deployable read capability over P1.4a and is not the release/execution explosion contract.

**Specification status:** Full implementation-ready design. Product implementation remains gated by P1.0 acceptance, P1.0a, ready P1.3a exact arithmetic, and implemented P1.4a draft authoring/integrity.

**Tracker:** [Issue #5405](https://github.com/open-mercato/open-mercato/issues/5405), under [Wave 0 tracker #5386](https://github.com/open-mercato/open-mercato/issues/5386).

## Overview

P1.4a intentionally stores one direct level per revision. P1.4b follows resolved `produce` edges to build a read-only occurrence tree for an author reviewing a draft.

```text
root draft revision (depth 0, one BOM invocation)
  direct stock line   -> occurrence leaf
  direct produce line -> occurrence + resolved child draft
                           stock line   -> occurrence leaf
                           produce line -> occurrence + ...
```

Each appearance has its own `occurrencePath` made from stable BOM line IDs. The same line definition can therefore appear at several paths, and identical component targets remain separate. The response is diagnostic draft evidence only: it does not aggregate material demand, select released revisions, apply effectivity/Site rules, create execution snapshots, reserve stock, or create child orders.

### Goals

- Let an author inspect the effective multi-level draft structure before release exists.
- Make variable/fixed consumption and yield arithmetic explicit and deterministic.
- Preserve occurrence identity, ordering, fallback source, and warnings at every level.
- Guarantee one internally consistent read without holding the P1.4a write lock.
- Bound traversal, response size, database work, rendering cost, and malicious inputs.
- Work with Catalog as the only required peer and without WMS, `resources`, or `planner`.

### Non-goals

- Editing through the tree or making the tree a persistence source.
- Released/effective BOM selection, Site applicability, or immutable explosion snapshots.
- Material aggregation, netting, availability, costing, lead-time, capacity, or scheduling.
- Routing operations, Work Centers, substitutions, alternatives, phantoms, co-/by-products, or process formulas.
- Cache, global search, export, printing, bulk actions, saved views, or public domain exports.

### Use-case traceability

| User outcome | Read/API/UI owner |
|---|---|
| Inspect the current nested draft from one consistent moment | Repeatable-read evaluator; preview GET; lazy preview panel. |
| Understand each occurrence's required quantity and child source | Exact evaluator/occurrence DTO; node quantities/resolution union; indented node row. |
| See missing child BOMs without blocking top-down authoring | Unresolved leaf/warning contract; `200` warning response; warning summary and focus link. |
| Know when a tree is too large to show safely | Depth/node sentinel and stable error; `422` contract; explicit bounded retry controls. |
| Avoid reading a silently stale tree after authoring | Root revision evidence plus P1.4a broadcasts; response token; stale marker and manual Refresh. |

## Problem Statement

Direct-line storage is the correct normalized authoring model, but it does not by itself answer what a nested draft currently contains. A naive UI-side recursion would issue N+1 requests, mix database states, calculate with JavaScript numbers, lose repeated occurrences, ignore fixed consumption, or loop indefinitely on corrupted data. A server that merely cuts off a response at an arbitrary threshold would present an apparently complete but false BOM.

The preview therefore needs a separate contract with traversal semantics, exact quantity rules, occurrence identity, snapshot consistency, limits, stable warnings/errors, a query budget, and an accessible tree UI. Those concerns are independently deliverable from P1.4a writes and must not leak into the later released-definition/execution contract.

## Scope and Accepted Decisions

### In scope

- one read-only preview endpoint for an active draft family;
- recursive variant-first/product-fallback child resolution;
- `stock` leaf and unresolved-`produce` warning behavior;
- exact variable/fixed/yield calculations from P1.4a snapshots;
- stable occurrence paths and ordered, non-deduplicated nodes;
- one `REPEATABLE READ` transaction per evaluation;
- iterative, batched traversal without per-node database queries;
- requested/default/hard depth and node limits;
- defensive cycle and invalid-snapshot detection;
- batch Catalog display enrichment with ID fallback;
- a lazy read-only tree panel in the BOM editor;
- OpenAPI, i18n, ACL reuse, accessibility, isolation, performance, and disabled-peer tests.

### Out of scope

- any database model or migration;
- any mutation, command, undo/redo handler, emitted domain event, or mutation guard;
- direct-line CRUD and graph-write validation (P1.4a);
- release, clone, effectivity, Site, approval, and release blockers (P1.7);
- runtime production-order explosion or execution snapshots (P1.10 and later);
- routing/operation references (P1.5), Work Centers (P1.6), and WMS effects (P1.8+);
- user-selected root production quantity, aggregation, substitutions, or phantom flattening;
- pagination inside a returned tree, partial continuation tokens, or silent truncation;
- persistent/cacheable preview artifacts.

### Accepted preview rules

| Area | Rule |
|---|---|
| Root | Preview evaluates the current live active draft of the requested P1.4a family. |
| Root quantity | One invocation produces the root revision's stored normalized base output. P1.4b has no requested-output parameter. |
| Occurrence | Every live line appearance is a node; repeated components and repeated paths are never merged. |
| Path | Root path is `[]`; a line node path is its parent path plus that line's stable UUID. |
| Depth | Root is depth `0`; its direct line occurrences are depth `1`. |
| Node count | Count includes the root and every returned line occurrence; it does not add a second wrapper node for a resolved child revision. |
| Ordering | Siblings use P1.4a `(position asc,id asc)` order. |
| Stock | `stock` is always a leaf, even when a child family exists. |
| Produce | Resolve exact variant family first, then product family; expose the selected source. |
| Missing child | Preserve the `produce` occurrence as a leaf and attach `bom.child_unresolved`; do not fail preview. |
| Cycles | P1.4a prevents them; P1.4b detects persisted corruption defensively and fails with `bom.cycle_detected`. |
| Limits | Complete result or stable limit error; never mark a cut tree as complete. |
| Consistency | All P1.4a rows are read from one organization-scoped `REPEATABLE READ` transaction. |
| Authority | Preview is transient draft diagnostics, not release or execution evidence. |

## Repository Research

| Concern | Repository evidence | P1.4b decision |
|---|---|---|
| Draft aggregate | P1.4a owns family/revision/line schema, target resolution, scope, ordering, and exact snapshots | Depend on its internal read contracts; add no duplicate persistence or resolver. |
| Exact arithmetic | P1.3a specifies canonical decimal multiply/divide/round and snapshot rounding | Use shared exact operations; never use JS `number` or re-normalize stored nominal values. |
| Scoped reads | Modules use `QueryEngine` for cross-module scalar-ID enrichment | Batch Catalog labels; arithmetic remains possible when enrichment is missing. |
| Custom routes | Repository custom routes export `metadata`, `openApi`, zod contracts, auth/ACL and scoped queries | Add one custom GET; mutation guards and operation headers do not apply. |
| Transactions | MikroORM allows explicit isolation and ambient entity managers | Run traversal inside one `REPEATABLE READ` transaction. |
| Events | `createModuleEvents` client broadcasts support invalidation/refresh | Consume P1.4a BOM/line broadcasts; emit no event for a read. |
| DataTable/CrudForm | Canonical authoring primitives serve lists/forms, not hierarchical read models | Use the existing editor shell and a focused accessible tree client leaf. |
| Cache/search | Both require explicit projections and invalidation contracts | Add neither; every preview is an uncached current-snapshot evaluation. |
| Module isolation | Reduced-registry/generator fixtures exercise disabled modules and optional peers | Prove Catalog-only operation and absence when Manufacturing is disabled. |

### Why a custom action route is justified

`makeCrudRoute` represents row-shaped CRUD and offset list conventions. Preview is a parameterized derived read over multiple aggregate instances, with transaction isolation, recursive evaluation, limits, warnings, and a non-entity response. A custom GET is the narrow correct seam. It still uses platform auth/context, feature metadata, zod, scoped not-found behavior, exported OpenAPI, and stable error mapping.

### Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| Expand in the browser through repeated detail calls | Reject | N+1 requests, mixed snapshots, duplicated domain arithmetic, and data-exposure risk. |
| Recursive SQL CTE as the complete implementation | Reject for Wave 0 | Fallback resolution, occurrence-preserving arithmetic, warnings, and snapshot validation are clearer in bounded batched domain code. |
| Materialized nested JSON on the revision | Reject | Becomes stale on descendant edits and duplicates normalized source data. |
| Aggregate identical components | Reject | Hides distinct occurrences, fixed consumption, and traceable paths. |
| Truncate when limits are reached | Reject | An incomplete structure can be mistaken for a valid complete BOM. |
| Acquire the P1.4a graph advisory lock for reads | Reject | `REPEATABLE READ` already gives a consistent snapshot; the organization-wide write lock would unnecessarily block authoring. |

## Official Product Benchmark

Only vendor-owned sources are used.

| Product | Official evidence | Relevant behavior | Open Mercato decision |
|---|---|---|---|
| SAP S/4HANA | [Exploding a BOM](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/18ee18df146f46e9a7738186eebceaa7/eeb1b853ff98b44ce10000000a174cb4.html) | Multi-level explosion follows assemblies through lower levels and distinguishes explosion scope. | Adopt explicit multi-level traversal; keep this endpoint draft-only and bounded. |
| Oracle Fusion Cloud SCM | [Overview of Work Definitions](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/overview-of-work-definitions.html), [How You Edit Work Definitions](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/how-you-edit-work-definitions.html) | Structures/work definitions retain component instances and quantities while operation/resource behavior is separate. | Preserve occurrences and separate BOM preview from routing; defer released execution semantics. |
| IFS Cloud | [Product Structures](https://docs.ifs.com/ifsclouddocs/26r1/lang/en/MfgStandard/AboutProductStructures.htm) | Product structures are revision/status controlled and may be viewed across levels. | Adopt a hierarchical review experience; do not import status/release behavior into P1.4b. |
| Microsoft Dynamics 365 SCM | [BOM designer functionality](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/bom-designer-functionality) | The designer exposes a hierarchical BOM tree and separate editing/selection behavior. | Adopt a dedicated tree presentation; keep it read-only and separate from direct-line editing. |
| Infor CloudSuite Industrial | [Indented Job BOM Report](https://docs.infor.com/csi/latest/en-us/csbiolh/inventory_user_cl_sl/mergedprojects/sl_invprod/forms/sftopics/indented_job_bom_report.html) | An indented BOM presents component levels and quantities as a derived hierarchy. | Adopt indented level/quantity visibility; defer report/export and job-specific behavior. |

- **Adopt:** indented multi-level visibility, occurrence identity, explicit levels, quantities, and separate structure/routing concerns.
- **Reject:** UI-side domain explosion, silent truncation, draft-tree persistence, and routing-coupled preview.
- **Defer:** released/effective selection, requested-quantity simulation, aggregation, costing, availability, reporting/export, and execution evidence.

## Proposed Solution

### Evaluation input

The endpoint accepts only bounded presentation/evaluation limits:

```ts
type BomPreviewQuery = {
  maxDepth?: number // default 8, range 1..20
  maxNodes?: number // default 500, range 1..2000
}
```

There is intentionally no root quantity. Evaluation starts with exactly one root BOM invocation whose required output is the revision's stored `baseOutputNormalizedQuantity`. A future requested-output simulator is a separate capability because it needs batch/run-count policy for fixed consumption.

### Exact quantity semantics

All values are canonical decimal strings. Let:

- `R` = required normalized output for the current BOM invocation;
- `B` = current revision `baseOutputNormalizedQuantity`;
- `Q` = line `normalizedQuantity`;
- `Y` = line `yieldFactor`;

For each line occurrence:

```text
variable gross = round((Q * R) / (B * Y), lineSnapshot.rounding)
fixed gross    = round(Q / Y, lineSnapshot.rounding)
```

Rules:

- fixed quantity applies once per occurrence for each invocation of its immediate parent BOM, independent of the parent's required/base-output ratio;
- both variable and fixed nominal demand are divided by yield;
- multiplication builds the exact numerator and denominator first; one P1.3a division then produces `gross` at the component line snapshot's explicit mode/scale, never through binary floating point;
- no intermediate ratio is serialized or rounded, so non-terminating `R / B` values remain deterministic;
- only final `gross` is rounded once with that component line snapshot's mode/scale;
- stored normalized values are evidence and are not re-normalized through current Catalog policy;
- overflow, zero/invalid base output, invalid yield, or malformed snapshot fails the entire evaluation as `bom.quantity_invalid`;
- a resolved child receives `R = gross` only when the parent line snapshot `baseUnitCode` exactly equals the child revision base-output snapshot `baseUnitCode` for the same component target;
- a historical base-unit mismatch fails closed as `bom.uom_invalid`; P1.4b never invents a cross-base conversion or consults current Catalog policy to reinterpret stored evidence;
- no quantity is summed across occurrences.

The root response exposes its evaluated output. Every line node exposes stored configured values plus calculated canonical `grossRequiredQuantity` in the component product's stored snapshot base unit. It does not expose a rounded nominal intermediate that could be mistaken for calculation input.

### Resolution and traversal

1. Start a `REPEATABLE READ`, read-only transaction.
2. Resolve and scope the requested family and its live active draft inside that transaction, then validate the root snapshots.
3. Load the frontier of ordered live lines for all newly encountered revisions in one query. Fetch at most `remainingNodeBudget + 1` records in deterministic parent-frontier/sibling order (absolute maximum `2,001`), or use an equivalent scoped `EXISTS` probe, so the evaluator can prove the first node overflow instead of truncating at the limit.
4. Batch-resolve all frontier `produce` targets against live active-draft families in the same snapshot: exact variant first, product fallback second.
5. Calculate occurrence quantities, append nodes in deterministic depth-first pre-order, and enqueue resolved children while preserving sibling order.
6. Before adding the next deterministic pre-order node, check depth first and node count second. On the first attempted excess, discard the result and return the stable limit error; this ordering defines error precedence when one candidate violates both limits.
7. Track family IDs on each ancestry path. A repeated ID on the current path is `bom.cycle_detected`; reuse on another branch is valid.
8. Batch-enrich all unique Catalog IDs after structure evaluation, still under tenant/organization context. Missing labels remain ID-visible and do not change calculations.

Implementation uses an explicit stack, not JavaScript call-stack recursion. Database reads are bounded by traversal frontiers, requested limits, and one overflow sentinel—not occurrences discovered outside the requested tree. It must not preload all organization-scoped families, revisions, lines, or resolution keys. At each frontier it batches no more unique revision IDs/target keys than can contribute to the remaining budget plus the one sentinel; traversal has at most `maxDepth + 1` frontier checks so it can prove a depth overflow without returning a partial tree.

## Architecture

### Module and code boundary

- All code stays in `packages/manufacturing/src/modules/manufacturing`.
- P1.4b consumes P1.4a internal scoped BOM readers and target resolver; no package export/public subpath is added.
- The route resolves a module-local `manufacturingBomPreviewService` through Awilix. That service receives the ORM/scoped reader and exact-decimal primitives by DI; route/UI code never constructs repositories or Catalog services directly.
- Neutral traversal/quantity types live under `lib/structure/`; BOM response adaptation lives under `lib/bom/preview/`.
- No runtime import from WMS, `resources`, `planner`, Sales, routing, or production-order code.
- Catalog is used only for optional batched display enrichment; P1.4a snapshots remain arithmetic authority.

Expected implementation paths:

```text
lib/structure/explosion.ts
lib/bom/preview/{evaluate,quantity,serialization}.ts
api/boms/[id]/preview/route.ts
backend/manufacturing/boms/[id]/components/BomTreePreview.tsx
backend/manufacturing/boms/[id]/components/BomTreeNode.tsx
i18n/{en,de,es,ko,pl}.json (additive keys)
```

The path names are guidance; the semantic boundaries, server/client ledger, and tests are binding.

### Read isolation and locking

- Start one PostgreSQL `REPEATABLE READ`, read-only transaction before resolving the root.
- Every family/revision/line query repeats tenant, organization, and live-row predicates.
- Do not take `FOR UPDATE`, the P1.4a advisory graph lock, or any write lock.
- Do not retry with a newer snapshot inside the same response.
- A concurrent committed authoring change is either entirely outside or entirely inside the transaction snapshot; the response includes root `revisionUpdatedAt` as freshness evidence.
- P1.4a's monotonic revision token lets the UI detect that a later authoring event made the rendered preview stale.

### Limit enforcement

Defaults and hard caps are server constants:

| Limit | Default | Hard maximum | Meaning |
|---|---:|---:|---|
| `maxDepth` | 8 | 20 | Largest permitted node depth, root = 0. |
| `maxNodes` | 500 | 2,000 | Root plus all line occurrences. |

- Inputs must be canonical integers inside their ranges; invalid query values return normal zod `400`.
- Requested limits are echoed in a success response.
- A resolved child with at least one line at depth `maxDepth + 1` causes a depth error; a leaf occurrence exactly at `maxDepth` is valid.
- Attempting node `maxNodes + 1` causes a node error.
- For the next deterministic pre-order candidate, depth is checked before node count; the error reports `limitType:'depth'` if that one candidate violates both.
- Limit evaluation precedes response serialization; no partial `root` is returned in the error body.
- Hard caps cannot be raised through environment variables in Wave 0.

## Data Models

P1.4b owns no entity, field, index, foreign key, migration, backfill, or generated entity ID. It reads only the P1.4a schema. This explicit N/A is a compatibility requirement.

## API Contracts

### Route

| Method/route | Feature | Contract |
|---|---|---|
| `GET /api/manufacturing/boms/{bomId}/preview` | `manufacturing.bom.view` | Optional bounded `maxDepth`/`maxNodes`; returns one complete nested occurrence tree and warnings. |

The route requires auth, tenant and concrete organization context, UUID/query zod schemas, `metadata.features`, and exported `openApi`. Missing or out-of-scope family/active draft returns the same non-disclosing platform `404`. It has no optimistic-lock input, mutation guard, command bus action, `x-om-operation`, or side effect.

### Response DTO

```ts
type PreviewQuantity = {
  value: string
  unitCode: string
}

type BomPreviewResolution =
  | { state: 'stock_leaf' }
  | {
      state: 'resolved'
      source: 'variant' | 'product_fallback'
      childBomId: string
      childRevisionId: string
      childRevisionNumber: number
    }
  | { state: 'unresolved' }

type BomPreviewNode = {
  occurrencePath: string[]
  depth: number
  lineId: string
  position: number
  componentProductId: string
  componentVariantId: string | null
  catalogLabel: {
    productName: string | null
    variantName: string | null
    state: 'resolved' | 'missing'
  }
  supplyMode: 'stock' | 'produce'
  consumptionBasis: 'variable' | 'fixed'
  yieldFactor: string
  configuredNormalizedQuantity: PreviewQuantity
  grossRequiredQuantity: PreviewQuantity
  resolution: BomPreviewResolution
  warnings: BomPreviewWarning[]
  children: BomPreviewNode[]
}

type BomPreviewWarning = {
  code: 'bom.child_unresolved'
  occurrencePath: string[]
  lineId: string
  componentProductId: string
  componentVariantId: string | null
}

type BomPreviewResponse = {
  bomId: string
  revisionId: string
  revisionNumber: number
  revisionUpdatedAt: string
  evaluatedBaseOutput: PreviewQuantity
  limits: { maxDepth: number; maxNodes: number }
  result: { nodeCount: number; deepestDepth: number }
  warnings: BomPreviewWarning[]
  children: BomPreviewNode[]
}
```

Root is represented by response metadata plus top-level `children`, not a synthetic line. `nodeCount` nevertheless includes the root, so an empty BOM returns `nodeCount:1`, `deepestDepth:0`, and `children:[]`. Warning order follows deterministic depth-first occurrence order. The same warning exists on its node and in the top-level summary for accessible presentation; it is not an HTTP error.

### Stable errors

| Code | HTTP | Meaning/data |
|---|---:|---|
| `bom.explosion_limit_exceeded` | 422 | Complete result would exceed requested depth or nodes; `{limitType:'depth'|'nodes',limit,attempted}`. |
| `bom.cycle_detected` | 409 | Persisted graph corruption; response includes scoped family/line path IDs only. |
| `bom.quantity_invalid` | 422 | Stored base/line/yield/snapshot invalid or exact arithmetic overflows. |
| `bom.uom_invalid` | 422 | Parent component and resolved child revision carry incompatible historical snapshot base units. |
| `bom.child_unresolved` | 200 warning | `produce` occurrence has no variant/product child family. |

P1.4b can surface `bom.variant_product_mismatch` as stored-data corruption if the P1.4a reader detects impossible target evidence. It returns `bom.uom_invalid` for corrupt snapshots or an exact parent-line/child-revision historical base-unit mismatch; normal preview never queries mutable Catalog policy to reinterpret a saved draft. Errors contain no SQL, labels from another scope, or unbounded path.

OpenAPI documents query ranges/defaults, decimal strings, occurrence-path semantics, all response unions, warning duplication, all-or-error limits, ACL, `404`, and stable errors. Contract tests assert both `metadata` and `openApi` exports.

## UI/UX

### Editor integration

P1.4b adds a separate **Multi-level preview** tab/panel to `/backend/manufacturing/boms/[id]`. Direct components remain the default editing source of truth owned by P1.4a.

- The panel is lazy: opening it requests the default bounded preview once.
- It shows evaluated root output, returned node/depth totals, and active limits.
- Nodes are indented/collapsible client-side; collapsing never triggers another server request.
- Each row shows component label/UUID fallback, gross required quantity and base unit, basis, yield, supply mode, resolution source, and warning state.
- `stock` and unresolved `produce` nodes have no expander.
- Repeated occurrences render separately and expose their path in an accessible detail/tooltip, not as one merged row.
- Top-level `Alert status="warning"` summarizes unresolved occurrences and links/focuses the corresponding node.
- Limit errors use `Alert status="warning"`, explain which requested cap was exceeded, and offer explicit retry buttons with preset bounded values up to the hard caps. No automatic escalating retry occurs.
- Quantity/corruption/cycle errors use `Alert status="error"` and do not render a partial tree.
- A P1.4a BOM/line client broadcast marks the open preview stale and offers Refresh; it does not silently replace a tree while the user is reading it.
- The view has no edit affordance, drag-and-drop, bulk action, print/export, or saved expansion state.
- Requests use `apiCall`/`readApiResultOrThrow`, never raw `fetch`; the hook owns `AbortController` cleanup on unmount, route, or organization change.
- `SectionHeader`, `Alert`, `StatusBadge`, `LoadingMessage`, `ErrorMessage`, and `EmptyState` are used in their canonical roles. Node/status text is rendered normally, never through unsafe HTML; there are no hardcoded status colors, arbitrary sizes, inline SVGs, or unlocalized user strings.

### Accessibility and responsive behavior

- Use semantic tree/treeitem/group roles only if the complete WAI-ARIA keyboard model is implemented; otherwise use nested lists with buttons, which is the Wave 0 default.
- Expand/collapse buttons have translated `aria-label`, visible focus, and `aria-expanded`.
- Warnings are not communicated by color alone and remain in DOM/readable when a branch is collapsed through the summary.
- Keyboard users can traverse controls in document order and jump from warning summary to occurrence.
- On narrow screens, quantity/status stack below identity; indentation has a capped visual width and level text remains available to assistive technology.

### Frontend architecture contract

The existing editor page remains a server root. P1.4b adds focused client leaves only:

| Client file | Exact browser-only reason | Imported by | Heavy dependency | Cleanup/hydration risk | Rejected alternative | Budget |
|---|---|---|---|---|---|---:|
| `BomTreePreview.tsx` | open/stale/error/summary and branch-state coordination | editor server shell | none beyond DS primitives | discard stale response and reset on scope change | turn editor/page root into a client component | <=300 LOC |
| `BomTreeNode.tsx` | per-branch expand/collapse state and focus target | preview client | none | bounded recursive hydration/deep focus | flatten occurrences and lose hierarchy | <=220 LOC |
| `useBomPreview.ts` | API request, abort lifecycle, event-bridge subscription | preview client | event hook only | abort and unsubscribe on unmount/scope change | global provider/store or raw fetch effect | <=160 LOC |

The editor `page.tsx` remains a server component and imports the panel as the only new island. No provider/bootstrap registry, duplicate server fetch, global store, heavy browser library, or entire-page client conversion is added. Recursive rendering is bounded by server caps. Budgets are zero new client page roots, zero unapproved >300-LOC client files, and zero heavy dependencies at page/provider roots. Tests measure editor hydration, `yarn check:client-boundaries`, route bundle/build/RAM, deep-tree render, keyboard collapse, and error/warning focus.

## Internationalization

Add `en`, `de`, `es`, `ko`, and `pl` keys for the preview tab, output/quantity/basis/yield labels, resolution sources, stock leaf, unresolved summary, limits, stale state, refresh/retry, expand/collapse controls, level/path, and errors. UI uses `useT`/`resolveTranslations`; API warning/error codes remain language-neutral. No hardcoded user-visible JSX text is accepted.

## Commands, Events, Undo, and Redo

P1.4b registers no command and creates no undo/redo entry because it is read-only. It emits no persistent/domain/client event. The preview client consumes P1.4a `manufacturing.bom.*` and `manufacturing.bom_line.*` broadcasts only to mark a loaded tree stale. Refresh remains an explicit GET and does not mutate domain state.

## ACL and Security

P1.4b reuses `manufacturing.bom.view`; it adds no feature key. Auth and immutable feature checks are declared in route/page `metadata`, never mutable role-name checks. The API performs ACL and full tenant/concrete-organization scoping before traversal or Catalog enrichment. Out-of-scope root/descendant data cannot be distinguished from missing data. Limit validation, iterative traversal, query budgets, no cache, and bounded diagnostic paths reduce resource-exhaustion and disclosure risk.

All UUID/query input is zod-validated; ORM/query-builder predicates are parameterized. Response JSON uses framework serialization, and labels are text-only—never raw HTML. Logs/errors exclude Catalog labels, snapshots, SQL, request bodies, credentials, and cross-scope existence detail. P1.4b introduces no PII/free text about people/secret field, so encryption maps and decryption reads are explicitly N/A.

## Search, Indexing, and Cache

- **Search/indexing:** N/A. Preview is a transient hierarchy, not an entity or global-search projection.
- **Cache:** N/A. A descendant mutation can affect many roots; P1.4b performs a fresh snapshot read and defines no key/tag/alias/invalidation surface.
- **Pagination:** N/A inside a tree. Limits bound the complete response; partial tree cursors are forbidden.

## Migration and Compatibility

There is no migration or backfill. The endpoint and editor panel are additive while Manufacturing is enabled; package root exports, module metadata, activation defaults, P1.4a writes, and Catalog APIs remain unchanged. Removing/turning off Manufacturing removes the route and UI through normal module discovery. Optional peers remain absent.

P1.7 must not reinterpret this draft response as release evidence. It may reuse neutral traversal primitives, but its released/effective selection and immutable snapshot DTO require a separate contract. P1.10 may similarly reuse exact primitives without depending on a UI response type.

## Implementation Plan

### Phase 1 — Pure evaluation contract

1. Add DTO/zod schemas and exact variable/fixed/yield unit tests.
2. Add occurrence-path, ordering, resolution, warning, cycle, and limit evaluator tests.
3. Keep traversal types neutral and response adaptation BOM-local.

### Phase 2 — Scoped read service and API

1. Add P1.4a internal reader seam and one `REPEATABLE READ` evaluator transaction.
2. Implement batched frontier/resolution reads and Catalog label enrichment.
3. Add route metadata, ACL, zod, OpenAPI, stable errors, and query-count instrumentation.

### Phase 3 — UI and i18n

1. Mount a lazy read-only panel without changing P1.4a direct editor ownership.
2. Add bounded nested presentation, warnings, errors, stale/refresh, accessibility, and responsive behavior.
3. Add all five locales and event-consumer tests.

### Phase 4 — Integration and performance gates

1. Prove cross-scope non-disclosure, repeatable-read consistency, hard caps, and no partial results.
2. Prove Catalog-only operation, optional peers absent, and Manufacturing-disabled behavior.
3. Run package build/typecheck/test, focused UI/shared tests, OpenAPI checks, create-app packaging, and measured query/render benchmarks.

## Testing Strategy

### Unit and contract

- empty root, one level, multiple levels, and deterministic sibling/pre-order output;
- repeated identical lines and the same child family appearing on separate occurrence paths without deduplication;
- variant-first resolution, product fallback, unresolved variant/product, and exposed resolution source;
- `stock` remains leaf even with an available BOM;
- variable calculation at `R=B`, below/above base output, non-terminating `R/B`, and multi-level propagation without intermediate ratio rounding;
- fixed remains once per immediate parent invocation while child variable lines scale to the fixed gross output;
- yield `1`, fractional yield, all rounding modes/scales, no intermediate rounding, canonical decimals, and overflow;
- matching historical base units propagate gross demand; mismatched parent-line/child-revision base units fail as `bom.uom_invalid` without current-policy conversion;
- root/depth/node counting boundaries including empty root, exact max, and first attempted excess;
- all-or-error response with no partial tree;
- defensive direct/indirect cycle path and valid shared descendant across branches;
- invalid stored base output, line quantity, yield, and snapshot;
- response/warning schema and stable error data bounds.

### API, isolation, and consistency

- auth/ACL, invalid UUID/query, root missing, active draft missing, and out-of-scope non-disclosure;
- tenant and organization isolation for roots, descendants, fallback resolution, warnings, and labels;
- `REPEATABLE READ` concurrency test where descendant changes during traversal: response is entirely old or entirely new, never mixed;
- authoring remains unblocked by a long preview except normal database resource contention;
- no command/action log/event/operation header on GET;
- Catalog label success/missing fallback without arithmetic change;
- OpenAPI/metadata coverage and canonical decimal serialization;
- default/requested/hard caps and malicious query corpus.

### UI and integration

- lazy first load, manual refresh, abort on scope/navigation change, and stale marker after every P1.4a event family;
- indented/collapsible nodes, repeated occurrences, resolution badges, stock leaf, unresolved summary/focus;
- limit retry presets never exceed hard caps and no automatic loop;
- cycle/quantity/transport errors render no partial tree;
- keyboard/focus/ARIA, screen-reader labels, narrow viewport, deep indentation cap, and five locales;
- hydration with no duplicate fetch, no new provider, and component LOC guardrails;
- Manufacturing+Catalog works without WMS/Resources/Planner;
- Manufacturing disabled exposes no route/tab/i18n ownership; Manufacturing without Catalog fails P1.0a dependency validation;
- no optional-peer/public-export/cache/search additions.

### Performance gates

Use deterministic fixtures at the hard caps and record query count, SQL duration, evaluator time, serialized response bytes, Node heap delta, browser render time, and graph-lock wait impact.

- no database query per occurrence; the uncombined upper shape is one root query, at most `maxDepth + 1` line-frontier/probe queries, at most `maxDepth` batched family-resolution queries, and one batched Catalog enrichment call; implementations may combine these but may not exceed the depth-shaped bound;
- each frontier input is capped by remaining node budget plus one overflow sentinel;
- fixtures with many unrelated organization BOMs prove the evaluator never preloads out-of-tree candidates and query/result volume remains tied to requested bounds;
- `maxNodes=1` with a non-empty root, exact-limit width/depth, and a next node violating both caps prove sentinel detection and depth-first error precedence;
- a `2,000`-node/depth-`20` valid preview completes within the repository CI performance-test budget established during implementation and records its measured baseline rather than inventing an unsupported absolute SLA here;
- attempting node `2,001` or depth `21` terminates before serialization and returns the stable limit error;
- response size and browser render/RAM are measured at `500` default and `2,000` hard cap;
- concurrent P1.4a write-lock tests show preview never acquires the organization graph advisory lock.

The synchronous path is justified only by the hard `2,000`-node/depth-`20` cap. Anything requiring a larger tree, report, export, or durable calculation is deferred to a separately specified asynchronous worker capability rather than raising limits or starting an ad hoc job here.

## P1.12 Evidence Mapping

| Category | Evidence |
|---|---|
| Isolation | Root/descendant/fallback/enrichment cross-scope API tests |
| Read consistency | `REPEATABLE READ` concurrent descendant mutation test |
| Exact quantity | Multi-level variable/fixed/yield/rounding/overflow corpus |
| Bounds/security | Query validation, exact boundaries, all-or-error, path bounding, hard-cap measurements |
| Compatibility | No schema/export/default/write change; additive route/panel only |
| Disabled modules | Optional peers absent, Manufacturing disabled, Catalog-required failure |
| API/UI | OpenAPI/metadata plus accessible lazy tree/error/warning/stale paths |
| Commands/cache/search | Explicit read-only N/A evidence |

## Alignment With Adjacent Specifications

| Work item | Contract |
|---|---|
| P1.0a | One opt-in package/runtime module; Catalog only hard dependency; no public domain export. |
| P1.3a | Blocking exact decimal multiply/divide/round and immutable line/revision evidence. |
| P1.4a | Blocking source schema, scoped readers, target resolution, occurrence/order semantics, cycle prevention, ACL/events. |
| P1.5 | Preview contains no operation/routing reference; a later additive field needs explicit display semantics. |
| P1.6 | No Work Center/resource/calendar dependency, data, or capacity calculation. |
| P1.7 | Owns release readiness, unresolved blocker, effectivity/Site, immutable child revision selection, and released snapshots. |

P1.4b is useful after P1.4a and remains independent of P1.5/P1.6. P1.7 may be implemented against P1.4a integrity without using the P1.4b UI/API, although Wave 0 user readiness tracks both P1.4 slices. Dedicated P1.5/P1.6/P1.7 full specs do not yet exist; this alignment follows accepted roadmap/execution/backlog boundaries and does not pre-decide their internals.

## Risks & Impact Review

### Combinatorial occurrence growth

- **Severity:** High.
- **Scenario/affected area:** Reused assemblies multiply into thousands of occurrences, exhausting API memory or editor render capacity for the requesting organization.
- **Detection:** node/depth error counters plus default/hard-cap SQL, heap, bytes and browser-render fixtures.
- **Mitigation:** occurrence-count hard cap, iterative traversal, pre-serialization all-or-error, measured default/hard-cap fixtures.
- **Residual:** legitimate large graphs require a future asynchronous/reporting capability, not a larger synchronous cap by configuration.

### Mixed-state or stale draft interpretation

- **Severity:** High.
- **Scenario/affected area:** A descendant changes while preview is evaluated or read, causing one author to act on a structurally inconsistent or outdated tree.
- **Detection:** concurrent snapshot integration test, response root token, and event-driven stale indicator; no cross-organization effect.
- **Mitigation:** one repeatable-read snapshot, response root version, event-driven stale marker, no cache.
- **Residual:** any draft preview can become stale immediately after commit; it is explicitly non-authoritative.

### Quantity semantic ambiguity

- **Severity:** High.
- **Scenario/affected area:** Non-terminating scaling, fixed demand, yield, or historical base-unit drift produces a plausible but different material quantity at a descendant.
- **Detection:** golden formula corpus for all modes/scales, non-terminating ratios, multi-level fixed/variable paths, and base-unit mismatch errors.
- **Mitigation:** one-invocation root, explicit fixed-per-parent rule, exact formulas, snapshot rounding, golden multi-level tests.
- **Residual:** future requested-output/batch policy needs a new contract.

### Query and render cost

- **Severity:** Medium.
- **Scenario/affected area:** A wide/deep valid tree stays inside limits but causes depth-shaped query latency or heavy client hydration.
- **Detection:** query-count instrumentation, slow-query/evaluator timing, response bytes, Node heap, route bundle/RSS, and browser render measurements.
- **Mitigation:** batched frontier reads/enrichment, query instrumentation, response caps, lazy panel, collapsible bounded rendering.
- **Residual:** wide shallow trees can still reach the hard node budget.

### Accidental lifecycle coupling

- **Severity:** High.
- **Scenario/affected area:** P1.7/P1.10 reuses a transient draft DTO as released/execution evidence and later descendant edits change historical meaning.
- **Detection:** static dependency/export tests and adjacent-spec contract tests reject imports of preview response types into release/order snapshots.
- **Mitigation:** no model/command/event/export, DTO labeled draft-only, P1.7/P1.10 boundaries and compatibility tests.
- **Residual:** neutral calculation primitives require disciplined adapters as released/execution models arrive.

### Catalog or optional-peer leakage

- **Severity:** High.
- **Scenario/affected area:** Label enrichment becomes arithmetic authority or an optional-peer import prevents Catalog-only installations from loading preview.
- **Detection:** missing-label equivalence tests, static imports, reduced-registry generation, and disabled-module/create-app fixtures.
- **Mitigation:** arithmetic from stored evidence, scalar IDs/QueryEngine labels, static import and reduced-registry tests.
- **Residual:** missing Catalog labels reduce readability but not structural correctness.

## Final Compliance Report

### Rules and guides reviewed

- `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/catalog/AGENTS.md`;
- `packages/shared/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`;
- `packages/events/AGENTS.md`, `packages/cache/AGENTS.md`, `packages/cli/AGENTS.md`, `.ai/qa/AGENTS.md`;
- `.ai/docs/module-development.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/ui-backend-components.md`;
- optimistic-locking/event-bridge guides named by the root Task Router and the spec-writing checklist/frontend contract.

### Compliance matrix

| Rule source/area | Status | Evidence |
|---|---|---|
| Spec scope | Compliant | Fresh-context verdict **PASS**: one bounded read-only draft-preview capability; no authoring/lifecycle ownership. |
| Module placement/naming | Compliant | Internal `manufacturing` read service/route/panel; singular feature reuse; no public export/submodule. |
| Cross-module coupling | Compliant | P1.4a internal readers and stored snapshots; Catalog QueryEngine labels only; optional peers absent. |
| Tenant/security | Compliant | Metadata auth/feature, zod, parameterized scoped queries, non-disclosing errors and bounded paths/work. |
| Encryption | N/A compliant | No persisted field, PII/free text/credential/secret or custom crypto. |
| Data/migration | N/A compliant | No entity, migration, backfill, persistent tree, array/blob column or generated entity ID. |
| Quantity/consistency | Compliant | One final exact division/round, historical base-unit fail-closed rule, repeatable-read snapshot. |
| API/OpenAPI | Compliant | One justified custom GET with DTO, limits, warnings/errors, metadata, ACL, zod and exported OpenAPI. |
| Commands/events/undo | N/A compliant | Read-only; no mutation/command/action log/event; consumes P1.4a broadcasts for stale UI only. |
| Bounds/performance | Compliant | Depth/node hard caps, overflow sentinel, deterministic precedence, bounded frontier queries and measurement gates. |
| UI/HTTP/DS | Compliant | apiCall, shared status/loading/error/empty primitives, accessible nested lists, no edit/raw HTML/hardcoded styles. |
| Frontend architecture | Compliant | Server editor root, exact three-file client ledger, cleanup/LOC/provider/heavy-dependency budgets and hydration/bundle/RAM tests. |
| i18n | Compliant | Five locales and no hardcoded user-visible text. |
| Cache/search/pagination/worker | N/A compliant | Fresh uncached complete tree; no projection/cursor; >2,000-node/report work explicitly deferred to a separate async capability. |
| Compatibility/isolation tests | Compliant | Additive route/panel only; optional peers absent, Manufacturing disabled, Catalog-required and create-app evidence. |

### Internal consistency check

| Check | Status | Notes |
|---|---|---|
| Source model matches evaluator/DTO | Pass | P1.4a direct lines, snapshots, positions, target resolution and revision token map without persistence duplication. |
| Arithmetic matches response/UI | Pass | DTO exposes configured and final gross quantities only; no rounded intermediate is reused. |
| Limits match traversal/API/tests | Pass | Root/depth/node counting, `remaining+1` sentinel, next-depth probe, precedence and all-or-error behavior agree. |
| API matches UI | Pass | Lazy panel handles success, unresolved warnings, staleness, limit retry and corruption without edit side effects. |
| Risks cover read path | Pass | Growth, consistency, quantity, query/render, lifecycle and dependency risks include scenario/detection/mitigation/residual. |
| Adjacent contracts agree | Pass | P1.0a/P1.3a/P1.4a/P1.5/P1.6/P1.7 gates and non-dependencies are explicit. |

### Non-compliant items

None.

### Verdict

**Fully compliant at specification level.** Approved as implementation-ready subject to P1.0 acceptance and ready P1.0a/P1.3a/P1.4a prerequisites.

Implementation remains gated by P1.0, P1.0a, P1.3a, and P1.4a. No product code is authorized by this documentation task.

## Changelog

- 2026-08-19: Created P1.4b after the combined P1.4 fresh-context review returned **SPLIT** and the roadmap owner accepted the authoring/preview boundary.
- 2026-08-19: Defined draft-only resolution, occurrence identity, exact variable/fixed/yield calculation, repeatable-read consistency, all-or-error limits, API/UI, and evidence gates.
- 2026-08-19: Fresh-context review returned **PASS** after exact single-round arithmetic, historical base-unit failure, transaction ordering, bounded sentinel traversal and deterministic limit precedence were made explicit.

### Review — 2026-08-19

- **Reviewer:** Codex plus fresh-context scope reviewer.
- **Security:** Passed; scoped/authenticated bounded read, zod/parameter binding, non-disclosing errors and explicit encryption N/A.
- **Performance:** Passed; all-or-error caps, sentinel/frontier query bounds, synchronous justification and hard-cap API/browser evidence.
- **Cache:** N/A; fresh repeatable-read evaluation with no cache/search/index projection.
- **Commands:** N/A; read-only endpoint and panel with no mutation, undo, action log or emitted event.
- **Risks:** Passed; scenarios, blast radius/detection, mitigation and residual risk are recorded.
- **Verdict:** Approved. Fresh-context scope-cohesion review returned **PASS — no further split**.
