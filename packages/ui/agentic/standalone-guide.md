# UI Package — Standalone Developer Guide

`@open-mercato/ui` provides all admin/backend UI components. Use these instead of building from scratch.

## Key Imports

```typescript
// Buttons (MUST use — never raw <button>)
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

// CRUD forms
import { CrudForm, createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

// API calls (MUST use — never raw fetch)
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

// Page structure
import { FormHeader, FormFooter } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// Widget injection
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { mergeMenuItems } from '@open-mercato/ui/backend/injection/mergeMenuItems'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

// Real-time events
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useOperationProgress } from '@open-mercato/ui/backend/injection/useOperationProgress'

// Custom fields
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
```

## MUST Rules

1. **MUST use `Button`/`IconButton`** — never raw `<button>` elements
2. **MUST pass `type="button"` explicitly** on non-submit buttons (HTML defaults to `type="submit"`)
3. **MUST use `apiCall`/`apiCallOrThrow`** — never raw `fetch`
4. **MUST use `LoadingMessage`/`ErrorMessage`** for loading/error states
5. **MUST NOT hard-code user-facing strings** — use `useT()` for all labels
6. **Every dialog**: `Cmd/Ctrl+Enter` to submit, `Escape` to cancel
7. **Keep `pageSize`** at or below 100

## CrudForm — Create/Edit Flows

Default for all create/edit pages and dialog forms:

```tsx
<CrudForm
  entityId="my_module:my_entity"
  mode="create" // or "edit"
  fields={fields}
  groups={groups}
  onSubmit={async (data) => {
    await createCrud('/api/my-module/items', data)
    flash(t('my_module.created'), 'success')
  }}
/>
```

- Drive validation with Zod schemas; surface errors via `createCrudFormError(message, fieldErrors?)`
- Pass `entityIds` when custom fields are involved
- Use `createCrud`/`updateCrud`/`deleteCrud` for submit actions
- Keep fields and groups in memoized helpers

## Non-CrudForm Write Operations

When a page can't use `CrudForm`, wrap every write in `useGuardedMutation`:

```typescript
const { runMutation } = useGuardedMutation()
await runMutation({ operation: 'update', context: { entityId, recordId }, mutationPayload: data })
```

## DataTable — List Views

```tsx
<DataTable
  columns={columns}
  data={items}
  extensionTableId="my-module-items" // stable ID for widget injection
  rowClickActionIds={['edit', 'open']} // default
/>
```

- Set `meta.truncate` and `meta.maxWidth` on columns for truncation
- Use `FilterBar`/`FilterOverlay` with async option loaders
- Use stable `extensionTableId` — widget injection spots depend on it
- Extension spots: `data-table:<tableId>:columns`, `:row-actions`, `:bulk-actions`, `:filters`

## Buttons — Quick Reference

| Use case | Component | Example |
|----------|-----------|---------|
| Button with text | `Button` | Save, Cancel, Create |
| Icon-only button | `IconButton` | Close, Settings, Trash |
| Link as button | `IconButton asChild` | `<IconButton asChild><Link href="...">...</Link></IconButton>` |

**Button variants**: `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link`
**IconButton variants**: `outline` (default), `ghost`

## FormHeader Modes

```tsx
// Edit mode (compact, used by CrudForm)
<FormHeader mode="edit" title="Edit Item" />

// Detail mode (large title with status badge)
<FormHeader mode="detail" title="Item #123" entityTypeLabel="Item" statusBadge={<Badge>Active</Badge>} menuActions={[...]} />
```

## Menu Injection

Load and merge injected menu items for sidebar/topbar surfaces:

```typescript
const injectedItems = useInjectedMenuItems('menu:sidebar:main')
const merged = mergeMenuItems(builtInItems, injectedItems)
```

Use `InjectionPosition` + `relativeTo` for deterministic placement.

## Real-Time Events

```typescript
// Subscribe to server events (via DOM Event Bridge)
useAppEvent('my_module.entity.*', (event) => {
  // event.id, event.payload — refresh data, show notifications
}, [dependencies])

// Track long-running operations
const progress = useOperationProgress('my_module.import.*')
// progress.status, progress.progress (0-100), progress.processedCount
```

## Flash Messages

```typescript
flash(t('my_module.saved'), 'success')
flash(t('my_module.error'), 'error')
```

## Component Replacement

For replacement-aware surfaces, resolve components by handle:

```typescript
const MyComponent = useRegisteredComponent('page:my-module:detail', DefaultDetailPage)
return <MyComponent {...props} />
```

## Portal UI

### Key Imports

