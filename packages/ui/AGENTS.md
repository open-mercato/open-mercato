# UI Package - Agent Guidelines

UI usage patterns based on customers, sales, and staff modules. Use these defaults when building new UI in `packages/ui` or consuming from other modules.

> **DS reference:** [`.ai/ds-rules.md`](../../.ai/ds-rules.md) — color tokens, typography, spacing, decision trees. **Component reference (variants/sizes/props/examples/MUST rules):** [`.ai/ui-components.md`](../../.ai/ui-components.md).

## Reference Modules

- Customers: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`, `…/people/page.tsx`, `…/components/detail/TaskForm.tsx`
- Sales: `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`, `…/PaymentsSection.tsx`, `…/SalesDocumentForm.tsx`
- Staff: `packages/core/src/modules/auth/backend/users/page.tsx`, `…/users/create/page.tsx`, `…/roles/create/page.tsx`

## Component quick reference

When you need… use this. Details (variants, sizes, props, MUST rules) live in [`.ai/ui-components.md`](../../.ai/ui-components.md).

| Need | Component | Import |
|---|---|---|
| Button with text label (with or without icon) | `Button` | `@open-mercato/ui/primitives/button` |
| Icon-only button | `IconButton` | `@open-mercato/ui/primitives/icon-button` |
| Inline link styled as button | `LinkButton` | `@open-mercato/ui/primitives/link-button` |
| OAuth/sign-in button (brand-styled) | `SocialButton` | `@open-mercato/ui/primitives/social-button` |
| Marketing CTA with brand gradient | `FancyButton` | `@open-mercato/ui/primitives/fancy-button` |
| Checkbox primitive (with indeterminate) | `Checkbox` | `@open-mercato/ui/primitives/checkbox` |
| Checkbox with label + description | `CheckboxField` | `@open-mercato/ui/primitives/checkbox-field` |
| Text input (text/email/password/number/etc.) | `Input` | `@open-mercato/ui/primitives/input` |
| Multi-line text input (with optional char counter) | `Textarea` | `@open-mercato/ui/primitives/textarea` |
| Dropdown / select | `Select` (with `SelectTrigger` / `SelectContent` / `SelectItem`) | `@open-mercato/ui/primitives/select` |
| Tooltip on hover (with arrow, dark/light) | `SimpleTooltip` (or `Tooltip`+`TooltipTrigger`+`TooltipContent`) | `@open-mercato/ui/primitives/tooltip` |
| Toggle switch (binary on/off preference) | `Switch` | `@open-mercato/ui/primitives/switch` |
| Switch with label + description (preference row) | `SwitchField` | `@open-mercato/ui/primitives/switch-field` |
| Radio button (single primitive) | `Radio` (inside `RadioGroup`) | `@open-mercato/ui/primitives/radio` |
| Radio with label + description (form row) | `RadioField` | `@open-mercato/ui/primitives/radio-field` |
| User / entity avatar | `Avatar`, `AvatarStack` | `@open-mercato/ui/primitives/avatar` |
| Keyboard shortcut keys | `Kbd`, `KbdShortcut` | `@open-mercato/ui/primitives/kbd` |
| Entity tag pill | `Tag` (with `TagMap`) | `@open-mercato/ui/primitives/tag` |
| Wrap a `<Link>` as button | `Button asChild` / `IconButton asChild` | — |

## Critical MUST rules (top of mind)

1. **NEVER use raw `<button>` or `<input type="checkbox">`** — always use the primitives. Native checkboxes get `accent-color: var(--accent-indigo)` as a safety net for legacy code, but new code MUST use `Checkbox`.
2. **Always pass `type="button"` explicitly** on non-submit `Button`/`IconButton` — HTML defaults to `submit`.
3. **Same-row buttons MUST share `size`.** Mixing `sm` (h-8) + `default`/`icon` (h-9) is a regression. Standardized rows: DataTable toolbar = `default`/`icon` h-9, FormActionButtons = `default` h-9.
4. **NEVER raw `<Link>` styled as a button** — wrap with `<Button asChild>` to inherit size + radius.
5. **`<Button className="h-9">` is an anti-pattern** — redundant with default size, hides contract from grep.
6. **`Checkbox` checked color is `--accent-indigo` (NOT `--primary`)** — matches Figma and distinguishes selection from primary actions.

## CrudForm Guidelines

- Use `CrudForm` as the default for create/edit flows and dialog forms.
- If a backend page cannot use `CrudForm`, use `useGuardedMutation` from `@open-mercato/ui/backend/injection/useGuardedMutation` for every write (`POST`/`PUT`/`PATCH`/`DELETE`).
- Always call writes through `runMutation({ operation, context, mutationPayload })` so global injection modules (e.g. record-lock conflict handling) can run `onBeforeSave`/`onAfterSave`, apply scoped headers, and receive errors consistently.
- Use manual `useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)` only when `useGuardedMutation` is insufficient.
- Keep `CrudForm` reusable — extract shared field/group builders and submit handlers into module-level helpers.
- Drive validation with Zod and surface field errors via `createCrudFormError`.
- With `CrudForm` + Zod, validation messages may be i18n keys (`CrudForm` translates them).
- If you validate outside `CrudForm` or manually map `safeParse(...).error.issues`, you MUST translate `issue.message` before passing to `createCrudFormError`.
- Keep `fields` and `groups` in memoized helpers.
- Pass `entityIds` when custom fields are involved.
- Use `createCrud`/`updateCrud`/`deleteCrud` for submit actions and call `flash()` for success/failure messaging.

## UI Interaction
- Every new dialog must support `Cmd/Ctrl + Enter` as a primary action shortcut and `Escape` to cancel, mirroring the shared UX patterns used across modules.
- Default to `CrudForm` for new forms and `DataTable` for tables displaying information unless a different component is explicitly required.
- Use the `EventSelect` component from `@open-mercato/ui/backend/inputs/EventSelect` for event selection. It fetches declared events via the `/api/events` endpoint.
- Never use `window.confirm` — use the shared `ConfirmDialog` and `useConfirmDialog` from `@open-mercato/ui/backend/confirm-dialog` for confirmation flows.
- New CRUD forms should use `CrudForm` wired to CRUD factory/commands APIs and be shared between create/edit flows.
- Prefer reusing components from the shared `packages/ui` package before introducing new UI primitives.
- For new `DataTable` columns, set `meta.truncate` and `meta.maxWidth` in the column config when you need specific truncation behavior; only rely on defaults when those are not set.
- When you create new UI check reusable components before creating UI from scratch (see [`.ai/specs/implemented/SPEC-001-2026-01-21-ui-reusable-components.md`](.ai/specs/implemented/SPEC-001-2026-01-21-ui-reusable-components.md))
- For form/detail page headers and footers, use `FormHeader` and `FormFooter` from `@open-mercato/ui/backend/forms`. `FormHeader` supports two modes: `edit` (compact, used automatically by CrudForm) and `detail` (large title with entity type label, status badge, Actions dropdown). Delete/Cancel/Save are always standalone buttons; additional context actions (Convert, Send, etc.) go into the `menuActions` array rendered as an "Actions" dropdown. See [SPEC-016](.ai/specs/implemented/SPEC-016-2026-02-03-form-headers-footers.md) for full API.

## Avatar

`Avatar` displays a user or entity with a photo or auto-generated initials. `AvatarStack` overlaps multiple avatars with an overflow indicator.

### Import

```typescript
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
```

### Sizes

| Size | px | Use case |
|---|---|---|
| `sm` | 24px | Table rows, AvatarStack, inline lists |
| `default` | 32px | Default — sidebar, comments, activity feed |
| `md` | 40px | Section headers, assignee cards |
| `lg` | 80px | Profile / detail page header |

### Usage

```tsx
// Photo
<Avatar src="/avatars/jan.jpg" name="Jan Kowalski" size="md" />

