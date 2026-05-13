# Topbar & Notifications Redesign

## TLDR

Open Mercato's backend topbar accumulated 8 right-side items (AI launcher, search dialog trigger, tenant + org selectors, integrations, settings, profile dropdown, notification bell, messages) over time, with no unified DS treatment. Items had varying sizes (28 / 32 / 36 / 40 px), inconsistent variants (some `outline`, some `ghost`), tight 4–8 px gaps, and on small viewports the whole row overflowed because every item had `shrink-0`. The notification panel was a custom `position: fixed` overlay with its own backdrop and a duplicate "Bell + Notifications" header that competed with the topbar bell, plus the inline `Tabs` primitive used pill-style active state instead of the underline-style the Figma spec calls for. The sidebar collapse/expand toggle sat in the topbar competing for space with the breadcrumb. Settings sub-navigation (the two-level sidebar shipped in PR #1790) was reachable on desktop but invisible on mobile — the hamburger drawer auto-swapped to the section sidebar with no way back to the main nav.

This spec ships the topbar + notifications redesign that landed alongside the breadcrumb DS primitive (see [`2026-05-05-breadcrumbs-ds-redesign.md`](2026-05-05-breadcrumbs-ds-redesign.md)). The work introduces one new DS primitive (`Sheet`), rewrites the notification panel to match Figma's `Notifications [Examples]` node (4316:44104), moves the sidebar collapse toggle onto the divider line between sidebar and content, adds an inline global search input with anchored popover (replacing the modal), and reshapes the right-side topbar group with a mobile "More" menu so secondary items hide behind a kebab on `< md`. The OrganizationSwitcher's two native `<select>` dropdowns become a single workspace pill that opens a Radix Popover with both tenant and organization controls (Vercel/Linear pattern). The notification badge swaps red destructive for the brand indigo. The mobile drawer learns to show a `[Main | Settings]` tab strip when the user opens it on a section route so the main nav is one tap away.

**In scope:**

- New `Sheet` primitive in `packages/ui/src/primitives/sheet.tsx` (Radix Dialog-based, side variants `top|bottom|left|right`, `--topbar-height` aware, backdrop with blur, slide-in animation, built-in or `hideClose` configurable X).
- Sticky topbar header with `bg-background/95 backdrop-blur` glass effect.
- Sidebar collapse toggle moved from topbar into a floating button on the divider line between sidebar and content (`position: fixed`, `z-index: dropdown`).
- OrganizationSwitcher refactored to a single workspace pill that opens a Popover with tenant select + organization list (collapsible to icon-only on `<sm`).
- Inline `TopbarSearchInline` component in `packages/search` — search icon button on `<md` that expands into a 320 px input with anchored results popover on click; `⌘K` shortcut still works.
- Notification panel rewritten on top of the new `Sheet` primitive, matched to Figma node 4316:44104 (clean header with indigo "Mark all as read" link + close X, underline-style tabs with indigo badge on "Unread", description-row time + chip layout in notification items, footer with `↑↓ to navigate · Manage notifications`).
- Notification count badge color: `bg-destructive` → `bg-accent-indigo` with a `ring-2 ring-background` halo for definition.
- AI launcher icon color: `text-brand-violet` → `text-accent-indigo` (DS-aligned).
- Mobile drawer header tightened (lucide `X` close button, opaque shadow, `bg-black/50 backdrop-blur-sm` backdrop) + `[Main | Settings]` tab strip when opened on a section route.
- Mobile "More" menu: `MoreHorizontal` icon-only button on `<md` that opens a Popover with Integrations / Settings / Messages links (those three hidden inline on `<md`).
- Topbar item order: `AI · Search · OrgSwitcher · Integrations · Settings · Messages · Notifications · Profile` (Profile always last, Notifications adjacent to Profile per SaaS convention).

**Out of scope (deferred):**

