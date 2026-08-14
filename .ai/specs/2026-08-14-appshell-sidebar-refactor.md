# AppShell / Sidebar Refactor

**Status:** Draft
**Date:** 2026-08-14
**Scope:** OSS — `packages/ui`
**Type:** Refactor (behavior-preserving, with one deliberate visual unification in Phase 3)

## TLDR

`packages/ui/src/backend/AppShell.tsx` has grown to 1588 lines, of which a single component
(`AppShellBody`) holds 1074 lines, 10 `useState`, 12 `useEffect`, 8 `useMemo` and three
render helpers defined as closures inside the component body. This spec breaks it into two
folders — `backend/sidebar/` (all navigation: existing customization editor plus the extracted
runtime) and `backend/app-shell/` (header, footer, breadcrumb) — leaving `AppShell.tsx` as a
~200-line composition file that keeps its frozen public exports.

Delivered in four phases, each independently mergeable. Phases 1–2 are pure extraction with no
render change. Phase 3 unifies three drifted copies of the nav-item renderer into one component
(a deliberate, approved visual change) and needs UI QA. Phase 4 covers chrome extraction,
memoization and design-system cleanup.

## Overview

`AppShell` is the backend chrome for every authenticated page: sidebar navigation (main plus a
two-level settings/profile mode), topbar with breadcrumb and injection spots, banner stack,
footer, and the mobile drawer. It is consumed by `apps/mercato/src/app/(backend)/backend/layout.tsx`
and by the `create-app` template, and re-exported wholesale from `packages/ui/src/index.ts:4`.

Because everything lives in one file, every concern — menu merging, icon definitions, preference
persistence, scroll affordance, breadcrumb state, layout grid — is entangled in one render
closure. This spec separates them without changing what the shell does.

## Problem Statement

### P1 — Render helpers are closures, not components

`renderSectionSidebar` (139 lines, `AppShell.tsx:800-939`), `renderSidebar` (268 lines,
`AppShell.tsx:941-1209`) and `renderSectionAside` (35 lines, `AppShell.tsx:1211-1246`) are plain
functions declared inside `AppShellBody`. Consequences:

- they cannot be memoized, so a single keystroke in the nav `SearchInput` (`navQuery`) re-renders
  the entire shell subtree, as does every `scroll` event that flips `sidebarScrollState`;
- they are invisible in React DevTools and untestable in isolation;
- `renderSidebar(compact, hideHeader, forceMainOnly)` is called with two different flag
  combinations (`AppShell.tsx:1310`, `AppShell.tsx:1579`) — three positional booleans selecting
  three visual variants is a component wearing a function's clothes.

Two further render blocks are IIFEs embedded directly in JSX: the main nav
(`AppShell.tsx:1040-1185`) and the breadcrumb (`AppShell.tsx:1382-1450`).

### P2 — The nav-item renderer exists in three drifted copies

The same visual element (active indicator bar, icon slot, label, `compact` variant) is written
three times:

| Copy | Location | Padding | Icon fallback |
|---|---|---|---|
| Section item | `AppShell.tsx:883-907` | inline `paddingLeft: 12 + depth * 16` | `DataTableIcon` for `/backend/entities/user/**/records` |
| Main parent item | `AppShell.tsx:1113-1135` | class `px-3 py-2` | `DefaultIcon` only |
| Main child item | `AppShell.tsx:1145-1168` | class `pl-5 pr-3 py-2` | `DataTableIcon` for `/backend/entities/user/**/records` |

The divergences look accidental rather than designed: the main parent item is the only one of the
three that never resolves `DataTableIcon`, and the section branch is the only one that computes
indentation inline in JS rather than through classes.

### P3 — The brand header is duplicated three times

`AppShell.tsx:816-822`, `AppShell.tsx:947-955` and `AppShell.tsx:1013-1021` are the same
`Link + ShellBrandLogo + span` block.

### P4 — Seven unrelated responsibilities share one file

