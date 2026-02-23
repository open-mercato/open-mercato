# SPEC-017: Version History Panel

**Date:** 2026-02-03
**Status:** Draft
**Module:** `audit_logs` (backend), `ui` (frontend)
**Related:** [SPEC-016 (Form Headers & Footers)](SPEC-016-2026-02-03-form-headers-footers.md)

---

## Overview

A **Version History** panel integrated into CRUD form headers across all modules. When a user opens a record for editing (e.g., a sales order, a product, a customer), a clock icon appears in the form header. Clicking it opens a right-side slide-out panel — styled identically to the existing Notifications panel — that displays a chronological timeline of all changes made to that specific record.

Each timeline entry shows who made the change, when, and what action was performed. Clicking an entry transitions the panel to a detail view (with a "← Back" button in the header) showing a field-by-field before/after comparison. The panel is read-only.

This feature integrates with the `FormHeader` / `FormActionButtons` component system defined in [SPEC-016](SPEC-016-2026-02-03-form-headers-footers.md). The clock icon is rendered as part of the `extraActions` slot in `FormActionButtons`, which is shared between the header and footer of CrudForm pages.

---

## Problem Statement

Users editing records in the admin panel currently have no quick way to see the history of changes to the document they're working on. The existing Audit Logs page (`/backend/audit-logs`) shows system-wide logs but is not contextual to a specific record. Users need to:

1. Quickly see who changed a record and when
2. Understand what fields changed in each edit
3. Access this information without leaving the current form

The data already exists in the `action_logs` table via the command bus — this feature provides a contextual UI to surface it.

---

## Architecture

### Component Hierarchy

```
CrudForm
  └─ FormHeader (mode="edit", from SPEC-016)
       └─ FormActionButtons
            └─ extraActions slot
                 └─ Clock icon button (conditionally rendered when versionHistory prop is set)
  └─ VersionHistoryPanel (fixed right-side overlay)
       ├─ List View
       │    └─ VersionHistoryEntry items (clickable rows)
       └─ Detail View (replaces list when an entry is selected)
            └─ VersionHistoryDetail (metadata + changed fields table)
```

For detail pages that use `FormHeader mode="detail"` directly (e.g., sales documents), the version history button can also be placed in the `actionsContent` slot or as an additional element alongside the `ActionsDropdown`.

### Data Flow

```
CrudForm (versionHistory: { resourceKind, resourceId })
  → useVersionHistory hook (enabled: panelOpen)
    → GET /api/audit_logs/audit-logs/actions?resourceKind=X&resourceId=Y&limit=20
      → ActionLogService.list({ resourceKind, resourceId, ... })
        → action_logs table (filtered by resource_kind + resource_id)
  → VersionHistoryPanel receives entries[]
    → User clicks entry → selectedEntry state → VersionHistoryDetail renders
    → User clicks "Back" → selectedEntry = null → list view renders
```

---

## Backend Changes

### 1. Validator Extension

**File:** `packages/core/src/modules/audit_logs/data/validators.ts`

Add `resourceKind` and `resourceId` to `actionLogListSchema`:

```typescript
export const actionLogListSchema = z.object({
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  undoableOnly: z.boolean().optional(),
  resourceKind: z.string().min(1).optional(),   // NEW
  resourceId: z.string().min(1).optional(),      // NEW
  limit: z.number().int().positive().max(200).default(50),
  before: z.date().optional(),
  after: z.date().optional(),
})
```

### 2. Service Extension

**File:** `packages/core/src/modules/audit_logs/services/actionLogService.ts`

In `ActionLogService.list()`, add resource filtering after existing filters:

```typescript
if (parsed.resourceKind) where.resourceKind = parsed.resourceKind
if (parsed.resourceId) where.resourceId = parsed.resourceId
```

### 3. API Route Extension

**File:** `packages/core/src/modules/audit_logs/api/audit-logs/actions/route.ts`

Add to `auditActionQuerySchema`:

```typescript
resourceKind: z.string().describe('Filter by resource kind (e.g., "order", "product")').optional(),
resourceId: z.string().describe('Filter by resource ID (UUID of the specific record)').optional(),
```

Parse from URL and pass to service:

```typescript
const resourceKind = url.searchParams.get('resourceKind') ?? undefined
const resourceId = url.searchParams.get('resourceId') ?? undefined
```

