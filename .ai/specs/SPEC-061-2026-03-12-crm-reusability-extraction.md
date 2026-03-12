# SPEC-061: CRM Feature Reusability Extraction

- **Date**: 2026-03-12
- **Status**: Draft
- **Related PR**: feat/crm-enhancement branch
- **Related Specs**: SPEC-058 (Deals Pipeline), SPEC-059 (Deal Timeline), SPEC-060 (Customer 360)

## TLDR

Extract 7 CRM-specific features into generic, reusable platform capabilities so that any module (sales, catalog, HR, etc.) can use timelines, saved views, bulk operations, reorder, line items, analytics patterns, and health scoring without copy-pasting CRM code.

## Problem Statement

The feat/crm-enhancement PR delivers strong CRM features but implements several capabilities as customers-module-only code that should be generic platform services:

1. **Timeline system** — 95% code duplication between `DealTimelinePanel` and `CustomerTimelinePanel`; API routes share ~80% identical code; types hardcoded to `deal_*` prefixes
2. **Saved Views** — Entity, API, events, and ACL locked to customers; validator restricts to `['deal', 'person', 'company']`; existing `perspectives` module serves similar purpose
3. **Bulk operations** — Loop-and-update with partial success reporting is generic but locked to deal actions
4. **Reorder logic** — Duplicated between deal lines and pipeline stages
5. **Line item totals** — `computeLineTotal()` in deal-lines duplicates sales order line logic
6. **Analytics routes** — 5 routes duplicate auth boilerplate, hardcode SQL, ignore existing `analyticsConfig`
7. **Health score / alerts** — Weights and thresholds hardcoded as constants, not configurable per org

Without extraction, each new module needing these capabilities must copy-paste ~3,000 lines of CRM code and adapt it.

## Proposed Solution

Extract generic abstractions into shared packages while keeping CRM-specific implementations as consumers of those abstractions. Follow the existing factory pattern established by `makeSalesLineRoute`.

### Design Principles

- **Extract, don't rewrite** — Move existing working code into shared locations; CRM becomes first consumer
- **Configuration over convention** — Generic systems accept config objects, not hardcoded constants
- **Backward compatible** — All existing CRM API routes, event IDs, and types remain unchanged
- **Incremental** — Each phase produces a working build; no big-bang refactor

## Architecture

### Phase 1: Timeline Generalization

**Goal**: Any module can render a timeline panel and expose a timeline API route with ~20 lines of configuration.

#### 1.1 Generic Timeline Types (`packages/shared/src/modules/timeline/`)

```typescript
// types.ts
export type TimelineEntry<K extends string = string> = {
  id: string
  kind: K
  occurredAt: string
  actor: TimelineActor
  summary: string
  detail: Record<string, unknown> | null
  changes: FieldChange[] | null
  entityContext?: { entityId: string; entityLabel: string } | null
}

export type TimelineActor = {
  id: string | null
  label: string
}

export type FieldChange = {
  field: string
  label: string
  from: unknown
  to: unknown
}

export type AggregateOptions<K extends string = string> = {
  types?: Set<K>
  before?: string
  limit: number
}

export type TimelineSourceConfig<K extends string = string> = {
  id: string                                    // e.g., 'audit', 'comments', 'emails'
  fetch: (ctx: TimelineSourceContext) => Promise<unknown[]>
  normalize: (records: unknown[], displayUsers: Record<string, string>) => TimelineEntry<K>[]
}

export type TimelineRouteConfig<K extends string = string> = {
  feature: string                               // e.g., 'customers.deals.view'
  entityLoader: (id: string, em: any, scope: any) => Promise<unknown>
  sources: TimelineSourceConfig<K>[]
  allKinds: readonly K[]
}

export type TimelinePanelConfig<K extends string = string> = {
  apiPath: (entityId: string) => string         // e.g., id => `/api/customers/deals/${id}/timeline`
  allKinds: readonly K[]
  kindLabels: Record<K, string>
  kindIcons: Record<K, string>
  kindColors: Record<K, string>
  kindIconColors: Record<K, string>
}
```

#### 1.2 Generic Aggregator (move from customers)

Move `aggregator.ts` to `packages/shared/src/modules/timeline/aggregator.ts` — already fully generic. Re-export from old location for BC.

#### 1.3 Normalizer Helpers (`packages/shared/src/modules/timeline/normalizers.ts`)

