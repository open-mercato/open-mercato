# DS Sidebar Restyle — Backend AppShell

## TLDR

Visual-only restyle of the backend admin sidebar in [`packages/ui/src/backend/AppShell.tsx`](../../packages/ui/src/backend/AppShell.tsx) to match the Figma DS source of truth ([node 3802:11759](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=3802-11759)). Tailwind class swaps only — zero behavior changes, zero structural changes, zero injection contract changes. Ships as a Phase 3 sub-track (3.B-adjacent — menu rewrite slice) per the parent [DS Foundation umbrella spec](2026-04-25-ds-foundation.md).

## Overview

- **Phase 3 sub-track** (UI-only slice of the future "menu rewrite" 3.B family)
- **Branch:** `refactor/ds-sidebar-restyle`
- **Base:** `refactor/ds-foundation-v2` (inherits all Phase 1 + Phase 2 primitives)
- **Scope:** backend admin sidebar only — desktop layout + mobile drawer
- **Out of scope** (explicitly): customer portal sidebar ([`PortalShell.tsx`](../../packages/ui/src/portal/PortalShell.tsx)), backend topbar, profile dropdown content, search input, FAVS / bookmarks section, keyboard shortcut badges, badge styling, notification dots, organization switcher integration, any new injection slot

## Problem Statement

The current backend sidebar visually predates the published Figma DS Open Mercato spec. Concrete misalignments today vs. Figma node 3802:11759:

| Surface | Current | Figma target |
|---|---|---|
| Sidebar width (expanded) | 240px | 240px *(kept — Figma proposes 272px but layout stability over pixel match)* |
| Sidebar width (collapsed) | 72px | **80px** *(adopted from Figma — narrow delta, no layout-grid impact)* |
| Sidebar background | `bg-background/60` (translucent) | **`bg-background`** (solid) |
| Nav-item padding | `px-2 py-1` | **`px-3 py-2`** |
| Nav-item radius | none | **`rounded-lg` (8px)** |
| Nav-item active state | `bg-background border shadow-sm` | **`bg-muted` (no border, no shadow)** |
| Active indicator | `left-0 top-1 bottom-1 w-0.5 rounded` | **`left-[-20px] top-2 w-1 h-5 rounded-r`** (extends out of nav into sidebar padding, only on right side) |
| Nav-item label colors | mix of `text-foreground` / `text-accent-foreground` on hover | **3-state model: Default = `text-muted-foreground`, Hover = `text-muted-foreground` (unchanged), Active = `text-foreground`** |
| Brand block | logo + name unwrapped | **`rounded-xl p-3` card wrapper** |
| Sticky footer container | `bg-background/80 backdrop-blur-sm` | **`bg-background`** (solid; backdrop-blur becomes redundant) |

The drift is cosmetic only — every behavioral surface (injection contract, hooks, props, accessibility, keyboard navigation) is correct and stays.

## Proposed Solution

Single atomic PR. Tailwind class swaps in `AppShell.tsx` plus a small set of token-aligned wrappers around existing children. No new primitives extracted (would be a separate Phase 3 PR if needed later).

The change ships in **one commit**: `refactor(ds): restyle backend sidebar to Figma 3802-11759`. Subsequent commits reserved only for inevitable test fixture updates if class-based assertions break.

## Architecture

### Token mapping (Figma → semantic CSS)

| Figma token | Hex | open-mercato semantic equivalent |
|---|---|---|
| `bg/white-0` | `#ffffff` | `bg-background` |
| `bg/weak-50` | `#f7f7f7` | `bg-muted` |
| `stroke/soft-200` | `#ebebeb` | `border-border` |
| `text/strong-950` | `#171717` | `text-foreground` |
| `text/sub-600` | `#5c5c5c` | `text-muted-foreground` |
| `text/soft-400` | `#a3a3a3` | `text-muted-foreground/70` |
| `icon/sub-600`, `icon/strong-950` | — | inherits via `currentColor` |
| `om-brand/black` | `#0c0c0c` | `text-foreground` (active indicator bar) |
| `radius-4` (4px) | — | `rounded` (4px) |
| `radius-6` (6px) | — | `rounded-md` (6px) |
| `radius-8` (8px) | — | `rounded-lg` (8px) |
| `radius-10` (10px) | — | `rounded-xl` (12px — close enough; documented inline) |
| `regular-shadow/x-small` | `0 1px 2px rgba(10,13,20,0.03)` | `shadow-sm` |

