# SPEC-041b — Menu Item Injection: Application Chrome Extensibility

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | B (PR 2) |
| **Branch** | `feat/umes-menu-injection` |
| **Depends On** | Phase A (Foundation) |
| **Status** | Draft |

## Goal

Allow modules to inject menu items into any application menu surface (main sidebar, settings sidebar, profile sidebar, profile dropdown, topbar actions) without modifying core navigation code.

---

## Current State: 5 Menu Surfaces, None Extensible by Modules

| Surface | Component | Currently Extensible? |
|---------|-----------|----------------------|
| **Main sidebar** | `AppShell.tsx` | Partially — pages with `pageContext: 'main'` auto-appear, but no items without pages |
| **Settings sidebar** | `SectionNav.tsx` | Partially — settings pages auto-appear |
| **Profile sidebar** | `SectionNav.tsx` | No |
| **Profile dropdown** | `ProfileDropdown.tsx` | No |
| **Header actions** | `layout.tsx` | No |

The auto-discovery via `page.meta.ts` fails when a module needs to add a menu item without a page, add items to the profile dropdown, add non-link items (toggles, badges), or remove/reorder items.

---

## Scope

### 1. Menu Surface IDs

```typescript
type MenuSurfaceId =
  | 'menu:sidebar:main'
  | 'menu:sidebar:settings'
  | 'menu:sidebar:profile'
  | 'menu:topbar:profile-dropdown'
  | 'menu:topbar:actions'
  | `menu:sidebar:settings:${string}`
  | `menu:sidebar:main:${string}`
  | `menu:${string}`
```

### 2. `useInjectedMenuItems(surfaceId)` Hook

```typescript
// packages/ui/src/backend/injection/useInjectedMenuItems.ts

function useInjectedMenuItems(surfaceId: MenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
}
```

Uses the headless widget loading path (Phase A) to collect `InjectionMenuItemWidget` entries targeting the given surface. Returns items already filtered by ACL and sorted by placement.

### 3. `mergeMenuItems(builtIn, injected)` Utility

```typescript
// packages/ui/src/backend/injection/mergeMenuItems.ts

function mergeMenuItems(
  builtIn: { id: string; [key: string]: unknown }[],
  injected: InjectionMenuItem[],
): MergedMenuItem[]
```

Merges built-in items with injected items, resolving placements:
- If `placement.relativeTo` matches a built-in ID → insert before/after
- If `placement` is First → prepend
- If `placement` is Last or missing → append
- If `groupId` specified → find or create group, insert into it

### 4. Component Modifications

| Component | Change | LOC |
|-----------|--------|-----|
| `ProfileDropdown.tsx` | Add `useInjectedMenuItems('menu:topbar:profile-dropdown')`, call `mergeMenuItems()` | ~20 |
| `AppShell.tsx` (main sidebar) | Add `useInjectedMenuItems('menu:sidebar:main')`, merge groups/items | ~15 |
| `SectionNav.tsx` | Add `useInjectedMenuItems('menu:sidebar:settings')` / `'menu:sidebar:profile'` | ~15 |
| `layout.tsx` (header) | Add `useInjectedMenuItems('menu:topbar:actions')` | ~10 |
| `buildAdminNav()` in `nav.ts` | **No change** — module discovery via `page.meta.ts` continues | 0 |

**Key design**: `buildAdminNav()` is NOT modified. Menu injection is a render-time overlay. Sidebar customization (reorder, rename, hide) works on injected items too.

### 5. Interaction with Sidebar Customization

Injected items:
- **Can be hidden** by user (stored by item `id` in `hiddenItems[]`)
- **Can be renamed** by user (stored by item `id` in `itemLabels{}`)
- **Can be reordered** within group (stored by group `id` in `groupOrder[]`)
- **Cannot be edited** at code level by customization UI

---

## Real-World Menu Injection Examples

### Example 1: SSO Module → Profile Dropdown + Settings Sidebar

One module, two menu surfaces:

```typescript
// sso/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'menu:topbar:profile-dropdown': {
    widgetId: 'sso.injection.menus',
    priority: 50,
  },
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

### Example 2: Analytics Module → New Sidebar Group

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
      groupId: 'analytics',
      groupLabel: 'Analytics',
      groupLabelKey: 'analytics.nav.group',
      groupOrder: 50,
    },
    {
      id: 'analytics-reports',
      label: 'analytics.nav.reports',
      icon: 'FileBarChart',
      href: '/backend/analytics/reports',
      groupId: 'analytics',
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

### Example 3: External BI → Menu Item Without a Page (External URL)

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
      href: 'https://bi.example.com/dashboard',
      groupId: 'analytics',
      placement: { position: InjectionPosition.Last },
    },
  ],
} satisfies InjectionMenuItemWidget
```