1. Injection-menu merging — `AppShell.tsx:161-400`, ~240 lines of pure functions with no React
   dependency, currently exercised only indirectly through component tests.
2. Inline SVG icon constants — `AppShell.tsx:465-499`.
3. Preference persistence — `AppShell.tsx:76-86`, `705-723`, `738-765` (versioned envelope for
   open groups, raw scalar for collapse state plus a cookie mirror).
4. Sidebar scroll-affordance state machine — `AppShell.tsx:580-649`, which resolves its scroll
   container via `querySelector('[data-sidebar-scroll="true"]')` because refs cannot be threaded
   through the render closures (documented as a deliberate workaround at `AppShell.tsx:576-579`).
5. Settings/profile auto-collapse with restore — `AppShell.tsx:749-762`.
6. Breadcrumb context, `ApplyBreadcrumb`, and a 69-line render IIFE.
7. Layout grid, topbar, footer, mobile drawer, body-scroll lock.

### P5 — Accumulated rule violations in the touched surface

- Raw `<button>` at `AppShell.tsx:1299` (sidebar collapse toggle) and `AppShell.tsx:1545` (mobile
  drawer tabs) — `packages/ui/AGENTS.md` forbids raw `<button>`.
- Arbitrary Tailwind values against `.ai/ds-rules.md`: `left-[-20px]`, `left-[-12px]`,
  `max-w-[120px]`, `w-[280px]`, `max-w-[85vw]`, plus the inline `paddingLeft` at `AppShell.tsx:876`.
- Two `eslint-disable react-hooks/exhaustive-deps` (`AppShell.tsx:648`, `AppShell.tsx:773`) that
  exist because the effects close over values the closures re-create each render.

## Proposed Solution

### Folder layout

Follows the `backend/` house convention: one nesting level, kebab-case folder names,
`PascalCase.tsx` for components, `camelCase.ts` for hooks and helpers, `__tests__/` inside the
folder. Precedent for a large flat folder: `backend/detail/` (19 files), `backend/injection/` (22).

```
backend/AppShell.tsx              ~200 lines — providers, layout grid, slots, re-exports

backend/sidebar/                  all navigation: existing editor + extracted runtime
  SidebarCustomizationEditor.tsx  unchanged
  customization-helpers.ts        unchanged
  types.ts                        SidebarGroup, SidebarItem, ShellLogo
  keys.ts                         resolveGroupKey, resolveItemKey
  injected-menu.ts                merge*WithInjected, resolveInjectedMenuLabel, converters
  icons.tsx                       DefaultIcon, DataTableIcon, Chevron, SerializedIcon, renderIcon
  useSidebarPreferences.ts        collapsed + openGroups persistence, toggleGroup
  useSidebarScrollAffordance.ts   scroll ref, 'down' | 'up' | 'none' state, click handler
  useSidebarMode.ts               settings/profile detection, auto-collapse, restore
  SidebarBrandHeader.tsx
  SidebarNavItem.tsx              the single unified nav item
  SidebarGroup.tsx                group header (Button + Chevron) + item list
  MainSidebarNav.tsx              replaces renderSidebar()
  SectionSidebarNav.tsx           replaces renderSectionSidebar() / renderSectionAside()
  SidebarSkeleton.tsx             chrome-loading state
  SidebarScrollAffordance.tsx
  MobileSidebarDrawer.tsx
  __tests__/

backend/app-shell/                the frame around the content
  HeaderContext.tsx               context + ApplyBreadcrumb implementation
  ShellBreadcrumb.tsx             today's IIFE at AppShell.tsx:1382-1450
  ShellHeader.tsx
  ShellFooter.tsx
  __tests__/
```

Allocation rule, one sentence: **anything that renders or holds the state of a menu entry goes to
`sidebar/`; anything that frames the page content goes to `app-shell/`.**

### Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | Everything navigation-related lives in `sidebar/`, including the pre-existing `SidebarCustomizationEditor` | One answer to "where is the sidebar?" |
| D2 | Chrome gets its own `app-shell/` folder | `sidebar/` must keep describing its contents; a header is not a sidebar |
| D3 | No `index.ts` barrel in either folder | `.ai/ui-backend-components.md:491` already treats importing chrome from module code as a review blocker; without a barrel these files stay internal and refactorable. The only public surface remains `AppShell.tsx` |
| D4 | `AppShellProps` stays in `AppShell.tsx`; derived `SidebarGroup` / `SidebarItem` / `ShellLogo` move to `sidebar/types.ts` and are re-exported | Preserves the frozen export list while letting sidebar files import types without reaching back into the shell |
| D5 | The three nav-item variants are unified into one `SidebarNavItem` | Approved by the requester; the divergences in P2 are accidental |
| D6 | `CollapsibleNavSection.tsx` is left untouched | Explicitly requested; recorded below as known debt |
| D7 | `SidebarCustomizationEditor` is not moved out of `packages/ui` | Out of scope; recorded below as known debt |
| D8 | `PortalShell` gets no shared abstraction | Deliberate "no" — the portal has its own component family under `portal/components/` |

### Unification contract for `SidebarNavItem`

One component covers all three call sites. Props: `href`, `label`, `id`, `icon` / `iconName` /
`iconMarkup`, `depth` (0 for top level, 1+ for children), `compact`, `active`, `disabled`,
`onNavigate`. Resolved behavior:

- **Indentation** — class-based per depth, replacing the inline `paddingLeft` arithmetic. Depth 0
  keeps today's `px-3 py-2`; depth 1 keeps today's `pl-5 pr-3 py-2`; depth ≥ 2 continues the same
  step. This is where the section-sidebar branch changes: its previous `12 + depth * 16` px values
  are replaced by the design-system spacing scale, which is the visual delta requiring QA.
- **Icon fallback** — `DataTableIcon` for `/backend/entities/user/**/records` hrefs, `DefaultIcon`
  otherwise, applied uniformly. This makes the main parent item resolve `DataTableIcon` where it
  previously did not.
- **Active indicator** — the existing absolutely positioned bar, with `left-[-20px]` /
  `left-[-12px]` migrated to design-system tokens under the Boy Scout rule.
- **Attributes** — `data-menu-item-id` is emitted on every variant exactly as today.

### Phasing

Each phase is one PR against `develop`.

**Phase 1 — pure extraction, no render change**

1. Create `sidebar/types.ts`, move `SidebarGroup` / `SidebarItem` / `ShellLogo`, re-export from `AppShell.tsx`.
2. Create `sidebar/keys.ts` with `resolveGroupKey` / `resolveItemKey`.
3. Create `sidebar/injected-menu.ts` with the four merge/convert/resolve functions from `AppShell.tsx:161-400`.
4. Create `sidebar/icons.tsx` with the icon constants, `SerializedIcon`, `Chevron` and `renderIcon`.
5. Add `sidebar/__tests__/injected-menu.test.ts` covering group/section merging, `InjectionPosition` placement, `relativeTo` fallback-to-append, `labelKey` resolution and new-group creation.
6. Run the validation gate.

**Phase 2 — hooks**

1. `sidebar/useSidebarPreferences.ts` — collapsed state (localStorage plus `om_sidebar_collapsed` cookie), `openGroups` versioned envelope, `toggleGroup`, active-route group expansion. Retains the existing swallow-on-throw behavior for blocked storage.
2. `sidebar/useSidebarScrollAffordance.ts` — returns `{ asideRef, state, scrollTo }`, keeping the `[data-sidebar-scroll="true"]` lookup and `prefers-reduced-motion` handling.
3. `sidebar/useSidebarMode.ts` — settings/profile path detection, auto-collapse on entry, restore on return.
4. Close both `react-hooks/exhaustive-deps` suppressions honestly inside the hooks; keep a suppression only where a documented reason survives.
5. Run the validation gate.