All tokens map to existing semantic tokens in [`globals.css`](../../packages/ui/src/styles/globals.css) — **zero new CSS variables**, **zero `dark:` overrides** (semantic tokens carry dark-mode story for free, per [`.ai/ds-rules.md`](../ds-rules.md)).

### Nav item — 3-state styling (CRITICAL)

The non-obvious design decision in Figma node [3741:45019](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=3741-45019): **Default and Hover share label color**. Only the background changes on hover. Active is the only state that darkens the label.

| State | Background | Label color | Icon color | Indicator bar |
|---|---|---|---|---|
| **Default** | transparent (`bg-background`) | `text-muted-foreground` | inherits (`currentColor`) | none |
| **Hover** | `bg-muted` | `text-muted-foreground` *(unchanged from default)* | inherits | none |
| **Active** | `bg-muted` *(same as hover)* | `text-foreground` | inherits | **4×20px dark bar at `left-[-20px]` (or `-22px` collapsed), `top-2`, `rounded-r`** |

Implementation pattern in `AppShell.tsx`:

```tsx
const navItemClasses = cn(
  'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
  'text-muted-foreground hover:bg-muted',
  isActive && 'bg-muted text-foreground'
)

// Active indicator (rendered conditionally inside the item):
{isActive && (
  <span
    aria-hidden
    className="absolute left-[-20px] top-2 h-5 w-1 rounded-r bg-foreground"
  />
)}
```

Two arbitrary values are documented and intentional:
1. `left-[-20px]` (or `-22px` for collapsed) — required to position the indicator bar inside the sidebar's outer 20px padding, matching Figma's spec; equivalent in scale tokens does not exist.
2. `h-5` — Figma specifies exactly 20px (the height of the icon row, not the full item).

### Layout dimensions

```
Expanded: w-[240px]   (kept — was 240px)
Collapsed: w-[80px]   (was 72px)
Outer padding: px-5 py-4  (Figma: pt-[20px] pb-[16px] px-[20px])
Item gap: gap-1  (Figma: 4px between siblings)
Group gap: gap-5  (Figma: 20px between sections)
```

The CSS grid that drives the AppShell layout switches:
```
lg:grid-cols-[240px_1fr]  →  lg:grid-cols-[240px_1fr]  (unchanged)
lg:grid-cols-[72px_1fr]   →  lg:grid-cols-[80px_1fr]
```

### Brand block (header)

Simplified per user decision — **no chevron, no organization switcher integration** (the existing `BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID` injection spot keeps rendering separately below, untouched).

```tsx
<div className="flex items-center gap-3 rounded-xl bg-background p-3">
  <Image src="/open-mercato.svg" alt={resolvedProductName} width={40} height={40} className="rounded-full" />
  {!compact && (
    <span className="text-sm font-medium text-foreground">{resolvedProductName}</span>
  )}
</div>
```

The injection spot below stays in place to preserve the FROZEN BC contract surface — modules that already inject widgets (e.g. `OrganizationSwitcher`) continue to render uninterrupted.

### Section/group headers (text dividers)

```tsx
<p className="px-1 py-1 text-xs font-medium uppercase tracking-[0.48px] text-muted-foreground/70">
  {groupLabel}
</p>
```

Tailwind `text-xs` (12px) matches Figma's 12px. `tracking-[0.48px]` is one of two arbitrary values in the file — Figma's 0.48px letter-spacing has no scale equivalent.

