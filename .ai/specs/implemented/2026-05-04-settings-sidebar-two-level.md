# Two-Level Sidebar for Settings & Profile Modes

## TLDR

When the user navigates to `/backend/settings/*` or `/backend/profile/*`, the current `AppShell` *replaces* the main sidebar with a section sub-nav, completely hiding the main navigation. Users lose context — they can't see Dashboard / Customers / Sales / Workflow Engine while configuring settings, and the only way back to the main menu is the settings ⚙ icon in the topbar.

This spec ships **Option B** (selected by Piotr) of the design exploration in [`.ai/mockups/2026-05-04-settings-sidebar-two-level/index.html`](../mockups/2026-05-04-settings-sidebar-two-level/index.html): the main sidebar collapses to icons (80px) and the section sub-nav (240px) sits **alongside** it. The main sidebar stays visible (icons + tooltips) so users keep full app context. A single "← Settings" link at the top of the section pane returns to the main route.

**In scope:**

- Two-level desktop layout for `sidebarMode === 'settings' | 'profile'`.
- Auto-collapse the main sidebar on entry, restore previous expansion on exit.
- New `forceMainOnly` opt-in for `renderSidebar()` so the desktop main aside renders main nav even when `sidebarMode !== 'main'`.
- New `renderSectionAside()` helper composing chevron + title (clickable Back-to-Main link) + section nav with `hideSearch=true` to prevent state collision with the main nav search.
- Smooth `transition-[grid-template-columns,width,padding]` when the user toggles collapse/expand within a mode.
- Static bottom gradient on the section aside to mask the iOS native scroll indicator.
- New i18n key `backend.nav.settings` (en/pl/de/es).
- 5 new unit tests in `AppShell.test.tsx`.

**Out of scope:**

- Mobile drawer behavior (kept as-is — the swap layout fits a 260px drawer better than two stacked levels).
- Section sub-nav search (was removed because it shared global `navQuery` state with the main nav search; if needed later, give section its own state).
- Animating the *enter/exit* of section mode (CSS Grid does not interpolate between different track counts; a smooth slide-in would require always rendering a 3-track grid with width 0/240, larger refactor).
- **Topbar ⚙ active state.** The mockup gives the topbar settings icon `class="icon-btn active"` when `sidebarMode === 'settings'`. The real topbar in `AppShell.tsx:1084` (`renderedTopbarInjectedActions`) renders injected menu items (`menu:topbar:actions`) without consulting `pathname` for active styling. Adding it requires comparing `item.href` against `sidebarMode` + applying `aria-current="page"` and an active class on the rendered `<Link>` / `<Button>`. Trivial change (~5 lines) but spans a different surface (topbar injection rendering, not sidebar). Deferred to a follow-up so this PR stays scope-clean.
- **Sidebar width tokenization.** The widths `'240px'` and `'80px'` remain hardcoded in `AppShell.tsx` (`expandedSidebarWidth`, the new section aside, and the grid-template-columns literals). `apps/mercato/src/app/globals.css` already defines `--sidebar-*` color tokens but no width tokens. Centralizing as `--sidebar-width` / `--sidebar-collapsed-width` would simplify future density / responsive work, but is pre-existing tech debt — this spec doesn't add new hardcoded literals beyond what was already there for the same value, and a width-token sweep is its own change.
- Portal (`PortalShell`) — customer portal has its own shell and no settings/profile mode today.

---

## Overview

`AppShell` (`packages/ui/src/backend/AppShell.tsx`) is the shared backend chrome — it renders the sidebar, topbar, breadcrumb, and the page content slot for every route under `/backend/*`. It already distinguishes three modes via `sidebarMode: 'main' | 'settings' | 'profile'`, derived from the URL path against `settingsPathPrefixes` / `profilePathPrefixes`. Today the sidebar-render code path uses an early-return inside `renderSidebar()` for the two non-main modes, swapping the entire sidebar content rather than layering a second pane.

This spec keeps the existing mode detection unchanged and the existing section data structures (`SectionNavGroup[]`) intact. Only the layout layer changes: when in section mode, instead of a single swapped pane, we render the main pane (forced into icons-only mode) and a second 240px section pane alongside it. Mobile drawer keeps the swap layout because two stacked levels do not fit a 260px drawer.

---

## Problem Statement