```typescript
// Portal hooks
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { usePortalEventBridge } from '@open-mercato/ui/portal/hooks/usePortalEventBridge'
import { usePortalInjectedMenuItems } from '@open-mercato/ui/portal/hooks/usePortalInjectedMenuItems'
import { usePortalNotifications } from '@open-mercato/ui/portal/hooks/usePortalNotifications'
import { usePortalDashboardWidgets } from '@open-mercato/ui/portal/hooks/usePortalDashboardWidgets'

// Portal layout
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { PortalProvider, usePortalContext } from '@open-mercato/ui/portal/PortalContext'

// Portal components
import {
  PortalCard, PortalCardHeader, PortalStatRow, PortalCardDivider,
  PortalPageHeader, PortalEmptyState, PortalFeatureCard,
  PortalNotificationBell, PortalNotificationPanel,
} from '@open-mercato/ui/portal/components'
```

### Portal Hooks Reference

| Hook | Purpose |
|------|---------|
| `useCustomerAuth(orgSlug?)` | Customer auth state: `{ user, roles, resolvedFeatures, isPortalAdmin, loading, error, logout }` |
| `useTenantContext(orgSlug)` | Resolve tenant/org from URL slug: `{ tenantId, organizationId, organizationName, loading, error }` |
| `usePortalAppEvent(pattern, handler, deps?)` | Listen for portal SSE events by glob pattern (e.g., `'sales.order.*'`) |
| `usePortalEventBridge()` | Establish singleton SSE connection — mount once in shell/layout |
| `usePortalInjectedMenuItems(surfaceId)` | Load feature-gated menu items for portal nav surfaces: `{ items, isLoading }` |
| `usePortalNotifications()` | Poll portal notifications: `{ notifications, unreadCount, hasNew, isLoading, refresh, markAsRead, dismiss, markAllRead }` |
| `usePortalDashboardWidgets(spotId)` | Load UI injection widgets (with `Widget` component) for a portal spot: `{ widgets, isLoading, error }` |

### Portal Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `PortalCard` | `children, className?` | Card container with border and padding |
| `PortalCardHeader` | `title, description?, label?, action?` | Card header with optional uppercase label and action slot |
| `PortalStatRow` | `label, value` | Key-value row inside a card (uppercase label, right-aligned value) |
| `PortalCardDivider` | — | Horizontal divider between stat rows |
| `PortalPageHeader` | `title, description?, label?, action?` | Page-level header with large title and action slot |
| `PortalEmptyState` | `title, description?, icon?, action?` | Dashed-border empty state with optional icon and CTA |
| `PortalFeatureCard` | `title, description?, icon?, href?, onClick?` | Feature grid card — renders as link, button, or static div |
| `PortalNotificationBell` | `t` | Header bell icon with unread badge |
| `PortalNotificationPanel` | — | Notification dropdown panel |

### Portal Page Structure

Every portal page is two files under `frontend/[orgSlug]/portal/<path>/`:

```
page.tsx        # Client component ("use client")
page.meta.ts    # PageMetadata — access control + sidebar nav
```

Minimal page:

```tsx
"use client"
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components'

export default function MyPortalPage({ params }: { params: { orgSlug: string } }) {
  const { auth } = usePortalContext()
  const { user, resolvedFeatures } = auth
  return <PortalPageHeader title="Orders" />
}
```

Prefer `usePortalContext()` inside pages wrapped by `PortalLayoutShell` — it reads server-hydrated auth and avoids client loading flashes. Reach for `useCustomerAuth(orgSlug)` only when the server wrapper is unavailable.

Minimal `page.meta.ts`:

```ts
import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.orders.view'],
  titleKey: 'portal.orders.title',
  title: 'Orders',
  nav: { label: 'Orders', labelKey: 'portal.nav.orders', group: 'main', order: 20 },
}

export default metadata
```

- Public pages (login, signup, verify, forgot/reset-password): omit `requireCustomerAuth`; set `navHidden: true`.
- Authenticated pages without sidebar presence (detail/create/edit): set `requireCustomerAuth: true`, **omit** `nav`.
- Sidebar-visible pages: include a `nav` block. Feature-gated pages are automatically hidden when the user lacks grants.

Reference: `packages/core/src/modules/portal/frontend/[orgSlug]/portal/{dashboard,profile}/page.{tsx,meta.ts}`.

### Portal Feature-Gating Contract

Single source of truth: `requireCustomerFeatures` in `page.meta.ts`. The same list is enforced in three layers:

| Layer | Where | Effect |
|---|---|---|
| Page access | `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` | Server-side gate via `CustomerRbacService.userHasAllFeatures()` — missing feature blocks render |
| Sidebar entry | `/api/customer_accounts/portal/nav` → `buildPortalNav()` at `packages/ui/src/portal/utils/nav.ts` | Same check — missing feature omits the entry |
| Injection widgets | `usePortalInjectedMenuItems` / `usePortalDashboardWidgets` | `/api/customer_accounts/portal/feature-check` + `hasAllFeatures()` — missing feature filters the widget |

Granting a customer role a feature (e.g. `portal.orders.view`) is sufficient to (a) reach the page, (b) see the sidebar entry, (c) see widgets gated by that feature. No separate menu-injection widget is required for sidebar presence when the page is backed by `page.meta.ts` with a `nav` block.