Extract reusable normalizer utilities:

```typescript
export function resolveActor(userId: string | null, displayUsers: Record<string, string>, fallback?: string): TimelineActor
export function toIsoString(value: Date | string | number): string
export function buildFieldChanges(changesJson: Record<string, unknown>, fieldLabels: Record<string, string>): FieldChange[]
export function normalizeAuditLogs<K extends string>(
  logs: AuditLogEntry[],
  displayUsers: Record<string, string>,
  config: {
    createKind: K
    updateKind: K
    deleteKind: K
    fieldLabels: Record<string, string>
    stageChangeFields?: Set<string>       // fields that indicate a stage change (to suppress from "updated")
    stageChangeKind?: K                   // kind to use for stage-only changes
  }
): TimelineEntry<K>[]
```

CRM normalizers become thin wrappers calling these with CRM-specific config.

#### 1.4 Timeline API Route Factory (`packages/shared/src/modules/timeline/createTimelineRoute.ts`)

```typescript
export function createTimelineRoute<K extends string>(config: TimelineRouteConfig<K>) {
  return async function handler(req: NextRequest, params: { id: string }) {
    // 1. Auth + feature check (from config.feature)
    // 2. Entity load (from config.entityLoader)
    // 3. Parse query (limit, before, types)
    // 4. Fetch all sources in parallel (from config.sources)
    // 5. Normalize + aggregate
    // 6. Return { items, nextCursor }
  }
}
```

#### 1.5 Generic Timeline Panel (`packages/ui/src/backend/timeline/TimelinePanel.tsx`)

```typescript
export function TimelinePanel<K extends string>(props: {
  entityId: string
  config: TimelinePanelConfig<K>
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TranslateFn
  extraFilters?: React.ReactNode        // for deal filter dropdown in entity timeline
}) { ... }
```

Extracts the duplicated panel logic. `DealTimelinePanel` and `CustomerTimelinePanel` become thin wrappers.

#### 1.6 Migrate CRM Timeline

- `DealTimelinePanel` → wraps `<TimelinePanel config={dealTimelineConfig} />`
- `CustomerTimelinePanel` → wraps `<TimelinePanel config={entityTimelineConfig} extraFilters={<DealFilterDropdown />} />`
- API routes → use `createTimelineRoute(dealTimelineRouteConfig)`
- Re-export types from old paths for BC

**Files changed**: ~12 files
**Files created**: ~6 files in `packages/shared/src/modules/timeline/` + 2 in `packages/ui/src/backend/timeline/`

---

### Phase 2: Saved Views Extraction

**Goal**: Any DataTable page can offer saved views with ~10 lines of config.

#### 2.1 Merge with Perspectives Module

The existing `perspectives` module already stores per-user, per-table view configurations with `settingsJson`. Rather than creating a parallel system, extend perspectives to support saved view semantics.

**Extend `Perspective` entity** with optional fields:

```typescript
// Add to existing Perspective entity
@Property({ type: 'json', nullable: true })
filters?: Record<string, unknown>

@Property({ type: 'text', nullable: true })
sortField?: string | null

@Property({ type: 'text', nullable: true, default: 'asc' })
sortDir?: 'asc' | 'desc'

@Property({ type: 'json', nullable: true })
columns?: string[]

@Property({ default: false })
isShared!: boolean
```

#### 2.2 Create Saved View API Extension

Add routes to `perspectives` module:

- `GET /api/perspectives/saved-views?tableId=customers:deals` — list saved views for a table
- `POST /api/perspectives/saved-views` — create saved view
- `PUT /api/perspectives/saved-views/:id` — update
- `DELETE /api/perspectives/saved-views/:id` — delete

#### 2.3 Deprecate Customer-Specific Saved Views

- Keep `CustomerSavedView` entity for 1 minor version
- Add `@deprecated` to entity and route exports
- Create migration script to move `customer_saved_views` rows to `perspectives` table
- Add re-export bridge from old API path

#### 2.4 UI Hook

```typescript
// packages/ui/src/backend/hooks/useSavedViews.ts
export function useSavedViews(tableId: string): {
  views: SavedView[]
  activeView: SavedView | null
  applyView: (id: string) => void
  saveCurrentView: (name: string) => Promise<void>
  deleteView: (id: string) => Promise<void>
}
```

**Files changed**: ~8 files
**Files created**: ~4 files

---

### Phase 3: Shared CRUD Utilities

