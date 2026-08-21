# Customers · Deals Kanban — UX Review Fixes (round 2)

**Created:** 2026-05-19
**Module:** `customers` (sub-module: `deals` / `pipeline`)
**Status:** Draft
**Author:** Maciej Dudziak (dev)
**Parent spec:** [2026-05-13-customers-deals-kanban-redesign.md](2026-05-13-customers-deals-kanban-redesign.md) — SPEC-048
**Related:** [packages/ui/AGENTS.md](../../packages/ui/AGENTS.md), [.ai/ds-rules.md](../ds-rules.md)
**Figma:** [SPEC-048 CRM Detail Pages UX Mockup](https://www.figma.com/design/oTF1oZoaNgFUdtmxEX2oSc/SPEC-048-CRM-Detail-Pages-UX-Mockup?node-id=956-98&m=dev)

---

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-05-19 | Initial spec: 27-item UX review punch list grouped into six commit phases (A11y / Navigation / Dialog shells / DS compliance / UX polish / PR body). Includes one SQL migration for stage colors and one new markdown TC-CRM scenario. |
| 1.1 | 2026-05-20 | Round-2 review fixes (items 29–33): two P1 blockers (#32 multi-card drag, #33 currency popover opacity), two P2 (#29 duplicate Reset CTA, #30 off-screen Add stage CTA), one P3 (#31 lane-rail elevation). Adds Phase G with one new markdown scenario (TC-CRM-066) for bulk-drag. |
| 1.2 | 2026-05-21 | Round-3 UX-designer corrections to round-2: (a) #30 — restore the trailing `AddStageLane` tile alongside the toolbar button (over-eager removal in 1.1 was reverted; both entry points coexist by design), (b) #31 — replace lane-rail overlap (`-mr-2`/`-ml-2`) with a positive 8px gap (`mr-2`/`ml-2`) so first/last lane edges don't touch the rail. |

---

## TLDR

**Key Points:**

- Second round of post-implementation polish for SPEC-048. UX reviewer raised 27 distinct items spanning A11y, navigation bugs, dialog-shell duplication, DS compliance, and UX polish.
- Four reviewer recommendations are explicitly **overridden by Figma**: item 9 (Configure card fields) is reinstated visually but disabled; items 12 (chevrons), 14 (DealCardMenu icons), and 15 (`text-[9px]`) match Figma exactly and are intentional.
- Probability pill is re-colored to match Figma's three-tier system (de-emphasized / warning / emphasized) instead of the current stage-state coloring that visually conflicts with stuck/overdue badges.
- AddStageDialog migrates from a 6-hex picker to a 7-tone semantic picker (success / warning / info / error / neutral / brand / pink). One forward-only SQL migration maps known hex values to tones.
- New markdown TC-CRM scenario covers the stage-color migration. All other Phase-5 integration tests remain deferred per SPEC-048.

**Scope:**

- Modified: all 15 components called out by the review under `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/`, plus `pipeline/page.tsx`, `create/page.tsx`, and `deals/page.tsx` (list view) for the ViewTabsRow placement.
- New: `pipeline/components/constants.ts` (lane-width constant), `pipeline/components/DashedTileButton.tsx` (extracted shared dashed-tile component), one Mikro-ORM SQL migration in `packages/core/src/modules/customers/data/migrations/`.
- New test: one markdown scenario `TC-CRM-018-deal-stage-color-migration.md` covering the hex→tone backfill.

**Out of scope:**

- Phase 5 integration tests from SPEC-048 (enricher shape, bulk routes, ProgressJob, CSV) — deferred to a separate PR per the parent spec.
- Aktywności / Kalendarz / Mapa tabs — routes do not exist (parent spec §line 86).
- Full Customize view feature work — "Configure card fields" implementation requires its own spec (per-user field preferences, drag-reorder, persistence).
- List-view redesign — parent spec §line 448 (existing list page untouched).
- Create-deal three-column redesign — parent spec Phase 5.

---

## Scope Classification

### UX-only (no data / API changes)
- All A11y fixes (items 1–6).
- All navigation / product bug fixes (items 7, 8, 9, 10) — `returnTo` is a query-param convention, no API change.
- All dialog shell cleanup (items 11, 12, 13, 14).
- All DS compliance items (15–20).
- UX polish items 21, 23, 24, 26.
- PR body documentation (item 27).

### Data / migration
- Item 25 — AddStageDialog hex → 7-tone semantic picker. Requires:
  - Schema decision: the `deal_stage` entity already has a `color` column. We **retain the column** and **change the value domain** from arbitrary hex strings to one of seven tone identifiers. Forward-only SQL migration backfills existing values.
  - One new TC-CRM markdown scenario covering the migration path.

### Behavioral surface that needs new wiring
- Item 22 — Quick deal currency options become dynamic, sourced from the `currencies` module. New prop pipe-through from `pipeline/page.tsx` to `QuickDealDialog.tsx`.
- Item 14 — DealCardMenu shortcut hints become live hotkeys (⏎, E, ⌘D) on focused cards / open menu.

---

## Workstream Dependencies

- **SPEC-048** (in implementation): All components and the data model under change are owned by SPEC-048. This spec extends the polish phase of SPEC-048 without modifying its scope.
- **`currencies` module**: Source of truth for the tenant's currency list. Item 22 reads the currency list via the same path already used by Lane's per-currency aggregate (currently server-aggregated; for the dialog we need a client-side list — see Phase E below).
- **`@open-mercato/ui` primitives**: Radio / RadioGroup, Popover, ComboboxInput, PageHeader, Breadcrumb, Button (`variant="link"`) — all already shipped. No DS additions required.

---

## Overview

The kanban page shipped in SPEC-048 Phase 4 went through a DS Guardian pass, then a UX review pass. The UX reviewer raised 27 items grouped roughly into accessibility blockers, three-close-path dialog duplication, navigation asymmetries, design-system drift the Guardian missed, and product behavior that does not match Figma intent. After confirming each item against the Figma file, four reviewer recommendations turned out to disagree with Figma intent and were re-decided in this spec.

---

## Problem Statement

### Current state on `feat/sales-pipeline-kanban` (post commit `151d260f0`)

1. **Accessibility regressions slip past DS Guardian.** DealCard's `role="article"` overrides dnd-kit's `role="button"`; hover-only quick actions use `display:none` (not just `opacity:0`), removing them from tab-order; BulkActionsBar has no ESC handler; SortByPopover hand-rolls pseudo-radio rows; DealCardMenu re-implements DropdownMenu without arrow-key navigation or autofocus.
2. **Floating overlays bleed background through.** FilterPopoverShell uses `bg-muted/30` on outer wrapper and footer; card content underneath shows through every filter popover.
3. **Navigation is asymmetric.** ViewTabsRow renders only on the kanban page; the list page has no way back to kanban. The "New deal" CTA on kanban routes to a create page that always redirects to the list afterwards.
4. **Menu stubs leak to users.** "Configure card fields" is a `handleComingSoon` placeholder. "Reset to default" copy promises to clear filters and restore columns but only resets `statusFilters` and `sortBy`.
5. **Dialog shells trip the three-close-path footgun.** QuickDealDialog, ActivityComposerDialog, and AddStageDialog each pass `extraActions={<Button>Cancel</Button>}` to CrudForm, and CrudForm renders it both in the header and in the footer. Combined with the DS Dialog's own X, the user sees Cancel ×2 + X. CustomizeViewDialog adds its own manual IconButton X next to the DS auto-X, and duplicates "Reset to default" in both the header and the row list.
6. **Design tokens drift from DS scale.** Two `text-[9px]` arbitrary sizes (matching Figma intent), three `w-[308px]` magic constants for lane width, one inline-style fallback, hand-rolled breadcrumb / `<h1>` instead of DS PageHeader / Breadcrumb, three duplicated dashed-tile button patterns, one raw `<button>` where `Button variant="link"` belongs.
7. **Product UX gaps.** Quick deal company field is a `<select>` (unusable above ~50 companies); currency options are hardcoded `['PLN','EUR','USD','GBP']` (broken for any other tenant currency); status options render raw values (the historic `'loose'` typo is visible to end users); AddStageDialog offers 6 hex colors while Lane renders 7 semantic tones, with implicit hex→tone mapping that can silently fall back to gray; no cursor change to signal bulk-select mode; probability pill is colored by stage state, so an 80% deal on a stuck/overdue lane reads as "80% is bad".

### Why now

The PR is being reviewed in real time; the UX reviewer flagged DS Guardian misses. Shipping these in one polish round avoids a fragmented review history and lets us close the SPEC-048 implementation chunk before Phase 5.

---

## Proposed Solution

Six commit-level phases, each independently reviewable. Implementation order matches the order below.

### Phase A — Accessibility (items 1–6)

| # | Component | Change |
|---|-----------|--------|
| 1 | `DealCard.tsx:248-260` | Remove `role="article"`. Add `aria-roledescription="deal card"`. Let dnd-kit's `role="button"` win. |
| 2 | `DealCard.tsx:262-277`, `:337-398` | Swap `hidden group-hover:flex group-focus-within:flex` → `opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100`. Keeps elements in tab-order on desktop; visible by default on touch. Apply to checkbox and to the Call/Email/Note action row. |
| 3 | `BulkActionsBar.tsx` | Add a global `keydown` listener (mounted while the bar is rendered) that calls the selection-clearing handler on `Escape`. Remove the listener on unmount. |
| 4 | `SortByPopover.tsx:136` | Replace the manual `<button>` + custom RadioDot rows with DS `RadioGroup` + `Radio`. Preserve current visual: selected row gets a `bg-accent` highlight. |
| 5 | `DealCardMenu.tsx:88-124` | Keep the custom portal positioning. Add: `autoFocus` on the first menu item on open; `onKeyDown` handler that maps ArrowUp / ArrowDown to focus prev/next item, Home/End to first/last, Esc to close. Hotkey wiring (⏎ / E / ⌘D) lands in Phase E item 14. |
| 6 | `FilterPopoverShell.tsx:54,77` | Replace outer `bg-muted/30` → `bg-card`, footer `bg-muted/30` → `bg-muted`. No opacity modifier on the floating surface. |

### Phase B — Navigation / product bugs (items 7–10)

| # | Component | Change |
|---|-----------|--------|
| 7 | `deals/page.tsx` (list) | Import and render `ViewTabsRow` near the page header, `active="lista"`. Reuse the existing component without changes. |
| 8 | `deals/create/page.tsx:19,47,73` | Read `searchParams.returnTo` once at component top. If present and starts with `/backend/customers/deals/`, use it for the three hardcoded post-action redirects (success / cancel / soft-cancel). Otherwise fall back to the current list redirect. Update the kanban "New deal" CTA in `pipeline/page.tsx:2431` to set `?returnTo=/backend/customers/deals/pipeline`. |
| 9 | `pipeline/page.tsx:1443`, `CustomizeViewDialog.tsx` | Remove the "Configure card fields" menu entry and its `handleComingSoon` call site. Removes the dead-click footgun. (Decision is documented as Figma-deviation in §"Figma deviations".) |
| 10 | `pipeline/page.tsx:1438-1441` | Extend the "Reset to default" handler to clear: `statusFilters`, `pipelineFilters`, `ownerFilters`, `peopleFilters`, `companyFilters`, `closeDateFilter`, `currencyFilter`, `searchQuery`, and reset `sortBy` to default. No copy change needed — the existing copy ("Clear filters and restore columns") now matches behavior. |

### Phase C — Dialog shell cleanup (items 11–14)

| # | Component | Change |
|---|-----------|--------|
| 11 | `QuickDealDialog.tsx`, `ActivityComposerDialog.tsx`, `AddStageDialog.tsx` | Remove the `extraActions={<Button variant="outline">Cancel</Button>}` prop passed to `CrudForm` in each dialog. DS Dialog renders the X; DS FormFooter renders the Cancel. CrudForm itself is untouched (avoids BC risk for other consumers). |
| 12 | `CustomizeViewDialog.tsx:66-83` | Remove the manual `IconButton` X (rely on DS Dialog's built-in X). Collapse the two "Reset to default" entries into the list row only (drop the header outline button and the footer "Close" button — keep "Cancel" + "Save view"). Keep the chevron-rights on all three ACTIONS rows (matches Figma). |
| 13 | `ActivityComposerDialog.tsx:102,135` | Parameterize the refine message by `context.type`: `'Add a subject or body before saving.'` when `type === 'email'`, otherwise `'Add a title or body before saving.'`. Wrap in `t()`. |
| 14 | `DealCardMenu.tsx` | Density polish to match topbar/RowActions (`text-sm leading-5 px-3 py-2`, container `p-1.5`, `shadow-md` DS shadow token). **Do not add leading icons** — Figma intentionally omits them in favor of right-aligned shortcut hints. Optional: extract a small `MenuShortcut` helper in this file for the hint rendering. Hotkey wiring lands in Phase E item 14. |

### Phase D — DS compliance (items 15–20)

| # | Component | Change |
|---|-----------|--------|
| 15 | `CurrencyFilterPopover.tsx:253`, `CurrencyBreakdownTable.tsx:80` | **Keep `text-[9px]`** with a one-line comment `// Figma: BASE badge uses intentional 9px (node 1251:671)`. Treat as a tracked DS exception. Open a follow-up to add a `text-badge` DS token. |
| 16 | new `pipeline/components/constants.ts` | Export `LANE_WIDTH_PX = 308`. Tailwind utility `LANE_WIDTH_CLASS = 'w-[308px]'`. |
| 17 | `Lane.tsx:234`, `AddStageLane.tsx:24`, `pipeline/page.tsx:2601` | Replace `w-[308px]` literals with the constant / class. Replace the inline `style={{ width: '308px' }}` fallback in `Lane.tsx:234` with the Tailwind class. |
| 18 | `pipeline/page.tsx:2298-2461` | Replace hand-rolled `<nav>` + `<Link>` breadcrumb and `<h1 className="text-2xl font-bold">` with DS `PageHeader` and `Breadcrumb`. Page title becomes `font-semibold` (DS default) — matches other backend pages. |
| 19 | new `pipeline/components/DashedTileButton.tsx` | Extract the dashed-tile pattern from `Lane.tsx:281-295` (quick-add), `Lane.tsx:332-353` (show-more), and `AddStageLane.tsx` (Nowy etap). Component props: `onClick`, `icon`, `children`, `disabled?`, `ariaLabel`. Single source of focus-ring + hover + dashed-border styles. |
| 20 | `CloseDateFilterPopover.tsx:149` | Replace the raw `<button>` "Clear" with `<Button variant="link" size="sm" onClick={…}>Clear</Button>`. |

### Phase E — UX polish (items 21–26)

| # | Component | Change |
|---|-----------|--------|
| 21 | `QuickDealDialog.tsx:159-170` | Replace the `<select>` for Company with `ComboboxInput` from `@open-mercato/ui/backend/inputs/ComboboxInput`. Async search hits the existing companies search endpoint already used in CrudForm. |
| 22 | `QuickDealDialog.tsx:27`, `pipeline/page.tsx` | Drop the hardcoded `['PLN','EUR','USD','GBP']` array. Read tenant currencies from the currencies module: pass a `currencies: { code, symbol, isBase }[]` prop into `QuickDealDialog` from `pipeline/page.tsx`. The page fetches the list via the existing currencies API used elsewhere in the module — confirm exact path during implementation. Default selection: tenant base currency. |
| 23 | `QuickDealDialog.tsx:196` | Replace the raw label rendering with `{ value, label: t(\`deals.status.\${value}\`) }`. Add the four keys to `customers` translation files (en/pl). Storage value stays the same — the historic `'loose'` value is mapped to a translated label like "Stalled" / "Wstrzymany" without changing the data. |
| 24 | `DealCard.tsx:230-234` | Replace stage-state coloring with probability-tier coloring (see §"Figma decisions" — three tiers using exact Figma hex; expressed via DS tokens when they match). Add `aria-label={\`Probability: \${value}%\`}`. |
| 25 | `AddStageDialog.tsx:26-33`, `Lane.tsx:55-74`, new SQL migration | Replace the 6-hex chip picker with a 7-tone chip picker (`success`, `warning`, `info`, `error`, `neutral`, `brand`, `pink`). Lane's existing hex→tone mapping becomes the canonical mapping table. Persist the tone identifier in the `color` column. Migration: see §"Data Models / Migration" below. |
| 26 | `DealCard.tsx:186-199` | When `bulkSelectionActive`, switch `cursor-grab` (and `cursor-grabbing` while dragging) → `cursor-pointer`. Add `aria-pressed={isSelected}` if not already present. |

### Phase G — Round-2 review fixes (items 29–33)

UX reviewer's round-2 punch list, layered on top of Phases A–F. All items below are net-new — no item from Phases A–F changes.

| # | Component | Change |
|---|-----------|--------|
| 29 | `pipeline/page.tsx:2466-2484` | Remove the header `<Button>` "Reset column widths" — the same `handleResetAllLaneWidths` handler is already passed to `CustomizeViewDialog` (`onResetColumnWidths`). One entry point only; Customize view owns it. |
| 30 | `pipeline/page.tsx` toolbar + lane row | Add an always-visible "Add stage" `<Button variant="outline">` in the page-header CTA cluster (next to "Customize view" / "New deal"). **Keep** the trailing `<AddStageLane onClick={handleAddStage} />` tile at the end of the lane scroller — both entry points coexist by explicit UX-designer decision (round-3): the toolbar is the always-visible primary CTA, the tile is the in-context affordance operators expect from Trello/Asana muscle memory. **Decision change vs 1.1:** the spec originally removed the lane-tail tile; round-3 review reinstated it. |
| 31 | `pipeline/page.tsx` left/right lane rails | Elevate both rails to read as "the kanban tucks under a sidebar": rail wrapper becomes `relative z-10 flex w-11 [mr-2|/ml-2] shrink-0 items-center justify-center bg-card shadow-lg [clip-path:inset(-40px_-40px_-40px_0)]` (left) / mirror on right. A positive `mr-2` / `ml-2` (8px) margin keeps a small visible gap between the rail and the first/last lane — UX-designer round-3 reverted the prior `-mr-2`/`-ml-2` overlap. The clip-path keeps the elevation's drop-shadow from spilling onto the page chrome (Zielivia feedback). All Tailwind values on DS scale (`w-11`, `mr-2`, `ml-2`, `shadow-lg`, `bg-card`); the arbitrary clip-path is a tracked DS exception with the same rationale as the `text-[9px]` BASE badge. |
| 32 | `pipeline/page.tsx:1413-1431` + DragOverlay | **Blocker.** `handleDragEnd` currently routes through `moveDealToStage` for the single `event.active.id`, ignoring `selectedDealIds`. Rewrite the dispatcher: if `selectedDealIds.has(dealId) && selectedDealIds.size > 1`, route through a new `bulkMoveDealsToStage(ids, targetStageId)` that performs an optimistic-update pass over every selected card and POSTs `/api/customers/deals/bulk-update-stage` (existing endpoint — already used by BulkActionsBar "Change stage" menu). Update the `DragOverlay` to render a `+N` badge on the dragged card when bulk-drag is active. Selection-after behavior: follow Asana — selection persists after a successful bulk drag; on POST failure, optimistic state rolls back AND selection is preserved so the operator can retry. |
| 33 | `LaneCurrencyBreakdown.tsx:108`, `CurrencyFilterPopover.tsx:113`, `CurrencyFilterPopover.tsx:195` | Same opacity-on-floating-overlay bug as item 6 / FilterPopoverShell, but in two popovers that hand-roll their own chrome instead of using the shared shell. Outer `rounded-2xl bg-muted/30` → `rounded-2xl bg-card`; footer `bg-muted/30` → `bg-muted`. Drop the opacity modifier everywhere on the floating surface so card content underneath cannot bleed through. Migrating these two popovers to `FilterPopoverShell` is filed as a follow-up — the chrome is similar but not identical (LaneCurrencyBreakdown's body has a custom overline + headline-total block; CurrencyFilterPopover's footer has only "Apply filter", no Cancel). Inline patch is the safer, smaller change for this round. |

### Phase F — PR body (item 27)

Update the PR description with a new "Deferred to follow-up (per spec)" section listing the seven items the reviewer called out as legitimately out-of-scope:
- Aktywności / Kalendarz / Mapa tabs in ViewTabsRow.
- KPI strip on the list view.
- Full list-view redesign.
- ViewTabsRow on the list page → **moved in-scope** per Phase B item 7.
- Saved-view perspectives integration in CustomizeViewDialog.
- Create-deal three-column redesign.
- Phase 5 integration tests in `.ai/qa/`.

---

## Architecture

No new modules, no new packages. All changes are component-local under `packages/core/src/modules/customers/backend/customers/deals/` plus one new constants file and one extracted component:

```
packages/core/src/modules/customers/
├── backend/customers/deals/
│   ├── page.tsx                                     [modified — ViewTabsRow]
│   ├── create/page.tsx                              [modified — returnTo]
│   └── pipeline/
│       ├── page.tsx                                 [modified — PageHeader, Reset scope, returnTo set]
│       └── components/
│           ├── constants.ts                         [new — LANE_WIDTH_PX]
│           ├── DashedTileButton.tsx                 [new — extracted pattern]
│           ├── DealCard.tsx                         [modified — A11y, probability pill, cursor]
│           ├── Lane.tsx                             [modified — uses constants, DashedTileButton]
│           ├── AddStageLane.tsx                     [modified — uses constants, DashedTileButton]
│           ├── BulkActionsBar.tsx                   [modified — ESC handler]
│           ├── SortByPopover.tsx                    [modified — DS Radio]
│           ├── DealCardMenu.tsx                     [modified — keyboard nav, density, hotkeys]
│           ├── FilterPopoverShell.tsx               [modified — drop /30 opacity]
│           ├── QuickDealDialog.tsx                  [modified — extraActions, Combobox, currencies, i18n status]
│           ├── ActivityComposerDialog.tsx           [modified — extraActions, refine msg]
│           ├── AddStageDialog.tsx                   [modified — extraActions, tone chips]
│           ├── CustomizeViewDialog.tsx              [modified — drop manual X, dedupe Reset, drop Configure card fields]
│           ├── CloseDateFilterPopover.tsx           [modified — Button variant="link"]
│           ├── CurrencyFilterPopover.tsx            [unchanged for text-[9px] — comment only]
│           └── CurrencyBreakdownTable.tsx           [unchanged for text-[9px] — comment only]
└── data/migrations/
    └── Migration{TIMESTAMP}.ts                      [new — stage color hex → tone backfill]
```

No DI changes. No new events. No new API routes. No new ACL features. No new translations module — only new keys added to existing `customers` translation files for the four deal status labels (item 23).

---

## Data Models / Migration

### Change to `deal_stage.color`

The existing `color` column on `deal_stage` is `varchar` and currently stores arbitrary hex values produced by the 6-chip AddStageDialog picker. After this spec, `color` stores one of seven tone identifiers: `'success' | 'warning' | 'info' | 'error' | 'neutral' | 'brand' | 'pink'`.

**Type-level change:** TypeScript validators and entity types narrow from `string` to the union above. UI consumers (Lane, AddStageDialog) read tones directly without runtime hex → tone mapping.

**Migration: forward-only SQL backfill.**

The migration runs once per tenant DB on `yarn db:migrate`:

```sql
-- packages/core/src/modules/customers/data/migrations/Migration{TIMESTAMP}.ts
UPDATE deal_stage SET color = CASE LOWER(color)
  WHEN '#22c55e' THEN 'success'
  WHEN '#16a34a' THEN 'success'
  WHEN '#f59e0b' THEN 'warning'
  WHEN '#eab308' THEN 'warning'
  WHEN '#3b82f6' THEN 'info'
  WHEN '#0ea5e9' THEN 'info'
  WHEN '#ef4444' THEN 'error'
  WHEN '#dc2626' THEN 'error'
  WHEN '#a855f7' THEN 'brand'
  WHEN '#8b5cf6' THEN 'brand'
  WHEN '#ec4899' THEN 'pink'
  WHEN '#f43f5e' THEN 'pink'
  ELSE 'neutral'
END
WHERE color IS NOT NULL;
```

**Exact mapping is determined during implementation** by reading the current AddStageDialog hex chips AND the current Lane hex→tone mapping function — both files already exist on the branch and define the canonical 6 hex values. The example above is illustrative; the implementation reads the source of truth from those two files and codifies it as the migration's `CASE` expression.

**Unknown / legacy values:** Anything not matched by the `CASE` collapses to `'neutral'`. Reviewed before merge — if any tenant has a custom hex in production, the migration's `ELSE` arm catches it without crashing.

**No rollback migration.** Forward-only per project convention (lossy mapping is acceptable; tones are the new authoritative domain).

---

## API Contracts

No API changes. Existing CRUD routes for `deal_stage` accept the same `color` field; the value domain narrows but the type signature stays `string` at the HTTP layer (Zod validator on the server enforces the union).

The Quick deal currencies prop (Phase E item 22) consumes the existing tenant currencies list already wired into the page. No new endpoint.

---

## Migration & Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`:

| Surface | Classification | Change | BC handling |
|---------|----------------|--------|-------------|
| `deal_stage.color` column type | STABLE | Value domain narrows from arbitrary hex to 7-tone enum | Forward-only data migration. No schema change. |
| `deal_stage` Zod validator | STABLE | Field constraint changes from `z.string()` (or hex regex) to `z.enum([...])` | Coordinated with migration in same release. |
| `QuickDealDialog` props | ADDITIVE-ONLY | New optional `currencies` prop | Defaults to a sensible fallback if omitted, but page always passes it now. |
| `ActivityComposerDialog` props | ADDITIVE-ONLY | New `context.type`-aware refine message | No prop signature change. |
| `CrudForm` `extraActions` | FROZEN | Not modified here. We change three consumers, not the primitive. | n/a — explicitly chose consumer-side fix over CrudForm fix. |
| ViewTabsRow component | ADDITIVE-ONLY | Now rendered on the list page in addition to kanban page | Existing consumers unaffected. |
| `/backend/customers/deals/create?returnTo=...` | ADDITIVE-ONLY | New optional query param | Old call sites without the param keep current behavior. |

No deprecation protocol needed — no removed exports, no removed event IDs, no removed routes.

---

## Integration Coverage

Per parent SPEC-048, Phase 5 covers the full integration test suite (`_pipeline` enricher shape, bulk routes, ProgressJob, CSV, accessibility). That work remains deferred.

**This spec adds one new markdown scenario:**

- `TC-CRM-018-deal-stage-color-migration.md` — verifies that a tenant with existing hex stage colors loads correctly after `yarn db:migrate`, that the 7-tone picker renders for new/edit dialogs, that migrated stages display with the correct tone, and that any unmapped legacy value falls back to `neutral` without erroring.

No new Playwright TypeScript tests in this round. The reviewer's items do not introduce new business logic outside of (a) the migration (covered by the markdown scenario above) and (b) the `returnTo` redirect (covered manually during PR QA).

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|-----------|----------|
| Stage color migration mis-maps a hex value used by a real tenant, silently turning a recognizable color into `neutral` | Medium | `deal_stage` rows in production | Build the `CASE` table from the union of (a) the 6 hex chips in AddStageDialog and (b) the current Lane hex→tone mapping function. Add an `ELSE 'neutral'` arm — never crash. Run a one-tenant smoke (or read all distinct hex values across tenants if practical) before merging. | Low — a `neutral` stage is still functional; admin can re-pick the tone in the new picker. |
| `Configure card fields` removal is a Figma deviation that the reviewer expected to be left as a stub | Low | CustomizeViewDialog | Documented explicitly in §"Figma deviations" and called out in PR body. Reviewer's punch list explicitly accepted "remove" as one of the two options. | None — matches reviewer's accepted option. |
| `text-[9px]` retention is technically a DS rule break, may trigger DS Guardian on next pass | Low | CurrencyFilterPopover, CurrencyBreakdownTable | Add a one-line comment citing the Figma node ID and reasoning. Document as a tracked exception. Follow-up: add a `text-badge` token to the DS. | Low — comment makes intent explicit. |
| `returnTo` accepts arbitrary URLs → open-redirect class of bug | Medium | `deals/create/page.tsx` | Validate `returnTo` starts with `/backend/customers/deals/` before honoring it. Otherwise fall back to the current list redirect. | Low — restricted to a known prefix; no off-site redirects possible. |
| DealCardMenu hotkey bindings conflict with global shortcuts or input fields | Low | Keyboard UX | Bindings only fire when (a) the menu is open, OR (b) the card is focused AND no input/textarea is the active element. Standard guard pattern. | Very low — scoped to focused card. |
| Removing `extraActions` Cancel from three dialogs leaves a visual gap if DS FormFooter Cancel was not previously rendering | Low | QuickDealDialog, ActivityComposerDialog, AddStageDialog | Verify in browser per dialog before staging. DS FormFooter renders Cancel by default when not embedded — confirm `embedded` is set correctly on each consumer. | None — caught by manual QA. |
| Phase B item 7 (ViewTabsRow on list page) changes the layout of an "untouched" page | Low | `deals/page.tsx` (list view) | Render only the tab row near the existing page header. Do not modify the list content. SPEC-048 §line 537 explicitly anticipates this reuse. | None. |

---

## Figma decisions

### Items where Figma overrides the reviewer

| # | Reviewer recommended | Figma shows | Implementation decision |
|---|----------------------|-------------|-------------------------|
| 9 | Remove "Configure card fields" | Present, with chevron + "Show / hide / reorder" subtitle | **Remove** — explicitly chosen over the Figma stance because (a) backend isn't built, (b) reviewer accepted "remove" as a valid option, (c) avoids dead-click UX. |
| 12 | Drop chevrons on Reset / Configure rows (they imply drill-in) | Chevrons intentional on all three ACTIONS rows | Keep chevrons. Other parts of item 12 (manual X, footer Close, duplicate Reset) still fixed. |
| 14 | Add leading icons to DealCardMenu | No icons; right-aligned shortcut hints (⏎, E, ⌘D) | Don't add icons. Wire the existing hints to real hotkeys (Phase E). |
| 15 | Remove `text-[9px]` arbitrary sizes | BASE badge uses `text-[9px] font-bold text-[#4f39f6]` (Figma node `1251:671`) | Keep `text-[9px]` with explanatory comment. Tracked as DS exception. |

### Item 24 — probability pill exact values from Figma

| Range | Figma `bg` | Figma `text` | DS token (where it maps) | Implementation |
|-------|------------|--------------|--------------------------|----------------|
| 0 – 39 % | `#f4f5f7` | `#808794` | `bg-muted` + `text-muted-foreground` (verify exact match) | DS tokens with hex fallback comment |
| 40 – 69 % | `#fff2e0` | `#fe9a00` | `bg-status-warning-bg` + `text-status-warning-text` (verify) | DS status-warning tokens with hex fallback |
| 70 – 100 % | `#f4f5f7` | `#474c5a` | `bg-muted` + `text-foreground` (verify) | DS tokens with hex fallback |

Border-radius: `rounded-[6px]` (matches `rounded-md` if 6px in the project's Tailwind config; otherwise arbitrary). Padding: `px-[8px] py-[3px]`. Font: `text-[11px] font-semibold`. **Not** colored green for high probability — Figma uses neutral surface + darker text to signal emphasis instead.

---

## Implementation Plan

### Phase A — Accessibility (one commit)

1. Edit `DealCard.tsx:248-260` per item 1.
2. Edit `DealCard.tsx:262-277` and `:337-398` per item 2.
3. Edit `BulkActionsBar.tsx` per item 3 (mount/unmount keydown listener).
4. Edit `SortByPopover.tsx:136` per item 4.
5. Edit `DealCardMenu.tsx:88-124` per item 5 — keyboard nav + autofocus (hotkey wiring lands in Phase E).
6. Edit `FilterPopoverShell.tsx:54,77` per item 6.

Manual QA per item: VoiceOver/NVDA pass over DealCard; tab through bulk-selected card to reach checkbox + actions; ESC clears bulk selection; arrow keys move through Sort radio; arrow keys move through DealCardMenu; FilterPopoverShell solid surface.

### Phase B — Navigation / product bugs (one commit)

1. Add `<ViewTabsRow active="lista" />` to `deals/page.tsx` near the existing header.
2. Add `returnTo` reading + validation in `deals/create/page.tsx:19,47,73`. Update `pipeline/page.tsx:2431` kanban "New deal" CTA to pass the param.
3. Remove "Configure card fields" entry from `CustomizeViewDialog.tsx`. Remove `handleComingSoon` call site in `pipeline/page.tsx:1443`.
4. Extend the "Reset to default" handler in `pipeline/page.tsx:1438-1441` to clear all filter state.

Manual QA: round-trip Lista → Kanban via tabs; New deal → cancel returns to kanban; Reset clears every filter chip.

### Phase C — Dialog shell cleanup (one commit)

1. Remove `extraActions` Cancel from each of QuickDealDialog / ActivityComposerDialog / AddStageDialog.
2. Update `CustomizeViewDialog.tsx:66-83` — drop manual X, drop footer Close, collapse duplicate Reset.
3. Parameterize `ActivityComposerDialog.tsx:102` refine message by `context.type`.
4. DealCardMenu density polish — text/leading/padding per Phase D-equivalent DS tokens.

Manual QA: each of the four dialogs shows exactly one X + one Cancel; email composer shows "Add a subject or body" error.

### Phase D — DS compliance (one commit)

1. Add `// Figma: BASE badge uses intentional 9px (node 1251:671)` next to each `text-[9px]` site.
2. Create `pipeline/components/constants.ts` with `LANE_WIDTH_PX = 308` and `LANE_WIDTH_CLASS = 'w-[308px]'`.
3. Replace `w-[308px]` literals and the inline-style fallback in Lane / AddStageLane / page.tsx.
4. Swap hand-rolled breadcrumb + h1 in `pipeline/page.tsx:2298-2461` for DS PageHeader + Breadcrumb.
5. Create `pipeline/components/DashedTileButton.tsx`. Refactor Lane.tsx:281-295, Lane.tsx:332-353, AddStageLane.tsx to use it.
6. Replace raw `<button>` "Clear" in `CloseDateFilterPopover.tsx:149` with `Button variant="link" size="sm"`.

Manual QA: page header weight matches other backend pages; lane widths visually unchanged; dashed-tile buttons unchanged; "Clear" link styled consistently with other text links.

### Phase E — UX polish (one commit + one SQL migration)

1. Swap Quick deal Company `<select>` → `ComboboxInput` (async search to companies API).
2. Pipe tenant currencies into `QuickDealDialog` from `pipeline/page.tsx` (replace hardcoded array).
3. Wrap status option labels in `t('deals.status.<value>')`. Add four keys to `customers` en/pl translation files.
4. Rewrite probability pill in `DealCard.tsx:230-234` using the three-tier mapping from §"Figma decisions". Add `aria-label`.
5. Replace AddStageDialog hex chips with 7-tone chips. Update Lane's mapping function (now identity for tones, defensive hex→tone fallback for old data if migration race occurs).
6. Add SQL migration backfilling `deal_stage.color` from hex → tone. Build the `CASE` table by reading both current hex sources (AddStageDialog chips + Lane mapping function) and codifying them.
7. Add `cursor-pointer` swap to `DealCard.tsx:186-199` when `bulkSelectionActive`.
8. Wire DealCardMenu shortcut hints to real bindings (⏎ open, E edit, ⌘D duplicate) — scoped to focused card or open menu.

Test: write `TC-CRM-018-deal-stage-color-migration.md` and run it manually against a seeded tenant.

### Phase F — PR body (no commit — PR description update)

Update PR description with the deferred-scope section described in Phase F above.

### Phase G — Round-2 review fixes (one commit + one TC scenario)

1. Remove the header "Reset column widths" `<Button>` from `pipeline/page.tsx`. Customize view dialog already owns the action — confirmed by the existing `onResetColumnWidths={handleResetAllLaneWidths}` wiring at the `CustomizeViewDialog` call site.
2. Add an "Add stage" `<Button variant="outline">` to the header CTA cluster (between "Customize view" and "New deal"). Wire it to the existing `handleAddStage` callback so the same `AddStageDialog` opens regardless of entry point. **Keep** the `<AddStageLane onClick={handleAddStage} />` tile at the end of the lane scroller — both entry points coexist (revised in round-3).
3. Elevate both lane rails by replacing `relative flex w-9 shrink-0` with `relative z-10 flex w-11 mr-2 shrink-0 items-center justify-center bg-card shadow-lg [clip-path:inset(-40px_-40px_-40px_0)]` on the left rail, and the mirrored `relative z-10 flex w-11 ml-2 shrink-0 items-center justify-center bg-card shadow-lg [clip-path:inset(-40px_0_-40px_-40px)]` on the right rail. Positive 8px margin (vs. the negative `-mr-2`/`-ml-2` in the original v1.1 design) gives the first/last lane visible breathing room from the rail — restored in round-3. The clip-path keeps the elevation's drop-shadow from leaking past the page chrome.
4. Patch `LaneCurrencyBreakdown.tsx:108` (outer wrapper) — `bg-muted/30` → `bg-card`. Patch `CurrencyFilterPopover.tsx:113` (outer) — `bg-muted/30` → `bg-card`. Patch `CurrencyFilterPopover.tsx:195` (footer) — `bg-muted/30` → `bg-muted`.
5. **Bulk-drag wiring** (item 32, the blocker):
   - Add a new `bulkMoveDealsToStage(dealIds: string[], targetStageId: string)` callback. It performs an optimistic move on all `dealIds` against the per-lane react-query caches (same shape as `moveDealToStage` but loops over each id), then POSTs to `/api/customers/deals/bulk-update-stage` (same endpoint already used by the BulkActionsBar "Change stage" menu). Wraps the POST in `runDealMutation` for guarded-mutation parity with the menu path. On failure, rolls back the optimistic update via the snapshot; selection is preserved so the operator can retry.
   - Rewrite `handleDragEnd`: extract `dealId` + `targetStageId` as today, then dispatch on `selectedDealIds.has(dealId) && selectedDealIds.size > 1` → `bulkMoveDealsToStage`, else `moveDealToStage`.
   - Update the `DragOverlay` render to attach a `+N` indicator pill in the upper-right corner of the dragged card when `bulkDragActive` (where `bulkDragActive = activeDragDealId ? selectedDealIds.has(activeDragDealId) && selectedDealIds.size > 1 : false`). N = `selectedDealIds.size - 1` (the dragged card itself is implicit).
6. Add markdown scenario `TC-CRM-066-deal-kanban-bulk-drag.md` covering: pre-select 3 deals, drag one of them into another stage → all 3 move; pre-select 3 deals, drag a deal that is NOT in the selection → only the dragged one moves (selection unchanged); POST 500 → optimistic update rolls back, selection preserved.

Manual QA per item: (1) widths control only exists inside Customize view; (2) "Add stage" CTA visible without scrolling, AddStageDialog opens, lane row no longer carries a trailing dashed tile; (3) rails render as elevated tabs over the scroller — no flicker behind chevron buttons; (4) currency popovers render solid (no bleed-through onto card content underneath); (5) bulk-drag UX as described in the TC-CRM-066 scenario.

---

## Progress Checklist

- [ ] Phase A — Accessibility (items 1–6)
- [ ] Phase B — Navigation / product bugs (items 7–10)
- [ ] Phase C — Dialog shell cleanup (items 11–14)
- [ ] Phase D — DS compliance (items 15–20)
- [ ] Phase E — UX polish (items 21–26) + SQL migration + TC-CRM-018
- [ ] Phase F — PR description (item 27)
- [ ] Phase G — Round-2 review fixes (items 29–33) + TC-CRM-066
- [ ] Manual QA pass per phase (see Implementation Plan)
- [ ] Build green: `yarn build`
- [ ] Lint green: `yarn lint`
- [ ] Unit tests green: `yarn test`
- [ ] `yarn mercato configs cache structural --all-tenants` run after Phase D (PageHeader/Breadcrumb may affect nav cache — verify; if no structural change, skip)

---

## Final Compliance Report

| Check | Result |
|-------|--------|
| BC contract surfaces reviewed | ✅ — see Migration & BC table. One STABLE narrowing (deal_stage.color domain), all others additive or consumer-only. |
| Existing specs / AGENTS read | ✅ — parent SPEC-048, packages/ui/AGENTS.md, .ai/ds-rules.md, .ai/specs/AGENTS.md. |
| Figma alignment | ✅ — exact hex values extracted via `mcp__figma-desktop__get_design_context` for probability pill (nodes 982:369, 982:417, 982:576, 982:626, 982:674, 982:745, 982:797, 982:928, 982:1002) and BASE badge (1251:671). Four reviewer points explicitly overridden by Figma — documented in §"Figma decisions". |
| Integration coverage | ✅ — one new markdown scenario (TC-CRM-018) for the migration. Phase 5 TS Playwright tests remain deferred per parent spec. |
| Risks documented | ✅ — seven concrete risks with severity + mitigation. |
| Forward-only migration | ✅ — no rollback; lossy mapping acceptable per spec convention. |
| User-facing strings i18n'd | ✅ — items 13 (refine msg), 22 (currency labels are codes), 23 (status labels) all wrapped in `t()`. |
| ACL / security review | ✅ — no ACL changes. `returnTo` validated by prefix to prevent open-redirect. |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-19 | Spec drafted. |
| 2026-05-20 | Round-2 review fixes (items 29–33) added as Phase G with companion TC-CRM-066 markdown scenario. |
| 2026-05-21 | Round-3 UX-designer corrections to Phase G items 30 and 31: restored the trailing `AddStageLane` tile (kept the toolbar button); replaced rail overlap (`-mr-2`/`-ml-2`) with a positive 8px gap (`mr-2`/`ml-2`). |