- AI Chat Command Palette modal redesign — separate effort, needs Figma reference and is its own scope (deep multi-phase flow with chat history + tool calls + debug panel).
- Global Search dialog redesign — replaced by `TopbarSearchInline` in this PR; the legacy `GlobalSearchDialog` remains in repo but is no longer wired into the chrome. Cleanup (delete file / remove from i18n / migrate any remaining settings page references) deferred.
- Breadcrumbs Steps 2–5 (coverage sweep, schema enforcement, Settings page for breadcrumb config, Portal API) — tracked in the breadcrumb spec.

---

## Problem Statement

### P1 — Topbar visual chaos

`packages/ui/src/backend/AppShell.tsx:1209-1330` rendered the topbar header with `gap-1 md:gap-2`, `px-3 lg:px-4 py-2 lg:py-3`, and a flat right-side row of 8 differently-sized icon buttons (sizes mixed `size-7` / `size-8` / `size-9`, variants mixed `outline` for hamburger/collapse vs `ghost` for everything else). The OrganizationSwitcher inside that row rendered two native `<select>` elements at `h-9` (36 px) — taller than the `size-7` icon buttons next to it, with browser-default dropdown chrome that did not match any DS primitive.

### P2 — Notification panel UX

`packages/ui/src/backend/notifications/NotificationPanel.tsx` rolled its own `position: fixed` overlay with `bg-black/20` backdrop. The panel header rendered `<Bell> Notifications` again even though the topbar bell was already the trigger that opened the panel — semantic duplication. The tabs used the `Tabs` primitive (pill-style active) instead of Figma's underline-style. The notification count badge in `NotificationCountBadge.tsx` used `bg-destructive` (red) which felt over-aggressive for a count indicator and did not match the indigo brand palette used elsewhere.

### P3 — Sidebar collapse toggle in the topbar

The desktop sidebar collapse/expand IconButton sat inside the topbar's left-side flex group, between the mobile hamburger and the breadcrumb. On wide enough screens this was fine, but it competed for breadcrumb width and the variant (`outline`) clashed with the breadcrumb's quieter typography. The button also is a sidebar control — putting it on the sidebar's right edge (Notion / Vercel pattern) is more discoverable and frees topbar space for the breadcrumb.

### P4 — Mobile drawer dead-ends