**Phase 3 — sidebar components (the QA-bearing phase)**

1. `SidebarBrandHeader.tsx`, replacing all three duplicates.
2. `SidebarNavItem.tsx` per the unification contract above.
3. `SidebarGroup.tsx` — group header plus item list, both variants.
4. `MainSidebarNav.tsx`, `SectionSidebarNav.tsx`, `SidebarSkeleton.tsx`, `SidebarScrollAffordance.tsx`, `MobileSidebarDrawer.tsx`. Replace the three positional booleans with named props: `variant: 'desktop' | 'mobile'`, `compact`, `forceMainOnly`.
5. Component tests for `SidebarNavItem` (all depths, compact, active, disabled, both icon fallbacks) and `MainSidebarNav` (query filtering, group collapse, injected entries).
6. Run the validation gate; capture UI QA screenshots.

**Phase 4 — chrome, memoization, design-system cleanup**

1. `app-shell/HeaderContext.tsx` with `ApplyBreadcrumb`; re-export `ApplyBreadcrumb` from `AppShell.tsx`.
2. `app-shell/ShellBreadcrumb.tsx` from the IIFE.
3. `app-shell/ShellHeader.tsx`, `app-shell/ShellFooter.tsx`.
4. `React.memo` on `MainSidebarNav` / `SectionSidebarNav` so nav search and scroll state stop re-rendering the topbar and footer.
5. Replace the two raw `<button>` elements with `IconButton` / `Button`; migrate the arbitrary Tailwind values listed in P5.
6. Run the validation gate.

## Architecture

### Data flow after the refactor

```
AppShell (QueryProvider → BackendChromeProvider → AiChatSessionsProvider → AiDockProvider)
└── AppShellBody
    ├── useBackendChrome()            server-provided groups/sections/brand
    ├── useSidebarMode()              → 'main' | 'settings' | 'profile'
    ├── useSidebarPreferences()       → collapsed, openGroups, toggleGroup
    ├── useSidebarScrollAffordance()  → asideRef, state, scrollTo
    ├── useInjectedMenuItems(×4)  ──► injected-menu.ts (pure merge)
    ├── <MainSidebarNav> | <SectionSidebarNav>  → <SidebarGroup> → <SidebarNavItem>
    ├── <ShellHeader> → <ShellBreadcrumb>       (HeaderContext consumer)
    ├── <main> … banners, injection spots, children …
    ├── <ShellFooter>
    └── <MobileSidebarDrawer> → same nav components, variant="mobile"
```

The injection-spot mounts, their spot IDs and the banner stack keep their current positions inside
`AppShell.tsx`; only their surrounding markup moves into `ShellHeader` / `ShellFooter`.

### Frozen surface — must not change

| Surface | Value |
|---|---|
| Import path | `@open-mercato/ui/backend/AppShell` (also reached via `export *` from `packages/ui/src/index.ts:4`) |
| Exports | `AppShell`, `ApplyBreadcrumb`, `AppShellProps`, `ShellLogo` |
| Injection spot IDs | all constants imported from `./injection/spotIds`, unchanged |
| `data-testid` | `sidebar`, `appshell-section-sidebar`, `appshell-section-back-to-main`, `sidebar-scroll-chevron`, `backend-chrome-loading`, `backend-chrome-ready` |
| Data attributes | `data-menu-item-id`, `data-sidebar-scroll`, `data-sidebar-scroll-chevron` |
| Storage keys | `om:sidebarOpenGroups` (version 1, with legacy bare-record migration), `om:sidebarCollapsed`, cookie `om_sidebar_collapsed` |
| i18n keys | all `appShell.*`, `backend.nav.*`, `ui.sidebar.chevron.*` keys keep their identifiers |

`packages/core/src/modules/customers/__integration__/TC-CRM-058.spec.ts` asserts against this
markup and must keep passing unmodified.

## Data Models

No database entities, migrations, or persisted server-side models are touched. The only persisted
state is browser-local and listed in the frozen-surface table above; its shape and versioning are
unchanged.