### P1 — Lost context on settings/profile entry

Current behavior (`packages/ui/src/backend/AppShell.tsx:771-797` before this change) early-returns `renderSectionSidebar(...)` from inside `renderSidebar()` when `sidebarMode === 'settings'` or `'profile'`. The `<aside>` width stays the same but its **entire contents** are swapped: main groups (Dashboard, Customers, Sales, Workflow Engine, …) disappear and only the section list (Auth, System, Personalizacja, …) is shown.

Users explicitly raised the regression:
- "Po kliknięciu ⚙ main sidebar ZNIKA. User traci całkowicie kontekst gdzie jest w aplikacji" (Piotr, mockup explainer).
- The only return path is the topbar settings icon — non-discoverable from inside settings.

### P2 — Search input shares state across both panes

The same `Input` component (`AppShell.tsx:606-627`) renders inside `renderSectionSidebar` and the main sidebar fallback, both bound to the global `navQuery` / `setNavQuery` state. If we naïvely render both panes side-by-side, typing in the section search would also filter the main nav (icons disappear), reproducing the issue captured in Piotr's screenshot.

---

## Proposed Solution

Render **both** panes side-by-side on desktop when in section mode:

| Mode | Grid columns (desktop, `lg:`) |
|---|---|
| Main, expanded | `[240px_1fr]` |
| Main, collapsed | `[80px_1fr]` |
| Settings/Profile, default (auto-collapsed main) | `[80px_240px_1fr]` |
| Settings/Profile, user-expanded main | `[240px_240px_1fr]` |

Mobile drawer is unchanged (still swaps on a single 260px drawer).

The section pane has a single header element: `<Link href="/backend">` containing a chevron-left icon + the section title (`Settings` / `Profile`). Visually it reads as a back affordance with the title baked in. `aria-label="Back to Main"` keeps screen readers explicit.

---

## Architecture

### `renderSidebar()` — new optional `forceMainOnly` param

`packages/ui/src/backend/AppShell.tsx`

```ts
function renderSidebar(compact: boolean, hideHeader?: boolean, forceMainOnly?: boolean) {
  // ...loading skeleton...
  if (!forceMainOnly && sidebarMode === 'settings' && resolvedSettingsSections?.length) { /* swap */ }
  if (!forceMainOnly && sidebarMode === 'profile' && resolvedProfileSections?.length) { /* swap */ }
  // ...main nav fallback...
}
```

Mobile drawer (line ~1210) still calls `renderSidebar(false, true)` without the third arg, preserving the swap behavior on small screens.

Desktop main aside (line ~1119) calls `renderSidebar(effectiveCollapsed, false, isSectionView)` — the third arg suppresses the early-return so main nav always renders alongside the section pane.

### `renderSectionAside()` — new helper

```ts
function renderSectionAside() {
  // resolve sections + title for current mode
  // return:
  //   <div flex h-full flex-col gap-2>
  //     <Link href="/backend" aria-label="Back to Main">
  //       <ChevronLeft /> {title}
  //     </Link>
  //     <div min-h-0 flex-1>
  //       {renderSectionSidebar(sections, title, false, /* hideHeader */ true, /* hideSearch */ true)}
  //     </div>
  //   </div>
}
```

`hideSearch=true` is a new param on `renderSectionSidebar` — without it, the section pane would render its own copy of the search Input bound to the same global `navQuery` state, filtering the main nav as the user types.

### Auto-collapse with restore

```ts
const collapsedBeforeSectionRef = React.useRef<boolean | null>(null)
const previousSidebarModeRef = React.useRef<'main' | 'settings' | 'profile'>('main')
React.useEffect(() => {
  const previous = previousSidebarModeRef.current
  if (previous === 'main' && sidebarMode !== 'main') {
    collapsedBeforeSectionRef.current = collapsed
    if (!collapsed) setCollapsed(true)
  } else if (previous !== 'main' && sidebarMode === 'main' && collapsedBeforeSectionRef.current !== null) {
    setCollapsed(collapsedBeforeSectionRef.current)
    collapsedBeforeSectionRef.current = null
  }
  previousSidebarModeRef.current = sidebarMode
}, [sidebarMode, collapsed])
```