**Actor filtering adjustment:** When `resourceKind` and `resourceId` are both provided, the API should return changes from **all actors** (not just the current user). This is necessary because version history needs to show who changed what. The user already has access to the record itself; showing its change history does not expose cross-tenant data. The existing `audit_logs.view_self` feature still gates access to the endpoint.

Implementation: when `resourceKind` and `resourceId` are both set, omit the `actorUserId` filter regardless of `canViewTenant`:

```typescript
// Existing logic (keep for non-resource-scoped queries)
let actorUserId = auth.sub
if (canViewTenant && actorQuery) {
  actorUserId = actorQuery
}

// NEW: for resource-scoped queries, show all actors
const isResourceScoped = resourceKind && resourceId
if (isResourceScoped) {
  actorUserId = undefined  // do not filter by actor
}
```

### 4. Database Index

**File:** `packages/core/src/modules/audit_logs/data/entities.ts`

Add a composite index for performant resource-scoped queries:

```typescript
@Index({ name: 'action_logs_resource_idx', properties: ['tenantId', 'resourceKind', 'resourceId', 'createdAt'] })
```

After modifying the entity, run `npm run db:generate` to produce the migration automatically.

### 5. OpenAPI Specification

Update the `openApi` export in the route file to include the new query parameters in the `auditActionQuerySchema`. The existing schema-driven approach will handle this automatically since the schema is already referenced in the `openApi.methods.GET.query` field.

---

## Shared Display Helpers

### Extraction from ActionLogDetailsDialog

**Source:** `packages/core/src/modules/audit_logs/components/ActionLogDetailsDialog.tsx`
**Target:** `packages/core/src/modules/audit_logs/lib/display-helpers.tsx` (new file)

The following functions and types currently live inline in the dialog component and should be extracted into a shared module so they can be reused by both the existing `ActionLogDetailsDialog` and the new `VersionHistoryDetail` component.

#### Extracted Functions

```typescript
// Type for a single field change
export type ChangeRow = {
  field: string
  from: unknown
  to: unknown
}

// Check if a value is a plain object
export function isRecord(value: unknown): value is Record<string, any>

// Convert snake_case/camelCase field names to Title Case
export function humanizeField(field: string): string

// Render a value as a React node with appropriate formatting
export function renderValue(value: unknown, fallback: string): React.ReactNode

// Safe JSON.stringify with fallback
export function safeStringify(value: unknown): string

// Format ISO date string to localized medium date + short time
export function formatDate(value: string): string

// Format resourceKind + resourceId into a display string
export function formatResource(item: { resourceKind: string | null; resourceId: string | null }, fallback: string): string

// Extract field-level changes from changesJson and snapshotBefore
export function extractChangeRows(
  changes: Record<string, unknown> | null | undefined,
  snapshotBefore: unknown,
): ChangeRow[]
```

After extraction, `ActionLogDetailsDialog.tsx` should import from `../lib/display-helpers` — this is a pure refactor with no functional change.

---

## UI Components

All new UI components live in `packages/ui/src/backend/version-history/`.

### 1. Types

**File:** `packages/ui/src/backend/version-history/types.ts`

```typescript
export type VersionHistoryEntry = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  actorUserName: string | null
  resourceKind: string | null
  resourceId: string | null
  createdAt: string
  updatedAt: string
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
  changes?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
}

export type VersionHistoryConfig = {
  resourceKind: string
  resourceId: string
}
```

### 2. useVersionHistory Hook

**File:** `packages/ui/src/backend/version-history/useVersionHistory.ts`

```typescript
export type UseVersionHistoryResult = {
  entries: VersionHistoryEntry[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

export function useVersionHistory(
  config: VersionHistoryConfig | null,
  enabled: boolean,
): UseVersionHistoryResult
```

**Behavior:**
- Accepts `config` (resourceKind + resourceId) and an `enabled` flag
- Only fetches when `enabled` is `true` (lazy loading — does not fetch until panel is opened)
- Fetches from `GET /api/audit_logs/audit-logs/actions?resourceKind=X&resourceId=Y&limit=20`
- Uses `apiCall` from `@open-mercato/ui/backend/utils/apiCall`
- Supports cursor-based pagination: "Load more" sets `before` param to `createdAt` of the last entry
- Returns newest-first sorted entries
- `refresh()` resets entries and refetches from the beginning
- `loadMore()` appends older entries
- Handles loading, error, and empty states