## API Contracts

No API routes are added, removed, or modified. The shell continues to consume the existing admin
nav / chrome payload through `BackendChromeProvider` (`adminNavApi`), with the same request shape
and the same response handling.

## Test & QA Coverage

No API paths change, so integration coverage is expressed as UI paths.

| Surface | Coverage | Phase |
|---|---|---|
| `injected-menu.ts` merge functions | New unit tests, `sidebar/__tests__/injected-menu.test.ts` | 1 |
| `useSidebarPreferences` (persistence, blocked storage, legacy migration) | New unit tests | 2 |
| `useSidebarMode` (auto-collapse, restore) | New unit tests | 2 |
| `SidebarNavItem` (depth, compact, active, disabled, icon fallback) | New component tests | 3 |
| `MainSidebarNav` (search filter, group collapse, injected entries) | New component tests | 3 |
| Composed shell | Existing `backend/__tests__/AppShell.test.tsx` (884 lines) must pass unmodified | 1–4 |
| Sidebar markup contract | Existing `TC-CRM-058` integration spec must pass unmodified | 3 |
| Manual QA (Phase 3 only) | Desktop expanded, desktop collapsed, settings two-level, profile two-level, mobile drawer on both tabs, chrome-loading skeleton, nav search active, scroll-affordance chevron at top and bottom | 3 |

## Risks & Impact Review

**R1 — Nav-item unification changes section-sidebar indentation.** Severity: medium. Area:
settings and profile sidebars. The inline `12 + depth * 16` px arithmetic is replaced by the
spacing scale, so nested settings entries may shift by a few pixels. Mitigation: Phase 3 ships
with `needs-qa` and before/after screenshots of both section modes. Residual risk: low — a small
intentional visual delta, reversible by adjusting one class map.

**R2 — Main parent items gain the `DataTableIcon` fallback.** Severity: low. Area: main sidebar.
A top-level entry pointing at `/backend/entities/user/**/records` will render the table icon where
it previously rendered the generic icon. Mitigation: covered by the Phase 3 QA screenshots.
Residual risk: low — this aligns the outlier with the other two variants.

**R3 — Extraction silently drops a `data-*` attribute or test id.** Severity: high. Area: the
Playwright suite and `TC-CRM-058`. Mitigation: the frozen-surface table is the checklist; the
884-line `AppShell.test.tsx` and the integration spec must pass **unmodified** — any need to edit
them is treated as a regression, not as test maintenance. Residual risk: low.

**R4 — Hook extraction changes effect ordering or timing.** Severity: medium. Area: breadcrumb
clearing on navigation, which deliberately relies on `useIsomorphicLayoutEffect` running after the
incoming page's `ApplyBreadcrumb` passive effect (`AppShell.tsx:780-793`). Mitigation: this effect
stays a layout effect and keeps its comment; the existing navigation tests cover it. Residual risk:
medium — this is the subtlest ordering dependency in the file and deserves explicit review
attention in Phase 4.

**R5 — Closing the `exhaustive-deps` suppressions changes effect frequency.** Severity: medium.
Area: scroll affordance and active-group expansion. Adding previously omitted dependencies can turn
a mount-time effect into a per-render effect. Mitigation: Phase 2 stabilizes the identities inside
the hooks first; where a suppression is genuinely correct, it is kept with a written reason rather
than removed for its own sake. Residual risk: low.

**R6 — Adding a barrel would enlarge the public surface.** Severity: low. Area: backward
compatibility. Mitigation: D3 explicitly forbids `index.ts` in both new folders. Residual risk: low.

## Documentation Impact

Audited before drafting: **no agent-instruction or component-catalog file requires an update**,
because none of them documents `AppShell`'s internal structure. Recorded here as a deliberate
no-op so the implementing agent does not re-derive it — or, worse, add catalog rows for the new
internal components, which decision D3 explicitly forbids.