This adds an external link to the sidebar — something impossible today since `page.meta.ts` only works for internal pages.

### Example 4: Carrier Integration → Profile Sidebar Section

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

---

## Example Module Additions

### `example/widgets/injection/example-menus/widget.ts`

```typescript
// packages/core/src/modules/example/widgets/injection/example-menus/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

export default {
  metadata: {
    id: 'example.injection.example-menus',
    features: ['example.view'],
  },
  menuItems: [
    {
      id: 'example-quick-add-todo',
      label: 'example.menu.quickAddTodo',
      icon: 'PlusSquare',
      href: '/backend/example/todos/create',
      // Topbar action button
      placement: { position: InjectionPosition.Last },
    },
    {
      id: 'example-external-dashboard',
      label: 'example.menu.externalDashboard',
      icon: 'ExternalLink',
      href: 'https://example.com/dashboard',
      // Sidebar item in the Example group
      groupId: 'example',
      placement: { position: InjectionPosition.Last },
    },
  ],
} satisfies InjectionMenuItemWidget
```

### `example/widgets/injection-table.ts` update

```typescript
// Add to existing injection-table.ts
'menu:topbar:actions': {
  widgetId: 'example.injection.example-menus',
  priority: 50,
},
'menu:sidebar:main': {
  widgetId: 'example.injection.example-menus',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-M01: Menu item injected into profile dropdown appears between existing items

**Type**: UI (Playwright)

**Preconditions**: Example module enabled, user logged in as admin

**Steps**:
1. Navigate to any backend page
2. Click the profile avatar/dropdown trigger in the top-right
3. Inspect the dropdown menu items

**Expected**: The injected "Quick Add Todo" item appears in the dropdown. If placement specifies a `relativeTo`, the item is positioned correctly relative to the target.

**Testing notes**:
- Open the dropdown: `page.locator('[data-testid="profile-dropdown-trigger"]').click()`
- Verify item: `page.locator('[data-testid="profile-dropdown"]').getByText('Quick Add Todo')`
- Verify separator renders if `separator: true`

### TC-UMES-M02: Sidebar group created by injected menu item appears in correct order

**Type**: UI (Playwright)

**Steps**:
1. Navigate to any backend page
2. Inspect the sidebar navigation

**Expected**: The "Example Dashboard" external link appears under the Example group in the sidebar. If `groupOrder` is set, the group appears in the correct position relative to other groups.

**Testing notes**:
- Use `page.locator('[data-sidebar-group="example"]')` to find the group
- Verify the external link item is inside the group
- Verify clicking it opens the external URL (or navigates if internal)

### TC-UMES-M03: Menu item respects ACL features (hidden when feature disabled)

**Type**: UI (Playwright)

**Steps**:
1. Log in as a user WITHOUT `example.view` feature
2. Navigate to any backend page
3. Inspect sidebar and profile dropdown

**Expected**: Injected menu items are NOT visible when the user lacks the required feature.

**Testing notes**:
- Create a test user/role without `example.view`
- Verify absence: `expect(page.locator('[data-menu-item-id="example-todos-shortcut"]')).not.toBeVisible()`
- Then switch to admin user and verify they ARE visible

### TC-UMES-M04: Menu item with `href` navigates correctly on click

**Type**: UI (Playwright)

**Steps**:
1. Log in as admin
2. Navigate to backend
3. Click the injected sidebar item "Example Todos"

**Expected**: Browser navigates to `/backend/example/todos`

**Testing notes**:
- `page.locator('[data-menu-item-id="example-todos-shortcut"]').click()`
- `await page.waitForURL('**/backend/example/todos')`
- For external links, verify `target="_blank"` or new tab behavior

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/useInjectedMenuItems.ts` |
| **NEW** | `packages/ui/src/backend/injection/mergeMenuItems.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/example-menus/widget.ts` |
| **MODIFY** | `packages/ui/src/backend/ProfileDropdown.tsx` |
| **MODIFY** | `packages/ui/src/backend/AppShell.tsx` |
| **MODIFY** | `packages/ui/src/backend/section-page/SectionNav.tsx` |
| **MODIFY** | `apps/mercato/src/app/(backend)/backend/layout.tsx` (header actions) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` |

**Estimated scope**: Medium — 4 component modifications + hook + utility

---

## Backward Compatibility

- `buildAdminNav()` is NOT modified — continues building nav from `page.meta.ts`
- Existing sidebar navigation unchanged — injected items are merged at render time
- Sidebar customization works on both built-in and injected items
- No existing injection-table.ts entries affected