### 3. VersionHistoryPanel Component

**File:** `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx`

```typescript
export type VersionHistoryPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: VersionHistoryEntry[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
  t: TranslateFn
}
```

**Layout** (modeled after `NotificationPanel.tsx`):

```
┌──────────────────────────────────────────┐
│ Backdrop: fixed inset-0 z-40 bg-black/20 │ (click to close)
│                                          │
│    ┌─────────────────────────────┐       │
│    │ Panel: fixed right-0 top-0  │       │
│    │ z-50 h-full w-full max-w-md │       │
│    │ border-l bg-background      │       │
│    │ shadow-lg                   │       │
│    │                             │       │
│    │ ┌─────────────────────────┐ │       │
│    │ │ HEADER                  │ │       │
│    │ │ [Clock] Version History │ │       │
│    │ │                    [X]  │ │       │
│    │ └─────────────────────────┘ │       │
│    │ ┌─────────────────────────┐ │       │
│    │ │ CONTENT (scrollable)    │ │       │
│    │ │                         │ │       │
│    │ │ ┌─────────────────────┐ │ │       │
│    │ │ │ Entry 1             │ │ │       │
│    │ │ │ Updated order       │ │ │       │
│    │ │ │ John Doe   2 min ago│ │ │       │
│    │ │ └─────────────────────┘ │ │       │
│    │ │ ┌─────────────────────┐ │ │       │
│    │ │ │ Entry 2             │ │ │       │
│    │ │ │ Created order       │ │ │       │
│    │ │ │ Jane Smith   1h ago │ │ │       │
│    │ │ └─────────────────────┘ │ │       │
│    │ │                         │ │       │
│    │ │ [Load more]             │ │       │
│    │ └─────────────────────────┘ │       │
│    └─────────────────────────────┘       │
└──────────────────────────────────────────┘
```

**Detail view** (when an entry is selected):

```
┌─────────────────────────────┐
│ HEADER                      │
│ [←] Back           [X]     │
├─────────────────────────────┤
│ METADATA                    │
│ Action: Updated order       │
│ Date: Feb 3, 2026 14:30     │
│ Changed by: John Doe        │
│ Status: done                │
├─────────────────────────────┤
│ CHANGED FIELDS              │
│ ┌─────┬─────────┬─────────┐│
│ │Field│ Before  │ After   ││
│ ├─────┼─────────┼─────────┤│
│ │Name │ Old val │ New val ││
│ │Price│ 10.00   │ 15.00   ││
│ └─────┴─────────┴─────────┘│
├─────────────────────────────┤
│ ▶ Context (collapsible)     │
│ ▶ Snapshot before           │
│ ▶ Snapshot after            │
└─────────────────────────────┘
```

**Internal state:**
- `selectedEntry: VersionHistoryEntry | null` — toggles between list and detail views
- Clicking an entry row → sets `selectedEntry` → renders detail
- Clicking "← Back" → sets `selectedEntry = null` → renders list

**Keyboard:**
- `Escape` key closes the panel (same pattern as NotificationPanel)

**Empty state:**
- Clock icon (opacity-50) + "No changes recorded" text

**Loading state:**
- Spinner + "Loading history..." text

**Error state:**
- Error message with retry option

### 4. VersionHistoryDetail Component

**File:** `packages/ui/src/backend/version-history/VersionHistoryDetail.tsx`

```typescript
export type VersionHistoryDetailProps = {
  entry: VersionHistoryEntry
  t: TranslateFn
}
```

Renders inside the panel's scrollable content area (no portal, no modal chrome). Sections:

1. **Metadata grid** (2-column dl/dt/dd layout):
   - Action: `entry.actionLabel || entry.commandId`
   - Date: formatted via `formatDate(entry.createdAt)`
   - Changed by: `entry.actorUserName || entry.actorUserId`
   - Status: `entry.executionState` (capitalized)

2. **Changed fields table**:
   - Extracted via `extractChangeRows(entry.changes, entry.snapshotBefore)`
   - Three columns: Field (humanized), Before, After
   - Values rendered via `renderValue()`
   - Empty state: "No tracked field changes"

