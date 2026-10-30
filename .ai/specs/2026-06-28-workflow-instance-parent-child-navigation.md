# Workflow Instance Parent ↔ Sub-Workflow Navigation

## TLDR
**Key Points:**
- Surface the existing parent↔child link between workflow instances in the admin UI so an operator can move naturally from a parent instance to the sub-workflow instances it spawned (and back), at any nesting depth.
- Two touchpoints: (1) the **instance list** page gains a recursive accordion that nests sub-workflow instances under their parent; (2) the **instance detail** page makes `SUB_WORKFLOW` graph nodes clickable, navigating to the child instance's detail page, plus a parent back-link.

**Scope:**
- Additive `parentInstanceId` + `hasParent` filters on `GET /api/workflows/instances`.
- Additive, opt-in row-expansion support on the shared `@open-mercato/ui` `DataTable` (TanStack `getExpandedRowModel`), default off — existing tables unaffected.
- Recursive parent→child accordion on the instance list page, lazy-loaded per level; default to top-level instances with a "show all (flat)" toggle.
- Clickable sub-workflow nodes on the instance detail graph → child instance detail (with a picker when a step spawned multiple children) + a "Parent instance" back-link.

**Concerns (if any):**
- Extending the shared `DataTable` is a contract-surface change. It is **additive-only** (new optional props; no behavior change when omitted), but it is `risk-high` because `DataTable` is used app-wide — it requires regression tests and BC sign-off.
- Top-level filtering (`hasParent=false`) needs a JSON-path predicate (absence of `metadata.labels.parentInstanceId`), which `$contains` cannot express; mitigated below.

## Overview
The workflows module already records the parent↔child relationship for every sub-workflow invocation, but only in the database and queue layer — it is invisible in the admin UI. An operator investigating a parent instance has no way to reach the sub-workflow instances it spawned without manually querying. This spec exposes that relationship at the two natural navigation points an operator already uses: the instance list and the instance detail graph. No new domain concepts are introduced — this is a read/navigation feature over data that already exists.

> **Market Reference**: Studied **Temporal Web UI** (its instance detail surfaces a "Child Workflows" relationship and each child is a hyperlink to its own run) and **Camunda Operate** (called-process-instance drill-down from a BPMN call-activity node, plus a parent breadcrumb). We adopt both ideas — node-level drill-down and a parent back-link — but reject Temporal's separate top-level "child workflows" search screen in favor of an inline accordion that matches Open Mercato's list conventions. We also reject building a dedicated graph "expand sub-workflow inline" overlay (Camunda-style nested rendering) as out of scope; we navigate to the child's own detail page instead.

## Problem Statement
When a `SUB_WORKFLOW` step runs, `lib/step-handler.ts` creates the child instance with parent linkage stored in `WorkflowInstance.metadata.labels` (`parentInstanceId`, `parentStepId`, `parentStepInstanceId`). Today:
- The instance **list** (`backend/instances/page.tsx`) shows every instance — parent and child — as a flat, undifferentiated row, so an operator cannot tell a sub-workflow run apart from a top-level one, nor group them.
- The instance **detail** graph (`backend/instances/[id]/page.tsx` + `components/WorkflowGraph.tsx`) renders `SUB_WORKFLOW` nodes but they are inert; there is no path from a node to the child instance it produced, and no link back to the parent.

Operators cannot follow execution across workflow boundaries, which is the single most common investigation path for nested workflows.