// Initials (auto-generated from name)
<Avatar name="Jan Kowalski" />        // → "JK"
<Avatar name="Copperleaf Design" />   // → "CD"

// Stack with overflow
<AvatarStack max={3}>
  <Avatar name="Jan Kowalski" size="sm" />
  <Avatar name="Oliwia Z." size="sm" />
  <Avatar name="Anna Nowak" size="sm" />
  <Avatar name="Sarah Mitchell" size="sm" />
</AvatarStack>
// renders: JK · OZ · AN · +1
```

### MUST rules

- NEVER render `<div className="rounded-full bg-muted ...">` for avatars — use `Avatar`
- `size="sm"` uses `text-[9px]` — DS exception for tiny initials (same as notification badge count)
- `ring-2 ring-background` is built-in — provides the border needed for `AvatarStack` overlap
- For unknown users or empty states: render `<Avatar />` (shows blank muted circle)

---

## Kbd

`Kbd` renders a keyboard key. `KbdShortcut` renders a full shortcut sequence (`⌘ + Enter`).

Use in dialog footers, tooltips, and empty states to communicate keyboard affordances required by our UX rules (every dialog MUST support `Cmd/Ctrl+Enter` submit and `Escape` cancel).

### Import

```typescript
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
```

### Usage

```tsx
// Single key
<Kbd>Esc</Kbd>
<Kbd>⌘</Kbd>