When the user navigated to a `/backend/settings/*` route on mobile and tapped the hamburger, the drawer auto-switched to the Settings section sub-navigation (because `renderSidebar` checks `sidebarMode`). There was no UI to switch back to the main nav — the user had to navigate away from Settings entirely (e.g. via the breadcrumb home icon) and re-open the drawer. On desktop the two-level sidebar (PR #1790) shows both navs side by side, which papered over the bug.

### P5 — Topbar overflow on `< md`

At 390 px (iPhone 12 Pro / 13 / 14 / Pro Max), the right-side group with 8 items at 32 px each plus the OrgSwitcher pill at ~200 px exceeded the viewport width. The `shrink-0` on the right group caused the breadcrumb to be pushed off-screen entirely, leaving only the home icon and a dangling chevron with no current-page label.

### P6 — Global Search modal-only

The global search `⌘K` modal worked but required a click on the topbar trigger (or the keyboard shortcut) to open a full Dialog. Most SaaS apps now expose the search field inline in the topbar so the user can start typing without an intermediate trigger — and the modal still wraps query state, results, indexing status, and perspectives.

---

## Proposed Solution

### A new `Sheet` primitive

`packages/ui/src/primitives/sheet.tsx`, ~130 lines, built on `@radix-ui/react-dialog` with cva variants:

```typescript
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@open-mercato/ui/primitives/sheet'

<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="right">
    <SheetHeader>
      <SheetTitle>Notifications</SheetTitle>
    </SheetHeader>
    {/* body content */}
  </SheetContent>
</Sheet>
```

| Variant | Behavior |
|---|---|
| `side="top"` | Slides from top, full width, border-bottom |
| `side="bottom"` | Slides from bottom, full width, border-top |
| `side="left"` | Slides from left, `w-3/4 sm:max-w-md`, border-right |
| `side="right"` (default) | Slides from right, `w-full sm:max-w-md`, border-left |

All variants:

- Read `--topbar-height` CSS variable (set on the AppShell outer container to `61px`) so they render below the sticky topbar, not on top of it. Falls back to `0px` when the variable is not set (use outside AppShell, e.g. in unit tests).
- Backdrop: `bg-black/40 backdrop-blur-sm` with `fade-in-0` / `fade-out-0` animations.
- Content: `slide-in-from-<side>` / `slide-out-to-<side>` animations driven off Radix's `data-state` attribute (open/closed durations 300 ms / 200 ms).
- Built-in close `<X>` button at `top-4 right-4`, can be hidden via `hideClose` prop when the consumer renders its own close affordance inline with other header actions.

### Topbar layout

Header:

```diff
- <header className="border-b bg-background/80 px-3 lg:px-4 py-2 lg:py-3 flex items-center justify-between gap-2">
+ <header className="sticky top-0 z-[var(--z-index-sticky)] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 sm:px-4 lg:px-6 py-3 flex items-center justify-between gap-2 sm:gap-3">
```

Right group:

```diff
- <div className="flex items-center gap-1 md:gap-2 text-sm shrink-0">
+ <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 text-sm shrink-0">
```

Order in `apps/mercato/src/components/BackendHeaderChrome.tsx`:

```
AI · Search · OrgSwitcher · Integrations · Settings · Messages · MoreMenu(<md) · Notifications · Profile
```

Notifications adjacent to Profile (so the unread badge sits near the user's avatar — easier to scan), Profile always last (universal SaaS convention), MoreMenu only renders on `<md` and contains Integrations + Settings + Messages (which are hidden inline on `<md` via `hidden md:contents`).

### Sidebar toggle on the divider line

Removed from the topbar's left group. Now a fixed-position button:

```tsx
<button
  type="button"
  onClick={() => setCollapsed((c) => !c)}
  className="hidden lg:flex fixed top-4 z-[var(--z-index-dropdown)] size-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-all hover:text-foreground hover:bg-muted"
  style={{ left: `calc(${asideWidth} - 14px)` }}
>
  {effectiveCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
</button>
```

- `position: fixed` so it does not scroll with the page (sidebar is sticky).
- `left: calc(${asideWidth} - 14px)` centers the 28 px button on the 1 px border-r line between sidebar and content; `asideWidth` swaps between `80px` (collapsed) and the expanded sidebar width.
- `z-index: dropdown` (20) — above the sticky topbar (z-index 10) but below any modal/overlay (z-index 30 / 40), so the notification Sheet and any future modal renders on top.
- Hidden on `<lg` because the mobile drawer uses a different paradigm (hamburger trigger).

### OrganizationSwitcher → workspace Popover

Two native `<select>` → one trigger button + Radix Popover:

```tsx
<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
  <PopoverTrigger asChild>
    <button className="inline-flex h-8 w-8 sm:w-auto items-center gap-2 rounded-md border ... sm:max-w-[200px] md:max-w-[260px]">
      <Building2 className="size-4 shrink-0 text-muted-foreground" />
      <span className="hidden sm:block truncate flex-1 text-left">{activeOrgLabel}</span>
      <ChevronDown className="hidden sm:block size-4 shrink-0 text-muted-foreground" />
    </button>
  </PopoverTrigger>
  <PopoverContent align="end" className="w-[320px] p-0">
    {showTenantSelect && <TenantSection />}
    <div className="p-2">
      <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        Organization
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {showAllOption && <AllOrganizationsRow />}
        {flatOrgOptions.map((opt) => (
          <button onClick={() => { handleChange(opt.id); setPopoverOpen(false) }}>
            <span style={{ paddingLeft: `${0.5 + opt.depth * 0.75}rem` }}>{opt.label.trim()}</span>
            {value === opt.id && <Check className="size-4 text-accent-indigo" />}
          </button>
        ))}
      </div>
    </div>
    {canManage && <ManageLink />}
  </PopoverContent>
</Popover>
```

- Tenant select rendered inline inside the popover (only when super-admin + multiple tenants) using the new DS `Select` primitive (not the legacy native one).
- Organization list rendered as clickable rows with depth-based indent (`paddingLeft: 0.5rem + depth × 0.75rem`); active row gets a `<Check>` icon in `text-accent-indigo`.
- Sentinel value `__all__` for the "All organizations" option (DS Select forbids `null` values).
- On `<sm` the trigger collapses to an icon-only square (32 × 32) and the popover is unchanged; the `Building2` icon is the only visible affordance.

### Inline search

Replaces `GlobalSearchDialog` as the topbar trigger. New file: `packages/search/src/modules/search/frontend/components/TopbarSearchInline.tsx`. Two render modes:

| State | UI |
|---|---|
| Collapsed (default) | 36 × 36 ghost icon button with `<Search>` icon |
| Expanded | 320 px input row with search icon prefix, `<input type="text">`, clear `<X>` button or `⌘K` kbd, anchored popover with results below |

Click on the icon (or `⌘K` shortcut) expands the input and focuses it. Click outside or pressing Escape with an empty query collapses back. Mobile (`< sm`) uses absolute positioning when expanded so the input overlays the rest of the topbar instead of overflowing.

The popover:

- Renders below the expanded input (`absolute top-[calc(100%+4px)]`).
- Lists up to 10 results from `fetchGlobalSearchResults` (same backend as the legacy modal).
- Each result has a 28 × 28 icon placeholder + title + `{entity type} · {subtitle}` description.
- Keyboard nav: `ArrowUp` / `ArrowDown` cycle selection, `Enter` opens, `Escape` clears or collapses.
- Scope hint banner ("Scoped to current organization") shows when the org cookie is set to a specific organization.
- Vector-warning banner shows when no embedding provider is configured, with a deep link to `/backend/config/search`.

### Notification panel rewrite (Figma 4316:44104)

`packages/ui/src/backend/notifications/NotificationPanel.tsx` rebuilt on top of the `Sheet` primitive. Layout, top to bottom:

1. **Header** (`px-5 py-4 border-b`): `<SheetTitle>` "Notifications" at `text-base font-medium leading-6 tracking-tight`; on the right, an indigo "Mark all as read" link button (only when `unreadCount > 0`) and an explicit `<X>` close `IconButton` (always rendered, addresses the "no close affordance on mobile" complaint when `hideClose` was used).
2. **Tabs** (`px-5 py-3.5 border-b`): inline `<button role="tab">` items "All / Unread / Action Required" with underline-style active state (`bottom-[-14px] h-0.5 bg-foreground` absolutely positioned under the active tab). "Unread" tab shows an indigo `min-w-4` badge with the unread count.
3. **List** (`flex-1 overflow-y-auto overflow-x-hidden`): each `NotificationItem` rendered with a 40 × 40 severity-tinted avatar (severity → `bg-status-{info|warning|success|error}-bg`), title row, description row with `2 days ago · #ORDER-... · 0 USD · Assigned to you` (inline text with mid-dots so it wraps naturally on narrow viewports), optional message bubble (asymmetric `rounded-tl-sm rounded-tr-lg rounded-bl-lg rounded-br-lg` per Figma), optional actions row (Deny outlined / Approve indigo-filled), and a floating dismiss `<X>` on hover at `right-2 top-2`.
4. **Footer** (`px-5 py-3.5 border-t text-xs`): `Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate · Manage notifications` link (Settings icon + label, links to `/backend/config/notifications`).

Custom renderers (e.g. `SalesOrderCreatedRenderer`) rewritten to match the same layout — vertical indigo bar removed, primary action recolored to `bg-accent-indigo`, description row inlined with separator dots, time pulled from above-title position into the description row.

### Notification count badge — indigo, not destructive

```diff
- <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-overline font-medium text-destructive-foreground">
-   {count > 99 ? '99+' : count}
- </span>
+ <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-indigo px-1 text-overline font-medium text-accent-indigo-foreground ring-2 ring-background">
+   {count > 99 ? '99+' : count}
+ </span>
```

Plus the in-panel `unreadCount` badge inside `NotificationPanel.tsx` and on the "Unread" tab use the same `bg-accent-indigo` token. Rationale: brand consistency, less aggressive visual tone, indigo is the established "primary" feedback color (Checkbox, Radio, focus rings).

### Mobile drawer with section tab strip

New state `mobileDrawerView: 'auto' | 'main'` in `AppShellBody`:

```tsx
const [mobileDrawerView, setMobileDrawerView] = React.useState<'auto' | 'main'>('auto')
React.useEffect(() => {
  if (!mobileOpen) setMobileDrawerView('auto')
}, [mobileOpen])
```

When the drawer opens on a `/backend/settings/*` or `/backend/profile/*` route (`sidebarMode !== 'main'`), a `<div role="tablist">` strip renders at the top of the drawer body with two tabs: `Main` and the section title (`Settings` / `Profile`). The active tab is underlined; tapping `Main` calls `setMobileDrawerView('main')` which is then passed as `forceMainOnly={true}` to `renderSidebar`, swapping the drawer content to the main nav without leaving the current route. Closing the drawer resets the override back to `'auto'`.

### Mobile More menu

`apps/mercato/src/components/BackendHeaderChrome.tsx` wraps Integrations + Settings + Messages in `<span className="hidden md:contents">` (so they render inline on `md+` with no wrapper layout impact) and renders a `<MobileMoreMenu>` button on `<md`. The button is a `MoreHorizontal` icon-only ghost `IconButton` that opens a Radix Popover with the three items as clickable rows (icon + label, navigates on click, closes the popover automatically).

---

## Architecture

### Files added

| File | Purpose |
|---|---|
| `packages/ui/src/primitives/sheet.tsx` | New Sheet primitive (Radix Dialog wrapper, side variants, `--topbar-height` aware, slide animations) |
| `packages/search/src/modules/search/frontend/components/TopbarSearchInline.tsx` | Inline search trigger + popover (replaces `GlobalSearchDialog` as topbar wiring) |
| `.ai/specs/2026-05-14-topbar-redesign.md` | This spec |

### Files modified

| File | Change |
|---|---|
| `packages/ui/src/backend/AppShell.tsx` | Sticky header with backdrop blur; sidebar toggle moved out of topbar to fixed-position divider button; `--topbar-height` CSS var set on outer container; mobile drawer header tightened (lucide `X`, opaque shadow, darker backdrop); mobile drawer section tab strip with `mobileDrawerView` state; right-group gap + padding tightened on `<sm` |
| `apps/mercato/src/components/BackendHeaderChrome.tsx` | Topbar item order (AI → Search → OrgSwitcher → Integrations → Settings → Messages → MoreMenu → Notifications → Profile); `LazyGlobalSearchDialog` → `LazyTopbarSearchInline`; `MobileMoreMenu` component for `<md` secondary items |
| `apps/mercato/src/components/OrganizationSwitcher.tsx` | Two native selects → single Popover trigger with tenant + organization sections; icon-only on `<sm` (`w-8 h-8 sm:w-auto`); DS `Select` primitive replaces native `<select>` in tenant inline picker |
| `packages/ui/src/backend/notifications/NotificationPanel.tsx` | Rebuilt on `Sheet` primitive; Figma-aligned header + tabs + footer; uppercase section labels at `text-[10px] tracking-wider`; indigo "Mark all as read" link + explicit `X` close button; inline tab strip with underline-style active state; `overflow-x-hidden` on scroll container as defensive clip |
| `packages/ui/src/backend/notifications/NotificationItem.tsx` | Full rewrite per Figma item layout — 40 × 40 severity-tinted avatar with optional indigo unread ring dot, mixed-weight title row, inline description with `time · source` separator, optional message bubble (asymmetric corners) and actions row, floating dismiss X on hover |
| `packages/core/src/modules/sales/widgets/notifications/SalesOrderCreatedRenderer.tsx` | Custom renderer realigned to Figma — vertical indigo bar removed, time moved from above-title to description row, indigo primary action, outline secondary, description row wraps naturally with `whitespace-nowrap` on atomic phrases |
| `packages/ui/src/backend/notifications/NotificationCountBadge.tsx` | `bg-destructive` → `bg-accent-indigo` with `ring-2 ring-background` halo, `min-w-5 px-1` for "99+" support |
| `packages/ui/src/ai/AiIcon.tsx` | `text-brand-violet` → `text-accent-indigo` |
| `packages/ui/src/primitives/breadcrumb.tsx` | Cross-spec note: breadcrumb primitive added in the same PR per [`2026-05-05-breadcrumbs-ds-redesign.md`](2026-05-05-breadcrumbs-ds-redesign.md) Step 1 |
| `apps/mercato/src/i18n/{en,pl,de,es}.json` | New keys: `appShell.moreActions`, `backend.nav.main`, plus the `appShell.breadcrumb.collapsed` from the breadcrumb spec |
| `packages/core/src/modules/notifications/i18n/{en,pl,de,es}.json` | New keys: `notifications.close`, `notifications.unreadSummary`, `notifications.footer.useHint`, `notifications.footer.toNavigate`, `notifications.footer.manage` |
| `packages/search/src/modules/search/i18n/{en,pl,de,es}.json` | New keys: `search.dialog.actions.clear`, `search.dialog.warnings.configureLink` |
| `.ai/ui-components.md` | New `Sheet` section + Breadcrumb section (per breadcrumb spec) |
| `packages/ui/AGENTS.md` | Quick reference rows for `Sheet` and `Breadcrumb` |

### Files retained but unwired

| File | Status |
|---|---|
| `packages/search/src/modules/search/frontend/components/GlobalSearchDialog.tsx` | Still in repo, exports preserved. No longer wired into the topbar chrome (`TopbarSearchInline` is the new mount). Cleanup (delete file, remove i18n keys, audit references) tracked as a follow-up. |

---

## Data Models

No data model changes. The notification panel reads the same `NotificationDto` and the OrganizationSwitcher reads the same `OrganizationSwitcherPayload` as before.

---

## API Contracts

No API changes. `TopbarSearchInline` uses the same `/api/search/search` endpoint as the legacy dialog via `fetchGlobalSearchResults`.

---

## Migration & Backward Compatibility

| Surface | Classification | Notes |
|---|---|---|
| `Sheet` primitive | NEW | Purely additive; no migration |
| `TopbarSearchInline` component | NEW | Additive; legacy `GlobalSearchDialog` export preserved for any external consumer |
| `OrganizationSwitcher` props | UNCHANGED | Internal component, default export signature unchanged |
| `NotificationPanel` props | UNCHANGED | Internal component, props unchanged |
| `NotificationItem` props | UNCHANGED | Internal component, custom renderers (`customRenderer` prop) keep their signature |
| `AiIcon` props | UNCHANGED | Only the default text color class changed |
| `NotificationCountBadge` props | UNCHANGED | Only the visual treatment changed |
| `appShell.openMenu` / `appShell.toggleSidebar` i18n keys | UNCHANGED | Reused; new keys added separately |
| `search.dialog.*` i18n keys | UNCHANGED | New keys (`clear`, `configureLink`) added; existing keys reused by `TopbarSearchInline` |
| `notifications.*` i18n keys | UNCHANGED | New keys (`close`, `unreadSummary`, `footer.*`) added; existing keys retained |
| `--topbar-height` CSS variable | NEW | Set to `61px` on the AppShell outer container. Defaults to `0px` via `var(--topbar-height,0px)` fallback in `Sheet` for code paths outside AppShell. |

No breaking changes. Third-party modules that imported `GlobalSearchDialog` from `@open-mercato/search/modules/search/frontend` continue to receive the same export. The visual treatment of `AiIcon` and `NotificationCountBadge` changed but their props did not — downstream consumers that explicitly override `className` get the same precedence as before.

---

## Integration Test Coverage

| Test | Source | Type |
|---|---|---|
| `AppShell` breadcrumb rendering (existing) | breadcrumb spec Step 1 | unit — should not regress |
| Sticky header renders with `position: sticky` and `z-index: var(--z-index-sticky)` | new | unit (could add to `AppShell.test.tsx`) |
| Mobile drawer section tab strip switches `mobileDrawerView` state | new | unit (could add to `AppShell.test.tsx`) |
| `Sheet` primitive — side variants render correct slide-in classes | new | unit (recommended: `packages/ui/src/primitives/__tests__/sheet.test.tsx`) |
| `Sheet` primitive — `--topbar-height` CSS var picked up via inline style cascade | new | unit |
| Notification panel — uses `Sheet` with `side="right"` and matches Figma layout (header + tabs + footer present) | new | unit (extend `NotificationPanel.test.tsx`) |
| `TopbarSearchInline` — collapsed → expanded on click, expanded → collapsed on Escape with empty query | new | unit (recommended new file) |
| `OrganizationSwitcher` — Popover opens on trigger click, selecting an org calls `handleChange` and closes popover | existing | unit — should not regress |

The PR ships with: 11 new tests for the breadcrumb primitive (per breadcrumb spec) and 23 unit + 67 component tests passing in `@open-mercato/ui`. Six DOM-bound suites in the AI assistant module that depend on built artifacts are skipped (cannot resolve module without a fresh `yarn build:packages`); this is pre-existing and not caused by this PR.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Sheet `top-[var(--topbar-height,60px)]` falls back to 60 px outside AppShell — could mis-position when consumed elsewhere | Medium | Any future Sheet consumer outside AppShell | Default fallback is conservative (60 px); consumers can override with the `top-*` className or pass an inline `style={{ '--topbar-height': '0px' }}` on the closest positioned ancestor. Sheet primitive docs call out the variable. | Low; the var is documented and the fallback is a sensible default. |
| Inline search expanded width on `<sm` uses `absolute inset-x-3` overlay — collides with header content if header z-index changes | Medium | Mobile topbar when search expanded | Search container has `z-popover` (45) when expanded, above the sticky header (z-index 10) and above the floating sidebar toggle (z-index 20). Updates to the z-index hierarchy must keep this ordering. | Low; documented in the file and in this spec. |
| `OrganizationSwitcher` icon-only on `<sm` loses textual context (the active org name disappears) | Low | Mobile workspace context | `aria-label` on the trigger reads `Organization: <active name>`, so screen readers still announce the context. `title` attribute provides a hover tooltip on devices with hover. The popover content shows the full label. | Low. |
| Notification count badge `ring-2 ring-background` may render incorrectly on dark backgrounds | Low | Future dark mode work / printable views | The ring color follows the `--background` CSS variable, so dark mode and printable views inherit a matching halo automatically. | None expected. |
| `MobileMoreMenu` duplicates link logic — Integrations/Settings/Messages exist as inline components AND as menu items | Medium | Maintenance | Items are derived from the same `useBackendChrome` payload (feature flags / visibility checks) using a single `useMemo` so the two surfaces stay in sync. If a new secondary item is added, the inline `<span className="hidden md:contents">` block AND the `mobileMoreItems` list need both touched. | Low — surfaced in this spec and in `BackendHeaderChrome.tsx` comments. |
| Mobile drawer section tab strip — when the user is on a non-section route, the tab strip is hidden; if they navigate from settings to a non-settings page with the drawer open, the strip should re-evaluate | Low | Mobile drawer state | The `mobileDrawerView` effect resets to `'auto'` when the drawer closes; the strip renders conditionally on `sidebarMode`, which is derived from `pathname`. Navigating mid-drawer-open is unlikely but works correctly because of the effect. | Low. |
| Legacy `GlobalSearchDialog.tsx` stays in repo, unwired — dead code risk | Low | Search module | Cleanup tracked as follow-up. Until then, the file is opt-in (no consumer imports it). Memory cost is one source file (~488 lines), no runtime cost. | None until cleanup. |
| The breadcrumb spec's Step 2 (coverage sweep for 134 missing `breadcrumb` entries in `page.meta.ts`) is NOT in this PR | High | All backend pages that previously rendered only the auto-Dashboard root | Documented in the breadcrumb spec changelog and surfaced again here. The redesigned breadcrumb primitive works correctly with the existing partial coverage; Step 2 is a mechanical sweep tracked separately. | Acceptable — users see the same breadcrumb content they did before, just rendered through the new primitive. |

---

## Final Compliance Report

### DS rules ([`.ai/ds-rules.md`](../ds-rules.md))

- Semantic tokens only across all new code: `text-foreground`, `text-muted-foreground`, `text-text-disabled`, `bg-background`, `bg-muted`, `bg-accent-indigo`, `text-accent-indigo`, `text-accent-indigo-foreground`, `border-input`, `border` (defaults to `border-border`), status-* tints. No hex literals, no Tailwind shade utilities (`bg-red-500` etc.), no `dark:` overrides in this PR.
- Notification count badge swapped from `bg-destructive` to `bg-accent-indigo` per user-confirmed UX direction.
- AI sparkle icon swapped from `text-brand-violet` to `text-accent-indigo` per user direction (brand consistency with the indigo accent used elsewhere).
- No arbitrary spacing values inside primitives (`Sheet`, `Breadcrumb`); arbitrary values used in `BackendHeaderChrome.tsx` and `AppShell.tsx` are CSS-variable consumers (`top-[var(--topbar-height,0px)]`, `left: calc(${asideWidth} - 14px)`) — these are framework integrations, not raw pixel literals.
- One typography exception: `text-[10px]` used for section labels inside the OrganizationSwitcher popover and notification panel — matches the Figma "Subheading/2X Small" 11 px reading; documented inline.

### Component MVP compliance

- ARIA: `Sheet` inherits Radix Dialog's `role="dialog"`, `aria-modal="true"`, focus trap, and Escape-to-close. Notification panel has `aria-label` via `SheetTitle`. Mobile drawer tab strip uses `role="tablist"` + `role="tab"` + `aria-selected`. OrganizationSwitcher trigger has `aria-label="Organization: <name>"`.
- Keyboard: Sheet supports Escape and click-outside to close (Radix default). `TopbarSearchInline` supports `ArrowUp` / `ArrowDown` / `Enter` / `Escape` in the input. `MobileMoreMenu` follows Radix Popover keyboard conventions.
- Reduced motion: Sheet animations use Tailwind `tw-animate-css` utilities (`slide-in-from-right`, etc.) which respect `prefers-reduced-motion: reduce` via the underlying keyframes.

### BC compliance

- All new primitives are additive (`Sheet` is new). No DS primitive's exports were removed or renamed.
- `GlobalSearchDialog` is unwired but retained as an export — third-party consumers (if any) continue to import it successfully.
- No DB schema changes. No CLI changes. No event ID changes. No widget injection spot ID changes.

---

## Changelog

- **2026-05-14** — Initial spec, covering the topbar + notifications work that landed in the same PR as the breadcrumb DS primitive ([`2026-05-05-breadcrumbs-ds-redesign.md`](2026-05-05-breadcrumbs-ds-redesign.md) Step 1). Anchored on Figma DS files [`Notifications [Examples]`, node 4316-44104](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=4316-44104) and [`Notifications`, node 4316-45303](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=4316-45303). UX decisions captured during implementation: Mobile drawer tab strip (`Main` / `Settings|Profile`) rather than a "Back to Main" link, because tab affordance is more discoverable. Notification panel close X kept explicit (visible in header) rather than relying solely on backdrop-click / Escape because the mobile virtual keyboard makes Escape impractical. Workspace switcher uses a single Popover trigger (Vercel / Linear pattern) instead of two adjacent dropdowns. Topbar item order swap (Notifications → Profile last) per universal SaaS convention. Sidebar toggle moved to divider line (Notion pattern). AI Chat command palette redesign and `GlobalSearchDialog` cleanup deferred — separate follow-up.