**MUST** resolve features via `hasAllFeatures` / `matchFeature` from `@open-mercato/shared/security/features`. Raw `Array.includes()` or `Set.has()` on feature arrays misses wildcards (`portal.*`) and is a bug.

Declare features in `acl.ts`; ship defaults per role via `defaultCustomerRoleFeatures` in `setup.ts`. Never rely on client-side checks alone as the access gate.

### Portal SPA CSRF Posture

Dual cookies set by login (`packages/core/src/modules/customer_accounts/api/login.ts`):

| Cookie | Contents | TTL | Flags |
|---|---|---|---|
| `customer_auth_token` | Short-lived JWT | 8h | `httpOnly`, `sameSite: 'lax'`, `secure` in prod, `path: '/'` |
| `customer_session_token` | Raw session token (hashed at rest) | 30d (env: `CUSTOMER_SESSION_TTL_DAYS`) | same as above |

Primary CSRF defense: `SameSite=lax` + same-origin deployment. No explicit CSRF token — the browser blocks cross-origin POSTs.

Rules:
- Use `apiCall` for every write — it uses `credentials: 'same-origin'` and sets JSON headers.
- Never expose either cookie to JS. `httpOnly` is load-bearing; do not add companion cookies that mirror session state.
- Never accept cross-origin POSTs on portal routes. Cross-origin use cases are explicit exceptions: per-tenant origin allowlist + CSRF token + re-auth.
- `sameSite: 'lax'` lets GET navigations carry cookies — keep all state-changing side effects behind POST/PUT/PATCH/DELETE.
- Logout (`api/portal/logout.ts`) clears both cookies with `maxAge: 0`. Mirror this shape for any new logout-style endpoints.

Concurrent sessions are capped at `MAX_CUSTOMER_SESSIONS_PER_USER` (default 5) in `customerSessionService.createSession()`. New sessions above the cap soft-delete the oldest active session.

### Portal XSS Discipline (Injected Widgets)

Third-party widgets render inside the authenticated portal and inherit user cookies. Enforce stricter discipline than first-party code because widgets load from arbitrary modules.

- **Forbidden**: `dangerouslySetInnerHTML` anywhere in portal injection widgets. Render structured data, not raw HTML.
- **Labels and user-facing text**: always through `useT()`; render as text children, never as HTML.
- **Icons**: Lucide components (`lucide-react`). No inline `<svg>` composed from user-controlled strings.
- **Asset URLs** (`src`, `href`, `action`, `srcDoc`): must not be user-controlled unless validated server-side against an allowlist.
- **No `eval`, `new Function`, `setTimeout(string)`**, or similar dynamic code paths.
- **Event-handler payloads** from SSE: validate shape (`isPortalBroadcastEvent` guards dispatch; never trust `event.data` to be well-formed without schema validation).
- **Styles**: no user-controlled strings in `style` props, CSS variables, or `className` built from untrusted input.

Prefer components that accept structured props over ones accepting `children` / `innerHTML` — the host keeps control of escaping.

### PortalShell Usage

```tsx
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

function MyPortalPage({ orgSlug }: { orgSlug: string }) {
  const { user, logout } = useCustomerAuth(orgSlug)
  return (
    <PortalShell orgSlug={orgSlug} authenticated={!!user} onLogout={logout} enableEventBridge>
      <PortalPageHeader title="My Orders" description="View and track your orders" />
      {/* page content */}
    </PortalShell>
  )
}
```

When `PortalProvider` is mounted in a parent layout, `PortalShell` reads auth/tenant state from context automatically — props act as overrides or are used on public pages without a provider.

### Portal Widget Injection Spots (FROZEN)

| Spot ID | Purpose |
|---------|---------|
| `menu:portal:sidebar:main` | Main portal navigation items |
| `menu:portal:sidebar:account` | Account/settings navigation items |
| `menu:portal:header:actions` | Header action buttons |
| `menu:portal:user-dropdown` | User dropdown menu items |
| `portal:dashboard:sections` | Dashboard section cards |
| `portal:dashboard:profile` | Dashboard profile area |
| `portal:dashboard:sidebar` | Dashboard sidebar |
| `portal:<pageId>:before` | Before page content |
| `portal:<pageId>:after` | After page content |

### Portal Component Replacement Handles (FROZEN)

| Handle | Constant | Purpose |
|--------|----------|---------|
| `page:portal:layout` | `PORTAL_SHELL_HANDLE` | Entire portal shell |
| `section:portal:header` | `PORTAL_HEADER_HANDLE` | Header bar |
| `section:portal:footer` | `PORTAL_FOOTER_HANDLE` | Footer |
| `section:portal:sidebar` | `PORTAL_SIDEBAR_HANDLE` | Navigation sidebar |
| `section:portal:user-menu` | `PORTAL_USER_MENU_HANDLE` | User menu / logout area |