**Goal**: Generic reorder, bulk operations, and line item totals available to any module.

#### 3.1 Reorder Items Utility (`packages/shared/src/lib/crud/reorder-items.ts`)

```typescript
export async function reorderItems<T extends { id: string }>(
  em: EntityManager,
  entityClass: EntityClass<T>,
  ids: string[],
  orderField: string,
  parentFilter?: Record<string, unknown>,
): Promise<{ reordered: number }>
```

Consumers:
- `deals/[id]/lines/reorder/route.ts` → `await reorderItems(em, CustomerDealLine, ids, 'lineNumber', { deal: dealId })`
- `pipeline-stages/reorder/` → `await reorderItems(em, PipelineStage, ids, 'sequenceNumber', { pipeline: pipelineId })`
- Future: any sortable list (order lines, workflow steps, form fields)

#### 3.2 Bulk Action Route Factory (`packages/shared/src/lib/crud/bulk-action-route.ts`)

```typescript
export type BulkActionConfig<TAction extends string = string> = {
  entityClass: EntityClass
  idField: string                    // 'dealIds', 'orderIds'
  feature: string                    // feature gate for this operation
  actions: Record<TAction, BulkActionHandler>
  maxBatchSize?: number              // default 100
}

export type BulkActionHandler = (params: {
  entity: any
  payload: unknown
  em: EntityManager
  userId: string
}) => Promise<void>

export function createBulkActionRoute<TAction extends string>(
  config: BulkActionConfig<TAction>
): RouteHandler
```

#### 3.3 Line Totals Calculation (`packages/shared/src/lib/line-items/compute-line-totals.ts`)

```typescript
export type LineTotalsInput = {
  quantity: number
  unitPrice: number
  discountPercent?: number
  discountAmount?: number
  taxRate?: number
}

export type LineTotalsOutput = {
  subtotal: number          // quantity * unitPrice
  discountTotal: number     // computed discount
  taxTotal: number          // computed tax
  total: number             // final line total
}

export function computeLineTotals(input: LineTotalsInput, precision?: number): LineTotalsOutput
```

Consumers:
- `customers/commands/deal-lines.ts` → replace inline `computeLineTotal()`
- `sales/lib/makeSalesLineRoute.ts` → adopt shared calculation
- Future: invoice lines, quote lines, purchase order lines

#### 3.4 State Transition History Helper (`packages/shared/src/lib/crud/state-history.ts`)

```typescript
export type StateTransition = {
  entityType: string
  entityId: string
  fromState: { id: string; label: string; group?: string }
  toState: { id: string; label: string; group?: string }
  changedBy: string
  metadata?: Record<string, unknown>
}

export function recordStateTransition(em: EntityManager, transition: StateTransition): Promise<void>
export function getStateHistory(em: EntityManager, entityType: string, entityId: string, options?: PaginationOptions): Promise<StateHistoryEntry[]>
```

**Files changed**: ~8 files
**Files created**: ~4 files in `packages/shared/src/lib/crud/` + 1 in `packages/shared/src/lib/line-items/`

---

### Phase 4: Analytics & Health Score Patterns

**Goal**: Configurable health scoring and documented analytics route pattern.

#### 4.1 Configurable Health Score (`packages/shared/src/lib/scoring/health-score.ts`)

```typescript
export type HealthScoreDimension = {
  name: string
  weight: number                              // 0.0 - 1.0
  compute: (params: Record<string, number>) => number  // returns 0-100
}

export type HealthScoreConfig = {
  dimensions: HealthScoreDimension[]
}

export type HealthScoreResult = {
  score: number                               // 0-100
  label: 'critical' | 'at_risk' | 'fair' | 'good' | 'excellent'
  dimensions: Array<{ name: string; score: number; weight: number }>
}

export function computeHealthScore(config: HealthScoreConfig, params: Record<string, number>): HealthScoreResult
```

CRM becomes first consumer by passing CRM-specific dimensions and weights.

#### 4.2 Configurable Alert Framework (`packages/shared/src/lib/scoring/alerts.ts`)

```typescript
export type AlertRule<T = unknown> = {
  type: string
  severity: (params: T) => 'info' | 'warning' | 'error'
  condition: (params: T) => boolean
  message: (params: T) => string
}

export function evaluateAlerts<T>(rules: AlertRule<T>[], params: T): Alert[]
```

CRM alert rules become a configuration array instead of hardcoded if-statements.