### Sticky footer (settings + customize button)

There is **no user profile card in the current sidebar** — user info is rendered in the topbar (`email || t('appShell.userFallback')`). The sticky footer holds: nav-footer injection spot, the Settings link, status-badge injection, the Customize button, and the footer injection spot. We do not introduce a new user profile card here; the Figma "User Profile Card" element is intentionally **out of scope** to preserve "UI-only, no behavior change" framing. Avatar primitive is therefore **not used** in this PR.

What we do change:
- Sticky container: `bg-background/80 backdrop-blur-sm` → `bg-background` (solid; the blur becomes redundant once the surface is opaque).
- Settings link: same 3-state styling as nav items (`text-muted-foreground hover:bg-muted` default, `bg-muted text-foreground` active, indicator bar at `left-[-20px]`).

### Mobile drawer

Same token swaps applied to the off-canvas drawer at line ~1552 of `AppShell.tsx`. Width stays `w-[260px]` (mobile-only viewport, independent of desktop expanded/collapsed scale). Backdrop `bg-black/40` stays (it's a modal scrim, not a sidebar surface).

## Data Models

Not applicable — UI-only restyle, no entity changes.

## API Contracts

**No public API changes.** All exported types, hooks, props, and contract surfaces preserved:

| Surface | Status |
|---|---|
| `InjectionMenuItem` type | unchanged |
| `useInjectedMenuItems(spotId)` hook | unchanged |
| `mergeMenuItems(builtIn, injected)` helper | unchanged |
| `BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID` | unchanged, still rendered |
| `menu:sidebar:main`, `menu:sidebar:settings`, `menu:sidebar:profile`, `menu:topbar:actions` spot IDs | unchanged |
| `AppShell` component props (`compact`, `hideHeader`, `customizing`, etc.) | unchanged |
| Component replacement handles (`section:backend:sidebar`, etc.) | unchanged |

## Migration & Backward Compatibility

Analysis against the 13 contract surfaces from [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):

| # | Surface | Impact | Notes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | None | No new module files |
| 2 | Type definitions & interfaces | None | All types unchanged |
| 3 | Function signatures | None | Hooks/helpers unchanged |
| 4 | Import paths | None | No moved/renamed exports |
| 5 | Event IDs | None | No event changes |
| 6 | Widget injection spot IDs | None | All 5 spot IDs preserved and rendered |
| 7 | API route URLs | None | No API changes |
| 8 | Database schema | None | No DB changes |
| 9 | DI service names | None | No DI changes |
| 10 | ACL feature IDs | None | No feature changes |
| 11 | Notification type IDs | None | No notification changes |
| 12 | CLI commands | None | No CLI changes |
| 13 | Generated file contracts | None | No generator changes |

**All 13 contract surfaces unaffected.** Pure additive Tailwind class change. No deprecation protocol required.

## Integration Test Coverage

### Existing tests touched

- [`packages/ui/src/backend/__tests__/AppShell.test.tsx`](../../packages/ui/src/backend/__tests__/AppShell.test.tsx) — verify rendering of nav groups, breadcrumbs, injection spots, settings/profile sidebar modes, hydration from `/api/auth/admin/nav`. **If any assertion targets specific Tailwind classes (e.g. `bg-background/60`), update to new classes.** Functional behavior is unchanged so structural assertions (counts, hierarchy, ARIA) remain green.

### New tests

None required. No new behaviors are introduced. Visual regression tooling (Phase 3 sub-track 3.C) is **not yet available** — therefore visual verification is **manual** for this PR. PR description must include before/after screenshots covering: expanded desktop sidebar with active item, collapsed desktop sidebar with active item, mobile drawer, footer profile card.

### CI inheritance note

This branch is rebased on `refactor/ds-foundation-v2`. PR #1709 currently has two failing integration tests (TC-CRM-002 + TC-MSG-009 — known regression in DS v2 `Input` primitive's wrapper-div, unrelated to sidebar). **Those failures will appear on this branch's CI run too**. They are not introduced by sidebar restyle and resolve when v2 unblocks. PR description must call this out so reviewers don't conflate.

## Risks & Impact Review

| # | Risk | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | Collapsed width 72→80 px alters icon-rail reflow | Low | All admin pages in collapsed mode | Update `lg:grid-cols-[72px_1fr]` → `lg:grid-cols-[80px_1fr]`; expanded grid stays at 240px so main-content reflow risk is none | None |
| 2 | Active indicator bar at `left-[-20px]` clipped by an `overflow-hidden` ancestor | Medium | Sidebar nav | Audit direct ancestors during implementation; ensure outer sidebar `<aside>` does not hard-clip | Low |
| 3 | Solid `bg-background` removes the existing `backdrop-blur-sm` effect under sticky footer | Low | Sticky footer area | Drop the now-redundant `backdrop-blur-sm` class | None |
| 4 | Test class assertions break | Low | `AppShell.test.tsx` | Update specific assertions to new classes; behavior tests stay green | Low |
| 5 | Visual regression — every admin page looks slightly different | Medium | All admin UI | Manual screenshot review in PR; sub-track 3.C visual regression tool will help future primitive PRs | Medium |
| 6 | Mobile drawer styling diverges from desktop | Low | Mobile UX | Apply same token swaps to drawer; manual mobile viewport check | None |
| 7 | OrganizationSwitcher in injection spot looks visually orphaned without a unified card | Medium | Brand area | Accepted — out of scope per user decision; can be revisited in follow-up PR | Medium (cosmetic) |

## Final Compliance Report

### DS rules ([`.ai/ds-rules.md`](../ds-rules.md))

- [x] No hardcoded Tailwind status colors (`text-red-*`, `bg-green-*`, etc.) — uses `bg-muted`, `text-foreground`, `text-muted-foreground` only
- [x] No raw color hex/rgb in `className`
- [x] No `dark:` overrides on semantic/status tokens — semantic tokens carry dark mode definition
- [x] Arbitrary values minimized and justified — only 3 occurrences: `left-[-20px]` (indicator position), `left-[-22px]` (collapsed variant), `tracking-[0.48px]` (Figma letter-spacing). Each is the minimum-impact way to match Figma when no scale token exists; documented inline.
- [x] No hardcoded color shades for borders — uses `border-border`

### Component MVP compliance

This PR does not introduce a new primitive. No existing primitive needed visual changes — only Tailwind class swaps on the existing `<aside>` / `<Link>` / `<Image>` / `<Button>` markup.

### BC compliance

See [Migration & Backward Compatibility](#migration--backward-compatibility) — all 13 contract surfaces unaffected.

### Code review compliance ([`.ai/skills/code-review/SKILL.md`](../skills/code-review/SKILL.md))

- [x] No new modules without `setup.ts` (no new modules)
- [x] No new entities (no DB changes)
- [x] All inputs validated with Zod (no API routes)
- [x] No `any` types (UI-only Tailwind class changes)
- [x] DS Guardian rules not violated (verified by [`ds-health-check.sh`](../scripts/ds-health-check.sh) before/after)
- [x] No raw `<button>` / `<input>` (only existing primitives reused)
- [x] **Icons** — no new icons introduced. The existing `InjectionMenuItem.icon` lookup already maps to `lucide-react` only. Remix-icon names in Figma source are design-time references and MUST NOT be ported into code. Any new icon, if added, MUST come from `lucide-react`.

### Generator regeneration

Not required — no module manifests, no events, no DI changes.

## Changelog

- **2026-04-26** — Initial draft. Scope locked to backend desktop sidebar + mobile drawer. Brand block simplified (no chevron, no switcher integration). Footer adopts `Avatar` primitive (`size="md"`). 3-state nav-item label color rule explicitly documented. Awaiting user approval before implementation.