## Proposed Solution
1. **API** — add optional `parentInstanceId` and `hasParent` query params to `GET /api/workflows/instances`, reusing the existing tenant/org-scoped handler. Children-of-parent uses the existing JSONB `$contains` mechanism; top-level (`hasParent=false`) uses a JSON-path `IS NULL` predicate.
2. **Shared DataTable** — add opt-in expansion props (`getSubRows`, `expandable`, controlled `expanded`/`onExpandedChange`) wired to TanStack's `getExpandedRowModel`. Off by default; zero change for existing consumers.
3. **List page** — default to top-level instances; render children nested under their parent via the expansion API, lazily fetching each level's direct children on expand (recursive to arbitrary depth). Add a "show all (flat)" toggle that restores the legacy unfiltered view.
4. **Detail page** — fetch the current instance's direct children, build a `parentStepId → childInstanceId[]` map, mark matching `SUB_WORKFLOW` nodes as navigable, forward an `onNodeClick` handler through `WorkflowGraphReadOnly`, and navigate to the child (or show a picker when a step spawned >1 child). Add a "Parent instance" back-link derived from `metadata.labels.parentInstanceId`.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep `metadata.labels` as the source of truth; **no new column/entity** | The linkage already exists and is written atomically by `step-handler.ts`. Adding a `parent_instance_id` column would require a migration + backfill for zero new capability in v1. Revisit only if list-query performance demands an index (see Risks). |
| Extend the shared `DataTable` (vs page-local tree) | Chosen by maintainer. Canonical-primitive path (Fowler lens #6): TanStack v8 already supports expansion; wiring it as opt-in is reusable and avoids a bespoke renderer. |
| Lazy per-level child fetch (vs whole-tree upfront) | Bounds payload and query cost; supports arbitrary depth and large trees without N-deep joins. Each expand is one tenant-scoped, paginated request. |
| Navigate to child's own detail page (vs inline graph expansion) | Matches existing per-instance detail page (events, timeline, compensation) which would be lost in an inline overlay; far smaller surface. |
| Default list to top-level only + toggle | Chosen by maintainer. Makes the hierarchy legible by default; toggle preserves the old flat view for back-compat. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Page-local nested/tree component, leave `DataTable` untouched | Maintainer chose the shared-component path; a bespoke renderer would not be reused and duplicates table chrome (sorting, row actions, empty/error states). |
| Add denormalized `parent_instance_id` FK column now | Migration + backfill of existing rows for no v1 capability gain; JSONB path queries suffice at admin-page scale. Kept as a documented future optimization. |
| Inline sub-workflow expansion inside the graph canvas | High complexity (nested ReactFlow, layout, status merging); loses the child's dedicated detail surfaces. |

## User Stories / Use Cases
- **An operations admin** wants to **expand a parent instance row and see its sub-workflow runs nested beneath it** so that they can assess overall progress without leaving the list.
- **An operations admin** wants to **click a sub-workflow node in the execution graph and land on that child's detail page** so that they can investigate why a nested step is stuck.
- **An operations admin** viewing a child instance wants to **jump back to the parent instance** so that they can see the surrounding process.
- **An operations admin** wants to **toggle back to a flat list of all instances** so that existing search/filter workflows still work.

## Architecture

Read-only navigation feature; no new commands, events, entities, or migrations. Data flow:

```
List page (top-level default)
  GET /api/workflows/instances?hasParent=false        → parent/standalone rows
  expand row →
  GET /api/workflows/instances?parentInstanceId=<id>  → direct children (recurse on expand)

Detail page (instance X)
  GET /api/workflows/instances?parentInstanceId=<X>   → direct children of X
     build map: child.metadata.labels.parentStepId → [child.id]
     inject childInstanceId(s) onto SUB_WORKFLOW nodes (node.id === parentStepId)
  node click → router push /backend/workflows/instances/<childId>  (or picker if >1)
  parent back-link ← X.metadata.labels.parentInstanceId
```

Tenant/organization scoping is unchanged: every read goes through the existing `GET /api/workflows/instances` / `/[id]` handlers, which already enforce `tenantId` + `resolveOrganizationScopeFilter`. `parentInstanceId`/`hasParent` are *additional* filters layered on top of that scope — they can never widen it. Sub-workflow children are created in the same `tenantId`/`organizationId` as the parent (`step-handler.ts`), so the org-scope filter matches.

### Commands & Events
None. No state mutations are introduced.

## Data Models
No new or changed entities. The feature reads existing fields:

### WorkflowInstance.metadata.labels (existing, JSONB — read-only here)
- `parentInstanceId`: string (UUID) — parent instance, when this instance is a sub-workflow run
- `parentStepId`: string — the parent step's `stepId` (equals the graph node id from `definitionToGraph()`)
- `parentStepInstanceId`: string — parent step-instance id

## API Contracts

### List workflow instances (extended — additive)
- `GET /api/workflows/instances`
- New optional query params (added to the handler **and** to the exported `openApi.query` zod schema):
  - `parentInstanceId?: string` — return only instances whose `metadata.labels.parentInstanceId` equals this value.
    Implementation: `where.$and.push({ metadata: { $contains: { labels: { parentInstanceId } } } })` (mirrors existing `entityType`/`entityId` containment).
  - `hasParent?: boolean` — `false` returns only top-level/standalone instances (no parent label); `true` returns only children.
    Implementation: a JSON-path predicate on absence/presence of `metadata.labels.parentInstanceId` (e.g. a QueryBuilder/raw fragment `metadata->'labels'->>'parentInstanceId' IS [NOT] NULL`), since `$contains` cannot express key absence.
- Response shape unchanged: `{ data: WorkflowInstance[], pagination: { total, limit, offset, hasMore } }`.
- `parentInstanceId` and `hasParent` are mutually combinable with existing filters; when both `parentInstanceId` and `hasParent` are sent, `parentInstanceId` wins (it already implies a parent).

### Get workflow instance (unchanged)
- `GET /api/workflows/instances/[id]` — already returns `metadata` (incl. `labels`); used for the parent back-link.

### Shared DataTable expansion contract (additive, `@open-mercato/ui`)
New optional props on `DataTableProps<T>` (all default-off; absence = today's behavior):
- `getSubRows?: (row: T) => T[] | undefined`
- `expandable?: boolean | ((row: T) => boolean)`
- `expanded?: ExpandedState` / `onExpandedChange?: (updater) => void` (controlled, for lazy loading)
- An expansion toggle affordance rendered in the first column when `expandable` is set.
Wires `getExpandedRowModel()` and `expanded` into the existing `useReactTable` config only when these props are present.

## Internationalization (i18n)
Add keys under `workflows.instances.*` in all four locales (`i18n/{en,es,de,pl}.json`):
- `parentInstance.link` ("Parent instance") and aria-label
- `subWorkflows.section` / `subWorkflows.empty`
- `list.topLevelOnly` / `list.showAllFlat` (toggle labels)
- `graph.openChildInstance` (node affordance / aria-label)
- `graph.multipleChildren` (picker title) + child row label
Any new shared-DataTable user-facing strings (e.g. expand/collapse aria-labels) go in `@open-mercato/ui` i18n with `aria-label`s, never hard-coded.

## UI/UX
- **List**: first column gains a chevron toggle on rows that can have children. Expanding lazily loads direct children (spinner row while loading), indented one level; children are themselves expandable (recursive). A header toggle switches between "Top-level only" (default) and "All (flat)". Status badges migrate to semantic `status-*` tokens (Boy Scout — see Risks/Compliance; the current page uses `bg-blue-100 text-blue-800` etc.).
- **Detail**: `SUB_WORKFLOW` nodes that produced a child get a visible affordance (pointer cursor + a small "open" icon/badge with `aria-label`) and are keyboard-activatable. Clicking navigates to the child; if a step spawned multiple children, a small picker (popover/dialog with `Cmd/Ctrl+Enter` submit, `Escape` cancel) lists them. A "Parent instance" link appears in the Execution Summary when the instance has a parent. Nodes without a resolved child remain inert.
- **Cycle/orphan safety**: the list tracks visited instance ids while expanding to avoid an infinite expand loop; a `parentStepId` that maps to a missing/deleted child renders no affordance.

## Migration & Compatibility
- No database migration; no schema change.
- API change is additive (new optional query params) — existing callers unaffected.
- `DataTable` change is additive (new optional props) — per `BACKWARD_COMPATIBILITY.md` types/signatures are ADDITIVE-ONLY-compliant; existing consumers render identically. Covered by regression tests asserting no behavioral change when the new props are absent.

## Implementation Plan

### Phase 1: API filters
1. Add `parentInstanceId` + `hasParent` parsing to `GET /api/workflows/instances` handler (`api/instances/route.ts`), implementing the `$contains` (children) and JSON-path `IS NULL` (top-level) predicates within the existing tenant/org scope.
2. Extend the exported `openApi.query` zod schema with the two optional params.
3. Tests: list returns only children for `parentInstanceId`; only top-level for `hasParent=false`; tenant isolation preserved (a child in another tenant is never returned).

### Phase 2: Detail-page navigation (independent of Phase 3/4)
1. In `backend/instances/[id]/page.tsx`, add a `useQuery` for direct children (`parentInstanceId=<id>`); build the `parentStepId → childInstanceId[]` map.
2. Inject `childInstanceId`/`childInstanceIds` into `SUB_WORKFLOW` node data during graph styling (`definitionToGraph` result post-processing).
3. Add `onNodeClick` to `WorkflowGraphReadOnly` (forward to existing `WorkflowGraph`/`WorkflowGraphImpl` prop) and handle navigation + multi-child picker.
4. Add affordance/aria to `SubWorkflowNode` (`components/nodes/SubWorkflowNode.tsx`) when `childInstanceId(s)` present.
5. Add "Parent instance" back-link in the Execution Summary from `instance.metadata.labels.parentInstanceId`.
6. i18n keys; tests for map building (single child, multi-child, no child) and back-link rendering.

### Phase 3: Shared DataTable expansion (additive)
1. Add expansion props to `DataTableProps<T>` and wire `getExpandedRowModel()` + `expanded` state into `useReactTable` only when present.
2. Render the toggle affordance in the first column; respect `stickyFirstColumn`/existing column behavior.
3. Regression tests: with no expansion props, output and behavior are byte-for-byte unchanged; with props, sub-rows render and toggle.

### Phase 4: List-page recursive accordion
1. Convert the list query to default `hasParent=false`; add the "All (flat)" toggle (when flat, drop `hasParent`).
2. Use the extended `DataTable` with controlled `expanded` + lazy child fetch (`parentInstanceId=<rowId>`), merging loaded children into the row tree; visited-id cycle guard; per-row loading state.
3. Boy Scout: migrate touched status-badge colors to semantic `status-*` tokens.
4. i18n keys; tests for default top-level view, expand→lazy-load children, toggle to flat.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/workflows/api/instances/route.ts` | Modify | `parentInstanceId`/`hasParent` filters + `openApi.query` schema |
| `packages/ui/src/backend/DataTable.tsx` | Modify | Opt-in expansion props + `getExpandedRowModel` wiring |
| `packages/core/src/modules/workflows/backend/instances/page.tsx` | Modify | Recursive accordion, top-level default + toggle, token migration |
| `packages/core/src/modules/workflows/backend/instances/[id]/page.tsx` | Modify | Child fetch, node-click nav, multi-child picker, parent back-link |
| `packages/core/src/modules/workflows/components/WorkflowGraph.tsx` | Modify | Forward `onNodeClick` through `WorkflowGraphReadOnly` |
| `packages/core/src/modules/workflows/components/nodes/SubWorkflowNode.tsx` | Modify | Navigable affordance + aria when child present |
| `packages/core/src/modules/workflows/i18n/{en,es,de,pl}.json` | Modify | New keys |
| (tests) | Create | API filter tests, map-building tests, DataTable regression/expansion tests |

### Testing Strategy
- **Unit**: `parentStepId→childInstanceId` map (0/1/many children); JSON-path filter SQL shape; DataTable renders unchanged without expansion props.
- **Integration (per `.ai/qa/AGENTS.md`, self-contained fixtures)**: start a parent workflow with a `SUB_WORKFLOW` step, assert (a) `GET …?hasParent=false` excludes the child, (b) `GET …?parentInstanceId=<parent>` returns exactly the child, (c) the child carries the parent labels. Clean up created instances in teardown.
- **UI paths**: list default shows only parents; expanding loads children; detail graph node click routes to child; parent back-link routes to parent.

## Risks & Impact Review

### Data Integrity Failures
Read-only feature — no writes, so no partial-write/interruption risk. A child referenced by `parentStepId` may be soft-deleted/missing; the UI degrades to an inert node (no broken link). Concurrent execution may add children after the page loaded; React Query refetch/invalidation on focus covers staleness.

### Cascading Failures & Side Effects
No events emitted, no downstream subscribers. The only cross-cutting change is the shared `DataTable`; a regression there would affect every list in the app — mitigated by additive opt-in design + regression tests asserting unchanged behavior when props are absent.

### Tenant & Data Isolation Risks
`parentInstanceId`/`hasParent` are filters layered on the existing tenant/org scope and cannot widen it. Children always share the parent's tenant/org. No shared/global caches introduced. A tenant with a very deep/wide sub-workflow tree only affects its own lazy queries (each is paginated and scoped).

### Migration & Deployment Risks
No migration, no backfill. Fully backward-compatible and deployable without downtime; the API and DataTable changes are additive.

### Operational Risks
JSONB filtering on `metadata.labels.parentInstanceId` is unindexed by default; at large instance volumes the top-level/children queries could degrade. Bounded by tenant/org scope + pagination at admin-page scale; mitigation is a partial/GIN index on `metadata` (or the documented `parent_instance_id` column) if profiling shows it. Recursive lazy expansion is user-driven (one request per expand), so no event-storm/flood risk.

### Risk Register

#### Shared DataTable regression
- **Scenario**: Wiring `getExpandedRowModel`/expanded state subtly changes rendering or row-id behavior for existing flat tables.
- **Severity**: High
- **Affected area**: Every `DataTable` consumer app-wide.
- **Mitigation**: Strictly additive props; expansion code paths guarded by prop presence; regression tests assert identical output/behavior with props absent; BC sign-off (ADDITIVE-ONLY).
- **Residual risk**: Low — behavior change only reachable by opting in.

#### Top-level filter performance at scale
- **Scenario**: `metadata->'labels'->>'parentInstanceId' IS NULL` scans large tenant instance sets without an index.
- **Severity**: Medium
- **Affected area**: Instance list API for high-volume tenants.
- **Mitigation**: Tenant/org scope + pagination bound the scan; add GIN/partial index or denormalized column if profiling requires.
- **Residual risk**: Low/Medium — acceptable for current admin-page usage; documented optimization path exists.

#### Multi-child / cyclic expansion
- **Scenario**: A step spawns many children (loop/parallel) or a UI expand loops indefinitely.
- **Severity**: Low
- **Affected area**: Detail node-click + list accordion.
- **Mitigation**: Multi-child picker instead of assuming 1:1; visited-id guard on recursive expansion.
- **Residual risk**: Negligible.

## Final Compliance Report — 2026-06-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/ui/AGENTS.md` (DataTable guidelines — to apply during implementation)
- `BACKWARD_COMPATIBILITY.md` (types/signatures, API routes — ADDITIVE-ONLY)

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No new relations; reads own module's instances |
| root AGENTS.md | Filter by organization_id / no cross-tenant exposure | Compliant | New filters layer on existing tenant/org scope |
| root AGENTS.md | Use `apiCall`/`apiFetch`, never raw fetch | Compliant | Reuses existing `apiCall`/`apiFetch` patterns |
| root AGENTS.md | No hardcoded status colors | Compliant (Boy Scout) | Migrate touched list status badges to `status-*` tokens |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | New `workflows.instances.*` keys in en/es/de/pl |
| core AGENTS.md | Export `openApi` from API routes | Compliant | Extend existing `openApi.query` schema |
| workflows AGENTS.md | Resolve services via DI; no direct lib calls in routes | Compliant | No new service usage; read-only |
| workflows AGENTS.md | Scope all queries by organization_id | Compliant | Handler scope unchanged |
| BACKWARD_COMPATIBILITY.md | Types/signatures ADDITIVE-ONLY | Compliant | DataTable props + query params additive, default-off |
| packages/ui/AGENTS.md | DataTable + dialog UX (Cmd/Ctrl+Enter, Escape; aria-labels) | Compliant | Multi-child picker + expansion affordance follow DS |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new models; reads `metadata.labels` |
| API contracts match UI/UX section | Pass | List + detail consume the new filters |
| Risks cover all write operations | Pass | No writes; shared-component risk covered |
| Commands defined for all mutations | Pass | No mutations |
| Cache strategy covers all read APIs | Pass | Uses existing endpoints + React Query |

### Non-Compliant Items
None identified.

### Verdict
- **Fully compliant** — ready for implementation once this spec is approved.

## Changelog
### 2026-06-28
- Initial specification. Open Questions resolved: extend shared `DataTable` (opt-in expansion); default list to top-level-only with a flat toggle; keep `metadata.labels` as source of truth (no migration); fully recursive nesting.
- Implemented all four phases:
  - Phase 1 — `parentInstanceId` (`$contains`) + `hasParent` (JSON-path `#>> '{labels,parentInstanceId}'` via MikroORM `raw()`) filters on `GET /api/workflows/instances` + `openApi.query`; 3 new route tests.
  - Phase 3 — additive opt-in expansion on shared `DataTable` (`getSubRows`/`expandable`/controlled `expanded`/`onExpandedChange` → `getExpandedRowModel`), expand toggle in first cell with depth indentation; 3 new render tests (incl. back-compat no-toggle assertion).
  - Phase 2 — detail-page child fetch + `parentStepId→childInstanceId[]` map, navigable `SUB_WORKFLOW` nodes via forwarded `onNodeClick`, multi-child picker dialog (Cmd/Ctrl+Enter / Esc), parent back-link, node affordance + aria.
  - Phase 4 — recursive lazy accordion (top-level default + `SegmentedControl` flat toggle, per-parent lazy load with loading/empty placeholder rows, visited-set cycle guard); Boy-Scout migration of status badges to `status-*` tokens.
  - i18n: 9 keys added across en/es/de/pl (parity 1276 each).
  - Validation: core + ui typecheck clean; 624 workflow tests, 1560 ui tests pass; changed files lint clean (DataTable shows only pre-existing warnings/`useVirtualizer` error). Note: `yarn build:app` not run; i18n key-sort warning is pre-existing/advisory (parity is correct).