#### 4.3 Extract `computePurchaseTrend` Utility

Move to `packages/shared/src/lib/math/trend.ts`:

```typescript
export function computeTrend(
  recentValue: number,
  previousValue: number,
  growthThreshold?: number,    // default 1.1
  declineThreshold?: number,   // default 0.9
): 'growing' | 'declining' | 'stable'
```

Eliminate duplication between `companies/[id]/metrics/route.ts` and `companies/[id]/purchase-history/route.ts`.

#### 4.4 Document Analytics Route Pattern

Create `packages/shared/src/lib/analytics/README.md` documenting:
- Standard auth/RBAC boilerplate to use
- How to leverage `analyticsConfig` for field mappings
- Standard response shapes for funnel, forecast, velocity, sources

No code extraction in this sub-phase — the analytics routes are too domain-specific to generalize further without over-engineering. Document the pattern instead.

**Files changed**: ~6 files
**Files created**: ~4 files in `packages/shared/src/lib/scoring/` + 1 in `packages/shared/src/lib/math/`

---

### Phase 5: UI Component Extraction

**Goal**: Reusable hooks and components for common detail page patterns.

#### 5.1 `useCrudSection` Hook (`packages/ui/src/backend/hooks/useCrudSection.ts`)

```typescript
export function useCrudSection<T extends { id: string }>(options: {
  fetchUrl: string
  t: TranslateFn
}): {
  items: T[]
  isLoading: boolean
  error: string | null
  editingId: string | null
  isSubmitting: boolean
  setEditingId: (id: string | null) => void
  reload: () => Promise<void>
  handleCreate: (data: Partial<T>) => Promise<void>
  handleUpdate: (id: string, data: Partial<T>) => Promise<void>
  handleDelete: (id: string) => Promise<void>
}
```

#### 5.2 Fix Minor UI Issues

- Replace raw `<button>` in `CrmAlerts.tsx` with `Button` component
- Extract hardcoded magic numbers to named constants in each file
- Add `variant` prop to `AccessDeniedMessage` for color flexibility

**Files changed**: ~6 files
**Files created**: ~2 files

---

## Data Models

### New Shared Types (no DB changes)

All new types in `packages/shared/` are runtime-only TypeScript types. No new database tables.

### Perspectives Extension (Phase 2)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `filters` | `json` | `null` | Saved filter state |
| `sort_field` | `text` | `null` | Column to sort by |
| `sort_dir` | `text` | `'asc'` | Sort direction |
| `columns` | `json` | `null` | Visible column list |
| `is_shared` | `boolean` | `false` | Shared across users |

Migration: additive-only (new nullable columns with defaults). No breaking changes.

### Deprecation: `customer_saved_views` Table

- Kept for 1 minor version
- Migration script copies rows to `perspectives` with `tableId = 'customers:<entityType>'`
- Drop in next minor version

## API Contracts

### No API Breaking Changes

All existing API routes remain at their current paths with identical request/response shapes. New generic routes are additive:

| Route | Method | Source |
|-------|--------|--------|
| `GET /api/perspectives/saved-views` | GET | Phase 2 (new) |
| `POST /api/perspectives/saved-views` | POST | Phase 2 (new) |
| `PUT /api/perspectives/saved-views/:id` | PUT | Phase 2 (new) |
| `DELETE /api/perspectives/saved-views/:id` | DELETE | Phase 2 (new) |

Existing routes deprecated (kept for BC):
| Route | Deprecation |
|-------|-------------|
| `GET /api/customers/saved-views` | Redirect to perspectives in v0.6.0, remove in v0.7.0 |
| `POST /api/customers/saved-views` | Same |
| `PUT /api/customers/saved-views/:id` | Same |
| `DELETE /api/customers/saved-views/:id` | Same |

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking type imports** — Modules importing `TimelineEntryKind` from customers | Medium | Re-export from old path for 1 minor version |
| **Perspectives schema migration** — Adding columns to existing table | Low | Additive-only, nullable columns with defaults |
| **Regression in CRM timeline** — Refactored panels might behave differently | Medium | Snapshot tests for panel output; integration tests for API routes |
| **Shared package size increase** — New modules in `@open-mercato/shared` | Low | Tree-shakable exports; separate subpaths |
| **Over-abstraction** — Generic systems harder to debug | Medium | Keep CRM-specific config close to CRM module; don't abstract beyond proven need |

## Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`:

| Surface | Category | Action |
|---------|----------|--------|
| Timeline types (Category 2) | STABLE | Re-export from old path; support both `deal_created` and generic kinds |
| Import paths (Category 4) | STABLE | All moved modules re-export from original location |
| Event IDs (Category 5) | FROZEN | `customers.savedView.*` events kept; new `perspectives.savedView.*` events added |
| API routes (Category 7) | STABLE | Old routes redirect/proxy to new; removal in v0.7.0 |
| Database schema (Category 8) | ADDITIVE-ONLY | New columns only; no renames/drops in this spec |
| ACL feature IDs (Category 10) | FROZEN | `customers.savedViews.manage` kept; new `perspectives.savedViews.manage` added |

## Implementation Plan

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|--------------|
| **Phase 1** | Timeline generalization | 2-3 days | None |
| **Phase 2** | Saved views → perspectives | 2 days | Phase 1 (for timeline saved filters) |
| **Phase 3** | Shared CRUD utilities | 1-2 days | None (can parallel with Phase 1) |
| **Phase 4** | Analytics & health score | 1-2 days | None (can parallel) |
| **Phase 5** | UI component extraction | 1 day | Phase 1 (timeline panel) |

**Total estimated effort**: 7-10 days

**Phases 1+3 can run in parallel. Phase 5 depends on Phase 1. Phase 2 is independent.**

## Final Compliance Report

- [x] No direct ORM relationships between modules
- [x] All entities filtered by `organization_id` / `tenant_id`
- [x] No cross-tenant data exposure
- [x] DI (Awilix) injection, no direct `new`
- [x] Zod validators for all inputs
- [x] Types derived from zod via `z.infer`
- [x] All new exports use package-level imports
- [x] Backward compatible: re-exports, deprecation bridges, additive-only schema changes
- [x] No frozen surface modifications (event IDs, widget spots, ACL feature IDs preserved)
- [x] i18n: all user-facing strings through `useT()` / `resolveTranslations()`

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Timeline Generalization | Done | 2026-03-12 | Types, aggregator, normalizers, UI panel, CRM wrappers, config, `createTimelineHandler` factory all implemented. Deal timeline route migrated to factory. Entity timeline stays as direct consumer (too complex for factory). |
| Phase 2 — Saved Views Extraction | Done | 2026-03-12 | Perspectives module fully implemented with GET/POST/PUT/DELETE. `CustomerSavedView` entity and commands marked `@deprecated`. `useSavedViews` hook implemented. Entity uses `settingsJson` (design choice vs flat fields). |
| Phase 3 — Shared CRUD Utilities | Done | 2026-03-12 | All shared utilities created and CRM consumers migrated: `computeSimpleLineTotal` replaces inline `computeLineTotal`, `reorderItems` replaces deal-lines reorder loop, `computeTransitionDuration` replaces inline duration calc. Pipeline stage reorder not migrated (uses explicit order values, not sequential). Bulk update route not migrated (encryption/auth complexity). |
| Phase 4 — Analytics & Health Score | Done | 2026-03-12 | Health score, alerts, and trend utilities implemented and consumed by CRM. Analytics route pattern README created. |
| Phase 5 — UI Component Extraction | Done | 2026-03-12 | `useCrudSection` hook with full CRUD methods (handleCreate/handleUpdate/handleDelete). `Button` component used in CrmAlerts. `AccessDeniedMessage` variant prop added. |

### Phase 3 — Detailed Notes
- [x] `computeSimpleLineTotal` replaces inline `computeLineTotal` in `deal-lines.ts`
- [x] `reorderItems` replaces manual reorder loop in `deal-lines.ts`
- [x] `computeTransitionDuration` replaces inline duration calc in `bulk-update/route.ts`
- [ ] Pipeline stage reorder — not migrated (uses explicit `{ id, order }` pairs, not sequential reorder)
- [ ] Bulk update route — not migrated to `executeBulkAction` (requires encryption support + per-item auth)
- [ ] `buildStateHistoryRecord` — CRM entity shape differs from generic (`dealId` vs `entityId`, pipeline fields)

## Changelog

| Date | Change |
|------|--------|
| 2026-03-12 | Initial draft — created from PR audit findings |
| 2026-03-12 | Gap implementation — timeline factory, perspectives PUT, CRM shared utility adoption, useCrudSection write methods, analytics README |