The ref defaults to `'main'` (not `sidebarMode`) so that **direct mounts** on `/backend/settings/*` also auto-collapse. If we used `useRef(sidebarMode)`, a direct mount would set ref = `'settings'` and the effect's first run would see `previous === 'settings'` (no-op).

### Animations

`transition-[grid-template-columns]` on the grid container and `transition-[width,padding]` on the main aside (both `duration-200 ease-out`). The two interpolations stay in sync because they animate the same `width` value. Animation only plays for toggles **within** a mode; entering/exiting section mode flips between 2-track and 3-track grids, which CSS does not interpolate.

### iOS scroll affordance

A `pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background via-background/80 to-transparent` overlay at the bottom of the section aside masks the native iOS WebKit scroll indicator (which `scrollbar-hide` cannot suppress on iOS Safari). Same visual treatment as the main aside's existing affordance, minus the chevron-bounce state machinery.

---

## Data Models

No data model changes. No new entities, no schema additions, no migrations. The change is presentational only and reads existing `settingsSections` / `profileSections` props (already part of `AppShellProps` and the `/api/auth/admin/nav` payload).

---

## API Contracts

No API changes. `/api/auth/admin/nav` continues to return the same `BackendChromePayload` shape (`groups`, `settingsSections`, `settingsPathPrefixes`, `profileSections`, `profilePathPrefixes`, `grantedFeatures`, `roles`). The new layout consumes these without altering the contract.

---

## Migration & Backward Compatibility

All changes are **additive**:

| Surface | Change | BC |
|---|---|---|
| `renderSidebar(compact, hideHeader)` | Adds optional 3rd param `forceMainOnly?: boolean` | ✅ Optional, defaults to `undefined` (= old behavior) |
| `renderSectionSidebar(sections, title, compact, hideHeader)` | Adds optional 5th param `hideSearch?: boolean` | ✅ Optional, defaults to `undefined` (= old behavior) |
| `AppShellProps` | No change | ✅ |
| `sidebarMode` union | No change | ✅ |
| i18n: `backend.nav.settings` | New key, all 4 locales | ✅ Additive |
| i18n: `backend.nav.backToMain` | Already present, used as `aria-label` | ✅ |
| DOM: section `<aside data-testid="appshell-section-sidebar">` | New conditional sibling element | ✅ Additive — does not appear unless `sidebarMode !== 'main'` |
| Mobile drawer | Unchanged | ✅ |

No data model changes, no API changes, no migrations.

---

## Integration Test Coverage

### Unit tests (this PR)

`packages/ui/src/backend/__tests__/AppShell.test.tsx` — 5 new tests under `describe('two-level sidebar (settings/profile mode)')`:

1. `renders main + section sidebars side-by-side when on a settings path` — verifies both panes coexist (main collapsed; section pane shows `User Entities`).
2. `section header renders chevron + title as a single Back-to-Main link` — verifies `<Link href="/backend">` carries `aria-label="Back to Main"` and visible text equals the section title.
3. `does not render a duplicate search input inside the section sidebar` — verifies `hideSearch=true` prevents the navQuery state collision Piotr reported.
4. `auto-collapses the main sidebar to 80px when mounting directly on a settings path` — verifies the `useRef('main')` initial value catches direct-mount entries.
5. `does not render the section sidebar when on a main route` — verifies `isSectionView` correctly gates the second `<aside>`.

### Existing integration coverage (touched surface)

Full ephemeral run executed locally before push:

- **`TC-INT-006`** (Embedded Settings Headings) — passes
- **`TC-ADMIN-011`** (User Widget Override And Dashboard Enablement) — passes
- **`TC-UX-001b`** (Collapsible Zone 1 Panel) — passes
- 736 / 738 specs pass overall (1 flaky / pre-existing `TC-SALES-005` Maciej-pattern; 1 pre-existing `TC-SEARCH-002` skipped on clean upstream — verified in worktree, unrelated to this change).

### CI inheritance note

