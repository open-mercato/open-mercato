# SPEC-041a — Foundation: InjectionPosition + Headless Widget Infrastructure

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | A (PR 1) |
| **Branch** | `feat/umes-foundation` |
| **Depends On** | Nothing |
| **Status** | Draft |

## Goal

Establish the type system and loading infrastructure for all subsequent UMES phases. Create the `InjectionPosition` enum for typed positioning, define all headless widget types, and create the headless widget loading path that subsequent phases build on.

---

## Scope

### 1. `InjectionPosition` Enum + `InjectionPlacement` Interface

```typescript
// packages/shared/src/modules/widgets/injection-position.ts

enum InjectionPosition {
  Before = 'before',
  After = 'after',
  First = 'first',
  Last = 'last',
}

interface InjectionPlacement {
  position: InjectionPosition
  /** Target element ID to position relative to. Required for Before/After. */
  relativeTo?: string
}

// Usage examples:
{ position: InjectionPosition.After, relativeTo: 'email' }    // After the "email" column
{ position: InjectionPosition.Before, relativeTo: 'status' }  // Before "status" field
{ position: InjectionPosition.First }                          // Absolute first
{ position: InjectionPosition.Last }                           // Absolute last (default)
```

If `position` is omitted, the default is `InjectionPosition.Last`. Invalid `relativeTo` references fall back to `Last` with a dev-mode console warning.

### 2. Headless Widget Loading Path

Create a second loading function alongside the existing one:

```typescript
// Two loading functions (not one)
loadInjectionWidgetById(id)         // Existing: expects Widget component, renders via InjectionSpot
loadInjectionDataWidgetById(id)     // NEW: loads metadata + declarative config, no Widget expected
```

**Widget type detection** uses the injection table entry. Existing spot IDs (`crud-form:*`, `backend:record:current`) use the existing loader. New spot IDs for declarative extensions use the new headless loader.

### 3. `useInjectionDataWidgets` Hook

```typescript
// packages/ui/src/backend/injection/useInjectionDataWidgets.ts

function useInjectionDataWidgets(spotId: string): {
  widgets: LoadedDataWidget[]
  isLoading: boolean
}
```

This hook loads headless widgets for a given spot ID without expecting a React component. Returns the widget metadata and declarative configuration (columns, fields, menu items, etc.).

### 4. Headless Widget Type Definitions

All new widget types added to `packages/shared/src/modules/widgets/injection.ts`:

```typescript
// InjectionColumnWidget — for DataTable column injection (Phase F)
type InjectionColumnWidget = {
  metadata: { id: string; title?: string; features?: string[] }
  columns: {
    id: string
    header: string              // i18n key
    accessorKey: string         // Dot-path into row data
    cell?: (props: { getValue: () => unknown }) => React.ReactNode
    size?: number
    sortable?: boolean
    placement?: InjectionPlacement
  }[]
}

// InjectionRowActionWidget — for DataTable row action injection (Phase F)
type InjectionRowActionWidget = {
  metadata: { id: string; features?: string[] }
  rowActions: {
    id: string
    label: string               // i18n key
    icon?: string
    onSelect: (row: any, context: any) => void
    placement?: InjectionPlacement
  }[]
}

// InjectionBulkActionWidget — for DataTable bulk action injection (Phase F)
type InjectionBulkActionWidget = {
  metadata: { id: string; features?: string[] }
  bulkActions: {
    id: string
    label: string               // i18n key
    icon?: string
    onExecute: (selectedRows: any[], context: any) => Promise<void>
  }[]
}

// InjectionFilterWidget — for DataTable filter injection (Phase F)
type InjectionFilterWidget = {
  metadata: { id: string; features?: string[] }
  filters: {
    id: string
    label: string               // i18n key
    type: 'select' | 'text' | 'date-range' | 'boolean'
    options?: { value: string; label: string }[]
    strategy: 'server' | 'client'
    queryParam?: string         // For server strategy
    enrichedField?: string      // For client strategy
  }[]
}

// InjectionFieldWidget — for CrudForm field injection (Phase G)
type InjectionFieldWidget = {
  metadata: { id: string; title?: string; features?: string[] }
  fields: {
    id: string                  // Dot-path (e.g., '_loyalty.tier')
    label: string               // i18n key
    type: 'text' | 'select' | 'number' | 'date' | 'boolean' | 'textarea' | 'custom'
    options?: { value: string; label: string }[]
    optionsLoader?: (context: FieldContext) => Promise<{ value: string; label: string }[]>
    optionsCacheTtl?: number    // Cache duration in seconds (default: 60)
    customComponent?: React.LazyExoticComponent<React.ComponentType<CustomFieldProps>>
    group: string               // Existing form group ID
    placement?: InjectionPlacement
    readOnly?: boolean
    visibleWhen?: FieldVisibilityCondition  // Conditional visibility
  }[]
  eventHandlers?: WidgetInjectionEventHandlers<any, any>
}

// InjectionWizardWidget — for multi-step setup flows (Phase L)
type InjectionWizardWidget = {
  metadata: { id: string; title?: string; features?: string[] }
  kind: 'wizard'
  steps: {
    id: string
    label: string               // i18n key
    fields?: InjectionFieldWidget['fields']  // reuse existing field types
    customComponent?: React.LazyExoticComponent<React.ComponentType<WizardStepProps>>
    validate?: (data: Record<string, unknown>, context: InjectionContext) => Promise<{ ok: boolean; message?: string }>
  }[]
  onComplete?: (stepData: Record<string, unknown>, context: InjectionContext) => Promise<void>
  eventHandlers?: WidgetInjectionEventHandlers<any, any>
}

// InjectionStatusBadgeWidget — for persistent status indicators (Phase L)
type InjectionStatusBadgeWidget = {
  metadata: { id: string; features?: string[] }
  kind: 'status-badge'
  badge: {
    label: string               // i18n key
    statusLoader: (context: StatusBadgeContext) => Promise<StatusBadgeResult>
    href?: string               // click to navigate to details
    pollInterval?: number       // refresh interval in seconds (default: 60)
  }
}

interface StatusBadgeResult {
  status: 'healthy' | 'warning' | 'error' | 'unknown'
  tooltip?: string
  count?: number                // optional numeric badge (e.g., "3 errors")
}

interface StatusBadgeContext {
  organizationId: string
  tenantId: string
  userId: string
}

// InjectionMenuItemWidget — for menu injection (Phase B)
type InjectionMenuItemWidget = {
  metadata: { id: string; features?: string[] }
  menuItems: InjectionMenuItem[]
}

interface InjectionMenuItem {
  id: string
  label: string                  // i18n key
  labelKey?: string              // i18n key (alias)
  icon?: string                  // Lucide icon name
  href?: string
  onClick?: () => void
  separator?: boolean
  placement?: InjectionPlacement
  features?: string[]
  roles?: string[]
  badge?: string | number
  children?: Omit<InjectionMenuItem, 'children'>[]
  groupId?: string
  groupLabel?: string
  groupLabelKey?: string
  groupOrder?: number
}
```