// Shortcut sequence
<KbdShortcut keys={['⌘', 'Enter']} />   // renders: ⌘ + Enter
<KbdShortcut keys={['Ctrl', 'S']} />

// In a dialog footer hint
<span className="text-xs text-muted-foreground">
  Press <KbdShortcut keys={['⌘', 'Enter']} /> to save or <Kbd>Esc</Kbd> to cancel
</span>
```

### MUST rules

- NEVER use raw `<span>` or `<code>` to display keyboard keys — use `Kbd`
- Platform-specific keys (`⌘` vs `Ctrl`): detect with `navigator.platform` or use `Ctrl/⌘` text when cross-platform

---

## Tag

`Tag` is a static pill element representing a user-applied label on an entity (e.g. "Customer", "Hot", "Renewal"). Use it for entity tags — NOT for system status display (use `StatusBadge` for that).

### Tag vs StatusBadge

| | `Tag` | `StatusBadge` |
|---|---|---|
| Purpose | User-applied label / category | System status (active, pending, failed…) |
| Shape | `rounded-full` pill | `rounded-full` pill |
| Dot | optional (`dot` prop) | optional (`dot` prop) |
| `brand` variant | ✅ (violet — for custom views/renewal tags) | ❌ |

### Import

```typescript
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { TagMap } from '@open-mercato/ui/primitives/tag'
```

### Variants

| Variant | Token | Example use |
|---|---|---|
| `default` | `border-border bg-background text-muted-foreground` | Generic / inactive tag |
| `success` | `status-success-*` | Customer, Shipped, Active |
| `warning` | `status-warning-*` | Renewal, At risk |
| `error` | `status-error-*` | Hot, Overdue, Blocked |
| `info` | `status-info-*` | Pending, In review |
| `neutral` | `status-neutral-*` | Archived, Draft |
| `brand` | `brand-violet/10` bg, `brand-violet/30` border, `text-brand-violet` | Custom views, Perspectives |

### Usage

```tsx
<Tag variant="success" dot>Customer</Tag>
<Tag variant="error" dot>Hot</Tag>
<Tag variant="brand" dot>Renewal Q1 2026</Tag>
<Tag variant="neutral">Inactive</Tag>
```

### TagMap helper

```typescript
import type { TagMap } from '@open-mercato/ui/primitives/tag'

const leadTagMap: TagMap<'customer' | 'hot' | 'inactive' | 'renewal'> = {
  customer: 'success',
  hot: 'error',
  inactive: 'neutral',
  renewal: 'brand',
}

