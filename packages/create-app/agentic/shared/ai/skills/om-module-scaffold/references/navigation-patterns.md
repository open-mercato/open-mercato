# Navigation & Sidebar Patterns

## page.meta.ts — Field Reference

Every backend page needs a `page.meta.ts` file alongside its `page.tsx`. The metadata controls sidebar placement, access control, and display.

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `pageTitle` | string | — | Display title in sidebar and breadcrumb |
| `pageTitleKey` | string | — | i18n key for title (preferred over `pageTitle`) |
| `pageGroup` | string | — | **Sidebar section name** — items with same group appear together |
| `pageGroupKey` | string | — | **i18n key for group** — used as the group identifier for matching |
| `pageOrder` | number | 10000 | Sort position within group (lower = higher in sidebar) |
| `icon` | ReactNode | — | Sidebar icon — MUST use `lucide-react` components |
| `requireAuth` | boolean | false | Require authenticated user |
| `requireFeatures` | string[] | — | Required ACL feature IDs (from `acl.ts`) |
| `navHidden` | boolean | false | Hide from sidebar (page still accessible by URL) |
| `pageContext` | `'main'` \| `'settings'` \| `'profile'` | `'main'` | Which navigation tier this page belongs to |
| `breadcrumb` | `{ label, labelKey?, href? }[]` | — | Breadcrumb trail above page title |

## Sidebar Group Configuration

Items are grouped by `pageGroupKey` (falls back to `pageGroup` if no key). **All related pages in a module MUST share the same `pageGroupKey`** to appear in the same sidebar section.

```typescript
// page.meta.ts — List page (appears in sidebar)
import { ShoppingCart } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_items.view'],
  pageTitle: 'Order Items',
  pageTitleKey: 'order_items.nav.title',
  pageGroup: 'Orders',                       // Display name for the sidebar section
  pageGroupKey: 'order_items.nav.group',      // Matching key — all module pages use this
  pageOrder: 100,                             // Position in the group
  icon: <ShoppingCart className="size-4" />,
  breadcrumb: [{ label: 'Order Items', labelKey: 'order_items.nav.title' }],
}
```

**Group sorting**: Core module groups (Customers, Catalog, Sales) appear first in a hardcoded order. Custom module groups appear after, sorted by their lowest `pageOrder` value.

## Settings Pages

Settings pages appear in the Settings hub, not the main sidebar. They require two fields:

```typescript
// backend/config/page.meta.ts
import { Settings } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_items.settings.manage'],
  pageTitle: 'Order Items Settings',
  pageTitleKey: 'order_items.config.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 10,
  icon: <Settings className="size-4" />,
  pageContext: 'settings' as const,           // ← Places in Settings hub
  navHidden: true,                            // ← MUST set — prevents duplicate in main sidebar
}
```

**Standard settings section keys**: `settings.sections.system`, `settings.sections.auth`, `settings.sections.moduleConfigs`, `settings.sections.directory`.

## Sub-Pages (Create / Edit / Detail)

- **`[id]` pages**: Auto-excluded from sidebar (framework skips dynamic segments). Still need `pageGroupKey` for breadcrumb context.
- **Create pages** (`new.tsx`): Set `navHidden: true` since they're accessed via the list page's create button.

```typescript
// backend/<entities>/new.meta.ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_items.create'],
  pageTitle: 'Create Order Item',
  pageTitleKey: 'order_items.create.title',
  pageGroup: 'Orders',
  pageGroupKey: 'order_items.nav.group',      // ← Same key as list page
  navHidden: true,                            // ← Not shown in sidebar
}
```

## Anti-Patterns

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing `pageGroup` + `pageGroupKey` | Item creates orphan group or lands in "Uncategorized" | Add both fields matching your module's group |
| Mismatched `pageGroupKey` across pages | Items from same module split into separate sidebar sections | Use identical `pageGroupKey` on all module pages |
| Missing `icon` | Blank space in sidebar next to title | Add `lucide-react` icon component |
| Inline SVG via `React.createElement` | Broken/wrong icon after `yarn generate` | Use `import { X } from 'lucide-react'` |
| `pageContext: 'settings'` without `navHidden: true` | Page appears in both main sidebar AND settings hub | Always pair both fields |
| Missing `as const` on `pageContext` | TypeScript error — type widened to `string` | Use `pageContext: 'settings' as const` |
| Missing `pageOrder` | Unpredictable sort position (defaults to 10000) | Set explicit order value |
| Missing `requireFeatures` | Page visible to users without permission | Add feature IDs from `acl.ts` |