### 5. Widget Shared State

Integration modules often have multiple related widgets (credentials, field mapping, sync status, logs) that need to share state without tight coupling. The `WidgetSharedState` mechanism provides a module-scoped key-value store accessible from any widget's context.

```typescript
// packages/ui/src/backend/injection/WidgetSharedState.ts

interface WidgetSharedState {
  /** Read a value by key (returns undefined if not set) */
  get<T>(key: string): T | undefined

  /** Write a value by key (notifies all subscribers) */
  set<T>(key: string, value: T): void

  /** Subscribe to changes on a key. Returns unsubscribe function. */
  subscribe(key: string, handler: (value: unknown) => void): () => void
}
```

Available in widget injection context:

```typescript
interface InjectionContext {
  // ... existing fields ...
  sharedState: WidgetSharedState  // Scoped to module namespace
}
```

**Scoping**: Each module gets its own namespace. Widget `example.injection.foo` accessing `sharedState.get('connectionStatus')` reads from `example:connectionStatus`. Modules cannot read other modules' shared state.

**React hook** for convenient access in client widgets:

```typescript
// packages/ui/src/backend/injection/useWidgetSharedState.ts

function useWidgetSharedState<T>(key: string): [T | undefined, (value: T) => void]
```

This uses `useSyncExternalStore` under the hood for safe React integration.

**Use cases:**
- Integration bundle: credentials widget sets `connectionStatus`, sync status widget reads it
- Multi-widget form: wizard widget sets `selectedProvider`, field widget adjusts options
- Progress tracking: sync worker updates `syncProgress` via SSE event, progress widget reads it

### 6. Generator Update

Update `yarn generate` to discover and register headless widget types. The generator must:
- Detect widget modules that export `columns`, `rowActions`, `bulkActions`, `filters`, `fields`, or `menuItems` (instead of or in addition to `Widget`)
- Register them in the headless widget registry alongside the existing visual widget registry
- Generated files follow the same `loader: () => import(...)` pattern

### 7. Standardized Slot Categories

Every backend page automatically gets slots at predictable positions:

