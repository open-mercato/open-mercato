# SPEC-041 — Universal Module Extension System (UMES)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Issue** | [#675](https://github.com/open-mercato/open-mercato/issues/675) |
| **Related** | [PR #635 — Record Locking](https://github.com/open-mercato/open-mercato/pull/635), SPEC-035 (Mutation Guard), SPEC-036 (Request Lifecycle Events), SPEC-043 (Reactive Notification Handlers) |

## TLDR

Evolve the widget injection system into a **Universal Module Extension System (UMES)** — a coherent, DOM-inspired framework that lets modules extend any UI surface, intercept any mutation, transform any API response, and replace any component — all without touching core code. Unify the currently fragmented extension mechanisms (widget injection, event subscribers, entity extensions, mutation guards) under a single mental model with consistent APIs.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Phase 1 — UI Extension Slots](#4-phase-1--ui-extension-slots)
5. [Phase 2 — Component Replacement](#5-phase-2--component-replacement)
6. [Phase 3 — API Response Enrichment (Data Federation)](#6-phase-3--api-response-enrichment-data-federation)
7. [Phase 4 — API Middleware & Action Interceptors](#7-phase-4--api-middleware--action-interceptors)
8. [Phase 5 — DataTable & CrudForm Deep Extensibility](#8-phase-5--datatable--crudform-deep-extensibility)
9. [Phase 6 — Recursive Widget Extensibility](#9-phase-6--recursive-widget-extensibility)
10. [Phase 7 — Detail Page Bindings](#10-phase-7--detail-page-bindings-customer-sales-document-etc)
11. [Coherence with Existing Systems](#11-coherence-with-existing-systems)
12. [Extension Manifest & Discovery](#12-extension-manifest--discovery)
13. [Developer Experience](#13-developer-experience)
14. [Data Models](#14-data-models)
15. [API Contracts](#15-api-contracts)
16. [Risks & Impact Review](#16-risks--impact-review)
17. [Integration Test Coverage](#17-integration-test-coverage)
18. [Final Compliance Report](#18-final-compliance-report)
19. [DOM Event Bridge — Widget ↔ App Event Unification](#19-dom-event-bridge--widget--app-event-unification)
20. [AGENTS.md Changes Required for UMES](#20-agentsmd-changes-required-for-umes)
21. [PR Delivery Plan — Phased Implementation](#21-pr-delivery-plan--phased-implementation)
22. [Appendix A — Insights from Code Analysis](#22-appendix-a--insights-from-code-analysis)
23. [Appendix B — Competitive Analysis Summary](#23-appendix-b--competitive-analysis-summary)
24. [Changelog](#24-changelog)

---

## 1. Problem Statement

### Current State

Open Mercato has **five separate extension mechanisms** that evolved independently:

| Mechanism | What it extends | Where defined |
|-----------|----------------|---------------|
| Widget Injection | UI surfaces (CrudForm, DataTable headers, detail tabs) | `widgets/injection-table.ts` + `widgets/injection/*/widget.ts` |
| Event Subscribers | Backend side-effects (create/update/delete reactions) | `subscribers/*.ts` |
| Entity Extensions | Data model (add fields/relations to other module's entities) | `data/extensions.ts` |
| Mutation Guards | Write operations (block/modify saves) | `@open-mercato/shared/lib/crud/mutation-guard.ts` |
| Custom Fields | User-defined entity attributes | `ce.ts` |

### Problems

1. **No component replacement** — A module cannot replace another module's dialog, form section, or table cell renderer. The `newSales` module cannot swap out the shipment dialog in old `orders` without forking.
2. **No API response enrichment** — Loading a customer requires touching the customers module code to add related data (e.g., credit score, loyalty points). There's no GraphQL-federation-like "extend the response from outside."
3. **No API action interception** — Modules cannot inject middleware into another module's API routes (e.g., validate a sales order against business rules before creation).
4. **Limited DataTable extensibility** — No way for external modules to add columns, row actions, or bulk actions to another module's data table.
5. **No CrudForm field injection** — Widgets can add UI sections to forms but cannot inject fields into existing groups or modify field behavior.
6. **Widgets can't extend widgets** — No recursive extensibility; the injection system is flat.
7. **Fragmented mental model** — Developers must learn five different patterns for five different kinds of extension.

### Goal

Create a unified extension framework where **any module can extend any other module's UI, data, and behavior** through a single, coherent API — comparable to how the browser DOM lets extensions interact with any page element.

---

## 2. Design Principles

Drawn from analysis of WordPress hooks, Shopify app extensions, VSCode contribution points, GraphQL Federation, and browser extension content scripts:

| # | Principle | Inspiration |
|---|-----------|-------------|
| 1 | **Actions vs Transformers** — Distinguish "do something" (side-effects) from "transform something" (data/UI modification) | WordPress actions vs filters |
| 2 | **Declarative Registration, Lazy Activation** — Declare capabilities in metadata; load code only when needed | VSCode contribution points + activation events |
| 3 | **Named, Typed Extension Points** — Every extension point has a string ID, typed contract, and documentation | Shopify extension targets |
| 4 | **Priority & Ordering** — When multiple modules target the same point, deterministic priority-based ordering | WordPress priority system |
| 5 | **Federation over Modification** — Extend data by composition (merge results) not mutation (modify source) | GraphQL Federation `@key` + `@extends` |
| 6 | **Removal & Override** — Extensions can be disabled, overridden, or replaced by configuration or other extensions | WordPress `remove_action`, VSCode extension disabling |
| 7 | **Recursive Extensibility** — Extensions can define their own extension points | WordPress custom hooks, VSCode contributed views |
| 8 | **Coherence over Duplication** — New patterns must integrate with existing subscribers, events, entity extensions — not duplicate them | Open Mercato architecture principle |
| 9 | **Progressive Disclosure** — Simple cases stay simple; advanced cases are possible | Existing widget injection simplicity |
| 10 | **Type Safety** — All extension contracts are fully typed via TypeScript generics and Zod schemas | Open Mercato convention |

---

## 3. Architecture Overview

### Unified Extension Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIVERSAL MODULE EXTENSION SYSTEM             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  UI Layer     │  │  Data Layer  │  │  Behavior Layer        ││
│  │              │  │              │  │                        ││
│  │ • Slots      │  │ • Response   │  │ • Mutation Guards      ││
│  │ • Replacements│  │   Enrichment │  │ • API Middleware       ││
│  │ • Field Inj. │  │ • Field      │  │ • Event Subscribers    ││
│  │ • Column Inj.│  │   Extension  │  │   (existing)           ││
│  │ • Action Inj.│  │   (existing) │  │ • Lifecycle Hooks      ││
│  │ • Widget Ext.│  │              │  │                        ││
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────────┘│
│         │                 │                    │                │
│  ┌──────┴─────────────────┴────────────────────┴───────────────┐│
│  │                 Extension Registry                          ││
│  │  • Module manifests (extensions.ts)                         ││
│  │  • Auto-discovery & code generation                         ││
│  │  • Priority resolution & conflict detection                 ││
│  │  • Feature-gated activation                                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Extension Point Taxonomy

All extension points use a **unified string ID format**:

```
<layer>:<module>.<entity>:<surface>:<position>
```

Examples:
- `ui:catalog.product:crud-form:fields` — inject fields into product form
- `ui:catalog.product:data-table:columns` — inject columns into product table
- `ui:sales.order:detail:shipment-dialog` — replace shipment dialog
- `data:customers.person:response:enrich` — enrich customer API response
- `api:sales.order:create:before` — intercept before order creation
- `api:sales.order:create:after` — intercept after order creation

**Backward compatibility**: Existing spot IDs (`crud-form:catalog.product`, `backend:record:current`, etc.) remain fully supported. The new taxonomy is additive.

---

## 4. Phase 1 — UI Extension Slots

**Goal**: Formalize and expand the injection spot system.

### 4.1 Standardized Slot Categories

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
'detail:<entityId>:sidebar'               // Detail sidebar
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
```

### 4.2 Wildcard & Pattern Matching (Existing — Formalized)

```typescript
'crud-form:*'                    // All CRUD forms (record-locking uses this)
'crud-form:catalog.*'            // All catalog module forms
'data-table:*'                   // All data tables
'detail:*:tabs'                  // All detail page tab sections
```

### 4.3 Universal Menu Injection

#### Current State: 5 Menu Surfaces, None Extensible by Modules

Open Mercato has 5 distinct navigation/menu surfaces in the backend:

| Surface | Component | Built From | Currently Extensible? |
|---------|-----------|-----------|----------------------|
| **Main sidebar** | `AppShell.tsx` | `groups[]` from `buildAdminNav()` scanning module `page.meta.ts` | Partially — pages with `pageContext: 'main'` auto-appear, but no items without pages |
| **Settings sidebar** | `SectionNav.tsx` | `settingsSections[]` from pages with `pageContext: 'settings'` | Partially — settings pages auto-appear, but no items without pages |
| **Profile sidebar** | `SectionNav.tsx` | `profileSections[]` hardcoded in `auth/lib/profile-sections.tsx` | No |
| **Profile dropdown** | `ProfileDropdown.tsx` | Hardcoded JSX (Change Password, Theme, Language, Sign Out) | No |
| **Header actions** | `layout.tsx` | Hardcoded JSX (AI Chat, Search, Org Switcher, Settings, Notifications) | No |

The auto-discovery via `page.meta.ts` works for adding **pages** to the sidebar, but fails when a module needs to:
- Add a menu item without a corresponding page (e.g., "Open external dashboard")
- Add items to the profile dropdown, profile sidebar, or header
- Add items to a specific group in Settings sidebar (e.g., a new section under "Auth")
- Add non-link items (toggles, badges, status indicators)
- Remove or reorder existing items

#### Solution: `InjectionMenuItemWidget` — One Type, Any Menu Surface

A single widget type that targets any menu surface via the standard injection table spot ID system:

```typescript
// packages/shared/src/modules/widgets/injection-menu.ts

/**
 * Every menu surface has a string ID. Items are injected by targeting that ID.
 * Built-in menu surfaces:
 */
type MenuSurfaceId =
  | 'menu:sidebar:main'               // Main sidebar navigation
  | 'menu:sidebar:settings'           // Settings section sidebar
  | 'menu:sidebar:profile'            // Profile section sidebar
  | 'menu:topbar:profile-dropdown'    // Top-right profile dropdown
  | 'menu:topbar:actions'             // Topbar action area (left of profile)
  | `menu:sidebar:settings:${string}` // Specific settings section (e.g., 'menu:sidebar:settings:auth')
  | `menu:sidebar:main:${string}`     // Specific main sidebar group (e.g., 'menu:sidebar:main:sales')
  | `menu:${string}`                  // Extensible — widgets can define their own menu surfaces

/**
 * Universal menu item — works across all surfaces.
 */
interface InjectionMenuItem {
  id: string
  label: string                        // i18n key
  labelKey?: string                    // i18n key (alias for label, matches existing page.meta.ts pattern)
  icon?: string                        // Lucide icon name (string) or React.ReactNode
  href?: string                        // Navigate to URL
  onClick?: () => void                 // Custom client-side action (for non-link items)
  /** Visual separator before this item */
  separator?: boolean
  /** Position relative to built-in or other injected items */
  placement?: InjectionPlacement
  /** ACL features required to show this item (checked at render time) */
  features?: string[]
  /** ACL roles required to show this item */
  roles?: string[]
  /** Badge/counter (e.g., notification count, "New" label) */
  badge?: string | number
  /** Child items (one level of nesting — matches sidebar group→item pattern) */
  children?: Omit<InjectionMenuItem, 'children'>[]
  /** For sidebar: which group to add this item to (by group ID) */
  groupId?: string
  /** For sidebar: create a new group if groupId doesn't exist */
  groupLabel?: string
  groupLabelKey?: string
  groupOrder?: number
}

/**
 * Widget type for menu injection. Headless — no Widget component needed.
 */
type InjectionMenuItemWidget = {
  metadata: {
    id: string
    features?: string[]
  }
  menuItems: InjectionMenuItem[]
}
```

#### The Runtime: `useInjectedMenuItems(surfaceId)`

A single hook used by any menu component to collect injected items:

```typescript
// packages/ui/src/backend/injection/useInjectedMenuItems.ts

function useInjectedMenuItems(surfaceId: MenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
} {
  const { widgets } = useInjectionDataWidgets(surfaceId)
  const items = widgets.flatMap(w => w.module.menuItems ?? [])
  // Filter by current user's features/roles
  // Sort by placement
  return { items: filtered, isLoading: false }
}
```

Every menu component calls this once. The hook returns items already filtered by ACL and sorted by placement.

#### Shared Utility: `mergeMenuItems(builtIn, injected)`

A utility that merges built-in items with injected items, resolving placements:

```typescript
// packages/ui/src/backend/injection/mergeMenuItems.ts

function mergeMenuItems(
  builtIn: { id: string; [key: string]: unknown }[],
  injected: InjectionMenuItem[],
): MergedMenuItem[] {
  // 1. Index built-in items by ID
  // 2. For each injected item:
  //    - If placement.relativeTo exists and matches a built-in ID → insert before/after
  //    - If placement is First → prepend
  //    - If placement is Last or missing → append
  //    - If groupId specified → find or create group, insert into it
  // 3. Return merged list preserving built-in order
}
```

#### Example 1: SSO Module → Profile Dropdown + Settings Sidebar

One module, two menu surfaces:

```typescript
// sso/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  // Add "Manage SSO" to profile dropdown
  'menu:topbar:profile-dropdown': {
    widgetId: 'sso.injection.menus',
    priority: 50,
  },
  // Add "SSO Configuration" to settings sidebar under "Auth" section
  'menu:sidebar:settings:auth': {
    widgetId: 'sso.injection.menus',
    priority: 50,
  },
}
```

```typescript
// sso/widgets/injection/menus/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

export default {
  metadata: {
    id: 'sso.injection.menus',
    features: ['auth.sso.manage'],
  },
  menuItems: [
    {
      id: 'sso-settings',
      label: 'sso.menu.manageSso',
      icon: 'Shield',
      href: '/backend/settings/sso',
      separator: true,
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
      // When targeted at profile-dropdown: item with separator before "Sign Out"
      // When targeted at settings:auth: item appears in the Auth section
    },
  ],
} satisfies InjectionMenuItemWidget
```

**Result in Profile Dropdown:**
```
Change Password
Notification Preferences
──────────────────────
🛡 Manage SSO            ← injected
──────────────────────
Dark Mode
Language
Sign Out
```

**Result in Settings Sidebar → Auth section:**
```
Auth
  Users
  Roles
  API Keys
  🛡 SSO Configuration   ← injected
```

#### Example 2: Analytics Module → New Sidebar Group

```typescript
// analytics/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'analytics.injection.sidebar-group',
    priority: 50,
  },
}
```

```typescript
// analytics/widgets/injection/sidebar-group/widget.ts
export default {
  metadata: {
    id: 'analytics.injection.sidebar-group',
    features: ['analytics.view'],
  },
  menuItems: [
    {
      id: 'analytics-dashboard',
      label: 'analytics.nav.dashboard',
      icon: 'BarChart3',
      href: '/backend/analytics',
      // Create a new group "Analytics" in the main sidebar
      groupId: 'analytics',
      groupLabel: 'Analytics',
      groupLabelKey: 'analytics.nav.group',
      groupOrder: 50,   // After Sales (order ~40), before Settings
    },
    {
      id: 'analytics-reports',
      label: 'analytics.nav.reports',
      icon: 'FileBarChart',
      href: '/backend/analytics/reports',
      groupId: 'analytics',  // Same group
    },
  ],
} satisfies InjectionMenuItemWidget
```

**Result in Main Sidebar:**
```
📋 Customers
  People
  Companies
📦 Catalog
  Products
  Categories
💰 Sales
  Orders
  Quotes
📊 Analytics              ← injected group
  Dashboard               ← injected item
  Reports                 ← injected item
```

#### Example 3: Record Locks → Settings Item Without a Page

The record-locking module already has a settings page at `pageContext: 'settings'`, so it auto-appears. But imagine a module that wants a menu item pointing to an **external URL**:

```typescript
// external_bi/widgets/injection/menus/widget.ts
export default {
  metadata: {
    id: 'external_bi.injection.menus',
    features: ['external_bi.view'],
  },
  menuItems: [
    {
      id: 'open-bi-dashboard',
      label: 'external_bi.menu.openDashboard',
      icon: 'ExternalLink',
      href: 'https://bi.example.com/dashboard',  // External URL
      groupId: 'analytics',
      placement: { position: InjectionPosition.Last },
    },
  ],
} satisfies InjectionMenuItemWidget
```

This adds an external link to the sidebar — something impossible today since `page.meta.ts` only works for internal pages.

#### Example 4: Carrier Integration → Profile Sidebar Section

```typescript
// carrier_integration/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:profile': {
    widgetId: 'carrier_integration.injection.profile-section',
    priority: 50,
  },
}
```

```typescript
// carrier_integration/widgets/injection/profile-section/widget.ts
export default {
  metadata: {
    id: 'carrier_integration.injection.profile-section',
    features: ['carrier_integration.manage'],
  },
  menuItems: [
    {
      id: 'carrier-api-keys',
      label: 'carrier_integration.menu.apiKeys',
      icon: 'Key',
      href: '/backend/profile/carrier-api-keys',
      // Create a new section in profile sidebar
      groupId: 'integrations',
      groupLabel: 'Integrations',
      groupLabelKey: 'carrier_integration.menu.integrationsGroup',
      groupOrder: 2,
    },
  ],
} satisfies InjectionMenuItemWidget
```

**Result in Profile Sidebar:**
```
Account                    ← existing section
  Change Password

Integrations               ← injected section
  🔑 API Keys              ← injected item
```

#### Implementation: Which Components Change

| Component | Change | Scope |
|-----------|--------|-------|
| `ProfileDropdown.tsx` | Add `useInjectedMenuItems('menu:topbar:profile-dropdown')`, call `mergeMenuItems()`, render injected items | ~20 LOC |
| `AppShell.tsx` (main sidebar) | Add `useInjectedMenuItems('menu:sidebar:main')`, merge groups/items into existing `groups` prop | ~15 LOC |
| `SectionNav.tsx` | Add `useInjectedMenuItems('menu:sidebar:settings')` / `'menu:sidebar:profile'`, merge into sections | ~15 LOC |
| `layout.tsx` (header) | Add `useInjectedMenuItems('menu:topbar:actions')`, render injected action buttons | ~10 LOC |
| `buildAdminNav()` in `nav.ts` | No change — continues building nav from `page.meta.ts`; injected items are merged at render time | 0 LOC |

**Key design**: `buildAdminNav()` is NOT modified. The module discovery via `page.meta.ts` continues to work as-is. Menu injection is a render-time overlay — it adds items to the already-built navigation tree. This means sidebar customization (reorder, rename, hide) also works on injected items, since the customization UI operates on the final merged item list.

#### Interaction with Sidebar Customization

The existing sidebar customization system (reorder groups, rename items, hide items, per-role preferences) works on the final merged item list. Injected items:
- **Can be hidden** by the user via the customization UI (stored by item `id` in `hiddenItems[]`)
- **Can be renamed** by the user (stored by item `id` in `itemLabels{}`)
- **Can be reordered** within their group (stored by group `id` in `groupOrder[]`)
- **Cannot be edited** at the code level by the customization UI — only visual overrides

### 4.4 Event Handler Expansion

Extend the existing `WidgetInjectionEventHandlers` with DOM-inspired lifecycle:

```typescript
interface WidgetInjectionEventHandlers<TContext, TData> {
  // === Existing (unchanged) ===
  onLoad?(context: TContext): Promise<void>
  onBeforeSave?(data: TData, context: TContext): Promise<WidgetBeforeSaveResult>
  onSave?(data: TData, context: TContext): Promise<void>
  onAfterSave?(data: TData, context: TContext): Promise<void>
  onBeforeDelete?(data: TData, context: TContext): Promise<WidgetBeforeDeleteResult>
  onDelete?(data: TData, context: TContext): Promise<void>
  onAfterDelete?(data: TData, context: TContext): Promise<void>
  onDeleteError?(data: TData, context: TContext, error: unknown): Promise<void>

  // === New: DOM-Inspired Lifecycle ===
  onFieldChange?(fieldId: string, value: unknown, data: TData, context: TContext): Promise<FieldChangeResult | void>
  onBeforeNavigate?(target: string, context: TContext): Promise<NavigateGuardResult>
  onVisibilityChange?(visible: boolean, context: TContext): Promise<void>

  // === New: Data Transformation (Filter-style) ===
  transformFormData?(data: TData, context: TContext): Promise<TData>
  transformDisplayData?(data: TData, context: TContext): Promise<TData>
  transformValidation?(errors: FieldErrors, data: TData, context: TContext): Promise<FieldErrors>
}

interface FieldChangeResult {
  /** Override the field value */
  value?: unknown
  /** Set values of other fields reactively */
  sideEffects?: Record<string, unknown>
  /** Show a warning/info message for this field */
  message?: { text: string; severity: 'info' | 'warning' | 'error' }
}

interface NavigateGuardResult {
  ok: boolean
  message?: string
  /** If false, navigation is blocked (e.g., unsaved changes) */
}
```

### 4.4 Implementation

The `InjectionSpot` component and `useInjectionWidgets` hook remain the core runtime. Changes:

1. **CrudForm** emits `onFieldChange` events through the injection context when any field value changes
2. **Detail pages** emit `onVisibilityChange` when tabs switch
3. **Transformer events** (`transformFormData`, `transformDisplayData`) are applied as a pipeline — each widget receives the output of the previous widget (WordPress filter pattern)

### 4.5 Backward Compatibility: Dual-Mode Event Dispatch

The existing `triggerEvent` function in `InjectionSpot.tsx` dispatches **action events** (fire handler, accumulate `requestHeaders`, check `ok` boolean). Transformer events require a fundamentally different dispatch mode: **pipeline** (output of widget N becomes input of widget N+1).

To preserve backward compatibility, `triggerEvent` gains a second dispatch path:

```typescript
// Existing behavior — unchanged for action events
if (isActionEvent(event)) {
  // Current logic: iterate widgets, accumulate requestHeaders, check ok
  // onBeforeSave, onSave, onAfterSave, onBeforeDelete, etc.
}

// New behavior — pipeline for transformer events
if (isTransformerEvent(event)) {
  // Pipeline: data flows through widgets in priority order
  let result = initialData
  for (const widget of sortedWidgets) {
    result = await widget.eventHandlers[event](result, context)
  }
  return result
}
```

**Action events** (existing): `onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`, `onBeforeDelete`, `onDelete`, `onAfterDelete`, `onDeleteError`, `onFieldChange`, `onBeforeNavigate`, `onVisibilityChange`

**Transformer events** (new): `transformFormData`, `transformDisplayData`, `transformValidation`

The `onEvent` callback prop union on `InjectionSpotProps` is updated to include new event names. The delete-to-save fallback chain (`onBeforeDelete` → `onBeforeSave` if not defined) is explicitly preserved.

---

## 5. Phase 2 — Component Replacement

**Goal**: Allow modules to replace any registered component without forking.

### 5.1 Component Registry

Introduce a **component registry** where core modules register replaceable components:

```typescript
// packages/shared/src/modules/widgets/component-registry.ts

type ComponentRegistryEntry<TProps = any> = {
  id: string                          // e.g., 'sales.order.shipment-dialog'
  component: React.ComponentType<TProps>
  metadata: {
    module: string
    description: string
    propsSchema?: z.ZodType<TProps>   // Typed contract
  }
}

// Registration (in module's index or component file)
registerComponent({
  id: 'sales.order.shipment-dialog',
  component: ShipmentDialog,
  metadata: {
    module: 'sales',
    description: 'Dialog for creating/editing shipments on orders',
    propsSchema: shipmentDialogPropsSchema,
  },
})

// Replacement (in another module's extensions)
replaceComponent({
  targetId: 'sales.order.shipment-dialog',
  component: NewShipmentDialog,
  metadata: {
    module: 'new_sales',
    priority: 100,
    description: 'Enhanced shipment dialog with carrier integration',
  },
})
```

### 5.2 Resolution Hook

```typescript
// packages/ui/src/backend/injection/useRegisteredComponent.ts

function useRegisteredComponent<TProps>(
  componentId: string
): React.ComponentType<TProps> {
  // 1. Check if any replacement is registered (highest priority wins)
  // 2. Fall back to original component
  // 3. Log warning if multiple replacements exist at same priority
}
```

### 5.3 Usage in Core Modules

Core modules wrap replaceable components:

```typescript
// Before (tightly coupled)
import { ShipmentDialog } from './components/ShipmentDialog'

// After (extensible)
const ShipmentDialog = useRegisteredComponent<ShipmentDialogProps>(
  'sales.order.shipment-dialog'
)

return <ShipmentDialog orderId={orderId} onClose={handleClose} />
```

### 5.4 Any-Component Injection via React Tree

For cases where no explicit registration point exists, provide a **tree-level injection** mechanism inspired by browser content scripts:

```typescript
// packages/ui/src/backend/injection/ComponentOverrideProvider.tsx

// Module declares overrides in extensions.ts
export const componentOverrides: ComponentOverride[] = [
  {
    // Target by component display name or data-testid
    target: { displayName: 'ShipmentDialog' },
    replacement: lazy(() => import('./NewShipmentDialog')),
    priority: 100,
    features: ['new_sales.view'],  // ACL gate
  },
  {
    // Target by a data-component-id attribute
    target: { componentId: 'sales.order.shipment-dialog' },
    wrapper: (OriginalComponent) => (props) => (
      <EnhancedWrapper>
        <OriginalComponent {...props} extraProp="value" />
      </EnhancedWrapper>
    ),
    priority: 50,
  },
]
```

The `ComponentOverrideProvider` at the app root intercepts component resolution:

```typescript
// Provider wraps the app shell
<ComponentOverrideProvider overrides={allModuleOverrides}>
  <AppShell>
    {children}
  </AppShell>
</ComponentOverrideProvider>
```

**How it works:**

1. Core components that are replacement-eligible add a `data-component-id` attribute or are wrapped in a `<Replaceable>` HOC
2. The provider builds a lookup table from all module overrides
3. `useRegisteredComponent(id)` checks the override table first
4. For `wrapper` mode, the original component is passed as an argument — the module wraps it (preserving core behavior while adding functionality)

### 5.5 Wrapper vs Replace Strategy

| Mode | Use Case | Risk |
|------|----------|------|
| **Replace** | Complete swap of a component (new UI, new behavior) | High — must maintain props contract |
| **Wrapper** | Add behavior around existing component (decorating, monitoring) | Low — original component preserved |
| **Props Override** | Modify props passed to existing component | Low — original component preserved |

```typescript
type ComponentOverride = {
  target: { componentId?: string; displayName?: string }
  priority: number
  features?: string[]
} & (
  | { replacement: React.LazyExoticComponent<any> }
  | { wrapper: (Original: React.ComponentType) => React.ComponentType }
  | { propsTransform: (props: any) => any }
)
```

---

## 6. Phase 3 — API Response Enrichment (Data Federation)

**Goal**: Allow modules to enrich other modules' API responses without touching core code — similar to GraphQL Federation's `@extends`.

### 6.1 Response Enricher Contract

```typescript
// packages/shared/src/lib/crud/response-enricher.ts

interface ResponseEnricher<TRecord = any, TEnriched = any> {
  /** Unique ID */
  id: string
  /** Which entity responses to enrich */
  targetEntity: string  // e.g., 'customers.person'
  /** ACL features required */
  features?: string[]
  /** Priority (higher = runs first) */
  priority?: number
  /**
   * Enrich a single record. Called after the core query resolves.
   * Must return the record with additional fields merged.
   * MUST NOT modify or remove existing fields.
   */
  enrichOne(
    record: TRecord,
    context: EnricherContext
  ): Promise<TRecord & TEnriched>
  /**
   * Batch enrichment for list endpoints (performance optimization).
   * Receives all records; should batch-fetch related data.
   */
  enrichMany?(
    records: TRecord[],
    context: EnricherContext
  ): Promise<(TRecord & TEnriched)[]>
}

interface EnricherContext {
  organizationId: string
  tenantId: string
  userId: string
  em: EntityManager  // Read-only access
  /** Fields explicitly requested by the client (if using field selection) */
  requestedFields?: string[]
}
```

### 6.2 Registration

```typescript
// In module's data/enrichers.ts (new auto-discovered file)
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

export const enrichers: ResponseEnricher[] = [
  {
    id: 'loyalty.customer-points',
    targetEntity: 'customers.person',
    features: ['loyalty.view'],
    priority: 50,
    async enrichOne(record, ctx) {
      const points = await ctx.em.findOne(LoyaltyPoints, {
        customerId: record.id,
        organizationId: ctx.organizationId,
      })
      return {
        ...record,
        loyaltyPoints: points?.balance ?? 0,
        loyaltyTier: points?.tier ?? 'none',
      }
    },
    async enrichMany(records, ctx) {
      const customerIds = records.map(r => r.id)
      const allPoints = await ctx.em.find(LoyaltyPoints, {
        customerId: { $in: customerIds },
        organizationId: ctx.organizationId,
      })
      const pointsMap = new Map(allPoints.map(p => [p.customerId, p]))
      return records.map(record => ({
        ...record,
        loyaltyPoints: pointsMap.get(record.id)?.balance ?? 0,
        loyaltyTier: pointsMap.get(record.id)?.tier ?? 'none',
      }))
    },
  },
]
```

### 6.3 Integration with makeCrudRoute

The CRUD factory applies enrichers **after** the existing `afterList` hook, preserving all current hook contracts:

```typescript
// In makeCrudRoute GET handler — exact ordering
async function handleGet(req, ctx) {
  // 1. Core query (existing — unchanged)
  const records = await queryEngine.find(...)

  // 2. CrudHooks.afterList (existing — unchanged, receives raw query results)
  if (hooks.afterList) await hooks.afterList(records, ctx)

  // 3. Apply enrichers (NEW — runs AFTER afterList)
  const enrichers = getEnrichersForEntity(entityId)
  const enrichedRecords = await applyEnrichers(records, enrichers, ctx)

  // 4. Return enriched response
  return enrichedRecords
}
```

**Ordering guarantee**: Enrichers run after `CrudHooks.afterList` completes. This means existing `afterList` hooks see the same raw data they see today — no behavioral change. Enriched fields are only present in the final HTTP response.

**Export handling**: The `_meta` field added by enrichers is stripped by `normalizeFullRecordForExport` before CSV/JSON export processing.

### 6.4 Client-Side Awareness

Enriched fields are transparently available in the API response. No client-side changes needed for consumption. For DataTable columns or CrudForm fields that display enriched data, modules use the standard widget injection to add columns/fields.

### 6.5 Guardrails

- Enrichers MUST NOT modify or remove existing fields (additive only)
- Enrichers MUST NOT perform writes (read-only EntityManager)
- Enrichers run after core query, not inside the transaction
- `enrichMany` MUST be implemented for list endpoints (N+1 prevention)
- Enrichers can be disabled per-tenant via module config
- Total enricher execution time is logged; slow enrichers are flagged in dev mode

---

## 7. Phase 4 — API Middleware & Action Interceptors

**Goal**: Allow modules to hook into other modules' API routes — validate, transform, or augment requests and responses.

### 7.1 API Interceptor Contract

```typescript
// packages/shared/src/lib/crud/api-interceptor.ts

interface ApiInterceptor {
  /** Unique ID */
  id: string
  /** Target route pattern (supports wildcards) */
  targetRoute: string  // e.g., 'sales/orders', 'sales/*', '*'
  /** HTTP methods to intercept */
  methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  /** Priority (higher = runs first) */
  priority?: number
  /** ACL features required */
  features?: string[]

  /**
   * Called before the route handler executes.
   * Can modify request body, add headers, or reject the request.
   */
  before?(request: InterceptorRequest, context: InterceptorContext): Promise<InterceptorBeforeResult>

  /**
   * Called after the route handler executes.
   * Can modify the response body (additive only).
   */
  after?(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult>
}

interface InterceptorBeforeResult {
  /** Continue processing (true) or reject (false) */
  ok: boolean
  /** Modified request body (if needed, for POST/PUT/PATCH) */
  body?: Record<string, unknown>
  /** Modified query params (if needed, for GET — enables cross-module filtering) */
  query?: Record<string, unknown>
  /** Additional headers to inject */
  headers?: Record<string, string>
  /** Rejection message */
  message?: string
  /** HTTP status code for rejection */
  statusCode?: number
  /** Arbitrary data passed to the after hook via ctx.metadata */
  metadata?: Record<string, unknown>
}

interface InterceptorAfterResult {
  /** Additional fields to merge into the response (additive) */
  merge?: Record<string, unknown>
  /** Completely replace the response body (use with caution — for post-query filtering) */
  replace?: Record<string, unknown>
}
```

### 7.2 Registration

```typescript
// In module's api/interceptors.ts (new auto-discovered file)
export const interceptors: ApiInterceptor[] = [
  {
    id: 'business_rules.validate-order',
    targetRoute: 'sales/orders',
    methods: ['POST', 'PUT'],
    features: ['business_rules.manage'],
    priority: 100,
    async before(request, ctx) {
      const violations = await validateBusinessRules(request.body, ctx)
      if (violations.length > 0) {
        return {
          ok: false,
          message: `Business rule violations: ${violations.map(v => v.message).join(', ')}`,
          statusCode: 422,
        }
      }
      return { ok: true }
    },
  },
]
```

### 7.3 Exact Execution Order Within CRUD Factory

Interceptors integrate into the existing CRUD mutation pipeline at precise points:

```
1. Zod schema validation (existing — unchanged)
2. API Interceptor `before` hooks  ← NEW (can reject; can add headers)
3. CrudHooks.beforeCreate/Update/Delete (existing — unchanged)
4. validateCrudMutationGuard (existing — unchanged)
5. Entity mutation + ORM flush (existing — unchanged)
6. CrudHooks.afterCreate/Update/Delete (existing — unchanged)
7. runCrudMutationGuardAfterSuccess (existing — unchanged)
8. API Interceptor `after` hooks  ← NEW (can merge data into response)
9. Response Enrichers (Phase 3)
10. Return HTTP response
```

**Key constraint**: Interceptor `before` hooks run AFTER Zod validation. They receive already-validated input. If an interceptor needs to modify the request body, it returns a `body` field in the result — this modified body is **re-validated through the route's Zod schema** before being passed to `CrudHooks.before*`. This prevents interceptors from bypassing input validation.

```typescript
// Inside CRUD factory — interceptor integration (pseudocode)
const parsedInput = schema.parse(rawBody)        // Step 1: existing Zod validation
const interceptResult = await runInterceptorsBefore(parsedInput, ctx)  // Step 2
if (!interceptResult.ok) return errorResponse(interceptResult)

// If interceptor modified the body, re-validate
const finalInput = interceptResult.body
  ? schema.parse(interceptResult.body)            // Re-validate modified body
  : parsedInput

if (hooks.beforeCreate) await hooks.beforeCreate(finalInput, ctx)     // Step 3
```

### 7.4 Relationship to Existing Patterns

| Concern | Use This | NOT This |
|---------|----------|----------|
| Block/validate a mutation from **UI** | Widget `onBeforeSave` handler | API interceptor |
| Block/validate a mutation from **API** (including external callers) | API interceptor `before` | Widget handler |
| Add data to API response | Response enricher | API interceptor `after` |
| React to completed mutation (send email, index, etc.) | Event subscriber | API interceptor `after` |
| Transform request before processing | API interceptor `before` | Event subscriber |

This maintains clear separation: **widgets** own UI-level behavior, **interceptors** own API-level behavior, **subscribers** own async side-effects.

---

## 8. Phase 5 — DataTable & CrudForm Deep Extensibility

### 8.0 Typed Positioning — Shared Across All Injection Types

All injection types (columns, fields, row actions, filters) use a **typed position object** instead of error-prone string literals:

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

If `position` is omitted, the default is `InjectionPosition.Last` — the injected element appends at the end. Invalid `relativeTo` references (e.g., targeting a column that doesn't exist) fall back to `Last` with a dev-mode console warning.

### 8.1 DataTable Column Injection — With Batch Data Loading

Allow modules to inject columns into other modules' data tables. The critical question: **how does the injected column get its data without N+1 fetches?**

#### The Problem

DataTable does NOT fetch its own data — the parent page calls the API and passes `data` as a prop. If a loyalty module injects a "Points" column, the loyalty data needs to already be in the row objects, or the column will render empty.

#### Solution: Response Enricher Is the Data Source

The same `data/enrichers.ts` mechanism (Phase 3) that works for single-entity endpoints also works for list endpoints. The key is `enrichMany` — it batch-fetches all loyalty data in ONE query for all rows:

```
Parent page fetches: GET /api/customers/people?page=1&pageSize=25
  │
  ├─ Core query returns 25 customer records
  │
  ├─ CrudHooks.afterList (existing — unchanged)
  │
  └─ Enrichers run (Phase 3):
     └─ loyalty.customer-tier.enrichMany receives all 25 records
        └─ ONE query: SELECT * FROM loyalty_memberships WHERE customer_id IN (id1, id2, ..., id25)
        └─ Returns 25 enriched records with _loyalty.tier, _loyalty.points
```

The DataTable receives enriched rows — the injected column can read the data directly:

```typescript
// loyalty/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'data-table:customers.people:columns': {
    widgetId: 'loyalty.injection.customer-points-column',
    priority: 50,
  },
}

// loyalty/widgets/injection/customer-points-column/widget.ts
export default {
  metadata: {
    id: 'loyalty.injection.customer-points-column',
    title: 'Loyalty Points',
    features: ['loyalty.view'],
  },
  columns: [
    {
      id: 'loyaltyPoints',
      header: 'loyalty.column.points',           // i18n key
      accessorKey: '_loyalty.points',             // Dot-path into enriched row data
      cell: ({ getValue }) => {
        const points = getValue() as number
        return <Badge variant={points > 1000 ? 'success' : 'default'}>{points}</Badge>
      },
      size: 100,
      sortable: false,                            // Not sortable (enriched, not indexed)
      placement: { position: InjectionPosition.After, relativeTo: 'email' },
    },
    {
      id: 'loyaltyTier',
      header: 'loyalty.column.tier',
      accessorKey: '_loyalty.tier',
      cell: ({ getValue }) => {
        const tier = getValue() as string
        const colors = { gold: 'warning', silver: 'default', bronze: 'muted', none: 'ghost' }
        return <Badge variant={colors[tier] ?? 'ghost'}>{tier}</Badge>
      },
      size: 80,
      placement: { position: InjectionPosition.After, relativeTo: 'loyaltyPoints' },
    },
  ],
} satisfies InjectionColumnWidget
```

#### Complete Data Flow Diagram

```
1. Parent page calls: GET /api/customers/people?page=1&pageSize=25

2. Server-side (CRUD factory):
   ├─ Core query: SELECT * FROM people WHERE org_id = ? LIMIT 25
   ├─ afterList hook (existing)
   └─ Enrichers (NEW):
      ├─ loyalty.enrichMany → 1 query for 25 rows → adds _loyalty to each row
      ├─ credit.enrichMany  → 1 query for 25 rows → adds _credit to each row
      └─ (N enrichers = N extra queries, NOT N×25)

3. Response arrives at frontend with enriched rows:
   [
     { id: '1', firstName: 'John', email: 'john@...', _loyalty: { tier: 'gold', points: 1250 }, _credit: { ... } },
     { id: '2', firstName: 'Jane', email: 'jane@...', _loyalty: { tier: 'silver', points: 430 }, _credit: { ... } },
     ...
   ]

4. DataTable renders:
   ├─ Core columns: Name, Email, Status, ...
   ├─ Injected column "Points": reads row._loyalty.points → <Badge>1250</Badge>
   └─ Injected column "Tier": reads row._loyalty.tier → <Badge>gold</Badge>
```

**Zero N+1 queries. Zero client-side fetching per row. The enricher handles everything server-side in batch.**

### 8.2 DataTable Row Action Injection

```typescript
// New injection type for row actions
export default {
  metadata: {
    id: 'loyalty.injection.customer-actions',
    features: ['loyalty.manage'],
  },
  rowActions: [
    {
      id: 'adjust-points',
      label: 'loyalty.action.adjust-points',
      icon: 'star',
      onSelect: (row, context) => {
        context.openDialog('loyalty.adjust-points', { customerId: row.id })
      },
      placement: { position: InjectionPosition.After, relativeTo: 'edit' },
    },
  ],
} satisfies InjectionRowActionWidget
```

### 8.3 DataTable Bulk Action Injection

```typescript
export default {
  metadata: {
    id: 'loyalty.injection.bulk-actions',
    features: ['loyalty.manage'],
  },
  bulkActions: [
    {
      id: 'bulk-adjust-points',
      label: 'loyalty.action.bulk-adjust',
      icon: 'stars',
      onExecute: async (selectedRows, context) => {
        return context.openDialog('loyalty.bulk-adjust', {
          customerIds: selectedRows.map(r => r.id),
        })
      },
    },
  ],
} satisfies InjectionBulkActionWidget
```

### 8.4 DataTable Filter Injection — Including Non-Native Fields

#### The Problem

A loyalty module wants to add a "Tier" filter to the customers list. But the customers API (`GET /api/customers/people`) has no idea what `loyaltyTier` is — it's not a column on the `people` table, it's not in the query index, and the customers CRUD factory's Zod schema will reject unknown query parameters.

#### How Filtering Works Today (Current Mechanism)

The current data flow for a customers list page:

```
1. Parent page renders DataTable with filters
2. User selects filter → URL query params update: ?status=active&tag=vip
3. Parent page fetches: GET /api/customers/people?status=active&tag=vip
4. Server-side CRUD factory:
   a. Zod-parses query params against the route's list schema
   b. Passes parsed params to query engine (SQL WHERE clauses)
   c. Returns filtered results
5. DataTable renders the filtered rows
```

The key constraint: **only query params declared in the route's Zod list schema are accepted**. Unknown params like `?loyaltyTier=gold` would be stripped by Zod or cause a 400 error.

#### Solution: Two-Tier Filter Architecture

Injected filters work at two levels depending on whether the filter targets core data or enriched data:

**Tier 1 — API Interceptor filter** (for cross-module filtering that needs server-side query modification):

```typescript
// loyalty/api/interceptors.ts
export const interceptors: ApiInterceptor[] = [
  {
    id: 'loyalty.filter-by-tier',
    targetRoute: 'customers/people',
    methods: ['GET'],
    features: ['loyalty.view'],
    async before(request, ctx) {
      const tierFilter = request.query.loyaltyTier
      if (!tierFilter) return { ok: true }

      // Look up which customer IDs match this tier
      const memberships = await ctx.em.find(LoyaltyMembership, {
        tier: tierFilter,
        organizationId: ctx.organizationId,
      }, { fields: ['customerId'] })

      const customerIds = memberships.map(m => m.customerId)

      if (customerIds.length === 0) {
        // No customers match — inject impossible filter to return empty results
        return {
          ok: true,
          query: { ...request.query, id: { $in: [] } },
        }
      }

      // Inject an ID filter that the core query engine understands
      return {
        ok: true,
        query: {
          ...request.query,
          id: { $in: customerIds },
          // Remove the non-native param so Zod doesn't reject it
          loyaltyTier: undefined,
        },
      }
    },
  },
]
```

**Tier 2 — Client-side filter** (for filtering on enriched data already present in the response):

If the enricher already adds `_loyalty.tier` to every row, a simple client-side filter can work without any API changes:

```typescript
// loyalty/widgets/injection/customer-filters/widget.ts
export default {
  metadata: {
    id: 'loyalty.injection.customer-filters',
    features: ['loyalty.view'],
  },
  filters: [
    {
      id: 'loyaltyTier',
      label: 'loyalty.filter.tier',
      type: 'select',
      options: [
        { value: 'bronze', label: 'loyalty.tier.bronze' },
        { value: 'silver', label: 'loyalty.tier.silver' },
        { value: 'gold', label: 'loyalty.tier.gold' },
      ],
      // Strategy determines HOW the filter is applied:
      strategy: 'server',              // 'server' | 'client'
      // For 'server': maps to query param → interceptor handles it
      queryParam: 'loyaltyTier',
      // For 'client': would use enriched data path for in-memory filtering
      // enrichedField: '_loyalty.tier',
    },
  ],
} satisfies InjectionFilterWidget
```

#### Complete Filter Flow (Server Strategy)

```
1. Loyalty module registers:
   - Filter widget (UI dropdown in DataTable toolbar)
   - API interceptor (translates loyaltyTier → customer ID list)

2. User selects "Gold" in Loyalty Tier filter
   → URL becomes: ?status=active&loyaltyTier=gold

3. Parent page fetches: GET /api/customers/people?status=active&loyaltyTier=gold

4. Server-side:
   a. API Interceptor runs BEFORE Zod validation
      → Queries loyalty_memberships WHERE tier = 'gold' → gets [id1, id5, id12]
      → Rewrites query: { status: 'active', id: { $in: ['id1', 'id5', 'id12'] } }
      → Removes loyaltyTier param
   b. Zod validates the rewritten query (valid — id and status are known params)
   c. Query engine filters: SELECT * FROM people WHERE status = 'active' AND id IN (...)
   d. Enrichers add _loyalty data to results

5. DataTable renders filtered, enriched rows
```

**Why two tiers?** Client-side filtering works for small datasets (pageSize ≤ 100) where all rows are enriched. Server-side filtering is required when the filter must reduce the dataset before pagination — you can't filter 10,000 customers client-side.

#### Tier 3 — Post-Query Merge Filter (When the Core API Can't Be Rewritten)

The `id: { $in: [...] }` rewrite works when the target API supports ID filtering. But what if it doesn't? For example, the sales documents list API has complex query logic (channel scoping, document type filtering, date ranges) and injecting an `id` filter might conflict with existing filters or the query engine might not support `$in` for that entity.

For these cases, the interceptor uses a **post-query merge** strategy: let the core API execute normally, then filter/merge the results in the `after` hook.

**Real example:** A `credit_scoring` module wants to add a "Credit Risk" filter to the sales orders list. The orders API doesn't know about credit scores, and injecting IDs before the query would conflict with the pagination logic (the core would paginate on IDs, losing the total count).

```typescript
// credit_scoring/api/interceptors.ts
export const interceptors: ApiInterceptor[] = [
  {
    id: 'credit_scoring.filter-orders-by-risk',
    targetRoute: 'sales/documents',
    methods: ['GET'],
    features: ['credit_scoring.view'],

    async before(request, ctx) {
      // Just strip the custom param so Zod doesn't reject it
      // Store it for the after hook
      const creditRisk = request.query.creditRisk
      if (!creditRisk) return { ok: true }

      return {
        ok: true,
        query: { ...request.query, creditRisk: undefined },
        // Pass data between before and after via interceptor metadata
        metadata: { creditRiskFilter: creditRisk },
      }
    },

    async after(request, response, ctx) {
      const creditRiskFilter = ctx.metadata?.creditRiskFilter
      if (!creditRiskFilter) return {}

      // The core API has already returned paginated results.
      // Now fetch credit scores for ONLY the returned records (not all records).
      const records = response.body.data ?? response.body.items ?? []
      if (!records.length) return {}

      // Get customer IDs from the returned orders
      const customerIds = [...new Set(records.map((r: any) => r.customerId).filter(Boolean))]

      // Batch-fetch credit scores from our own table
      const scores = await ctx.em.find(CreditScore, {
        customerId: { $in: customerIds },
        organizationId: ctx.organizationId,
      })
      const scoreMap = new Map(scores.map(s => [s.customerId, s]))

      // Filter: keep only records matching the credit risk level
      const filtered = records.filter((record: any) => {
        const score = scoreMap.get(record.customerId)
        return score?.riskLevel === creditRiskFilter
      })

      // Return the filtered set with corrected pagination
      return {
        replace: {
          ...response.body,
          data: filtered,
          total: filtered.length,
          // Flag that client-side filtering was applied
          _meta: {
            ...(response.body._meta ?? {}),
            postFiltered: true,
            originalTotal: response.body.total,
          },
        },
      }
    },
  },
]
```

This requires extending `InterceptorAfterResult` with a `replace` option:

```typescript
interface InterceptorAfterResult {
  /** Additional fields to merge into the response (additive) */
  merge?: Record<string, unknown>
  /** Completely replace the response body (use with caution — for post-query filtering) */
  replace?: Record<string, unknown>
}
```

And `InterceptorBeforeResult` needs a `metadata` passthrough:

```typescript
interface InterceptorBeforeResult {
  ok: boolean
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  message?: string
  statusCode?: number
  /** Arbitrary data passed to the after hook via ctx.metadata */
  metadata?: Record<string, unknown>
}
```

#### Trade-offs of Tier 3 (Post-Query Merge)

| Aspect | Tier 1 (ID Rewrite) | Tier 3 (Post-Query Merge) |
|--------|---------------------|--------------------------|
| **Pagination** | Accurate — core paginates on filtered IDs | Inaccurate — page may have fewer items than `pageSize` |
| **Performance** | Two queries: one for IDs + one for core data | One core query + one for filter data, but post-filtering |
| **Total count** | Correct | Corrected but may differ from expected page count |
| **Use when** | Target API supports `id: { $in: [...] }` | Target API has complex query logic that can't be rewritten |
| **Risk** | Low | Medium — pages may have inconsistent sizes |

**Recommendation**: Prefer Tier 1 (ID rewrite) whenever possible. Use Tier 3 only when the API's query engine cannot accept injected ID filters.

### 8.5 CrudForm Field Injection — Complete Data Lifecycle

Allow modules to inject fields into existing form groups. The critical question: **how does injected field data get loaded and saved?**

#### The Problem

A loyalty module wants to add a "Tier" dropdown into the customer form. But:
- The customer entity doesn't have a `loyaltyTier` column — it lives in the loyalty module's own table
- The customer API doesn't return `loyaltyTier` — nothing knows to include it
- When the user saves, the customer PUT endpoint doesn't know about `loyaltyTier`

#### The Solution: Enricher + Field Widget + onSave — The Triad Pattern

Injected fields work through **three cooperating mechanisms**:

**Step 1 — Load: Response Enricher adds the data to the API response**

```typescript
// loyalty/data/enrichers.ts
export const enrichers: ResponseEnricher[] = [
  {
    id: 'loyalty.customer-tier',
    targetEntity: 'customers.person',
    features: ['loyalty.view'],

    async enrichOne(record, ctx) {
      const membership = await ctx.em.findOne(LoyaltyMembership, {
        customerId: record.id,
        organizationId: ctx.organizationId,
      })
      return {
        ...record,
        // These fields are now part of every customer API response
        _loyalty: {
          tier: membership?.tier ?? 'none',
          points: membership?.points ?? 0,
          memberSince: membership?.createdAt ?? null,
        },
      }
    },

    async enrichMany(records, ctx) {
      const ids = records.map(r => r.id)
      const memberships = await ctx.em.find(LoyaltyMembership, {
        customerId: { $in: ids },
        organizationId: ctx.organizationId,
      })
      const map = new Map(memberships.map(m => [m.customerId, m]))
      return records.map(record => ({
        ...record,
        _loyalty: {
          tier: map.get(record.id)?.tier ?? 'none',
          points: map.get(record.id)?.points ?? 0,
          memberSince: map.get(record.id)?.createdAt ?? null,
        },
      }))
    },
  },
]
```

**Step 2 — Render: Field widget displays the enriched data as an editable field**

```typescript
// loyalty/widgets/injection/customer-fields/widget.ts
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export default {
  metadata: {
    id: 'loyalty.injection.customer-fields',
    features: ['loyalty.manage'],
  },
  fields: [
    {
      id: '_loyalty.tier',              // Dot-path into the enriched response
      label: 'loyalty.field.tier',      // i18n key
      type: 'select',
      options: [
        { value: 'none', label: 'loyalty.tier.none' },
        { value: 'bronze', label: 'loyalty.tier.bronze' },
        { value: 'silver', label: 'loyalty.tier.silver' },
        { value: 'gold', label: 'loyalty.tier.gold' },
      ],
      group: 'details',                 // Insert into the "Details" form group
      placement: { position: InjectionPosition.After, relativeTo: 'status' },
      readOnly: false,
    },
  ],
  eventHandlers: {
    // Step 3 — Save: widget handles its own persistence
    onSave: async (data, context) => {
      // Extract the injected field value from the form data
      const tier = data['_loyalty.tier'] ?? data._loyalty?.tier
      if (!tier) return

      // Save via loyalty module's own API — NOT via customer API
      await apiCallOrThrow(
        `/api/loyalty/memberships/${context.resourceId}/tier`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier }),
        },
        { errorMessage: 'Failed to update loyalty tier' },
      )
    },
  },
} satisfies InjectionFieldWidget
```

**Step 3 — Save: The complete save flow**

```
User edits "Loyalty Tier" dropdown and clicks Save
  │
  ├─ CrudForm collects ALL field values (core + injected)
  │
  ├─ CrudForm validates core fields via Zod
  │  (injected fields are excluded from core schema validation)
  │
  ├─ Widget onBeforeSave handlers run (can validate injected fields)
  │
  ├─ CrudForm sends core fields to core API:
  │  PUT /api/customers/people  { id, firstName, lastName, status, ... }
  │  (the _loyalty fields are NOT sent to the core API)
  │
  ├─ Widget onSave handlers run (each saves its own data):
  │  PUT /api/loyalty/memberships/:id/tier  { tier: 'gold' }
  │
  └─ Widget onAfterSave handlers run (cleanup, refresh)
```

**Key design**: The core API never sees the injected fields. Each widget saves its own data through its own API. This preserves the core contract completely.

#### For Detail Pages (Non-CrudForm)

Detail pages use `useGuardedMutation` which already calls `onSave` handlers on all injected widgets. The injected field widget's `onSave` runs automatically:

```typescript
// In customer detail page — existing pattern, no changes needed
const { runMutation } = useGuardedMutation({
  contextId: `customer-person:${personId}`,
})

// When any section saves:
await runMutation({
  operation: () => apiCallOrThrow('/api/customers/people', { method: 'PUT', ... }),
  context: injectionContext,   // Widgets receive this context
})
// ↑ useGuardedMutation automatically calls onSave on all injected widgets
// ↑ The loyalty widget's onSave fires, saving tier via /api/loyalty/memberships/:id/tier
```

### 8.6 End-to-End Example: Adding a "Carrier Instructions" Field to the Shipment Dialog (Without Touching Core)

This is a complete, realistic walkthrough. A hypothetical `carrier_integration` module wants to add a "Special Instructions" textarea to the shipment dialog so warehouse staff can attach carrier-specific handling notes. The shipment dialog is a `CrudForm` embedded inside a `<Dialog>` on the order detail page (`ShipmentDialog.tsx`). It uses `entityId={E.sales.sales_shipment}`.

**Requirements:**
1. Show a "Special Instructions" field in the shipment dialog's "Tracking information" group
2. Load existing instructions when editing a shipment
3. Save instructions to the carrier integration module's own table — not to `sales_shipments`
4. Never modify any file in `packages/core/src/modules/sales/`

#### Step 1 — Data Model: Create the entity

```typescript
// carrier_integration/data/entities.ts
@Entity({ tableName: 'carrier_shipment_instructions' })
export class CarrierShipmentInstructions extends BaseEntity {
  @Property()
  shipmentId!: string              // FK to sales_shipments.id (no ORM relation — ID only)

  @Property({ type: 'text', nullable: true })
  specialInstructions?: string

  @Property({ type: 'text', nullable: true })
  handlingCode?: string

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}
```

Run `yarn db:generate` → creates migration for `carrier_shipment_instructions` table.

#### Step 2 — API: Create CRUD endpoint

```typescript
// carrier_integration/api/shipment-instructions/route.ts
export const { GET, POST, PUT, DELETE } = makeCrudRoute({
  entity: CarrierShipmentInstructions,
  basePath: 'carrier-integration/shipment-instructions',
  schemas: { create: createSchema, update: updateSchema, list: listSchema },
  features: { write: ['carrier_integration.manage'] },
})

export const openApi = { ... }
```

#### Step 3 — Response Enricher: Attach instructions to shipment API responses

```typescript
// carrier_integration/data/enrichers.ts
export const enrichers: ResponseEnricher[] = [
  {
    id: 'carrier_integration.shipment-instructions',
    targetEntity: 'sales.sales_shipment',
    features: ['carrier_integration.view'],

    async enrichOne(record, ctx) {
      const instructions = await ctx.em.findOne(CarrierShipmentInstructions, {
        shipmentId: record.id,
        organizationId: ctx.organizationId,
      })
      return {
        ...record,
        _carrierInstructions: {
          specialInstructions: instructions?.specialInstructions ?? '',
          handlingCode: instructions?.handlingCode ?? '',
        },
      }
    },

    async enrichMany(records, ctx) {
      const shipmentIds = records.map(r => r.id)
      const all = await ctx.em.find(CarrierShipmentInstructions, {
        shipmentId: { $in: shipmentIds },
        organizationId: ctx.organizationId,
      })
      const map = new Map(all.map(i => [i.shipmentId, i]))
      return records.map(record => ({
        ...record,
        _carrierInstructions: {
          specialInstructions: map.get(record.id)?.specialInstructions ?? '',
          handlingCode: map.get(record.id)?.handlingCode ?? '',
        },
      }))
    },
  },
]
```

Now every `GET /api/sales/shipments` response includes `_carrierInstructions` on each shipment.

#### Step 4 — Widget: Inject field into the shipment dialog

The shipment dialog is a CrudForm with `entityId={E.sales.sales_shipment}`. It has groups: `shipmentDetails` (column 1), `tracking` (column 2), `items` (column 1), `shipmentCustomFields` (column 2).

```typescript
// carrier_integration/widgets/injection-table.ts
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Target the CrudForm that has entityId 'sales.sales_shipment'
  'crud-form:sales.sales_shipment': {
    widgetId: 'carrier_integration.injection.shipment-instructions-field',
    priority: 50,
  },
}
```

```typescript
// carrier_integration/widgets/injection/shipment-instructions-field/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export default {
  metadata: {
    id: 'carrier_integration.injection.shipment-instructions-field',
    title: 'Carrier Instructions',
    features: ['carrier_integration.manage'],
  },
  fields: [
    {
      id: '_carrierInstructions.specialInstructions',
      label: 'carrier_integration.field.specialInstructions',
      type: 'textarea',
      group: 'tracking',      // Insert into the existing "Tracking information" group
      placement: { position: InjectionPosition.After, relativeTo: 'notes' },
    },
    {
      id: '_carrierInstructions.handlingCode',
      label: 'carrier_integration.field.handlingCode',
      type: 'select',
      options: [
        { value: 'standard', label: 'carrier_integration.handling.standard' },
        { value: 'fragile', label: 'carrier_integration.handling.fragile' },
        { value: 'hazmat', label: 'carrier_integration.handling.hazmat' },
        { value: 'refrigerated', label: 'carrier_integration.handling.refrigerated' },
      ],
      group: 'tracking',
      placement: { position: InjectionPosition.After, relativeTo: '_carrierInstructions.specialInstructions' },
    },
  ],
  eventHandlers: {
    // Save the carrier instructions via the carrier integration API
    onSave: async (data, context) => {
      const specialInstructions = data['_carrierInstructions.specialInstructions'] ?? ''
      const handlingCode = data['_carrierInstructions.handlingCode'] ?? 'standard'

      // context.resourceId is the shipment ID (set after core save)
      const shipmentId = context.resourceId
      if (!shipmentId) return

      await apiCallOrThrow(
        '/api/carrier-integration/shipment-instructions',
        {
          method: 'POST',      // Upsert pattern: create-or-update
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            shipmentId,
            specialInstructions,
            handlingCode,
            organizationId: context.organizationId,
            tenantId: context.tenantId,
          }),
        },
        { errorMessage: 'Failed to save carrier instructions' },
      )
    },

    // Validate before save
    onBeforeSave: async (data, context) => {
      const handlingCode = data['_carrierInstructions.handlingCode']
      if (handlingCode === 'hazmat') {
        const instructions = data['_carrierInstructions.specialInstructions'] ?? ''
        if (instructions.trim().length < 10) {
          return {
            ok: false,
            message: 'Hazmat shipments require detailed special instructions (min 10 chars).',
            fieldErrors: {
              '_carrierInstructions.specialInstructions': 'Required for hazmat shipments',
            },
          }
        }
      }
      return { ok: true }
    },
  },
} satisfies InjectionFieldWidget
```

#### Step 5 — Translations

```typescript
// carrier_integration/i18n/en.ts
export default {
  'carrier_integration.field.specialInstructions': 'Special Instructions',
  'carrier_integration.field.handlingCode': 'Handling Code',
  'carrier_integration.handling.standard': 'Standard',
  'carrier_integration.handling.fragile': 'Fragile',
  'carrier_integration.handling.hazmat': 'Hazmat',
  'carrier_integration.handling.refrigerated': 'Refrigerated',
}
```

#### What Happens at Runtime

**Edit shipment dialog opens:**
```
1. Order detail page opens ShipmentDialog for shipment id=abc
2. ShipmentDialog renders CrudForm with entityId='sales.sales_shipment'
3. CrudForm loads initial values (including existing data from shipment)
4. Response enricher has already attached _carrierInstructions to the shipment data
5. CrudForm discovers injected field widgets via injection-table
6. The "Tracking information" group now renders:
   - Shipped date        ← core field
   - Delivered date       ← core field
   - Tracking numbers     ← core field
   - Notes               ← core field
   - Special Instructions ← INJECTED (from carrier_integration)
   - Handling Code        ← INJECTED (from carrier_integration)
```

**User fills in fields and clicks Save (⌘Enter):**
```
1. CrudForm validates core fields (Zod schema)
2. CrudForm triggers onBeforeSave on all injection widgets
   → carrier_integration validates: hazmat requires instructions ≥10 chars
   → record_locks validates: lock token is valid (if record-locking active)
3. CrudForm calls handleSubmit() → sends core fields to PUT /api/sales/shipments
   → The _carrierInstructions fields are NOT sent (not in shipment Zod schema)
4. CrudForm triggers onSave on all injection widgets
   → carrier_integration posts to POST /api/carrier-integration/shipment-instructions
5. CrudForm triggers onAfterSave → dialog closes, shipments list refreshes
```

**Files touched in `packages/core/src/modules/sales/`: ZERO.**

#### What's Needed in UMES for This to Work

This example works TODAY for the basic case because:
- ✅ CrudForm already supports injection via `crud-form:<entityId>` spot IDs
- ✅ CrudForm already calls `onBeforeSave`/`onSave`/`onAfterSave` on injection widgets
- ✅ Custom fields already render in CrudForm groups

What UMES adds to make the **field injection** specifically work:
- **NEW**: `InjectionFieldWidget` type — fields array with `group`, `placement`, `type`
- **NEW**: CrudForm reads `fields` from injection widgets and inserts them into specified groups at specified positions
- **NEW**: CrudForm populates injected field initial values from enriched API response data (via `accessorKey` dot-path)
- **NEW**: Response enrichers (`data/enrichers.ts`) auto-discovered and applied in CRUD factory

### 8.7 CrudForm Group Injection (Existing — Formalized)

Already works via current injection table with `kind: 'group'` and `column` placement. Formalized with explicit type:

```typescript
satisfies InjectionGroupWidget  // Existing pattern, now typed
```

### 8.7 Headless Widget Type — No `Widget` Component Required

Existing widgets MUST export a `Widget` React component (`InjectionSpot.tsx` destructures `{ Widget }` and renders it). New declarative widget types (columns, row actions, bulk actions, filters, fields) are **headless** — they provide data/configuration but no visual component.

To maintain backward compatibility with the `InjectionSpot` rendering path, headless widgets use a separate loading path:

```typescript
// Two loading functions (not one)
loadInjectionWidgetById(id)         // Existing: expects Widget component, renders via InjectionSpot
loadInjectionDataWidgetById(id)     // NEW: loads metadata + declarative config, no Widget expected
```

**Widget type detection** uses the injection table entry. Existing spot IDs (`crud-form:*`, `backend:record:current`) use the existing loader. New spot IDs for declarative extensions (`data-table:*:columns`, `data-table:*:row-actions`, `data-table:*:bulk-actions`, `data-table:*:filters`, `crud-form:*:fields`) use the new headless loader.

If a headless widget also needs to render UI (e.g., a custom cell renderer for an injected column), it exports `Widget` optionally — the column definition's `cell` function handles rendering inline.

### 8.8 Implementation: DataTable Integration

```typescript
// In DataTable.tsx — new hook (uses headless loader)
function useInjectedTableExtensions(tableId: string) {
  const { widgets } = useInjectionDataWidgets(`data-table:${tableId}:columns`)
  const { widgets: actionWidgets } = useInjectionDataWidgets(`data-table:${tableId}:row-actions`)
  const { widgets: bulkWidgets } = useInjectionDataWidgets(`data-table:${tableId}:bulk-actions`)
  const { widgets: filterWidgets } = useInjectionDataWidgets(`data-table:${tableId}:filters`)

  return {
    injectedColumns: widgets.flatMap(w => w.module.columns ?? []),
    injectedRowActions: actionWidgets.flatMap(w => w.module.rowActions ?? []),
    injectedBulkActions: bulkWidgets.flatMap(w => w.module.bulkActions ?? []),
    injectedFilters: filterWidgets.flatMap(w => w.module.filters ?? []),
  }
}
```

DataTable merges injected extensions with its own columns, actions, and filters — respecting `position` hints for ordering.

---

## 9. Phase 6 — Recursive Widget Extensibility

**Goal**: Allow widgets themselves to be extended by other widgets.

### 9.1 Widget-Level Extension Points

Any widget can declare its own injection spots:

```typescript
// In a widget's client component
function RecordLockingWidget({ context, data }: WidgetProps) {
  return (
    <div>
      <LockStatusBanner />
      {/* Other widgets can inject into this widget */}
      <InjectionSpot
        spotId={`widget:record_locks.crud-form-locking:actions`}
        context={context}
        data={data}
      />
      <ConflictResolutionDialog />
    </div>
  )
}
```

### 9.2 Widget Behavior Extension

Modules can extend a widget's event handlers:

```typescript
// In injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  // Extend record-locking's onBeforeSave with additional check
  'widget:record_locks.crud-form-locking:events': {
    widgetId: 'audit.injection.lock-audit-trail',
    priority: 50,
  },
}
```

This enables **layered composition** — audit module adds logging to record-locking's save guard without record-locking knowing about audit.

---

## 10. Phase 7 — Detail Page Bindings (Customer, Sales Document, etc.)

**Goal**: Bring the full UMES extensibility to detail pages that are NOT based on CrudForm — specifically the customer person/company detail pages and sales document detail pages (orders, quotes, invoices).

### 10.1 The Problem: Detail Pages Are Bespoke

CrudForm-based pages get UMES features for free (field injection, event handlers, headless widgets). But the most important pages in Open Mercato — customer detail and sales document detail — are **hand-built pages** that:

- Load data via manual `useEffect` + `readApiResultOrThrow`
- Store data in component state (`useState<PersonOverview>`)
- Handle mutations via `useGuardedMutation.runMutation()`
- Render tabs/sections manually with conditional logic
- Pass `injectionContext` to `InjectionSpot` components

These pages already support **tab injection** and **detail section injection** (via existing `InjectionSpot`), and **mutation hooks** (via `useGuardedMutation`). But they do NOT support:
- Field injection into existing sections
- Column injection into embedded data tables
- Response enrichment (enrichers work on the API but the UI doesn't know about the extra fields)
- Component replacement of specific sections/dialogs

### 10.2 Architecture: The `useExtensibleDetail` Hook

Introduce a unified hook that detail pages opt into, binding all UMES features:

```typescript
// packages/ui/src/backend/injection/useExtensibleDetail.ts

interface UseExtensibleDetailOptions<TData> {
  /** Entity identifier for extension point resolution */
  entityId: string                    // e.g., 'customers.person', 'sales.document'
  /** The loaded entity data (from useState) */
  data: TData | null
  /** Data setter (the existing setState function) */
  setData: React.Dispatch<React.SetStateAction<TData | null>>
  /** The existing injection context */
  injectionContext: Record<string, unknown>
  /** The existing useGuardedMutation instance */
  guardedMutation: ReturnType<typeof useGuardedMutation>
}

interface ExtensibleDetailResult<TData> {
  // === Injected tabs (already works, but now typed) ===
  injectedTabs: InjectedTab[]

  // === Injected fields for specific sections ===
  getFieldsForSection(sectionId: string): InjectedField[]

  // === Injected columns for embedded DataTables ===
  getColumnsForTable(tableId: string): InjectedColumn[]
  getRowActionsForTable(tableId: string): InjectedRowAction[]

  // === Component replacements available for this page ===
  getComponent<TProps>(componentId: string): React.ComponentType<TProps>

  // === Enriched data accessor (reads _ext fields from data) ===
  getEnrichedData<T>(namespace: string): T | undefined

  // === Composed save handler (calls all widget onSave handlers) ===
  runSectionSave(
    sectionId: string,
    operation: () => Promise<unknown>,
    sectionData?: Record<string, unknown>,
  ): Promise<void>
}
```

### 10.3 Customer Detail Page — Before/After

**Before** (current code — simplified):

```typescript
// packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx

export default function PersonDetailPage() {
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({ ... })

  // Load data
  React.useEffect(() => { /* fetch /api/customers/people/${id} */ }, [id])

  // Injection context
  const injectionContext = React.useMemo(() => ({
    formId: contextId,
    personId,
    resourceKind: 'customers.person',
    resourceId: personId,
    data,
    retryLastMutation,
  }), [data, personId, retryLastMutation])

  // Injected tabs
  const { widgets: injectedTabWidgets } = useInjectionWidgets(
    'customers.person.detail:tabs', { context: injectionContext }
  )

  return (
    <Page>
      <FormHeader mode="detail" ... />
      <DetailFieldsSection>
        {/* Hard-coded fields: firstName, lastName, email, phone, status */}
      </DetailFieldsSection>
      <InjectionSpot spotId="customers.person.detail:details" ... />
      <DetailTabsLayout tabs={[...builtInTabs, ...injectedTabs]}>
        {activeTab === 'activities' && <ActivitiesSection ... />}
        {activeTab === 'deals' && <DealsSection ... />}
        ...
      </DetailTabsLayout>
    </Page>
  )
}
```

**After** (with UMES bindings):

```typescript
export default function PersonDetailPage() {
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const guardedMutation = useGuardedMutation({ ... })

  React.useEffect(() => { /* fetch — unchanged */ }, [id])

  const injectionContext = React.useMemo(() => ({ /* unchanged */ }), [...])

  // NEW: single hook binds all UMES features
  const ext = useExtensibleDetail({
    entityId: 'customers.person',
    data,
    setData,
    injectionContext,
    guardedMutation,
  })

  return (
    <Page>
      <FormHeader mode="detail" ... />
      <DetailFieldsSection>
        {/* Hard-coded fields: firstName, lastName, email, phone, status */}

        {/* NEW: Injected fields render after core fields in this section */}
        {ext.getFieldsForSection('details').map(field => (
          <InjectedField key={field.id} field={field} data={data} onSave={ext.runSectionSave} />
        ))}
      </DetailFieldsSection>

      <InjectionSpot spotId="customers.person.detail:details" ... />

      <DetailTabsLayout tabs={[...builtInTabs, ...ext.injectedTabs]}>
        {activeTab === 'activities' && <ActivitiesSection ... />}
        {activeTab === 'deals' && (
          <DealsSection
            columns={[...coreColumns, ...ext.getColumnsForTable('customers.person.deals')]}
            rowActions={[...coreActions, ...ext.getRowActionsForTable('customers.person.deals')]}
          />
        )}
        ...
      </DetailTabsLayout>
    </Page>
  )
}
```

### 10.4 Sales Document Detail Page — Concrete Bindings

The sales document detail page is the most complex page in the system. Here are the specific extension points:

```typescript
// Sales document detail — extension point map
const ext = useExtensibleDetail({
  entityId: 'sales.document',
  data: documentData,
  setData: setDocumentData,
  injectionContext,
  guardedMutation,
})

// 1. COMPONENT REPLACEMENT: Shipment dialog
//    A new_sales module can swap the entire ShipmentDialog
const ShipmentDialog = ext.getComponent<ShipmentDialogProps>(
  'sales.document.shipment-dialog'
)

// 2. FIELD INJECTION: Add fields to the document header section
//    Example: a "Priority" field injected by a fulfillment module
const headerFields = ext.getFieldsForSection('document-header')

// 3. COLUMN INJECTION: Items table
//    Example: a warehouse module adds a "Stock Level" column to the items table
const itemColumns = ext.getColumnsForTable('sales.document.items')

// 4. ROW ACTIONS: Items table
//    Example: a procurement module adds "Reorder from supplier" row action
const itemRowActions = ext.getRowActionsForTable('sales.document.items')

// 5. TAB INJECTION: Additional tabs
//    Example: a shipping module adds a "Tracking" tab
const allTabs = [...builtInTabs, ...ext.injectedTabs]

// 6. SECTION SAVE: When the items section saves, loyalty widget also saves
await ext.runSectionSave('items', async () => {
  await apiCallOrThrow('/api/sales/documents', { method: 'PUT', body: ... })
})
```

### 10.5 The `runSectionSave` Pattern

Detail pages have multiple save operations (each section saves independently). Unlike CrudForm where there's one Save button, detail pages have inline editing, section-level save buttons, and auto-save on blur.

`runSectionSave` wraps any section's save with the full UMES lifecycle:

```typescript
async function runSectionSave(
  sectionId: string,
  operation: () => Promise<unknown>,
  sectionData?: Record<string, unknown>,
): Promise<void> {
  // 1. Collect injected field values for this section
  const injectedValues = collectInjectedFieldValues(sectionId)

  // 2. Run widget onBeforeSave (can block)
  const guardResult = await triggerEvent('onBeforeSave', {
    ...sectionData,
    ...injectedValues,
  }, injectionContext)

  if (!guardResult.ok) {
    throw createCrudFormError(guardResult.message, guardResult.fieldErrors)
  }

  // 3. Execute the core save (with scoped headers from widgets)
  await withScopedApiRequestHeaders(guardResult.requestHeaders ?? {}, operation)

  // 4. Run widget onSave (each widget saves its own data)
  await triggerEvent('onSave', {
    ...sectionData,
    ...injectedValues,
  }, injectionContext)

  // 5. Run widget onAfterSave (cleanup, refresh)
  await triggerEvent('onAfterSave', {
    ...sectionData,
    ...injectedValues,
  }, injectionContext)
}
```

### 10.6 The `<InjectedField>` Component

A new UI component that renders injected fields consistently across both CrudForm and detail pages:

```typescript
// packages/ui/src/backend/injection/InjectedField.tsx

interface InjectedFieldProps {
  field: {
    id: string
    label: string       // i18n key
    type: 'text' | 'select' | 'number' | 'date' | 'boolean' | 'textarea'
    options?: { value: string; label: string }[]
    readOnly?: boolean
    position?: string
    group?: string
  }
  /** Current value (read from enriched data via dot-path) */
  value: unknown
  /** Called when user changes the value */
  onChange: (fieldId: string, value: unknown) => void
  /** Whether the page is in loading state */
  isLoading?: boolean
}

function InjectedField({ field, value, onChange, isLoading }: InjectedFieldProps) {
  const t = useT()

  // Renders the appropriate input based on field.type
  // Uses the same UI primitives as CrudForm fields for visual consistency
  switch (field.type) {
    case 'select':
      return (
        <FormField label={t(field.label)}>
          <Select
            value={value as string}
            onChange={(v) => onChange(field.id, v)}
            options={(field.options ?? []).map(o => ({ value: o.value, label: t(o.label) }))}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'text':
      return (
        <FormField label={t(field.label)}>
          <Input
            value={value as string ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    // ... other field types
  }
}
```

### 10.7 Data Flow: Detail Page With Enrichment + Field Injection + Save

Complete end-to-end example — a loyalty module extending the customer detail page:

```
                                ┌─────────────────────────────────────────┐
                                │     Customer Detail Page (person)       │
                                └───────────────────┬─────────────────────┘
                                                    │
         ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
         │                                          │                                          │
    1. LOAD                                    2. RENDER                                  3. SAVE
         │                                          │                                          │
  GET /api/customers/                    ┌──────────┴──────────┐                     User edits tier
  people/123                             │                     │                     and clicks save
         │                          Core fields           Injected fields                  │
  ┌──────┴──────────┐               firstName             _loyalty.tier ← InjectedField   │
  │ Core query      │               lastName              (from enricher)                  │
  │ returns person  │               email                                             ┌────┴─────────┐
  └──────┬──────────┘               status                                            │ runSection   │
         │                                                                            │ Save()       │
  ┌──────┴──────────┐                                                                 └────┬─────────┘
  │ Enrichers run:  │                                                                      │
  │ loyalty adds    │                                                          ┌───────────┼───────────┐
  │ _loyalty.tier   │                                                          │           │           │
  │ _loyalty.points │                                                     onBeforeSave  Core PUT    onSave
  └──────┬──────────┘                                                     (validate)    (person)    (loyalty)
         │                                                                     │           │           │
  Response arrives:                                                            │    PUT /api/      PUT /api/
  {                                                                            │    customers/     loyalty/
    person: { id, firstName, ... },                                            │    people         memberships/
    _loyalty: { tier: 'gold', points: 1250 },                                 │    {id,name,...}  123/tier
  }                                                                            │           │      {tier:'silver'}
                                                                               │           │           │
                                                                               └───────────┴───────────┘
                                                                                     onAfterSave
                                                                                   (refresh data)
```

### 10.8 Implementation Scope Per Detail Page

| Page | Current State | Required Changes |
|------|--------------|-----------------|
| **Customer Person** (`people/[id]/page.tsx`) | Has: tabs, detail spots, guarded mutation. Missing: field injection, column injection in deals/activities tables, component replacement | Add `useExtensibleDetail` hook (~15 LOC). Add `<InjectedField>` rendering in details section. Pass injected columns to DealsSection DataTable. |
| **Customer Company** (`companies/[id]/page.tsx`) | Same pattern as person detail | Same changes as person detail |
| **Sales Document** (`documents/[id]/page.tsx`) | Has: tabs, detail spots, guarded mutation. Missing: field injection in header, column injection in items table, shipment dialog replacement | Add `useExtensibleDetail` hook. Wrap `ShipmentDialog` with `ext.getComponent()`. Add `<InjectedField>` in header section. Pass injected columns to items DataTable. |
| **Future detail pages** | N/A | All new detail pages should use `useExtensibleDetail` from the start |

### 10.9 Migration Path — Non-Breaking

The `useExtensibleDetail` hook is **opt-in per page**. Pages that don't adopt it continue working exactly as today. The migration is:

1. Add `const ext = useExtensibleDetail({ ... })` (using existing state and mutation instances)
2. Render `ext.getFieldsForSection('...')` where field injection is desired
3. Pass `ext.getColumnsForTable('...')` to embedded DataTables
4. Wrap replaceable components with `ext.getComponent('...')`

No existing InjectionSpot usage changes. No existing injection-table.ts changes. No existing widget.ts changes.

---

## 11. Coherence with Existing Systems

### 10.1 Mapping: When to Use What

| I want to... | Use | Why |
|--------------|-----|-----|
| Add UI to another module's page | **Widget Injection** (Phase 1 slots) | UI composition |
| Replace a component entirely | **Component Replacement** (Phase 2) | Component swap |
| Add data to another module's API response | **Response Enricher** (Phase 3) | Data federation |
| Validate/block an API mutation | **API Interceptor** (Phase 4) | Server-side guard |
| Validate/block a form save from UI | **Widget `onBeforeSave`** (Phase 1) | Client-side guard |
| Add columns to a data table | **Column Injection** (Phase 5) | Table extension |
| Add fields to a form | **Field Injection** (Phase 5) | Form extension |
| React to a completed operation | **Event Subscriber** (existing) | Async side-effect |
| Add data model relations | **Entity Extension** (existing) | Data model |
| Add user-configurable fields | **Custom Fields/Entities** (existing) | User-defined |
| Add items to profile menu / sidebar nav | **Menu Item Injection** (Phase 1 §4.3) | Application chrome |

### 10.2 What Does NOT Change

| Existing System | Status |
|----------------|--------|
| Event subscribers (`subscribers/*.ts`) | **Unchanged** — remain the pattern for async side-effects |
| Entity extensions (`data/extensions.ts`) | **Unchanged** — remain the pattern for data model links |
| Custom fields/entities (`ce.ts`) | **Unchanged** — remain the pattern for user-defined attributes |
| Mutation guards (`mutation-guard.ts`) | **Integrated** — API interceptors complement (not replace) mutation guards; guards are DI-resolved server-side validation, interceptors are module-declared route hooks |
| Widget injection (current) | **Extended** — all existing APIs remain, new capabilities added |

### 10.3 Event Flow: Complete Picture

```
User clicks Save
  │
  ├─ 1. [UI] Client-side Zod validation (existing)
  │
  ├─ 2. [UI] Widget onBeforeSave handlers (client-side validation, lock checks)
  │      └─ Can block save, return fieldErrors, inject requestHeaders
  │
  ├─ 3. [API] Server-side Zod validation (existing)
  │
  ├─ 4. [API] API Interceptor before hooks (server-side validation, business rules)
  │      └─ Can reject request; if body modified → re-validated by Zod
  │
  ├─ 5. [API] CrudHooks.beforeCreate/Update (existing — receives validated input)
  │
  ├─ 6. [API] Mutation Guard check (DI-resolved, e.g., record-lock token validation)
  │      └─ Can reject mutation
  │
  ├─ 7. [Core] Entity mutation + ORM flush (existing)
  │
  ├─ 8. [API] CrudHooks.afterCreate/Update (existing)
  │
  ├─ 9. [API] Mutation Guard afterSuccess (existing)
  │
  ├─ 10. [API] API Interceptor after hooks (augment response)
  │
  ├─ 11. [API] Response Enrichers (add data from other modules)
  │
  ├─ 12. [UI] Widget onAfterSave handlers (clear state, refresh)
  │
  └─ 13. [Async] Event Subscribers (send email, reindex, update cache)
```

Each numbered step preserves the exact contract of existing hooks — new steps (4, 10, 11) are inserted at defined boundaries without changing what existing hooks receive.

---

## 12. Extension Manifest & Discovery

### 11.1 Unified Module Extension File

Each module declares all its extensions in a single manifest alongside existing files:

```
src/modules/<module>/
├── index.ts               # Existing: module metadata
├── acl.ts                 # Existing: permissions
├── events.ts              # Existing: event declarations
├── setup.ts               # Existing: tenant init
├── data/
│   ├── entities.ts        # Existing
│   ├── extensions.ts      # Existing: entity extensions
│   └── enrichers.ts       # NEW: response enrichers
├── api/
│   ├── <routes>           # Existing
│   └── interceptors.ts    # NEW: API interceptors
├── widgets/
│   ├── injection-table.ts # Existing: slot mappings
│   ├── injection/         # Existing: widget implementations
│   └── components.ts      # NEW: component replacements/overrides
└── subscribers/           # Existing: event subscribers
```

### 11.2 Auto-Discovery

The CLI generator (`yarn generate`) discovers:
- `data/enrichers.ts` → generates enricher registry
- `api/interceptors.ts` → generates interceptor registry
- `widgets/components.ts` → generates component override registry

All registries are generated into `apps/mercato/.mercato/generated/` and loaded at bootstrap — same pattern as current injection widget discovery.

### 11.3 Feature-Gated Activation

All extension types support `features?: string[]` for ACL-based activation. Extensions are only loaded when the current user has the required features. This reuses the existing RBAC system.

---

## 13. Developer Experience

### 12.1 CLI Scaffolding

```bash
# Scaffold a new widget injection
yarn generate widget --module loyalty --target crud-form:customers.person --kind group

# Scaffold a response enricher
yarn generate enricher --module loyalty --target customers.person

# Scaffold an API interceptor
yarn generate interceptor --module business_rules --target sales/orders --methods POST,PUT

# Scaffold a component replacement
yarn generate component-override --module new_sales --target sales.order.shipment-dialog
```

### 12.2 DevTools Integration

In development mode, a **UMES DevTools panel** shows:

- All active extension points on the current page
- Which modules have registered for each point
- Priority ordering and conflict detection
- Real-time event flow (onBeforeSave fired → widget X responded → blocked/allowed)
- Response enricher timing (which enrichers are slow)
- Component replacements in effect

### 12.3 Extension Conflict Detection

At build time (`yarn generate`), detect:
- Two modules replacing the same component at the same priority (error)
- Enricher adding fields that conflict with core fields (warning)
- Circular widget dependencies (error)
- Missing feature declarations for gated extensions (warning)

---

## 14. Data Models

### 13.1 No New Database Entities for Phase 1-2

Phases 1-2 (UI slots, component replacement) are purely runtime — no database changes. All configuration is in code (injection tables, component registries).

### 13.2 Phase 3 — Enricher Cache (Optional)

For performance-critical enrichers, an optional cache layer:

```typescript
// Uses existing @open-mercato/cache infrastructure
{
  id: 'loyalty.customer-points',
  cache: {
    strategy: 'read-through',
    ttl: 60,  // seconds
    tags: ['loyalty', 'customers'],
    invalidateOn: ['loyalty.points.updated', 'loyalty.tier.changed'],
  },
}
```

### 13.3 Phase 4 — Interceptor Audit Log (Optional)

Interceptor rejections can be logged for audit:

```sql
-- Uses existing action_log infrastructure; no new table needed
-- Interceptor rejections are logged as action_log entries with:
--   action_type: 'api_interceptor_reject'
--   metadata: { interceptorId, route, method, message }
```

---

## 15. API Contracts

### 14.1 No New HTTP Endpoints

UMES is a framework-level feature — no new API routes. Extensions are applied transparently within existing routes.

### 14.2 Extension Header Protocol

Widgets and interceptors can communicate via scoped headers (existing pattern from record-locking):

```
x-om-ext-<module>-<key>: <value>
```

Example:
```
x-om-ext-record-locks-token: abc123
x-om-ext-business-rules-override: skip-credit-check
```

### 14.3 Response Metadata

When enrichers are active, responses include metadata:

```json
{
  "data": { /* enriched record */ },
  "_meta": {
    "enrichedBy": ["loyalty.customer-points", "credit.score"]
  }
}
```

---

## 16. Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual Risk |
|---|------|----------|------|------------|---------------|
| 1 | **Performance degradation from enrichers** — N+1 queries or slow enrichers on list endpoints | High | Data Layer | Require `enrichMany` for list endpoints; add timing budget (100ms warning, 500ms error in dev); leverage cache | Medium — cache misses on first load |
| 2 | **Component replacement breaks props contract** — Replacement component doesn't match original's props interface | High | UI Layer | Enforce `propsSchema` via Zod at registration; runtime props validation in dev mode; test coverage requirement for replacements | Low — caught at dev/build time |
| 3 | **Circular dependencies between extensions** — Module A enriches B's response, B enriches A's | Medium | Architecture | Dependency graph analysis at `yarn generate`; circular references are a build error | Low |
| 4 | **Priority conflicts** — Two modules register at same priority for same extension point | Medium | All Layers | Build-time detection; require explicit priority; document that identical priorities resolve by module load order (alphabetical) | Low |
| 5 | **API interceptor blocks legitimate requests** — Misconfigured interceptor rejects valid mutations | High | API Layer | Interceptor rejections include `interceptorId` in error response; admin can disable interceptors per-tenant; all rejections are logged | Medium — requires admin intervention |
| 6 | **Backward compatibility** — Existing injection-table.ts and widget.ts files must continue working | Critical | All | All existing APIs are preserved; new features are additive; migration guide for opt-in adoption | Low |
| 7 | **Complexity overhead for simple modules** — System becomes too complex for basic CRUD modules | Medium | DX | Progressive disclosure: simple modules use only what they need; no mandatory boilerplate; CLI scaffolding for common patterns | Low |
| 8 | **Security: enrichers expose cross-tenant data** — Enricher query doesn't filter by organizationId | Critical | Security | `EnricherContext` always includes `organizationId`; enricher EntityManager is scoped to current tenant; code review checklist item | Low — architectural guard |

---

## 17. Integration Test Coverage

Tests are organized by PR (see §21 for PR definitions). Each PR ships its own integration tests.

### PR 1 — Foundation
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-F01 | Headless menu item widget renders in sidebar navigation | UI | Playwright |
| TC-UMES-F02 | `InjectionPosition` enum values resolve correctly (Before, After, First, Last) | Unit | Vitest |

### PR 2 — Menu Item Injection
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-M01 | Menu item injected into profile dropdown appears between existing items | UI | Playwright |
| TC-UMES-M02 | Sidebar group created by injected menu item appears in correct order | UI | Playwright |
| TC-UMES-M03 | Menu item respects ACL features (hidden when feature disabled) | UI | Playwright |
| TC-UMES-M04 | Menu item with `href` navigates correctly on click | UI | Playwright |

### PR 3 — Events + DOM Bridge
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-E01 | `clientBroadcast: true` event arrives at client via SSE within 2 seconds | API+UI | Playwright |
| TC-UMES-E02 | Widget `onAppEvent` handler fires when matching event is dispatched | UI | Playwright |
| TC-UMES-E03 | `onFieldChange` handler receives field updates and can set side-effects | UI | Playwright |
| TC-UMES-E04 | `transformFormData` pipeline applies multiple widget transformations in priority order | UI | Playwright |
| TC-UMES-E05 | Events without `clientBroadcast: true` do NOT arrive at client | API+UI | Playwright |
| TC-UMES-E06 | `useAppEvent` wildcard pattern `example.todo.*` matches `example.todo.created` | Unit | Vitest |

### PR 4 — Response Enrichers
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-R01 | GET single customer includes `_example.todoCount` from enricher | API | Playwright |
| TC-UMES-R02 | GET customer list — `enrichMany` batches fetch (verify via response timing or query count) | API | Playwright |
| TC-UMES-R03 | Enricher respects ACL features (admin sees enriched data, employee without feature does not) | API | Playwright |
| TC-UMES-R04 | Enricher fields are `_` prefixed and additive (core fields unchanged) | API | Playwright |
| TC-UMES-R05 | Enriched `_meta.enrichedBy` includes enricher ID | API | Playwright |

### PR 5 — API Interceptors
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-I01 | Interceptor `before` rejects POST with 422 when title contains "BLOCKED" | API | Playwright |
| TC-UMES-I02 | Interceptor `before` allows valid POST to proceed | API | Playwright |
| TC-UMES-I03 | Interceptor `after` merges `_example.serverTimestamp` into GET response | API | Playwright |
| TC-UMES-I04 | Interceptor with wildcard `example/*` matches `example/todos` and `example/tags` | API | Playwright |
| TC-UMES-I05 | Interceptor `before` modifying body — modified body is re-validated through Zod | API | Playwright |
| TC-UMES-I06 | `metadata` passthrough between `before` and `after` hooks works | API | Playwright |

### PR 6 — DataTable Deep Extensibility
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-D01 | Injected "Todos" column appears in customers DataTable at correct position (after "Email") | UI | Playwright |
| TC-UMES-D02 | Injected column cell renders enriched data (`_example.todoCount`) | UI | Playwright |
| TC-UMES-D03 | Injected "View Todos" row action appears in row action dropdown | UI | Playwright |
| TC-UMES-D04 | Injected row action click navigates to correct URL | UI | Playwright |
| TC-UMES-D05 | Injected column respects ACL features | UI | Playwright |

### PR 7 — CrudForm Field Injection
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-CF01 | Injected "Priority" field appears in customer edit form within "Details" group | UI | Playwright |
| TC-UMES-CF02 | Injected field loads initial value from enriched response (`_example.priority`) | UI | Playwright |
| TC-UMES-CF03 | Editing injected field and saving persists via example module's API | UI+API | Playwright |
| TC-UMES-CF04 | Widget `onBeforeSave` validation blocks save on invalid injected field value | UI | Playwright |
| TC-UMES-CF05 | Core customer fields are unchanged (injected field data not sent to customer API) | API | Playwright |

### PR 8 — Component Replacement
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-CR01 | Replaced component renders instead of original | UI | Playwright |
| TC-UMES-CR02 | Wrapper mode renders original component with extra content | UI | Playwright |
| TC-UMES-CR03 | Component replacement respects ACL features | UI | Playwright |
| TC-UMES-CR04 | Highest priority replacement wins when multiple exist | UI | Playwright |

### PR 9 — Detail Page Bindings
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-DP01 | Injected field renders in customer detail page "Details" section | UI | Playwright |
| TC-UMES-DP02 | `runSectionSave` triggers widget `onSave` handlers alongside core save | UI+API | Playwright |
| TC-UMES-DP03 | Enriched data accessible via `ext.getEnrichedData('_example')` | UI | Playwright |
| TC-UMES-DP04 | Injected tab renders in customer detail tabs | UI | Playwright |

### PR 10 — Recursive Widgets
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-RW01 | Widget-level injection spot renders child widgets | UI | Playwright |
| TC-UMES-RW02 | Nested widget's `onBeforeSave` handler participates in save lifecycle | UI | Playwright |

### PR 11 — DevTools + Conflict Detection
| Test ID | Scenario | Path | Type |
|---------|----------|------|------|
| TC-UMES-DT01 | DevTools panel lists all active extensions on current page (dev mode) | UI | Playwright |
| TC-UMES-DT02 | Build-time conflict detection warns on duplicate priority replacements | CLI | Script |

### Test Totals

| PR | Count |
|----|-------|
| PR 1 — Foundation | 2 |
| PR 2 — Menus | 4 |
| PR 3 — Events + DOM Bridge | 6 |
| PR 4 — Enrichers | 5 |
| PR 5 — Interceptors | 6 |
| PR 6 — DataTable | 5 |
| PR 7 — CrudForm Fields | 5 |
| PR 8 — Component Replacement | 4 |
| PR 9 — Detail Bindings | 4 |
| PR 10 — Recursive Widgets | 2 |
| PR 11 — DevTools | 2 |
| **Total** | **45** |

---

## 18. Final Compliance Report

| Check | Status |
|-------|--------|
| No direct ORM relationships between modules | PASS — enrichers use read-only EM, no cross-module entity imports |
| All entities filtered by organization_id | PASS — enricher context always includes organizationId |
| Zod validation for all inputs | PASS — interceptor request/response schemas, component propsSchema |
| RBAC feature gating | PASS — all extension types support `features` array |
| No raw fetch | PASS — enrichers use EM, interceptors use framework internals |
| Backward compatible with existing injection system | PASS — all existing APIs preserved, new features additive |
| Auto-discovery via CLI generator | PASS — new files follow existing `yarn generate` pattern |
| i18n for user-facing strings | PASS — all labels use i18n keys |
| No hardcoded strings | PASS — labels, messages, descriptions all use locale references |

---

## 22. Appendix A — Insights from Code Analysis

This section captures critical implementation details learned from deep-diving into the actual codebase, particularly the record-locking widget (PR #635) and the core injection infrastructure.

### A.1 Current Runtime Architecture (How It Actually Works)

The widget injection system is built on three layers:

**Layer 1 — Type System** (`packages/shared/src/modules/widgets/injection.ts`):
- `WidgetInjectionEventHandlers<TContext, TData>` — generic event handler contract
- `WidgetBeforeSaveResult` — union type: `boolean | void | { ok, message, fieldErrors, requestHeaders, details }`
- `ModuleInjectionTable` — `Record<InjectionSpotId, ModuleInjectionSlot | ModuleInjectionSlot[]>`
- `InjectionWidgetPlacement` — rendering hints: `kind: 'tab' | 'group' | 'stack'`, `column: 1 | 2`

**Layer 2 — Loading & Registration** (`packages/shared/src/modules/widgets/injection-loader.ts`):
- Uses `globalThis` keys (`__openMercatoCoreInjectionWidgetEntries__`, `__openMercatoCoreInjectionTables__`) to survive HMR in development
- Widget modules loaded lazily via `entry.loader()` and cached in a `Map<string, Promise<LoadedWidgetModule>>`
- Wildcard matching via regex: `candidateSpotId.replace(/\*/g, '.*')` converted to `RegExp`
- Deduplication by `moduleId:widgetId` key — highest priority wins when same widget registered for both exact and wildcard
- Sorting: `(b.priority ?? 0) - (a.priority ?? 0)` — higher priority = runs first

**Layer 3 — UI Runtime** (`packages/ui/src/backend/injection/`):
- `InjectionSpot` component: renders widget React components, triggers `onLoad` on mount
- `useInjectionSpotEvents` hook: imperative event triggering, normalizes `WidgetBeforeSaveResult` to consistent `{ ok, message, fieldErrors, requestHeaders, details }`
- `useGuardedMutation` hook: wraps any mutation with `onBeforeSave` → `operation()` → `onAfterSave`, manages scoped headers and retry
- Delete events **fallback to save handlers**: if `onBeforeDelete` isn't defined, `onBeforeSave` is called instead (same for `onDelete`→`onSave`, `onAfterDelete`→`onAfterSave`)

### A.2 Scoped Request Headers — The Critical Bridge Pattern

The `withScopedApiRequestHeaders(headers, operation)` function in `packages/ui/src/backend/utils/apiCall.ts` is the key mechanism that bridges client-side widgets to server-side API routes. This is how record-locking works:

1. Widget's `onBeforeSave` returns `{ ok: true, requestHeaders: { 'x-om-record-lock-token': '...' } }`
2. `useGuardedMutation.runMutation()` wraps the mutation `operation()` in `withScopedApiRequestHeaders(requestHeaders, operation)`
3. The scoped header stack pushes headers before the operation and pops after
4. All `apiCall()` invocations within the operation automatically include the scoped headers
5. Server-side `crudMutationGuardService` reads these headers to validate the lock token

**Implication for UMES**: This pattern should be the standard way for any extension to pass context from client to server. The `requestHeaders` return from `onBeforeSave` is already a general-purpose extension mechanism.

### A.3 Record-Locking Widget — Lessons for Extension System Design

The record-locking widget (`packages/enterprise/src/modules/record_locks/widgets/injection/`) is the most complex widget in the codebase (1400+ lines client component) and reveals patterns that the UMES should formalize:

**Pattern 1: Primary Instance Election**
Multiple widget instances can mount for the same record (e.g., on detail page + in dialog). Record-locking uses a global `Map` (`GLOBAL_RECORD_LOCK_OWNERS_KEY`) to elect a primary instance — only the primary makes API calls. UMES should provide a built-in `usePrimaryInstance(key)` hook.

**Pattern 2: Client-Side State Store**
The `clientLockStore.ts` implements a pub/sub store (`getState`, `setState`, `subscribe`) shared between widget.ts event handlers and widget.client.tsx React component. This pattern should be standardized as `createWidgetStore<TState>()` in the injection framework.

**Pattern 3: Backend Mutation Error Channel**
Widget uses `window.dispatchEvent(new CustomEvent(BACKEND_MUTATION_ERROR_EVENT, { detail }))` to propagate save errors to the conflict dialog. The error payload is extracted via BFS search through nested error properties. UMES should formalize this error channel with typed events.

**Pattern 4: Beacon-Based Cleanup**
Lock release on page unload uses `navigator.sendBeacon()` with `keepalive` fallback — critical for resource cleanup. UMES should document this pattern and potentially provide a `useWidgetCleanup(callback)` hook.

**Pattern 5: Portal Rendering**
The lock banner renders via `createPortal()` to `#om-top-banners` — a DOM element outside the widget's position in the React tree. UMES should define standard portal targets.

### A.4 Command Bus Integration Point

The command bus (`packages/shared/src/lib/commands/command-bus.ts`) executes commands through a pipeline:
1. `prepare()` → capture before state
2. `execute()` → perform mutation
3. `captureAfter()` → capture after state
4. `buildLog()` → audit metadata
5. Persist to ActionLog
6. Cache invalidation via tags
7. ORM flush

**API interceptors** (Phase 4) should hook into the command bus pipeline rather than at the HTTP route level. This ensures interceptors work for both API calls and internal command invocations (e.g., workflow steps).

### A.5 CRUD Factory Hook Points

The CRUD factory (`packages/shared/src/lib/crud/factory.ts`) already has hooks:
```typescript
CrudHooks = {
  beforeList, afterList,
  beforeCreate, afterCreate,
  beforeUpdate, afterUpdate,
  beforeDelete, afterDelete,
}
```

Plus the mutation guard integration:
```typescript
validateCrudMutationGuard(container, { resourceKind, resourceId, operation, requestHeaders, mutationPayload })
runCrudMutationGuardAfterSuccess(container, { ... })
```

**API interceptors should compose with these existing hooks**, not replace them. The interceptor `before` hook runs before `validateCrudMutationGuard`, and the interceptor `after` hook runs after the response is built but before enrichers.

### A.6 Event System Coexistence

The event system (`packages/events/src/bus.ts`) provides:
- **Ephemeral subscribers**: immediate in-process delivery (cache invalidation, query index)
- **Persistent subscribers**: async queue delivery with retry (notifications, search indexing)
- **Pattern matching**: wildcard event patterns (`customers.*`)

**UMES interceptors should NOT duplicate event subscriber functionality.** The distinction:
- Interceptors are **synchronous** (block the request/response cycle)
- Subscribers are **asynchronous** (fire-and-forget after mutation)
- Interceptors can **modify** the request/response
- Subscribers only **react** to completed events

### A.7 Bootstrap Registration Sequence

Current bootstrap order (from `packages/core/src/bootstrap.ts`):
1. Cache service
2. Event bus + global reference (`globalThis.__openMercatoGlobalEventBus__`)
3. Subscriber registration
4. Encryption service
5. Rate limiter
6. Search module

Widget injection registration happens separately in `registerWidgetsAndOptionalPackages()`:
1. Dynamic import `@open-mercato/ui/backend/injection/widgetRegistry`
2. `registerInjectionWidgets(entries)` — UI-side registry
3. Dynamic import `@open-mercato/core/modules/widgets/lib/injection`
4. `registerCoreInjectionWidgets(entries)` — shared-side registry
5. `registerCoreInjectionTables(tables)` — injection table mappings

**New UMES registries** (enrichers, interceptors, component overrides) should follow this same pattern: generated files → bootstrap registration → `globalThis` for HMR.

### A.8 Generated File Pattern

All auto-discovered files are generated into `apps/mercato/.mercato/generated/`:
- `injection-widgets.generated.ts` — widget entry loaders
- `injection-tables.generated.ts` — all injection table mappings

Each entry has a `loader: () => import(...)` function for lazy loading. New UMES files (`enrichers.generated.ts`, `interceptors.generated.ts`, `component-overrides.generated.ts`) should follow the identical pattern.

### A.9 DataTable Current Injection Points

From actual code analysis, DataTable already supports:
- `data-table:<tableId>:header` — via `<InjectionSpot>` above the table
- `data-table:<tableId>:footer` — via `<InjectionSpot>` below the table
- But **no column, row action, filter, or bulk action injection** — these are the gaps Phase 5 fills

CrudForm already supports:
- `crud-form:<entityId>` — widget rendering in form body (groups, tabs, stacks)
- `backend:record:current` — mutation-level hooks
- `crud-form:*` — wildcard for all forms
- But **no field-level injection, no per-group injection, no field-adjacent slots** — Phase 1 and 5 address this

### A.10 CrudForm Save Flow (Actual Code Path)

From `CrudForm.tsx` lines 1100-1332, the exact save flow:

```
1. handleSubmit()
2. Flush active element blur (await sleep(10))
3. Required field validation (iterate fields, check values)
4. Custom field validation (CE definitions, required checks)
5. Schema validation (Zod parse, collect field errors)
6. If errors → setErrors(), return
7. triggerEvent('onBeforeSave', values, injectionContext)
   ├─ If !ok → raiseCrudError(message), return
   ├─ If fieldErrors → merge with form errors, return
   └─ If requestHeaders → saved for step 8
8. withScopedApiRequestHeaders(requestHeaders, async () => {
     await onSubmit(parsedValues)
   })
9. triggerEvent('onAfterSave', values, injectionContext)
10. Success flash + redirect
```

**Key insight**: `onBeforeSave` runs AFTER client-side Zod validation but BEFORE the API call. This means widget validators can assume the form data passes schema validation.

---

## 23. Appendix B — Competitive Analysis Summary

| Platform | Strengths to Adopt | Weaknesses to Avoid |
|----------|-------------------|---------------------|
| **WordPress** | Actions vs Filters distinction; priority system; recursive hooks (`do_action` inside plugins); `remove_action` API | Global mutable state; no type safety; no lazy loading |
| **Shopify** | Extension targets (typed string IDs); constrained component set; sandboxed execution; merchant-configurable | Overly restrictive (64KB limit); no cross-extension communication; tied to Shopify infrastructure |
| **VSCode** | Contribution points (declarative); activation events (lazy); Extension Host (isolated process); extensions can extend extensions | Complex activation model; process isolation overhead; large API surface |
| **GraphQL Federation** | `@key` + `@extends` for data composition; subgraph independence; automated type merging | Gateway complexity; debugging distributed queries; versioning challenges |
| **Browser Extensions** | Content scripts inject into ANY page; isolated worlds; pattern-based targeting; `chrome.runtime.sendMessage` | No component-level granularity; security risks from full DOM access; performance impact |

**Key patterns adopted by UMES:**
1. **Actions vs Transformers** (WordPress) → `onBeforeSave` (action) vs `transformFormData` (transformer)
2. **Typed Extension Targets** (Shopify) → Standardized spot ID taxonomy
3. **Lazy Activation** (VSCode) → Existing `loader()` pattern in injection-loader.ts
4. **Data Federation** (GraphQL) → Response enrichers
5. **Pattern Matching** (Browser) → Wildcard spot IDs (`crud-form:*`)
6. **Priority System** (WordPress) → Existing priority in injection tables
7. **Removal API** (WordPress) → Component override with `propsTransform: () => null` for conditional hiding

---

## 24. Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft — complete spec with 6 phases, appendices with code analysis and competitive analysis |
| 2026-02-24 | Backward compatibility review: resolved 4 medium-severity concerns — added dual-mode event dispatch (§4.5), enricher ordering guarantee (§6.3), interceptor execution order with re-validation (§7.3), headless widget loader (§8.7); updated event flow (§10.3) |
| 2026-02-24 | Added: Phase 7 — Detail Page Bindings (§10) with `useExtensibleDetail` hook, `<InjectedField>` component, `runSectionSave` pattern, and concrete customer/sales document migration examples |
| 2026-02-24 | Added: Complete data lifecycle for field injection (§8.5) — enricher loads, field widget renders, onSave persists through module's own API (the "triad pattern") |
| 2026-02-24 | Added: DataTable batch data loading via `enrichMany` (§8.1) — zero N+1, one query per enricher for all rows |
| 2026-02-24 | Added: Typed positioning via `InjectionPosition` enum + `InjectionPlacement` interface (§8.0) — replaces error-prone string literals |
| 2026-02-24 | Added: Two-tier filter architecture (§8.4) — server-side via API interceptor query rewriting for cross-module filtering, client-side for enriched data |
| 2026-02-24 | Added: `query` field to `InterceptorBeforeResult` for GET interceptors |
| 2026-02-24 | Added: End-to-end shipment field injection example (§8.6) — carrier_integration adds "Special Instructions" + "Handling Code" to ShipmentDialog without touching sales module |
| 2026-02-24 | Added: Tier 3 post-query merge filter (§8.4) — interceptor `after` hook filters/merges results when API can't accept ID rewrites; `replace` + `metadata` fields on interceptor types |
| 2026-02-24 | Added: Application chrome injection (§4.3) — `InjectionMenuItemWidget` type, profile menu/topbar/sidebar nav slots, SSO and carrier integration examples, ProfileDropdown implementation guide |
| 2026-02-24 | Added reference to SPEC-043 (Reactive Notification Handlers) — extends UMES with `notification:<type>:handler` extension points for client-side reactive effects (toasts, popups, state refreshes) triggered on notification arrival, eliminating module-specific polling loops |
| 2026-02-24 | Added: §19 DOM Event Bridge, §20 AGENTS.md Changes Required, §21 PR Delivery Plan with phased implementation, example module usage for every mechanism, expanded integration tests |

---

## 19. DOM Event Bridge — Widget ↔ App Event Unification

### 19.1 Current State: Ad-Hoc DOM Events

The codebase already uses `om:` prefixed DOM events for widget communication, but they are **ad-hoc** — each feature invents its own:

| Event | Origin | Purpose |
|-------|--------|---------|
| `om:backend-mutation-error` | `packages/ui/src/backend/injection/mutationEvents.ts` | CrudForm/GuardedMutation → widgets (save error channel) |
| `om:crud-save-error` | `packages/ui/src/backend/CrudForm.tsx` | CrudForm → widgets (duplicate error channel) |
| `om:refresh-sidebar` | `packages/ui/src/backend/AppShell.tsx` | Internal → sidebar (trigger nav refresh) |
| `om:record-lock-owner-changed` | `packages/enterprise/.../record-locking/widget.client.tsx` | Widget → widget (instance election) |

**Problem**: Module events (from `events.ts` — e.g., `example.todo.created`) are **server-side only**. They flow through the event bus, into persistent/ephemeral subscribers, but **never reach the browser**. A widget injected into a customer detail page cannot know that a todo was just created — it must poll the API or use a manual refresh button.

### 19.2 The DOM Event Bridge

Introduce a **unidirectional bridge** that emits every app event as a DOM `CustomEvent` on the client side. This gives widgets instant notification of any app event without polling.

#### Architecture

```
Server-side event bus                         Browser
─────────────────────                         ───────

example.todo.created ──► event bus
  │                        │
  ├── subscribers/*.ts     │ (existing)
  │                        │
  └── SSE/WebSocket ──────►│ DOM Event Bridge
      push to client       │
                           ▼
                    window.dispatchEvent(
                      new CustomEvent(
                        'om:event',
                        { detail: {
                          id: 'example.todo.created',
                          payload: { ... },
                          timestamp: ...,
                        }}
                      )
                    )
                           │
                    ┌──────┴──────────┐
                    │  Any widget or  │
                    │  component can  │
                    │  addEventListener│
                    └─────────────────┘
```

#### Transport Layer

The bridge uses the **existing notification SSE channel** (`/api/auth/notifications/stream`). Instead of creating a new transport, extend the notification stream to include app events:

```typescript
// packages/core/src/modules/auth/api/notifications/stream.ts
// Existing SSE endpoint — extended to include app events

// Current: sends notification payloads
// NEW: also sends event payloads when the event is flagged as `clientBroadcast: true`
```

**Not all events are bridged.** Only events declared with `clientBroadcast: true` in `events.ts` are pushed to the client. This prevents flooding the browser with high-frequency internal events (search reindex, cache invalidation).

#### Event Declaration Extension

```typescript
// In module's events.ts
const events = [
  {
    id: 'example.todo.created',
    label: 'Todo Created',
    entity: 'todo',
    category: 'crud',
    clientBroadcast: true,  // NEW: bridge this event to the browser
  },
  {
    id: 'example.todo.updated',
    label: 'Todo Updated',
    entity: 'todo',
    category: 'crud',
    clientBroadcast: true,
  },
] as const
```

#### Client-Side Reception

```typescript
// packages/ui/src/backend/injection/useAppEvent.ts

/**
 * Subscribe to app events in any widget or component.
 * Events arrive via the notification SSE channel.
 */
function useAppEvent(
  eventPattern: string,           // e.g., 'example.todo.created', 'example.todo.*', '*'
  handler: (payload: AppEventPayload) => void,
  deps?: unknown[],
): void {
  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<AppEventPayload>).detail
      if (matchesPattern(eventPattern, detail.id)) {
        handler(detail)
      }
    }
    window.addEventListener('om:event', listener)
    return () => window.removeEventListener('om:event', listener)
  }, [eventPattern, ...(deps ?? [])])
}

interface AppEventPayload {
  id: string                      // Event ID (e.g., 'example.todo.created')
  payload: Record<string, unknown>// Event-specific data
  timestamp: number               // Server-side emission time
  organizationId: string          // Scoped to current org
}
```

#### Wildcard Matching

Uses the same pattern matching as the server-side event bus:

```typescript
function matchesPattern(pattern: string, eventId: string): boolean {
  if (pattern === '*') return true
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  return regex.test(eventId)
}
```

### 19.3 Widget Event Handler: `onAppEvent`

Widgets can declare an `onAppEvent` handler alongside existing lifecycle handlers:

```typescript
// In widget.ts
export default {
  metadata: { id: 'example.injection.sales-todos', ... },
  Widget: SalesTodosWidget,
  eventHandlers: {
    onLoad: async (context) => { /* ... */ },
    onBeforeSave: async (data, context) => { /* ... */ },

    // NEW: React to app events
    onAppEvent: async (event: AppEventPayload, context) => {
      if (event.id === 'example.todo.created' || event.id === 'example.todo.updated') {
        // Refresh the widget's data
        context.refresh?.()
      }
    },
  },
} satisfies InjectionWidgetModule
```

The `InjectionSpot` component subscribes to `om:event` and dispatches `onAppEvent` to all mounted widgets, filtering by the widget's declared interest pattern.

### 19.4 Existing om: Events — Unified Under the Bridge

The existing ad-hoc events are preserved but **also emitted through the bridge** for consistency:

| Existing Event | Bridge Event ID | Change |
|---------------|----------------|--------|
| `om:backend-mutation-error` | `om.mutation.error` | Aliased (both fire) |
| `om:crud-save-error` | `om.crud.save-error` | Aliased (both fire) |
| `om:refresh-sidebar` | `om.ui.sidebar-refresh` | Aliased (both fire) |

New code should use the `useAppEvent` hook; existing code continues to work via the `om:` DOM events.

### 19.5 Performance & Security

- **Scoping**: Events are only bridged to clients within the same `organizationId`. The SSE channel is already org-scoped.
- **Payload size**: Event payloads pushed to the client are limited to 4KB. Larger payloads send only `{ id, entityId, entityType }` — the widget fetches the full data via API.
- **Deduplication**: The bridge includes a 500ms deduplication window for identical event IDs (prevents rapid fire from bulk operations).
- **Opt-in**: Modules must explicitly set `clientBroadcast: true`. Default is `false` — zero behavior change for existing modules.

### 19.6 Example Module: Widget Reacting to App Events

The `example.injection.sales-todos` widget on the sales order detail page auto-refreshes when a todo is created/updated:

```typescript
// example/widgets/injection/sales-todos/widget.client.tsx
"use client"
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

export default function SalesTodosWidget({ context, data }: WidgetProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  // Auto-refresh when any todo event fires
  useAppEvent('example.todo.*', (event) => {
    setRefreshKey(k => k + 1)
  })

  useEffect(() => {
    loadTodos(context.record?.id).then(setTodos)
  }, [context.record?.id, refreshKey])

  return <TodoList todos={todos} />
}
```

**Before UMES**: Widget needs a manual "Refresh" button or polls every 5 seconds.
**After UMES**: Widget updates instantly when any todo event fires — zero polling, zero manual refresh.

---

## 20. AGENTS.md Changes Required for UMES

This section specifies **exactly what must change** in each AGENTS.md file to make UMES a first-class documented pattern that LLMs and developers can follow.

### 20.1 Root `AGENTS.md` — Task Router Additions

**Add rows to the Task Router table:**

```markdown
| Adding response enrichers to another module's API, data federation | `packages/core/AGENTS.md` → Response Enrichers |
| Adding API interceptors (before/after hooks on routes), cross-module validation | `packages/core/AGENTS.md` → API Interceptors |
| Replacing or wrapping another module's UI component | `packages/core/AGENTS.md` → Component Replacement |
| Injecting columns, row actions, bulk actions into another module's DataTable | `packages/ui/AGENTS.md` → DataTable Extension Injection |
| Injecting fields into another module's CrudForm groups | `packages/ui/AGENTS.md` → CrudForm Field Injection |
| Adding menu items to sidebar, profile dropdown, topbar, settings nav | `packages/core/AGENTS.md` → Menu Item Injection |
| Bridging server events to client-side widgets, using `useAppEvent` | `packages/events/AGENTS.md` → DOM Event Bridge |
| Using `useExtensibleDetail` for detail page extensions | `packages/ui/src/backend/AGENTS.md` → Extensible Detail Pages |
```

**Add to the "Optional Module Files" table:**

```markdown
| `data/enrichers.ts` | `enrichers` | Response enrichers for other modules' entities |
| `api/interceptors.ts` | `interceptors` | API route interceptors (before/after hooks) |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper declarations |
```

**Add to the "When You Need an Import" table:**

```markdown
| Response enricher types | `import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'` |
| API interceptor types | `import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'` |
| Injection position enum | `import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'` |
| App event hook | `import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'` |
| Extensible detail hook | `import { useExtensibleDetail } from '@open-mercato/ui/backend/injection/useExtensibleDetail'` |
| Injected menu items hook | `import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'` |
```

**Add to "Key Rules":**

```markdown
- Response enrichers MUST implement `enrichMany` for list endpoints (N+1 prevention)
- Response enrichers MUST NOT modify or remove existing fields (additive only)
- API interceptors that modify request body MUST return data that passes the route's Zod schema
- Injected columns read data from response enrichers — pair every column injection with an enricher
- `clientBroadcast: true` on events enables the DOM Event Bridge — use for events widgets need to react to
```

**Add to "Critical Rules → Architecture":**

```markdown
- **NO direct entity import from another module's enricher** — enrichers access data via EntityManager, not by importing entities
- Response enrichers run AFTER `CrudHooks.afterList` — they do not change what existing hooks receive
- API interceptor `before` hooks run AFTER Zod validation; modified body is re-validated through Zod
- Component replacements MUST maintain the original component's props contract (enforced via `propsSchema`)
```

### 20.2 `packages/core/AGENTS.md` — New Sections

**Add section: "Response Enrichers"**

```markdown
## Response Enrichers

Enrichers add data to another module's API responses without modifying core code (GraphQL Federation-style `@extends`).

### File Convention

`src/modules/<module>/data/enrichers.ts` — export `enrichers: ResponseEnricher[]`

### MUST Rules

- MUST implement `enrichMany` for list endpoints (batch-fetch, no N+1)
- MUST NOT modify or remove existing fields — additive only
- MUST NOT perform writes — enricher EntityManager is read-only
- MUST filter by `ctx.organizationId` (tenant isolation)
- MUST prefix enriched fields with `_<module>` namespace (e.g., `_loyalty.tier`)
- Run `npm run modules:prepare` after adding enrichers

### Template

\`\`\`typescript
// src/modules/<module>/data/enrichers.ts
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

export const enrichers: ResponseEnricher[] = [
  {
    id: '<module>.<enricher-name>',
    targetEntity: '<target-module>.<entity>',
    features: ['<module>.view'],
    priority: 50,

    async enrichOne(record, ctx) {
      const related = await ctx.em.findOne(MyEntity, {
        foreignId: record.id,
        organizationId: ctx.organizationId,
      })
      return { ...record, _<module>: { field: related?.value ?? null } }
    },

    async enrichMany(records, ctx) {
      const ids = records.map(r => r.id)
      const all = await ctx.em.find(MyEntity, {
        foreignId: { $in: ids },
        organizationId: ctx.organizationId,
      })
      const map = new Map(all.map(e => [e.foreignId, e]))
      return records.map(r => ({
        ...r,
        _<module>: { field: map.get(r.id)?.value ?? null },
      }))
    },
  },
]
\`\`\`

### Execution Order in CRUD Factory

1. Core query (existing)
2. `CrudHooks.afterList` (existing — receives raw results)
3. **Enrichers run** (NEW — receive post-hook results, add fields)
4. Return HTTP response

### Caching (Optional)

\`\`\`typescript
{
  cache: {
    strategy: 'read-through',
    ttl: 60,
    tags: ['<module>', '<target-entity>'],
    invalidateOn: ['<module>.<entity>.updated'],
  },
}
\`\`\`
```

**Add section: "API Interceptors"**

```markdown
## API Interceptors

Interceptors hook into other modules' API routes — validate, transform, or augment requests and responses.

### File Convention

`src/modules/<module>/api/interceptors.ts` — export `interceptors: ApiInterceptor[]`

### MUST Rules

- `before` hooks MUST NOT bypass Zod validation — modified body is re-validated
- `before` hooks that reject MUST include a descriptive `message` and appropriate `statusCode`
- `after` hooks MUST NOT remove existing response fields (additive `merge` or full `replace`)
- Use `metadata` to pass data between `before` and `after` hooks
- Run `npm run modules:prepare` after adding interceptors

### Execution Order in CRUD Mutation Pipeline

1. Zod schema validation (existing)
2. **API interceptor `before` hooks** (NEW)
3. CrudHooks.beforeCreate/Update/Delete (existing)
4. validateCrudMutationGuard (existing)
5. Entity mutation + ORM flush (existing)
6. CrudHooks.afterCreate/Update/Delete (existing)
7. runCrudMutationGuardAfterSuccess (existing)
8. **API interceptor `after` hooks** (NEW)
9. Response enrichers (Phase 3)
10. Return HTTP response

### When to Use What

| Concern | Use | NOT |
|---------|-----|-----|
| Block/validate from UI | Widget `onBeforeSave` | Interceptor |
| Block/validate from API | API interceptor `before` | Widget handler |
| Add data to response | Response enricher | Interceptor `after` |
| React to completed mutation | Event subscriber | Interceptor `after` |
| Transform request before processing | Interceptor `before` | Subscriber |

### Template

\`\`\`typescript
// src/modules/<module>/api/interceptors.ts
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

export const interceptors: ApiInterceptor[] = [
  {
    id: '<module>.validate-<action>',
    targetRoute: '<target-module>/<entity>',
    methods: ['POST', 'PUT'],
    features: ['<module>.manage'],
    priority: 100,

    async before(request, ctx) {
      const violations = await validate(request.body, ctx)
      if (violations.length > 0) {
        return { ok: false, message: violations.join(', '), statusCode: 422 }
      }
      return { ok: true }
    },
  },
]
\`\`\`
```

**Add section: "Component Replacement"**

```markdown
## Component Replacement

Replace or wrap another module's UI component without forking.

### File Convention

`src/modules/<module>/widgets/components.ts` — export `componentOverrides: ComponentOverride[]`

### Modes

| Mode | Use Case | Risk |
|------|----------|------|
| **Replace** | Complete swap (new UI, new behavior) | High — must maintain props contract |
| **Wrapper** | Decorate (add behavior around existing) | Low — original preserved |
| **Props Override** | Modify props passed to existing | Low — original preserved |

### Template

\`\`\`typescript
// src/modules/<module>/widgets/components.ts
export const componentOverrides: ComponentOverride[] = [
  {
    target: { componentId: '<target-module>.<component-id>' },
    replacement: lazy(() => import('./components/MyReplacement')),
    priority: 100,
    features: ['<module>.view'],
  },
]
\`\`\`

### Usage in Core (Making a Component Replaceable)

\`\`\`typescript
// In the component that should be replaceable
const ShipmentDialog = useRegisteredComponent<ShipmentDialogProps>(
  'sales.order.shipment-dialog'
)
\`\`\`
```

**Add section: "Menu Item Injection"**

```markdown
## Menu Item Injection

Add items to any application menu surface (sidebar, profile dropdown, settings nav, topbar actions).

### Menu Surface IDs

| Surface | ID |
|---------|-------|
| Main sidebar | `menu:sidebar:main` |
| Settings sidebar | `menu:sidebar:settings` |
| Profile sidebar | `menu:sidebar:profile` |
| Profile dropdown | `menu:topbar:profile-dropdown` |
| Topbar actions | `menu:topbar:actions` |
| Specific sidebar group | `menu:sidebar:main:<groupId>` |
| Specific settings section | `menu:sidebar:settings:<sectionId>` |

### File Convention

Declare in `widgets/injection-table.ts` with a headless `InjectionMenuItemWidget` in `widgets/injection/`.

### Template

\`\`\`typescript
// widgets/injection/menus/widget.ts
export default {
  metadata: { id: '<module>.injection.menus', features: ['<module>.view'] },
  menuItems: [
    {
      id: '<item-id>',
      label: '<module>.menu.<item>',
      icon: 'IconName',
      href: '/backend/<path>',
      groupId: '<group>',
      groupLabel: '<group label>',
      placement: { position: InjectionPosition.Last },
    },
  ],
} satisfies InjectionMenuItemWidget
\`\`\`
```

**Add section: "DOM Event Bridge"**

```markdown
## DOM Event Bridge

Bridge server-side events to client-side widgets for instant reaction (no polling).

### Enabling

In `events.ts`, add `clientBroadcast: true` to events that widgets need:

\`\`\`typescript
{ id: 'example.todo.created', label: 'Todo Created', clientBroadcast: true, ... }
\`\`\`

### Subscribing in Widgets

\`\`\`typescript
// In widget.client.tsx
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

useAppEvent('example.todo.*', (event) => {
  // event.id, event.payload, event.timestamp
  refreshData()
})
\`\`\`

### In Widget Event Handlers

\`\`\`typescript
// In widget.ts
eventHandlers: {
  onAppEvent: async (event, context) => {
    if (event.id === 'example.todo.created') {
      context.refresh?.()
    }
  },
}
\`\`\`

### Rules

- Only events with `clientBroadcast: true` reach the browser
- Payload limit: 4KB; larger payloads send entity reference only
- Deduplication: 500ms window for identical event IDs
- Scoped to current `organizationId`
```

### 20.3 `packages/ui/AGENTS.md` — New Sections

**Add section: "DataTable Extension Injection"**

```markdown
## DataTable Extension Injection

Inject columns, row actions, bulk actions, and filters into another module's DataTable.

### Injection Spot IDs

| Spot ID | Widget Type |
|---------|-------------|
| `data-table:<tableId>:columns` | `InjectionColumnWidget` |
| `data-table:<tableId>:row-actions` | `InjectionRowActionWidget` |
| `data-table:<tableId>:bulk-actions` | `InjectionBulkActionWidget` |
| `data-table:<tableId>:filters` | `InjectionFilterWidget` |

### MUST Rules

- Injected columns MUST pair with a response enricher (Phase 3) for data
- Injected columns use `accessorKey` dot-path to read enriched data (e.g., `_loyalty.points`)
- Injected row actions MUST have stable `id` values
- Injected filters with `strategy: 'server'` MUST pair with an API interceptor
- Use `InjectionPosition` for column/action ordering

### Column Injection Template

\`\`\`typescript
export default {
  metadata: { id: '<module>.injection.<table>-columns', features: ['<module>.view'] },
  columns: [
    {
      id: '<columnId>',
      header: '<module>.column.<name>',
      accessorKey: '_<module>.<field>',
      cell: ({ getValue }) => <Badge>{getValue()}</Badge>,
      size: 100,
      sortable: false,
      placement: { position: InjectionPosition.After, relativeTo: '<existing-column>' },
    },
  ],
} satisfies InjectionColumnWidget
\`\`\`
```

**Add section: "CrudForm Field Injection"**

```markdown
## CrudForm Field Injection

Inject fields into another module's CrudForm groups — the "Triad Pattern": Enricher loads → Field renders → onSave persists.

### Injection Spot ID

`crud-form:<entityId>:fields` — targets the CrudForm's field groups

### The Triad Pattern

1. **Response Enricher** (`data/enrichers.ts`): adds data to API response under `_<module>` namespace
2. **Field Widget** (`widgets/injection/`): renders field in target form group using enriched data
3. **onSave Handler**: saves field value via module's own API (NOT via core API)

### MUST Rules

- Injected field IDs MUST use dot-path matching the enricher namespace (e.g., `_loyalty.tier`)
- Injected fields MUST specify `group` (existing form group ID) and `placement`
- Core API never sees injected field values — each widget saves its own data
- Use `onBeforeSave` for validation of injected fields

### Template

\`\`\`typescript
export default {
  metadata: { id: '<module>.injection.<form>-fields', features: ['<module>.manage'] },
  fields: [
    {
      id: '_<module>.<field>',
      label: '<module>.field.<name>',
      type: 'select',
      options: [...],
      group: '<existing-group-id>',
      placement: { position: InjectionPosition.After, relativeTo: '<existing-field>' },
    },
  ],
  eventHandlers: {
    onSave: async (data, context) => {
      const value = data['_<module>.<field>']
      await apiCallOrThrow('/api/<module>/<endpoint>', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    },
  },
} satisfies InjectionFieldWidget
\`\`\`
```

### 20.4 `packages/ui/src/backend/AGENTS.md` — New Section

**Add section: "Extensible Detail Pages"**

```markdown
## Extensible Detail Pages

For hand-built detail pages (customer, sales document), use `useExtensibleDetail` to bind UMES features.

### Usage

\`\`\`typescript
const ext = useExtensibleDetail({
  entityId: 'customers.person',
  data,
  setData,
  injectionContext,
  guardedMutation,
})

// Injected tabs
const allTabs = [...builtInTabs, ...ext.injectedTabs]

// Injected fields in a section
ext.getFieldsForSection('details').map(field => <InjectedField ... />)

// Injected columns in embedded DataTable
ext.getColumnsForTable('customers.person.deals')

// Component replacement
const Dialog = ext.getComponent<DialogProps>('customers.person.merge-dialog')

// Section-level save with widget hooks
await ext.runSectionSave('details', () => apiCallOrThrow(...), sectionData)
\`\`\`

### MUST Rules

- MUST pass existing `useGuardedMutation` instance (not create a new one)
- MUST pass existing `injectionContext` (not rebuild)
- Use `runSectionSave` for all mutation operations to trigger widget lifecycle
```

### 20.5 `packages/events/AGENTS.md` — New Section

**Add section: "DOM Event Bridge"**

```markdown
## DOM Event Bridge

Server-side events can be bridged to client-side widgets for instant UI updates.

### Declaring Bridged Events

In `events.ts`, add `clientBroadcast: true`:

\`\`\`typescript
{ id: 'module.entity.action', clientBroadcast: true, ... }
\`\`\`

### MUST Rules

- Only events with `clientBroadcast: true` are bridged — default is `false`
- Keep payload under 4KB for bridged events; send entity references for larger data
- Bridged events are org-scoped (only received by clients in the same organization)
- Use `useAppEvent(pattern, handler)` to subscribe in components/widgets
- Deduplication window: 500ms — rapid-fire events from bulk ops are coalesced
```

### 20.6 `.ai/qa/AGENTS.md` — New Section

**Add section: "Testing UMES Extension Points"**

```markdown
## Testing UMES Extension Points

Integration tests for UMES features should verify cross-module extension behavior.

### Patterns

1. **Extension activation**: Verify widget/enricher/interceptor activates when feature is enabled
2. **ACL filtering**: Verify extension is hidden when user lacks required feature
3. **Priority ordering**: When multiple extensions target the same point, verify correct ordering
4. **Data lifecycle**: For field injection, verify load → render → edit → save → persist cycle
5. **Error handling**: Verify interceptor rejection returns proper error message/code

### Test Structure

\`\`\`typescript
test('response enricher adds loyalty data to customer response', async ({ request }) => {
  // 1. Create fixture (customer via API)
  // 2. Call GET /api/customers/people/:id
  // 3. Assert response includes _loyalty namespace
  // 4. Clean up fixture
})

test('API interceptor rejects invalid mutation', async ({ request }) => {
  // 1. Create fixture
  // 2. Call POST /api/sales/orders with invalid data
  // 3. Assert 422 with interceptor message
  // 4. Clean up fixture
})

test('injected column renders in DataTable', async ({ page }) => {
  // 1. Navigate to list page
  // 2. Assert injected column header is visible
  // 3. Assert enriched data renders in column cells
})
\`\`\`
```

### 20.7 Summary: All AGENTS.md Changes

| File | Action | Sections |
|------|--------|----------|
| **Root `AGENTS.md`** | Add rows to Task Router, Optional Module Files, Import table, Key Rules, Critical Rules | 8 Task Router rows, 3 optional files, 6 imports, 5 key rules, 4 critical rules |
| **`packages/core/AGENTS.md`** | Add 5 new sections | Response Enrichers, API Interceptors, Component Replacement, Menu Item Injection, DOM Event Bridge |
| **`packages/ui/AGENTS.md`** | Add 2 new sections | DataTable Extension Injection, CrudForm Field Injection |
| **`packages/ui/src/backend/AGENTS.md`** | Add 1 new section | Extensible Detail Pages |
| **`packages/events/AGENTS.md`** | Add 1 new section | DOM Event Bridge |
| **`.ai/qa/AGENTS.md`** | Add 1 new section | Testing UMES Extension Points |

**Total**: 10 new sections across 6 files. All existing content is preserved — changes are purely additive.

---

## 21. PR Delivery Plan — Phased Implementation

Each phase is a **separate PR** that is fully testable, independently mergeable, and adds working example module demonstrations + integration tests. Phases can be developed in parallel where noted.

### PR 1: Foundation — `InjectionPosition` + Headless Widget Infrastructure

**Branch**: `feat/umes-foundation`

**Scope**:
- Create `packages/shared/src/modules/widgets/injection-position.ts` with `InjectionPosition` enum + `InjectionPlacement` interface
- Create `loadInjectionDataWidgetById` / `loadInjectionDataWidgets` in injection-loader (headless widget loading path)
- Create `useInjectionDataWidgets` hook in `packages/ui/src/backend/injection/`
- Add `InjectionColumnWidget`, `InjectionRowActionWidget`, `InjectionBulkActionWidget`, `InjectionFilterWidget`, `InjectionFieldWidget`, `InjectionMenuItemWidget` type definitions to `packages/shared/src/modules/widgets/injection.ts`
- Update `yarn generate` to discover and register headless widget types

**Example module additions**:
- `example/widgets/injection/todo-menu-items/widget.ts` — headless `InjectionMenuItemWidget` adding "Example Todos" to sidebar under the Example group

**Integration tests**:
- TC-UMES-F01: Headless menu item widget renders in sidebar navigation
- TC-UMES-F02: `InjectionPosition` enum values resolve correctly (Before, After, First, Last)

**Files touched**: ~8 new files, ~3 modified files

**Estimated scope**: Small — type definitions + loader extension + one example widget

**Depends on**: Nothing

---

### PR 2: Menu Item Injection — Application Chrome Extensibility

**Branch**: `feat/umes-menu-injection`

**Scope**:
- Create `useInjectedMenuItems(surfaceId)` hook
- Create `mergeMenuItems(builtIn, injected)` utility
- Modify `ProfileDropdown.tsx` to call `useInjectedMenuItems('menu:topbar:profile-dropdown')`
- Modify `AppShell.tsx` sidebar to call `useInjectedMenuItems('menu:sidebar:main')` and merge with `groups[]`
- Modify `SectionNav.tsx` to call `useInjectedMenuItems` for settings/profile
- Modify `layout.tsx` header to call `useInjectedMenuItems('menu:topbar:actions')`

**Example module additions**:
- `example/widgets/injection/example-menus/widget.ts` — adds "Quick Add Todo" to topbar actions area, adds "Example Dashboard" external link to sidebar
- Update `example/widgets/injection-table.ts` with menu surface mappings

**Integration tests**:
- TC-UMES-M01: Menu item injected into profile dropdown appears between existing items
- TC-UMES-M02: Sidebar group created by injected menu item appears in correct order
- TC-UMES-M03: Menu item respects ACL features (hidden when feature disabled)
- TC-UMES-M04: Menu item with `href` navigates correctly on click

**Files touched**: ~4 new files, ~5 modified files

**Estimated scope**: Medium — 4 component modifications + hook + utility

**Depends on**: PR 1

---

### PR 3: Extended Widget Event Handlers + DOM Event Bridge

**Branch**: `feat/umes-event-bridge`

**Scope**:
- Add `onFieldChange`, `onBeforeNavigate`, `onVisibilityChange`, `onAppEvent` to `WidgetInjectionEventHandlers` type
- Add `transformFormData`, `transformDisplayData`, `transformValidation` transformer events
- Implement dual-mode dispatch in `useInjectionSpotEvents` (action vs transformer pipeline)
- Add `clientBroadcast` field to event declaration type in `createModuleEvents`
- Create `useAppEvent` hook in `packages/ui/src/backend/injection/`
- Extend notification SSE channel to push `clientBroadcast: true` events
- Create `om:event` DOM event dispatching in the SSE listener

**Example module additions**:
- Update `example/events.ts` — add `clientBroadcast: true` to todo CRUD events
- Update `example/widgets/injection/sales-todos/widget.client.tsx` — use `useAppEvent('example.todo.*', ...)` for auto-refresh instead of manual refresh button
- Add `example/widgets/injection/crud-validation/widget.ts` — demonstrate `onFieldChange` handler that shows a warning when product name contains "TEST"
- Add `transformFormData` example — widget that auto-trims whitespace from text fields before save

**Integration tests**:
- TC-UMES-E01: `clientBroadcast: true` event arrives at client via SSE within 2 seconds
- TC-UMES-E02: Widget `onAppEvent` handler fires when matching event is dispatched
- TC-UMES-E03: `onFieldChange` handler receives field updates and can set side-effects
- TC-UMES-E04: `transformFormData` pipeline applies multiple widget transformations in priority order
- TC-UMES-E05: Events without `clientBroadcast: true` do NOT arrive at client
- TC-UMES-E06: `useAppEvent` wildcard pattern `example.todo.*` matches `example.todo.created`

**Files touched**: ~6 new files, ~5 modified files

**Estimated scope**: Large — SSE extension + new event types + dual dispatch

**Depends on**: PR 1 (types), independent of PR 2

---

### PR 4: Response Enrichers

**Branch**: `feat/umes-response-enrichers`

**Scope**:
- Create `packages/shared/src/lib/crud/response-enricher.ts` — types + registry
- Create `applyEnrichers(records, enrichers, ctx)` function
- Modify `makeCrudRoute` GET handler to call `applyEnrichers` after `CrudHooks.afterList`
- Update `yarn generate` to discover `data/enrichers.ts` and generate `enrichers.generated.ts`
- Add bootstrap registration for enricher registry

**Example module additions**:
- `example/data/enrichers.ts` — enricher that adds `_example.todoCount` and `_example.latestTodo` to customer person responses (fetches todo count per customer from example module's todos table)

**Integration tests**:
- TC-UMES-R01: GET single customer includes `_example.todoCount` from enricher
- TC-UMES-R02: GET customer list — `enrichMany` batches fetch (verify single query for all rows via timing/query count)
- TC-UMES-R03: Enricher respects ACL features (admin user sees enriched data, employee without feature does not)
- TC-UMES-R04: Enricher fields are `_` prefixed and additive (core fields unchanged)
- TC-UMES-R05: Enriched `_meta.enrichedBy` includes enricher ID

**Files touched**: ~5 new files, ~3 modified files (CRUD factory, generator, bootstrap)

**Estimated scope**: Medium — CRUD factory modification is the critical path

**Depends on**: Nothing (independent of PR 1-3)

---

### PR 5: API Interceptors

**Branch**: `feat/umes-api-interceptors`

**Scope**:
- Create `packages/shared/src/lib/crud/api-interceptor.ts` — types + registry
- Create `runInterceptorsBefore(request, ctx)` / `runInterceptorsAfter(request, response, ctx)` functions
- Modify `makeCrudRoute` to call interceptors at correct pipeline positions (after Zod, before hooks; after response, before enrichers)
- Implement route pattern matching with wildcards
- Implement body re-validation when interceptor modifies body
- Update `yarn generate` to discover `api/interceptors.ts`

**Example module additions**:
- `example/api/interceptors.ts`:
  1. Interceptor that logs all POST/PUT operations to todos with a console message (demonstrates `before` hook passthrough)
  2. Interceptor that rejects todo creation if title contains "BLOCKED" (demonstrates rejection)
  3. Interceptor that adds `_example.serverTimestamp` to all todo GET responses (demonstrates `after` hook merge)

**Integration tests**:
- TC-UMES-I01: Interceptor `before` rejects POST with 422 when title contains "BLOCKED"
- TC-UMES-I02: Interceptor `before` allows valid POST to proceed
- TC-UMES-I03: Interceptor `after` merges `_example.serverTimestamp` into GET response
- TC-UMES-I04: Interceptor with wildcard `example/*` matches `example/todos` and `example/tags`
- TC-UMES-I05: Interceptor `before` modifying body — modified body is re-validated through Zod
- TC-UMES-I06: `metadata` passthrough between `before` and `after` hooks works

**Files touched**: ~5 new files, ~3 modified files (CRUD factory, generator, bootstrap)

**Estimated scope**: Medium-Large — CRUD factory pipeline modification

**Depends on**: PR 4 (enrichers must exist for execution order)

---

### PR 6: DataTable Deep Extensibility (Columns, Row Actions, Bulk Actions, Filters)

**Branch**: `feat/umes-datatable-extensions`

**Scope**:
- Create `useInjectedTableExtensions(tableId)` hook
- Modify `DataTable.tsx` to merge injected columns at correct positions using `InjectionPlacement`
- Modify `RowActions` component to merge injected row actions
- Modify `FilterBar`/`FilterOverlay` to merge injected filters
- Add bulk action injection to DataTable toolbar

**Example module additions**:
- `example/widgets/injection/customer-todo-count-column/widget.ts` — injects a "Todos" column into the customers people DataTable showing `_example.todoCount` (from PR 4's enricher)
- `example/widgets/injection/customer-todo-actions/widget.ts` — injects a "View Todos" row action into the customers people DataTable
- Update `example/widgets/injection-table.ts` with new DataTable spot mappings

**Integration tests**:
- TC-UMES-D01: Injected "Todos" column appears in customers DataTable at correct position (after "Email")
- TC-UMES-D02: Injected column cell renders enriched data (`_example.todoCount`)
- TC-UMES-D03: Injected "View Todos" row action appears in row action dropdown
- TC-UMES-D04: Injected row action click navigates to correct URL
- TC-UMES-D05: Injected column respects ACL features

**Files touched**: ~4 new files, ~4 modified files (DataTable, RowActions, FilterBar, injection-table)

**Estimated scope**: Large — DataTable is a complex component

**Depends on**: PR 1 (types + headless loading), PR 4 (enrichers for column data)

---

### PR 7: CrudForm Field Injection

**Branch**: `feat/umes-crudform-fields`

**Scope**:
- Modify `CrudForm.tsx` to read `fields` from injection widgets and insert into specified groups at specified positions
- Implement `InjectedField` component in `packages/ui/src/backend/injection/`
- CrudForm populates injected field initial values from enriched response data via dot-path accessor
- Injected field values excluded from core Zod schema validation
- Widget `onSave` handlers persist injected field data through module's own API

**Example module additions**:
- `example/widgets/injection/customer-priority-field/widget.ts` — injects a "Priority" select field into the customer person edit form's "Details" group, with `onSave` that persists to example module's own table
- `example/data/entities.ts` — add `ExampleCustomerPriority` entity (FK to customer ID)
- `example/api/customer-priorities/route.ts` — CRUD endpoint for customer priorities

**Integration tests**:
- TC-UMES-CF01: Injected "Priority" field appears in customer edit form within "Details" group
- TC-UMES-CF02: Injected field loads initial value from enriched response (`_example.priority`)
- TC-UMES-CF03: Editing injected field and saving persists via example module's API
- TC-UMES-CF04: Widget `onBeforeSave` validation blocks save on invalid injected field value
- TC-UMES-CF05: Core customer fields are unchanged (injected field data not sent to customer API)

**Files touched**: ~5 new files, ~2 modified files (CrudForm, injection system)

**Estimated scope**: Large — CrudForm modification is delicate

**Depends on**: PR 1 (types), PR 4 (enrichers for loading data)

---

### PR 8: Component Replacement

**Branch**: `feat/umes-component-replacement`

**Scope**:
- Create `packages/shared/src/modules/widgets/component-registry.ts` — registry + `registerComponent` / `replaceComponent`
- Create `useRegisteredComponent(componentId)` hook
- Create `ComponentOverrideProvider` context provider
- Update `yarn generate` to discover `widgets/components.ts`
- Wrap app shell in `ComponentOverrideProvider`

**Example module additions**:
- `example/widgets/components.ts` — register a wrapper around the todo edit dialog that adds a "Quick Notes" panel below the form (demonstrates wrapper mode)
- Core: register the todo create/edit dialog as replaceable (in example module itself, since this is a demo)

**Integration tests**:
- TC-UMES-CR01: Replaced component renders instead of original
- TC-UMES-CR02: Wrapper mode renders original component with extra content
- TC-UMES-CR03: Component replacement respects ACL features
- TC-UMES-CR04: Highest priority replacement wins when multiple exist

**Files touched**: ~5 new files, ~3 modified files (generator, bootstrap, app shell)

**Estimated scope**: Medium

**Depends on**: PR 1 (types)

---

### PR 9: Detail Page Bindings (`useExtensibleDetail`)

**Branch**: `feat/umes-detail-bindings`

**Scope**:
- Create `useExtensibleDetail` hook in `packages/ui/src/backend/injection/`
- Create `InjectedField` component for detail pages
- Create `runSectionSave` helper
- Modify customer person detail page to use `useExtensibleDetail`
- Modify customer company detail page
- Modify sales document detail page

**Example module additions**:
- `example/widgets/injection/customer-detail-fields/widget.ts` — injects a read-only "Todo Summary" section into customer detail page showing todo count + latest todo title (uses enricher from PR 4)

**Integration tests**:
- TC-UMES-DP01: Injected field renders in customer detail page "Details" section
- TC-UMES-DP02: `runSectionSave` triggers widget `onSave` handlers alongside core save
- TC-UMES-DP03: Enriched data accessible via `ext.getEnrichedData('_example')`
- TC-UMES-DP04: Injected tab renders in customer detail tabs

**Files touched**: ~4 new files, ~3 modified files (3 detail pages)

**Estimated scope**: Medium — detail page modifications are well-scoped

**Depends on**: PR 4 (enrichers), PR 7 (InjectedField component)

---

### PR 10: Recursive Widget Extensibility

**Branch**: `feat/umes-recursive-widgets`

**Scope**:
- Allow widgets to declare `InjectionSpot` in their client component (already possible, formalize)
- Document `widget:<widgetId>:<spot>` naming convention
- Add widget-level behavior extension via injection-table `widget:*:events` pattern

**Example module additions**:
- `example/widgets/injection/crud-validation/widget.client.tsx` — add a nested `InjectionSpot` inside the validation widget, demonstrating recursive extension
- `example/widgets/injection/crud-validation-addon/widget.ts` — widget that injects into the validation widget's nested spot

**Integration tests**:
- TC-UMES-RW01: Widget-level injection spot renders child widgets
- TC-UMES-RW02: Nested widget's `onBeforeSave` handler participates in save lifecycle

**Files touched**: ~3 new files, ~2 modified files

**Estimated scope**: Small — mostly documentation + example

**Depends on**: PR 1

---

### PR 11: UMES DevTools + Conflict Detection

**Branch**: `feat/umes-devtools`

**Scope**:
- Create UMES DevTools panel (dev mode only)
- Add build-time conflict detection to `yarn generate`
- Log enricher timing, interceptor execution, widget event flow

**Example module additions**: None (infrastructure only)

**Integration tests**:
- TC-UMES-DT01: DevTools panel lists all active extensions on current page
- TC-UMES-DT02: Build-time conflict detection warns on duplicate priority replacements

**Files touched**: ~4 new files, ~2 modified files

**Estimated scope**: Medium

**Depends on**: All previous PRs

---

### 21.1 Dependency Graph

```
PR 1 (Foundation) ──────┬──────────────────────────────────────────────────────┐
  │                      │                                                      │
  ├── PR 2 (Menus)       ├── PR 3 (Events + DOM Bridge)                        │
  │                      │                                                      │
  │                      │          PR 4 (Enrichers) ── independent ────────────┤
  │                      │            │                                         │
  │                      │            ├── PR 5 (Interceptors)                   │
  │                      │            │                                         │
  │                      │            ├── PR 6 (DataTable Deep Ext.)            │
  │                      │            │                                         │
  │                      │            ├── PR 7 (CrudForm Fields)               │
  │                      │            │     │                                   │
  │                      │            │     └── PR 9 (Detail Bindings)          │
  │                      │            │                                         │
  │                      ├── PR 8 (Component Replacement) ─────────────────────┤
  │                      │                                                      │
  │                      └── PR 10 (Recursive Widgets) ────────────────────────┤
  │                                                                             │
  └─────────────────────────────────── PR 11 (DevTools) ◄──────────────────────┘
```

### 21.2 Parallelization Opportunities

These PRs can be developed **in parallel**:
- PR 2 (Menus) + PR 3 (Events) + PR 4 (Enrichers) + PR 8 (Component Replacement) — all independent after PR 1
- PR 5 (Interceptors) + PR 6 (DataTable) + PR 7 (CrudForm Fields) — all depend only on PR 4

### 21.3 Minimum Viable UMES (PRs 1 + 4 + 6)

For teams wanting the highest-impact subset:
1. **PR 1** — Foundation types + headless loading
2. **PR 4** — Response enrichers (data federation)
3. **PR 6** — DataTable column/action injection

This gives: cross-module data enrichment + injected columns + injected row actions — the most requested features.

### 21.4 Example Module — Complete UMES Showcase After All PRs

After all PRs, the example module demonstrates every UMES mechanism:

| Mechanism | Example Module File | What It Does |
|-----------|-------------------|--------------|
| **Menu Injection** | `widgets/injection/example-menus/widget.ts` | Adds "Quick Add Todo" to topbar, "Example Dashboard" external link to sidebar |
| **DOM Event Bridge** | `events.ts` + `widgets/injection/sales-todos/widget.client.tsx` | Todo CRUD events broadcast to client; sales-todos widget auto-refreshes |
| **Widget Event Handlers** | `widgets/injection/crud-validation/widget.ts` | `onFieldChange` warns when product name contains "TEST"; `transformFormData` trims whitespace |
| **Response Enricher** | `data/enrichers.ts` | Adds `_example.todoCount` + `_example.latestTodo` to customer person responses |
| **API Interceptor** | `api/interceptors.ts` | Rejects todo creation with "BLOCKED" title; adds `_example.serverTimestamp` to responses |
| **DataTable Columns** | `widgets/injection/customer-todo-count-column/widget.ts` | "Todos" column in customers DataTable showing `_example.todoCount` |
| **DataTable Row Actions** | `widgets/injection/customer-todo-actions/widget.ts` | "View Todos" row action in customers DataTable |
| **CrudForm Field Injection** | `widgets/injection/customer-priority-field/widget.ts` | "Priority" select field in customer edit form |
| **Component Replacement** | `widgets/components.ts` | Wrapper around todo edit dialog adding "Quick Notes" panel |
| **Detail Page Binding** | `widgets/injection/customer-detail-fields/widget.ts` | Read-only "Todo Summary" in customer detail |
| **Recursive Widgets** | `widgets/injection/crud-validation-addon/widget.ts` | Widget injected into validation widget's nested spot |
| **Existing (unchanged)** | `widgets/injection/crud-validation/widget.ts` | CRUD form validation hooks (onBeforeSave) |
| **Existing (unchanged)** | `widgets/injection/sales-todos/widget.ts` | Sales document tab injection |
| **Existing (unchanged)** | `widgets/injection/catalog-seo-report/widget.ts` | DataTable header injection |

### 21.5 Integration Test Summary Per PR

| PR | Tests | Total |
|----|-------|-------|
| PR 1 — Foundation | TC-UMES-F01, F02 | 2 |
| PR 2 — Menus | TC-UMES-M01–M04 | 4 |
| PR 3 — Events + DOM Bridge | TC-UMES-E01–E06 | 6 |
| PR 4 — Response Enrichers | TC-UMES-R01–R05 | 5 |
| PR 5 — API Interceptors | TC-UMES-I01–I06 | 6 |
| PR 6 — DataTable Extensions | TC-UMES-D01–D05 | 5 |
| PR 7 — CrudForm Fields | TC-UMES-CF01–CF05 | 5 |
| PR 8 — Component Replacement | TC-UMES-CR01–CR04 | 4 |
| PR 9 — Detail Bindings | TC-UMES-DP01–DP04 | 4 |
| PR 10 — Recursive Widgets | TC-UMES-RW01–RW02 | 2 |
| PR 11 — DevTools | TC-UMES-DT01–DT02 | 2 |
| **Total** | | **45** |