<Tag variant={leadTagMap[tag.type]} dot>{tag.label}</Tag>
```

### MUST rules

- NEVER hardcode colors on `Tag` — use variants only
- Use `dot` for tags that represent a status-like category (Customer, Hot); omit for purely descriptive labels
- For "Manage tags" / add-tag affordances: use a `Button variant="ghost"` or dashed outline — NOT `Tag`
- `brand` variant is for user-saved views and renewal/custom category tags only (see brand color rules in root AGENTS.md)

## DataTable Guidelines

- Use `DataTable` as the default list view.
- For wide list views where rightmost `rowActions` can scroll out of view, enable `stickyActionsColumn` on the host `DataTable`; keep it opt-in instead of making all actions columns sticky by default.
- DataTable extension spots include: `data-table:<tableId>:columns`, `:row-actions`, `:bulk-actions`, `:filters`, `:search-trailing`, `:toolbar` (in addition to `:header`/`:footer`).
- `:search-trailing` renders inside `FilterBar`, immediately to the right of the search input on the same row. Reserve it for **compact triggers** (AI assistants, saved-view shortcuts, focus-mode toggles) — full-width / multi-action toolbars belong in `:toolbar` or `:header`. The slot is suppressed automatically when the host DataTable does not render a search input. Use `Button variant="outline"` (default size, h-9, `rounded-md`) with a single leading icon plus a short caption (e.g. `AI`) so the trigger matches the search input's `h-9` row height and the rest of the toolbar's rounded-rectangle button radius. Resolve the spot ID via `DataTableInjectionSpots.searchTrailing(tableId)` from `@open-mercato/ui/backend/injection/spotIds`.
- Populate `columns` with explicit renderers and set `meta.truncate`/`meta.maxWidth` where truncation is needed.
- For filters, use `FilterBar`/`FilterOverlay` with async option loaders; keep `pageSize` at or below 100.
- Support exports using `buildCrudExportUrl` and pass `exportOptions` to `DataTable`.
- Use `RowActions` for per-row actions; navigate via `onRowClick` or action links.
- Keep table state (paging, sorting, filters, search) in component state and reload on scope changes.
- Keep `extensionTableId` stable and deterministic.
- Render injected row actions and bulk actions through `RowActions`/bulk handlers so they follow the same guard and i18n behavior as built-ins.

## CrudForm Field Injection (UMES Phase G)

- `CrudForm` automatically resolves injected field widgets from `crud-form:<entityId>:fields`; always pass a stable `entityId`.
- Keep host field/group IDs stable so injected fields can target groups deterministically across versions.
- Use injected fields for cross-module form augmentation; keep core module fields in the base form config.

## Menu Injection (UMES Phase A/B)

- Use `useInjectedMenuItems(surfaceId)` for chrome surfaces (`menu:sidebar:*`, `menu:topbar:*`).
- Merge built-in and injected items with `mergeMenuItems(builtIn, injected)` to preserve deterministic placement.
- For relative positioning, use `InjectionPosition` + `relativeTo` IDs; if `relativeTo` is missing, insertion falls back to append.
- Treat injected labels as i18n-first: prefer `labelKey` (with human fallback `label`) and `groupLabelKey`.
- Add stable attributes (`data-menu-item-id="<id>"`) when rendering merged items so integration tests can assert injected entries.
- When filtering menu items by `item.features` or route `requireFeatures`, MUST use the shared wildcard-aware matcher from `@open-mercato/shared/lib/auth/featureMatch` — `Set.has(...)`/`includes(...)` miss `module.*` grants.

## Loading, Empty, and Error States

- For list/detail data loading, use `LoadingMessage` and `ErrorMessage` from `@open-mercato/ui/backend/detail`.
- For record-backed backend detail/edit pages, treat `notFound` as a dedicated page state, separate from generic `error`.
- When a record is missing, return early with a page-level `ErrorMessage` and a clear recovery action ("Back to list"); do not render `CrudForm`, detail sections, tabs, or record actions.
- Don't use ad hoc centered `<div>` error markup when shared backend detail primitives can express the state.
- Use `TabEmptyState` when a section is empty but otherwise healthy.
- Keep loading flags local to the section; reset errors before each load.

## Flash Messages

- Use `flash(message, 'success' | 'error')` from `@open-mercato/ui/backend/FlashMessages` for user feedback after CRUD operations.
- Prefer specific translation keys; keep message copy in module locale files.
- For non-blocking errors in side effects (e.g. creating secondary records), show a flash error and let the main flow complete.

## Notifications

- Define notification types in `src/modules/<module>/notifications.ts` and client renderers in `notifications.client.ts`.
- Define reactive notification handlers in `src/modules/<module>/notifications.handlers.ts` when notifications should trigger automatic side-effects.
- Renderers live in `widgets/notifications/` and should use `useT()` for copy.
- Use shared action labels where possible (e.g. `notifications.actions.dismiss`).
- Prefer notification creation in commands or subscribers; keep UI renderers lightweight.
- For component-scoped reactions, use `useNotificationEffect(notificationType, effect)` instead of module-specific polling loops.
- When gating notification handlers by `features`, MUST use the shared wildcard-aware matcher.

## Component Reuse

- Prefer existing UI primitives and backend components from `@open-mercato/ui` before creating new ones.
- For replacement-aware hosts, expose stable handle IDs (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) so overrides are deterministic.
- Reference @`.ai/specs/implemented/SPEC-001-2026-01-21-ui-reusable-components.md` for the reusable component catalog and usage patterns.
- For dialogs and forms, keep the interaction model consistent: `Cmd/Ctrl + Enter` to submit, `Escape` to cancel.
- Favor composable, data-first helpers (custom field helpers, CRUD helpers, filter utilities) over bespoke logic.

## Component Replacement (UMES Phase H)

- When a host surface is replacement-aware, resolve implementations via `useRegisteredComponent(handle, Fallback)` instead of hardcoded references.
- Prefer additive override modes (`wrapper`, `props`) before full `replace`; reserve `replace` for cases where compatibility is preserved.
- Keep handle IDs stable and document them when introducing new replacement-aware surfaces.

## Portal Extension

The portal extensibility system lets app modules build customer-facing pages that integrate with the shared portal shell, navigation, auth, and event bridge.

### Portal Hooks (`packages/ui/src/portal/hooks/`)

| Hook | Import | Purpose |
|------|--------|---------|
| `useCustomerAuth` | `@open-mercato/ui/portal/hooks/useCustomerAuth` | Customer auth state (user, roles, features, logout) |
| `useTenantContext` | `@open-mercato/ui/portal/hooks/useTenantContext` | Resolve tenant/org from URL slug |
| `usePortalInjectedMenuItems` | `@open-mercato/ui/portal/hooks/usePortalInjectedMenuItems` | Load feature-gated menu items for portal surfaces |
| `usePortalEventBridge` | `@open-mercato/ui/portal/hooks/usePortalEventBridge` | SSE connection for portal real-time events |
| `usePortalAppEvent` | `@open-mercato/ui/portal/hooks/usePortalAppEvent` | Listen for portal events by pattern |

### Portal Shell (`packages/ui/src/portal/PortalShell.tsx`)

Shared layout with header, nav (built-in + injected), main, footer. Supports event bridge and component replacement handles.

```tsx
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