3. **Context** (collapsible `<details>` element):
   - Shows `safeStringify(entry.context)` when context is non-empty

4. **Snapshots** (collapsible `<details>` elements):
   - "Snapshot before" with `safeStringify(entry.snapshotBefore)`
   - "Snapshot after" with `safeStringify(entry.snapshotAfter)`

Imports display helpers from `@open-mercato/core/modules/audit_logs/lib/display-helpers`.

### 5. Barrel Export

**File:** `packages/ui/src/backend/version-history/index.ts`

```typescript
export { VersionHistoryPanel } from './VersionHistoryPanel'
export type { VersionHistoryPanelProps } from './VersionHistoryPanel'
export { VersionHistoryAction } from './VersionHistoryAction'
export type { VersionHistoryActionProps } from './VersionHistoryAction'
export { useVersionHistory } from './useVersionHistory'
export type { UseVersionHistoryResult } from './useVersionHistory'
export type { VersionHistoryEntry, VersionHistoryConfig } from './types'
```

---

## CrudForm Integration

**File:** `packages/ui/src/backend/CrudForm.tsx`

This section describes how CrudForm integrates with the version history feature. CrudForm internally uses `FormHeader` and `FormFooter` from [SPEC-016](SPEC-016-2026-02-03-form-headers-footers.md).

### New Prop on CrudForm

```typescript
/** When provided, shows a "Version History" clock icon in the header that opens a side panel.
 *  Only appears in edit mode (when resourceId is non-empty). */
versionHistory?: {
  resourceKind: string
  resourceId: string
}
```

**Why explicit prop instead of auto-deriving:**
- `entityId` is a custom-field entity ID (e.g., `customers:people`), not the `resourceKind` used by commands (e.g., `person`)
- The caller knows the correct `resourceKind` string that matches what their commands emit
- Explicit opt-in avoids showing version history on forms that don't support it

### Internal Wiring

```typescript
// State
const [historyOpen, setHistoryOpen] = React.useState(false)

// Hook (lazy — only fetches when panel is open)
const historyData = useVersionHistory(
  versionHistory?.resourceId ? versionHistory : null,
  historyOpen,
)
```

### Header Button via FormActionButtons.extraActions

CrudForm passes the `FormHeader` component (edit mode) with `actions` props including `extraActions`. When `versionHistory` is provided, CrudForm **prepends** the clock icon button to the consumer-provided `extraActions`:

```tsx
// Inside CrudForm, when building FormActionButtons props:
const versionHistoryAction = (
  <VersionHistoryAction
    config={versionHistoryEnabled ? versionHistory : null}
    t={t}
  />
)

// Merge with consumer extraActions:
const mergedExtraActions = versionHistoryEnabled ? (
  <>
    {versionHistoryAction}
    {props.extraActions}
  </>
) : props.extraActions

// Pass to FormHeader:
<FormHeader
  mode="edit"
  title={title}
  backHref={backHref}
  backLabel={backLabel}
  actions={{
    extraActions: mergedExtraActions,
    showDelete,
    onDelete: handleDelete,
    cancelHref,
    submit: { formId, pending, label: submitLabel, pendingLabel: savingLabel },
  }}
/>
```

The button only renders when `resourceId` is non-empty (edit mode). On create forms, `resourceId` is typically empty, so the button is hidden.

### Detail Page Integration (FormHeader mode="detail")

For detail pages that use `FormHeader mode="detail"` directly (not via CrudForm), the version history button can be included via `utilityActions`:

```tsx
<FormHeader
  mode="detail"
  title={documentNumber}
  backHref="/backend/sales/orders"
  entityTypeLabel="Sales order"
  statusBadge={statusBadge}
  menuActions={contextActions}
  utilityActions={(
    <VersionHistoryAction
      config={{ resourceKind: 'sales.order', resourceId: documentId }}
      t={t}
    />
  )}
/>
```

`utilityActions` renders before the dropdown + delete button so existing actions remain intact.

### Panel Rendering