```typescript
// Auto-generated for every CrudForm entity
'crud-form:<entityId>:before-fields'      // Before all field groups
'crud-form:<entityId>:after-fields'       // After all field groups
'crud-form:<entityId>:header'             // Form header area
'crud-form:<entityId>:footer'             // Form footer/actions area
'crud-form:<entityId>:sidebar'            // Right sidebar (column 2)
'crud-form:<entityId>:group:<groupId>'    // Inside a specific group
'crud-form:<entityId>:field:<fieldId>:before'  // Before a specific field
'crud-form:<entityId>:field:<fieldId>:after'   // After a specific field

// Auto-generated for every DataTable
'data-table:<tableId>:header'             // Above the table
'data-table:<tableId>:footer'             // Below the table
'data-table:<tableId>:toolbar'            // Toolbar area (filters, search)
'data-table:<tableId>:empty-state'        // Custom empty state

// Auto-generated for every detail page
'detail:<entityId>:header'                // Detail page header
'detail:<entityId>:tabs'                  // Tab injection
'detail:<entityId>:sidebar'              // Detail sidebar
'detail:<entityId>:footer'                // Detail footer

// Global slots (already exist, formalized)
'backend:record:current'                  // Current record context
'backend:layout:top'                      // Page header
'backend:layout:footer'                   // Page footer
'backend:sidebar:top'                     // Sidebar top
'backend:sidebar:footer'                  // Sidebar footer

// NEW: Application chrome slots (topbar, sidebar navigation, profile menu)
'backend:topbar:profile-menu'             // Profile dropdown menu items
'backend:topbar:actions'                  // Topbar action buttons (left of profile)
'backend:sidebar:nav'                     // Sidebar navigation items
'backend:sidebar:nav:footer'              // Sidebar navigation footer items

// NEW: Status badge injection spots (Phase L)
'global:sidebar:status-badges'            // Sidebar footer — persistent status indicators
'global:header:status-indicators'         // Top bar — health/sync status badges
'detail:<entityId>:status-badges'         // Detail page header — entity-scoped badges
```

### 8. Wildcard & Pattern Matching (Existing — Formalized)

```typescript
'crud-form:*'                    // All CRUD forms (record-locking uses this)
'crud-form:catalog.*'            // All catalog module forms
'data-table:*'                   // All data tables
'detail:*:tabs'                  // All detail page tab sections
```

---

## Example Module Additions

### `example/widgets/injection/todo-menu-items/widget.ts`

A headless `InjectionMenuItemWidget` that adds "Example Todos" to the sidebar under the Example group:

```typescript
// packages/core/src/modules/example/widgets/injection/todo-menu-items/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

export default {
  metadata: {
    id: 'example.injection.todo-menu-items',
    features: ['example.view'],
  },
  menuItems: [
    {
      id: 'example-todos-shortcut',
      label: 'example.menu.todosShortcut',
      icon: 'CheckSquare',
      href: '/backend/example/todos',
      groupId: 'example',
      placement: { position: InjectionPosition.Last },
    },
  ],
} satisfies InjectionMenuItemWidget
```

### `example/widgets/injection-table.ts` update

Add the menu spot mapping:

```typescript
// Add to existing injection-table.ts
'menu:sidebar:main': {
  widgetId: 'example.injection.todo-menu-items',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-F01: Headless menu item widget renders in sidebar navigation

**Type**: UI (Playwright)

**Preconditions**: Example module is enabled, user has `example.view` feature

**Steps**:
1. Log in as admin user
2. Navigate to any backend page
3. Inspect the sidebar navigation

**Expected**: The "Example Todos" menu item appears in the sidebar under the Example group

**Example module file exercised**: `example/widgets/injection/todo-menu-items/widget.ts`

**Testing notes**:
- Use `page.locator('[data-testid="sidebar"]')` to find the sidebar
- Look for the injected item by text content or `data-menu-item-id` attribute
- Verify the icon renders (CheckSquare)
- Verify clicking navigates to `/backend/example/todos`

### TC-UMES-F02: `InjectionPosition` enum values resolve correctly

**Type**: Unit (Vitest)

**Steps**:
1. Import `InjectionPosition` and the position resolution utility
2. Create a list of items: `[{id: 'a'}, {id: 'b'}, {id: 'c'}]`
3. Insert item `{id: 'x'}` with `{ position: InjectionPosition.Before, relativeTo: 'b' }`
4. Insert item `{id: 'y'}` with `{ position: InjectionPosition.After, relativeTo: 'a' }`
5. Insert item `{id: 'z'}` with `{ position: InjectionPosition.First }`
6. Insert item `{id: 'w'}` with `{ position: InjectionPosition.Last }`

**Expected**: Final order is `[z, a, y, x, b, c, w]`

**Testing notes**:
- Test edge cases: invalid `relativeTo` falls back to Last
- Test missing `position` defaults to Last
- This is a pure unit test — no browser needed

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/modules/widgets/injection-position.ts` |
| **NEW** | `packages/ui/src/backend/injection/useInjectionDataWidgets.ts` |
| **NEW** | `packages/ui/src/backend/injection/WidgetSharedState.ts` |
| **NEW** | `packages/ui/src/backend/injection/useWidgetSharedState.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/todo-menu-items/widget.ts` |
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add headless types, custom field, wizard, status badge, visibility) |
| **MODIFY** | `packages/shared/src/modules/widgets/injection-loader.ts` (add headless loading path) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` (add menu spot) |
| **MODIFY** | Generator scripts (discover headless widgets) |
| **MODIFY** | Bootstrap registration (register headless widgets) |

**Estimated scope**: Small — type definitions + loader extension + one example widget

---

## Backward Compatibility

- All existing `InjectionSpot` usage unchanged
- All existing `injection-table.ts` files unchanged
- All existing `widget.ts` files that export `Widget` component unchanged
- New headless loading path is additive — does not modify existing `loadInjectionWidgetById`
- `InjectionPosition` is a new export — no existing code affected