function MyPage({ orgSlug }) {
  const { user, logout } = useCustomerAuth(orgSlug)
  return (
    <PortalShell orgSlug={orgSlug} authenticated={!!user} onLogout={logout} enableEventBridge>
      {/* page content */}
    </PortalShell>
  )
}
```

### Portal Menu Injection Spots (FROZEN)

| Spot ID | Purpose |
|---------|---------|
| `menu:portal:sidebar:main` | Main portal navigation |
| `menu:portal:sidebar:account` | Account/settings navigation |
| `menu:portal:header:actions` | Header action buttons |
| `menu:portal:user-dropdown` | User dropdown menu items |

### Portal Widget Injection Spots (FROZEN)

| Spot ID | Purpose |
|---------|---------|
| `portal:dashboard:sections` | Dashboard section cards |
| `portal:dashboard:profile` | Dashboard profile area |
| `portal:dashboard:sidebar` | Dashboard sidebar |
| `portal:<pageId>:before` | Before page content |
| `portal:<pageId>:after` | After page content |

### Portal Component Replacement Handles (FROZEN)

| Handle | Purpose |
|--------|---------|
| `page:portal:layout` | Entire portal shell |
| `section:portal:header` | Header bar |
| `section:portal:footer` | Footer |
| `section:portal:sidebar` | Navigation sidebar |
| `section:portal:user-menu` | User dropdown |

### Portal Page Metadata (REQUIRED)

Every portal page (any page under `frontend/[orgSlug]/portal/...`) MUST ship a sibling `page.meta.ts`. The `(frontend)` catch-all server-side enforces `requireCustomerAuth` and `requireCustomerFeatures` from the route manifest, so omitting metadata silently disables access control on a page that should be guarded.

Authoring checklist for each portal page:
- Public pages (`login`, `signup`, `verify`, anonymous landing): set `navHidden: true`. Do not set `requireCustomerAuth`.
- Authenticated pages: set `requireCustomerAuth: true`.
- Pages that need feature gating: add `requireCustomerFeatures: ['portal.<feature>']`. Wildcard grants like `portal.*` are honored by the shared matcher.
- Pages that should appear in the portal sidebar: add a `nav` block (label + group). Pages without `nav` are routable but not auto-listed (correct for detail/edit pages).

```typescript
// frontend/[orgSlug]/portal/orders/page.meta.ts
import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.orders.view'],
  titleKey: 'orders.nav.title',
  title: 'Orders',
  nav: {
    label: 'Orders',
    labelKey: 'orders.nav.title',
    group: 'main', // 'main' | 'account'
    order: 20,
    icon: 'shopping-bag',
  },
}

export default metadata
```

The portal sidebar is built from these `nav` declarations by `/api/customer_accounts/portal/nav`, filtered by `CustomerRbacService` against the same `requireCustomerFeatures` that gates access. Granting the feature to a customer role is sufficient for the entry to appear — no separate menu-injection widget required.

For external links or items without a backing portal page, keep using `usePortalInjectedMenuItems` widgets.

Reference: see `packages/core/src/modules/portal/frontend/[orgSlug]/portal/{dashboard,profile,login,signup,verify}/page.meta.ts` for examples.

### Declarative Customer Role Features in setup.ts

```typescript
export const setup: ModuleSetupConfig = {
  defaultCustomerRoleFeatures: {
    buyer: ['portal.orders.view', 'portal.orders.create'],
    viewer: ['portal.orders.view'],
  },
}
```

### Portal Event Bridge

Events with `portalBroadcast: true` are streamed to authenticated portal users via `/api/customer_accounts/portal/events/stream`.

```typescript
const events = [
  { id: 'sales.order.status_changed', label: 'Order Status Changed', portalBroadcast: true },
] as const

import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
usePortalAppEvent('sales.order.status_changed', (event) => { refetch() })
```