At the bottom of the CrudForm return, render the panel (fixed positioning means placement in DOM tree doesn't matter):

```tsx
{versionHistory && versionHistory.resourceId ? (
  <VersionHistoryPanel
    open={historyOpen}
    onOpenChange={setHistoryOpen}
    entries={historyData.entries}
    isLoading={historyData.isLoading}
    error={historyData.error}
    hasMore={historyData.hasMore}
    onLoadMore={historyData.loadMore}
    t={t}
  />
) : null}
```

### Import Additions

```typescript
import { Clock } from 'lucide-react'  // Add to existing lucide imports
import { VersionHistoryPanel } from './version-history/VersionHistoryPanel'
import { useVersionHistory } from './version-history/useVersionHistory'
```

---

## Usage Example

### Sales Order Edit Page

```typescript
// packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx

<CrudForm
  title={t('sales.orders.form.editTitle')}
  backHref="/backend/sales/orders"
  versionHistory={{
    resourceKind: 'order',       // matches what sales commands emit
    resourceId: documentId,      // UUID of the order being edited
  }}
  fields={fields}
  onSubmit={handleSubmit}
  // ...
/>
```

### Catalog Product Edit Page

```typescript
// packages/core/src/modules/catalog/backend/catalog/products/[id]/edit/page.tsx

<CrudForm
  title={t('catalog.products.form.editTitle')}
  backHref="/backend/catalog/products"
  versionHistory={{
    resourceKind: 'catalog_product',
    resourceId: productId,
  }}
  fields={fields}
  onSubmit={handleSubmit}
  // ...
/>
```

### Customer Person Edit Page

```typescript
// packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx

<CrudForm
  title={t('customers.people.form.editTitle')}
  backHref="/backend/customers/people"
  versionHistory={{
    resourceKind: 'person',
    resourceId: personId,
  }}
  fields={fields}
  onSubmit={handleSubmit}
  // ...
/>
```

---

## Access Control

The version history panel uses the existing `audit_logs.view_self` feature to gate API access. No new ACL features are introduced.

**Actor visibility in resource-scoped queries:** When `resourceKind` + `resourceId` are provided in the API query, the endpoint returns changes from **all** actors (not just the current user). Rationale: the user already has permission to view and edit the record; seeing its complete change history is a natural extension of that access. The `audit_logs.view_self` feature still gates access to the endpoint itself.

If a stricter model is needed later, a new feature `audit_logs.view_resource_history` can be introduced to gate this behavior without breaking existing functionality.

### Default Role Features

No changes to `packages/core/src/modules/audit_logs/setup.ts` are needed. The existing configuration already grants:
- **admin:** `audit_logs.*` (all audit features)
- **employee:** `audit_logs.undo_self` (can only undo own actions)

Employees will see version history entries (they have `audit_logs.view_self` via the wildcard not being applied to them). If employees should not see version history, the module edit pages should conditionally omit the `versionHistory` prop based on the user's features.

---

## Internationalization

### New i18n Keys

Add to all 4 locale files in `packages/core/src/modules/audit_logs/i18n/`:

#### English (`en.json`)

```json
{
  "audit_logs.version_history.title": "Version History",
  "audit_logs.version_history.empty": "No changes recorded",
  "audit_logs.version_history.loading": "Loading history…",
  "audit_logs.version_history.error": "Failed to load version history",
  "audit_logs.version_history.load_more": "Load more",
  "audit_logs.version_history.detail.title": "Change Details",
  "audit_logs.version_history.detail.back": "Back",
  "audit_logs.version_history.detail.action": "Action",
  "audit_logs.version_history.detail.date": "Date",
  "audit_logs.version_history.detail.actor": "Changed by",
  "audit_logs.version_history.detail.status": "Status",
  "audit_logs.version_history.close": "Close"
}
```

#### Polish (`pl.json`)

```json
{
  "audit_logs.version_history.title": "Historia wersji",
  "audit_logs.version_history.empty": "Brak zarejestrowanych zmian",
  "audit_logs.version_history.loading": "Wczytywanie historii…",
  "audit_logs.version_history.error": "Nie udało się załadować historii wersji",
  "audit_logs.version_history.load_more": "Załaduj więcej",
  "audit_logs.version_history.detail.title": "Szczegóły zmiany",
  "audit_logs.version_history.detail.back": "Wstecz",
  "audit_logs.version_history.detail.action": "Akcja",
  "audit_logs.version_history.detail.date": "Data",
  "audit_logs.version_history.detail.actor": "Zmienione przez",
  "audit_logs.version_history.detail.status": "Status",
  "audit_logs.version_history.close": "Zamknij"
}
```

#### German (`de.json`)

```json
{
  "audit_logs.version_history.title": "Versionsverlauf",
  "audit_logs.version_history.empty": "Keine Änderungen aufgezeichnet",
  "audit_logs.version_history.loading": "Verlauf wird geladen…",
  "audit_logs.version_history.error": "Versionsverlauf konnte nicht geladen werden",
  "audit_logs.version_history.load_more": "Mehr laden",
  "audit_logs.version_history.detail.title": "Änderungsdetails",
  "audit_logs.version_history.detail.back": "Zurück",
  "audit_logs.version_history.detail.action": "Aktion",
  "audit_logs.version_history.detail.date": "Datum",
  "audit_logs.version_history.detail.actor": "Geändert von",
  "audit_logs.version_history.detail.status": "Status",
  "audit_logs.version_history.close": "Schließen"
}
```

#### Spanish (`es.json`)

```json
{
  "audit_logs.version_history.title": "Historial de versiones",
  "audit_logs.version_history.empty": "No se registraron cambios",
  "audit_logs.version_history.loading": "Cargando historial…",
  "audit_logs.version_history.error": "No se pudo cargar el historial de versiones",
  "audit_logs.version_history.load_more": "Cargar más",
  "audit_logs.version_history.detail.title": "Detalles del cambio",
  "audit_logs.version_history.detail.back": "Volver",
  "audit_logs.version_history.detail.action": "Acción",
  "audit_logs.version_history.detail.date": "Fecha",
  "audit_logs.version_history.detail.actor": "Cambiado por",
  "audit_logs.version_history.detail.status": "Estado",
  "audit_logs.version_history.close": "Cerrar"
}
```

### Reused Existing Keys

The detail view should reuse these existing keys from `audit_logs`:
- `audit_logs.actions.details.changed_fields` → "Changed fields" section heading
- `audit_logs.actions.details.field` → Table column header
- `audit_logs.actions.details.before` → Table column header
- `audit_logs.actions.details.after` → Table column header
- `audit_logs.actions.details.no_changes` → "No tracked field changes" empty state
- `audit_logs.actions.details.context` → Context collapsible label
- `audit_logs.actions.details.snapshot_before` → Snapshot before collapsible label
- `audit_logs.actions.details.snapshot_after` → Snapshot after collapsible label
- `audit_logs.common.none` → Fallback "—" for empty values

---

## File Manifest

### New Files

| File | Purpose |
|------|---------|
| `packages/core/src/modules/audit_logs/lib/display-helpers.tsx` | Shared formatting/rendering helpers extracted from ActionLogDetailsDialog |
| `packages/ui/src/backend/version-history/types.ts` | TypeScript types (VersionHistoryEntry, VersionHistoryConfig) |
| `packages/ui/src/backend/version-history/useVersionHistory.ts` | Data fetching hook with lazy loading and pagination |
| `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx` | Right-side slide-out panel (list view + detail view) |
| `packages/ui/src/backend/version-history/VersionHistoryDetail.tsx` | Detail view sub-component (metadata + changed fields table) |
| `packages/ui/src/backend/version-history/VersionHistoryAction.tsx` | Reusable clock button + panel wrapper |
| `packages/ui/src/backend/version-history/index.ts` | Barrel export |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/modules/audit_logs/data/validators.ts` | Add `resourceKind` and `resourceId` to `actionLogListSchema` |
| `packages/core/src/modules/audit_logs/services/actionLogService.ts` | Add resource filtering to `list()` method |
| `packages/core/src/modules/audit_logs/api/audit-logs/actions/route.ts` | Add query params, adjust actor filtering for resource-scoped queries |
| `packages/core/src/modules/audit_logs/data/entities.ts` | Add composite index on `(tenantId, resourceKind, resourceId, createdAt)` |
| `packages/core/src/modules/audit_logs/components/ActionLogDetailsDialog.tsx` | Replace inline helpers with imports from `lib/display-helpers` |
| `packages/ui/src/backend/CrudForm.tsx` | Add `versionHistory` prop, prepend clock button to `FormActionButtons.extraActions`, wire panel |
| `packages/core/src/modules/audit_logs/i18n/en.json` | Add version_history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/pl.json` | Add version_history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/de.json` | Add version_history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/es.json` | Add version_history i18n keys |

### Auto-Generated Files

| File | Trigger |
|------|---------|
| `packages/core/src/modules/audit_logs/migrations/Migration<timestamp>.ts` | `npm run db:generate` after adding new index |

---

## Design Decisions

### 1. Filtering by `resourceKind + resourceId` (not resourceId alone)

The compound filter matches the `action_logs` data model and avoids theoretical UUID collisions across entity types. A new composite index ensures performant queries.

### 2. Explicit `versionHistory` prop on CrudForm

The caller explicitly provides `{ resourceKind, resourceId }` rather than the system auto-deriving it from `entityId` or other props. Reasons:
- `entityId` is a custom-field entity identifier (e.g., `customers:people`), which differs from the `resourceKind` used by commands (e.g., `person`)
- Explicit opt-in avoids showing version history on forms where audit data doesn't exist or isn't meaningful
- The caller knows the correct `resourceKind` string that matches what their command handlers emit

### 3. All actors visible in resource-scoped queries

When filtering by `resourceKind + resourceId`, the API returns changes from all actors. The user already has edit access to the record; seeing its change history is a natural extension. No additional ACL feature is needed.

### 4. Display helpers in `@open-mercato/core`

The shared display helpers are placed in `packages/core/src/modules/audit_logs/lib/` rather than `packages/shared`. This keeps them semantically colocated with the audit_logs module. The `packages/ui` → `packages/core` import path is already established in 5+ existing files (NotificationPanel, detail sections).

### 5. Lazy loading via `enabled` flag

The `useVersionHistory` hook accepts `enabled: boolean` and only fetches when the panel is open. This avoids unnecessary API calls on every form load.

### 6. Panel modeled after NotificationPanel

The version history panel reuses the same layout pattern as `NotificationPanel.tsx`:
- Fixed right-side overlay with backdrop
- `z-40` backdrop + `z-50` panel
- `max-w-md` width
- Escape key support
- Scrollable content area

This ensures visual and behavioral consistency across the application.

### 7. Integration via FormActionButtons.extraActions (SPEC-016)

The version history clock button is placed in the `extraActions` slot of `FormActionButtons` (defined in [SPEC-016](SPEC-016-2026-02-03-form-headers-footers.md)). This slot is shared between the form header and footer, but the clock icon button is only prepended in the header's `extraActions`. CrudForm merges the version history button with consumer-provided `extraActions` transparently. For detail pages using `FormHeader mode="detail"` directly, the button is provided via the `utilityActions` slot so dropdown + delete remain intact.

### 8. In-panel navigation (not separate views or routes)

Clicking a version entry navigates to the detail view within the same panel using internal `selectedEntry` state. The "← Back" button returns to the list. This avoids route changes or separate modals and matches the UX pattern the user described (similar to "Wstecz" back navigation shown in the reference screenshots).

---

## Future Considerations

1. **Version comparison:** Allow selecting two versions to compare side-by-side
2. **Version restore:** Allow reverting to a previous version (using the existing undo/redo infrastructure)
3. **Filtering within the panel:** Filter by actor, date range, or action type
4. **Real-time updates:** Listen for new action log entries and show a "new changes" indicator
5. **Custom field changes:** Render custom field changes with human-readable labels instead of `cf_*` keys
6. **Pagination count:** Show "X of Y changes" at the top of the list
7. **Export:** Export version history as CSV or PDF for compliance purposes

---

## Changelog

### 2026-02-03
- Initial specification

### 2026-02-04
- Added reusable `VersionHistoryAction` component and `FormHeader` `utilityActions` slot for detail pages

### 2026-02-17 Addendum (Record Locking Alignment)
- Historical body intentionally preserved (append-only update).
- `record_locks` conflict diff generation reuses `action_logs` snapshots (`snapshot_before`, `snapshot_after`, `changes_json`) instead of storing duplicate snapshots in lock tables.
- No new version-history endpoint was introduced; integration continues through `GET /api/audit_logs/audit-logs/actions`.
- Existing related-history behavior (`includeRelated`, `parentResourceKind`, `parentResourceId`) remains unchanged.