`AppShell` renders on every backend page, so virtually every backend integration test exercises this layout indirectly. No new dedicated integration spec is added because the unit tests already cover the structural and behavioral invariants and the existing matrix already exercises the live paths.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Active-bar `<span absolute left-[-12px]>` cropped by a wrapper's `overflow-hidden` | Medium (visual regression of "active route" affordance) | `renderSectionAside` inner wrapper, all section nav items | Removed `overflow-hidden` from the inner wrapper; aside keeps `lg:overflow-hidden`, bar now lands inside aside content area | None observed; covered indirectly by manual QA + the existing nav-active styling (no test asserts pixel-level bar visibility) |
| Search state collision: typing in section pane filters main nav | High (Piotr explicitly screenshotted this regression mid-implementation) | `renderSectionSidebar`, `navQuery` global state | `hideSearch?: boolean` prop on `renderSectionSidebar`; `sectionNavQueryActive = hideSearch ? false : navQueryActive` short-circuits filter logic in the section pane only | None; covered by unit test #3 in `AppShell.test.tsx` |
| Direct mount on `/backend/settings/*` skips auto-collapse | Medium (poor first-load impression — main sidebar at 240px overlaps section pane until user toggles) | `previousSidebarModeRef` initialization | Initialize ref to `'main'` (not `useRef(sidebarMode)`) so the first effect run always sees a transition from main → section | None; covered by unit test #4 |
| iOS native scroll indicator visible at section pane edge | Low (cosmetic, iPad-only) | Section aside scroll area | Static gradient mask at `bottom-0 h-10`; matches the main aside's existing affordance | iOS Safari may still briefly draw the indicator at the start of a fling; not all the way suppressed because Mobile WebKit ignores `scrollbar-width: none` |
| 2-track ↔ 3-track grid transition not smooth | Low (UX nit only on first entry/exit of section mode) | `gridColsClass` swap in caller | Out of scope; toggle within a mode is smooth | Accepted — would need a permanent 3-track grid with animated 0/240 section width; defer to a future polish pass |
| Future modes (e.g. `help`) won't inherit the layout automatically | Low (one-time architecture cost when adding a new mode) | `sidebarMode` union, `renderSectionAside`, `isSectionView` | Helper is mode-agnostic in shape; adding a mode is `union += '\| help'`, plus a branch in the helper, plus widening `isSectionView` | None — adding a mode is a localized 5-minute change |
| Long sessions: rapid mode flips can desync `collapsedBeforeSectionRef` | Low (worst case: main aside stays collapsed after returning to main) | Auto-collapse effect | Effect resets the ref to `null` on every restore; subsequent re-entries snapshot `collapsed` again | None observed; tested locally with rapid back-and-forth between settings → main → settings |
| Topbar ⚙ has no active state (mockup divergence) | Low (UX gap, not a regression — existing behavior) | Out of scope (see Out of scope section) | Defer to follow-up | User may notice ⚙ does not highlight when in settings; existing behavior, not introduced by this PR |

## Final Compliance Report

### DS rules ([`.ai/ds-rules.md`](../ds-rules.md))

- Semantic tokens only: `text-foreground`, `text-muted-foreground`, `bg-background`, `bg-foreground`, `hover:bg-muted`, `from-background via-background/80 to-transparent`. No hex, no Tailwind status-color shades, no `dark:` overrides.
- No arbitrary value spacing (`p-[Npx]`, `text-[Npx]`, `rounded-[Npx]`, `z-[N]`).
- Single arbitrary CSS-property utility used: `transition-[grid-template-columns]` / `transition-[width,padding]` — same pattern as `packages/ui/src/backend/devtools/components/EnricherTiming.tsx` (`transition-[width]`) and `apps/mercato/src/components/ui/input.tsx` (`transition-[color,box-shadow]`). Not a value, a property whitelist — DS-compatible.

### BC compliance

- All public exports unchanged.
- Both `renderSidebar` and `renderSectionSidebar` only gain trailing optional params. Existing callers (mobile drawer, internal early-returns) remain valid.
- No removed/renamed translation keys; one additive key.
- No DB / route / event ID changes.

---

## Changelog

- **2026-05-04** — Initial spec; Option B selected by Piotr from `.ai/mockups/2026-05-04-settings-sidebar-two-level/index.html` (states 1–4). Implemented in `packages/ui/src/backend/AppShell.tsx` with 5 unit tests in `__tests__/AppShell.test.tsx` and one new i18n key (`backend.nav.settings`, en/pl/de/es). Validation: build 18/18, ui 378/378, core 3350/3350, full ephemeral integration 736 passed (1 pre-existing skip + 1 pre-existing flake unrelated to this scope, verified on a clean `upstream/develop` worktree).