| Document | Why it stays unchanged |
|---|---|
| Root `AGENTS.md` Task Router | Its only sidebar row (`AGENTS.md:76`) routes menu-injection work to `ui`; neither the task nor its destination changes. Adding a row would consume the 32 KB instruction budget for no routing gain |
| `packages/ui/AGENTS.md` | Its sidebar mentions cover injection spot IDs and the portal only — no rule references the file layout |
| `packages/ui/src/backend/AGENTS.md` | Contains no reference to `AppShell` or the sidebar |
| `.ai/ui-backend-components.md` § "Internal — do not consume" | The `AppShell` row describes responsibilities, not files, and stays accurate. New components must **not** be listed there: the section states that importing them from module code is a review blocker, and D3 (no barrel) enforces it |
| `BACKWARD_COMPATIBILITY.md` / `UPGRADE_NOTES.md` | No contract surface changes — import path, exports, spot IDs, storage keys and i18n keys are all preserved, and no new public surface is introduced |

Both items in Known Debt below *will* require documentation work when they are picked up:
moving `SidebarCustomizationEditor` needs the deprecation protocol plus an `UPGRADE_NOTES.md`
entry, and deprecating `CollapsibleNavSection` removes its row from
`.ai/ui-backend-components.md:499`. Neither is in scope here.

## Known Debt (out of scope, file as separate issues)

- **`SidebarCustomizationEditor` is misplaced.** 1655 lines — larger than `AppShell` itself — with
  exactly one consumer, the 17-line `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx`.
  It imports `Page`/`PageBody`, `apiCall`, `flash`, `useGuardedMutation`, `buildOptimisticLockHeader`,
  `surfaceRecordConflict`, `useConfirmDialog` and `dnd-kit`: a product feature, not a reusable
  primitive. Its natural home is the `auth` module. Moving it changes a public import path, so it
  needs the `BACKWARD_COMPATIBILITY.md` deprecation protocol and a plan for the
  `customization-helpers.ts` dependency that `AppShell` shares with it.
- **`CollapsibleNavSection.tsx` is dead.** 201 lines, zero importers anywhere in `packages`, `apps`
  or `external`, yet still listed in `.ai/ui-backend-components.md:499` as "Sidebar nav group
  internals". It is a parallel sidebar implementation with its own `DefaultIcon` (byte-identical to
  `AppShell`'s), its own `om:sidebarSettingsExpanded` storage key, and a `CollapsibleNavItem` model
  strictly weaker than `SidebarItem` (no `id`, `iconName`, `iconMarkup`, `pageContext`,
  `defaultTitle`). Left untouched by explicit decision (D6); it should eventually be deprecated
  rather than revived, because building on it would downgrade the data model.

## Final Compliance Report

| Rule | Status |
|---|---|
| No cross-module ORM relationships | N/A — no data layer touched |
| Tenant/organization scoping | N/A — no data access added |
| No hand-edited generated files | Compliant |
| No code added under `apps/mercato/src/` | Compliant — changes confined to `packages/ui` |
| `BACKWARD_COMPATIBILITY.md` contract surfaces | Import path, export names, spot IDs, storage keys and i18n keys all preserved; see the frozen-surface table |
| No hard-coded user-facing strings | Compliant — all copy stays behind `t()` with its current keys |
| No hardcoded status colors / arbitrary values | Improved — P5 items migrated under the Boy Scout rule in Phases 3–4 |
| No raw `<button>` | Improved — both instances replaced in Phase 4 |
| `packages/ui` validation commands | `yarn workspace @open-mercato/ui test`, `… build`, `yarn ds:code-connect:check`, `yarn i18n:check` per phase |

## Changelog

| Date | Change |
|---|---|
| 2026-08-14 | Spec drafted. Folder layout and decisions D1–D8 agreed with the requester before drafting. Not yet implemented. |
| 2026-08-14 | Added Documentation Impact section recording the audited no-op across the agent-instruction files and the component catalog. |
