# DS Foundation v5 — Implementation Spec

> **Phase 5 monolithic delivery** of the DS Foundation programme. Companion to the umbrella spec [`2026-04-25-ds-foundation.md`](./2026-04-25-ds-foundation.md). Builds directly on Phase 3 ([PR #1910](https://github.com/open-mercato/open-mercato/pull/1910), carry-forward of #1907) and Phase 4 ([PR #1921](https://github.com/open-mercato/open-mercato/pull/1921), carry-forward of #1918) — both merged into `develop`.

## TLDR

**Key Points:**
- Single PR delivering the **final batch of missing primitives** from the Figma DS Open Mercato source of truth, closing the "Components" layer of the 7-layer DS framework. Net: **12 new primitives + 8 rewrites + 1 Table polish pass**.
- **12 new primitives**: `ActivityFeed`, `ButtonGroup`, `ColorPicker`, `CommandMenu` (Cmd+K palette), `Drawer` (side sheet), `NotificationFeed` (inbox / timeline, distinct from existing toast `Notification`), `Pagination` (standalone — extracted from `DataTable` sub-component), `Rating` (1–5 star widget), `ScrollArea` (Radix wrapper with DS-styled scrollbars), `Slider`, `StepIndicator` (wizard progress), `SegmentedControl` (mutually-exclusive toggle group).
- **8 rewrites** of existing primitives to align with the Figma source of truth: `Avatar`, `Badge`, `Dialog` (a.k.a. Modal), `Separator` (a.k.a. Content Divider), `Progress`, `Notification` (toast — distinct from new `NotificationFeed`), `Tabs`, `Table` (incl. companion polish on `DataTable` + `FilterBar` + `FilterOverlay`). All rewrites are **additive** at the API surface — every existing prop / variant / size stays callable; new props/variants/sizes are added per Figma.
- **Per-Figma-node anchoring**: each primitive section in this spec lists the source Figma node ID from the DS file [`qCq9z6q1if0mpoRstV5OEA`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato). Node IDs marked `TBD` are resolved during the per-primitive commit (via `mcp__figma__search_design_system` or by inspecting the corresponding screen).
- **Atomic commit discipline** is mandatory. The implementation plan below sequences ~25 commits — one per primitive, one per migration cluster, one per docs sweep — so the carry-forward / autofix path stays narrow if review surfaces blockers.
- **Backward compatibility is a hard constraint** for the 8 rewrites. The 83-import-site `Badge` and 40-import-site `Dialog` cascades cannot tolerate prop renames or variant removals. Every rewrite ships its existing API as the canonical default and adds new variants behind opt-in props.

**Scope:**
- 12 new primitive files in `packages/ui/src/primitives/`.
- 8 rewritten primitive files (preserving existing exports).
- Unit tests in `packages/ui/src/primitives/__tests__/` — **mandatory** for every new primitive AND every rewrite that touches behaviour (controlled state, conditional render, a11y). Per [`feedback_pre_pr_primitive_adding_checklist`](../../README.md) and [`feedback_pre_pr_review_checklist`](../../README.md).
- Documentation updates (mandatory):
  - `.ai/ui-components.md` — full section per primitive (new or rewritten).
  - `packages/ui/AGENTS.md` — quick-reference rows.
  - `docs/design-system/components.md` — status updates.
  - `docs/design-system/component-apis.md` — TS interfaces.
  - `.ai/specs/2026-04-25-ds-foundation.md` — Phase 5 changelog row.
- Targeted consumer migrations only where the new primitive replaces an ad-hoc pattern that grep-trivially audits (e.g. `Pagination` replaces the inline `DataTable` pager). No bulk consumer rewrites in this PR — those follow up in subsequent PRs.

**Concerns:**
- **Monolithic-PR scope (20 components)** is roughly 2.5× the size of v4 (8 components, [#1921](https://github.com/open-mercato/open-mercato/pull/1921)) and 1.3× v3 (15 components, [#1910](https://github.com/open-mercato/open-mercato/pull/1910)). Risk: review fatigue → carry-forward with multi-commit autofix. **Mitigations**: (1) strict atomic commit discipline; (2) per-primitive smoke tests so auto-review-pr finds zero "missing test coverage" gaps; (3) backward-compatible rewrites so the integration suite finds zero behavioural regressions; (4) pre-push grep against the patterns in `feedback_pre_pr_primitive_adding_checklist` (role-aware `rounded-*`, DS shadow tokens, no context-dependent defaults, cascade audit, no inline `style={{}}` sizes).
- **Badge cascade (83 import sites)** is the largest single-rewrite risk in the v5 batch. Mitigation: keep the existing `variant` API (`default | secondary | destructive | outline | success | warning | brand`) callable verbatim; add Figma's new variants as additional discriminants on the union. No removed variants, no renamed sizes, no dropped props.
- **Dialog cascade (40 import sites)** is second-largest. Mitigation: same — keep `<Dialog>` / `<DialogTrigger>` / `<DialogContent>` / `<DialogHeader>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogFooter>` / `<DialogClose>` compound API stable; restyle the slots, do not refactor the composition.
- **Table is touched indirectly via `DataTable` consumers (every list view in the product)**. Treat the `Table` primitive rewrite as a styling-only sweep — no header-cell prop changes, no `Row` / `Cell` API rewrites, no sort-behaviour changes in `DataTable`. The "kilka rzeczy do poprawienia" the user mentioned is captured in § 20 (Table) as a closed list — anything beyond that list ships in a follow-up PR.
- **New third-party deps audit**. `CommandMenu` uses `cmdk` (already transitively installed — confirmed via `yarn.lock`). `ScrollArea` requires `@radix-ui/react-scroll-area` (**not currently installed** — must be added to `packages/ui/package.json` in the ScrollArea commit; spec note revised post-audit). `Slider` requires `@radix-ui/react-slider` (audit at Slider commit time — likely needs adding too). All other primitives use already-installed Radix packages or no third-party deps.

---

## Overview

The Open Mercato Design System workstream began with the April 2026 hackathon ([PR #1226](https://github.com/open-mercato/open-mercato/pull/1226)) and has progressed through:

1. **Phase 0** — semantic tokens, FormField, StatusBadge, SectionHeader, DS Guardian skill, AGENTS.md DS rules.
2. **Phase 1** ([PR #1708](https://github.com/open-mercato/open-mercato/pull/1708)) — Input/Textarea/Button/IconButton/Select/Switch/Radio/Checkbox/Tooltip/Avatar/Tag/Kbd primitives + status colors.
3. **Phase 2** ([PR #1739](https://github.com/open-mercato/open-mercato/pull/1739)) — Alert, RichEditor, Popover refresh, sidebar customization, semantic spacing.
4. **Phase 3** ([PR #1910](https://github.com/open-mercato/open-mercato/pull/1910)) — 15 primitives: DatePicker, DateRangePicker, TimePicker, EmptyState, Skeleton, TagInput, CounterInput, DigitInput, InlineInput, CompactSelect, InlineSelect, plus LogList + RichEditor auto-overflow + 30 production migrations.
5. **Phase 4** ([PR #1921](https://github.com/open-mercato/open-mercato/pull/1921)) — 8 primitives: EmailInput, PasswordInput, SearchInput, WebsiteInput, AmountInput, ButtonInput, CardInput, SelectTriggerLeading/SelectItemLeading compound additions, plus PhoneNumberField rewrite and ComboboxInput / LookupSelect / EventSelect / EventPatternInput i18n.

v5 closes the gap to the Figma source-of-truth file. After v5 merges, every component variant listed in the DS file should have a corresponding primitive in the codebase — leaving downstream work to be **consumer migrations** rather than primitive additions.

## Problem Statement

The Figma DS file ([`qCq9z6q1if0mpoRstV5OEA`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato)) defines components that either have no implementation in `packages/ui/src/primitives/` after Phases 0–4, or have an implementation that visually drifted from the Figma source of truth. Concrete gaps audited from the current codebase:

### Missing primitives (12)

These render today as ad-hoc HTML or inlined sub-components — each occurrence is a discoverability + consistency cost:

- **`ActivityFeed`** — every detail page (`customers/components/detail/ActivityTimeline.tsx`, `customers/components/detail/ChangelogList.tsx`, sales document audit panels) rolls its own `<div>`-based timeline. Different paddings, different timestamp formats, different empty states.
- **`ButtonGroup`** — view-mode toggles (List/Grid in catalog) and grouped CTAs hand-roll `<div className="inline-flex">` + manual `rounded-l-md rounded-r-md` per child. Easy to drift.
- **`ColorPicker`** — Custom tag colors today use a 6-row table of `<button>` swatches inside `customers/components/TagsConfig.tsx`. No reusable primitive.
- **`CommandMenu`** — No Cmd+K palette today. Users navigate by sidebar clicks. Roadmap item from `project_ds_phase3_component_roadmap.md`.
- **`Drawer`** — Side sheets today use full `Dialog` with manual positioning overrides. The contextual / non-blocking-feel is lost (Dialog steals full focus). Affects: notification-list panel, secondary forms, mobile menus.
- **`NotificationFeed`** — Bell-icon dropdown today uses ad-hoc `<ul>` markup in `packages/ui/src/backend/AppShell.tsx`. Existing `Notification` primitive is for toasts only.
- **`Pagination`** — Today exists only as an internal sub-component of `DataTable` (`packages/ui/src/backend/DataTable.tsx:2143`). Non-DataTable lists (portal order list, search result page) can't reuse it.
- **`Rating`** — No primitive. Consumer product review surfaces (if added) would have to roll their own.
- **`ScrollArea`** — Long lists currently use `overflow-auto` + native scrollbars (visually inconsistent across OS). DS specifies a custom thumb token.
- **`Slider`** — No primitive. Price-range filters in catalog roll their own `<input type="range">`.
- **`StepIndicator`** — Onboarding wizard (`packages/onboarding/src/modules/onboarding/frontend/onboarding/OnboardingPageClient.tsx`) uses ad-hoc step dots. Checkout flow (`packages/checkout`) also has custom step indicators. Not shared.
- **`SegmentedControl`** — Status filter pills (e.g. "All / Active / Archived" on customer-people list page) use ad-hoc button groups with manual `aria-pressed` state. No primitive captures the iOS-segmented-control pattern.

### Drifted primitives (8, requiring rewrites)

These have implementations but the visual treatment is from pre-v3 and no longer matches the Figma source of truth. Each rewrite is **strictly additive** at the API level — see `Backward compatibility` per primitive in `## Per-Primitive Specs`:

- **`Avatar`** (4 import sites) — Figma adds status indicator dot and optional ring color per role. Existing initials-generation logic stays.
- **`Badge`** (83 import sites — **highest cascade**) — Figma adds new variants and possibly an `xs` size for inline-in-text mentions. Existing seven variants (`default | secondary | destructive | outline | success | warning | brand`) all stay callable verbatim.
- **`Dialog`** (40 import sites — **second-highest cascade**) — Figma adjusts padding / radius / shadow / header treatment. Possibly adds `size` discriminant. Existing compound API stays.
- **`Separator`** (5 import sites) — Figma adds labeled separator pattern (the "OR" divider on login pages), plus optional `dashed` / `dotted` variants.
- **`Progress`** (3 import sites) — Figma adds `indeterminate` mode (shimmer animation), `variant` discriminant for status-colored progress, optional `showValue` overlay.
- **`Notification`** (0 import sites — toast primitive) — Figma adds optional `action` slot inside the toast and `icon` override. Existing `title` / `description` / `type` / `onClose` props stay.
- **`Tabs`** (6 import sites) — Figma adds `variant: pills | vertical` plus a `count` slot on `TabsTrigger`.
- **`Table`** (1 direct + DataTable internals — every list view in the product) — closed list of polish items: header cell padding, row-hover token, sortable indicator placement, empty-state row, optional `striped` variant.

### Backend polish (FilterBar / FilterOverlay / DataTable filters)

User explicitly called out "filtry do tabel" as part of v5 scope. These are backend components, not primitives. Polish is visual-only — no `FilterDef` / `FilterValues` API change.

### Why monolithic delivery

Per `feedback_ds_v3_monolithic_strategy` memory rule, the user prefers a single foundation PR per DS phase rather than per-primitive PRs. The carry-forward pattern observed on v3 (`#1907 → #1910`) and v4 (`#1918 → #1921`) — where the maintainer extends the PR with autofix commits rather than blocking — works at this scope **only if** the pre-push checklist gates are met (see `## Pre-Push Checklist` and the `feedback_pre_pr_primitive_adding_checklist` memory rule).

## Per-Primitive Specs

Each section below documents one component. New primitives use the heading "(new)"; rewrites use "(rewrite)" with a "Backward compatibility" subsection explicitly enumerating what stays callable.

### 1. ActivityFeed (new)

**Figma node:** TBD (DS file → "Activity Feed" or similar).

**Purpose:** Chronological list of actions/events scoped to an entity (deal, person, order). Distinct from `Notification` (toast) and the planned `NotificationFeed` (inbox panel). Used in detail-page "Activity" / "Timeline" tabs.

**API:**

```tsx
<ActivityFeed
  items={items}
  groupBy?: 'day' | 'week' | 'none'    // default 'day'
  renderItem?: (item) => ReactNode      // custom renderer override
  emptyState?: ReactNode                // defaults to <EmptyState>
  isLoading?: boolean                   // defaults to false; renders <Skeleton> rows
/>
```

Each `ActivityFeedItem` carries: `id`, `timestamp`, `actor` (optional `Avatar` source), `verb` (translated), `target` (optional badge / link), `details` (optional ReactNode), `icon` (optional, falls back to a default per `verb`).

**Anti-patterns this replaces:** Ad-hoc `<div>`-based activity lists in `customers/components/detail/ActivityTimeline.tsx` and similar. Migration of those consumers is **out of scope for this PR** (per Concerns) — they migrate in a follow-up.

**Tests:** Smoke test asserts grouping logic, empty state, loading state, custom `renderItem`.

---

### 2. ButtonGroup (new)

**Figma node:** TBD.

**Purpose:** Joined buttons sharing a common border, used for view-mode toggles (List/Grid), period selectors, and grouped CTAs. Distinct from `SegmentedControl` — `ButtonGroup` is for *related actions* (each does something different), `SegmentedControl` is for *mutually-exclusive states* (only one selected).

**API:**

```tsx
<ButtonGroup orientation?='horizontal' | 'vertical' size?='sm' | 'default' | 'lg'>
  <Button>Save</Button>
  <Button>Save & New</Button>
  <IconButton aria-label='More'><Ellipsis /></IconButton>
</ButtonGroup>
```

Renders children with shared border-radius corners (first child = left corners, last child = right corners, middle children = `rounded-none`). Children inherit `size` if unspecified.

**Tests:** Smoke test asserts corner-radius application, size cascade, orientation switch.

---

### 3. ColorPicker (new)

**Figma node:** [`Color Picker`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=167184-38583) frame (`167184:38583`) on doc page [`553:22078`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=553-22078). 4-section vertical stack (316×334, `rounded-xl`):

1. **Choose color** — title + current hex (right) + pill hue slider (rainbow gradient, draggable white thumb).
2. **Input** — hex text field + eyedropper button (Sip).
3. **Saved colors** — title + row of swatch dots (24×24 wrapper, 16×16 dot inside).
4. **Add new color** *(optional)* — footer button with `+` icon that fires `onAddSwatch(currentValue)`.

No 2D HSV spectrum, no opacity slider, no format dropdown — those belong to a separate "advanced color picker" primitive (deferred indefinitely; current DS source doesn't ship them). Implementation is vanilla — hue slider is a native `<input type="range">` with a CSS gradient track, hex / RGB / HSL conversion done inline. No `react-colorful` / `tinycolor2` / `color` dep.

Swatch dot states match `Color Dots [1.1]` 4-state contract (componentSet `3365:22464`): Default (color fill), Hover (16→14px shrink via `scale-[0.875]`), Selected (color fill + 2px **inset** white ring on the dot itself, NOT outer outline), Disabled (opacity-50 on the wrapper).

10 default swatches mirror the `Color Dots [1.1]` palette 1:1: Gray / Blue / Orange / Red / Green / Yellow / Purple / Sky / Pink / Teal.

**New deps:** None beyond the existing Radix Popover.

**Purpose:** Selecting a color, primarily for tagging (custom tag colors), category branding, and brand-color configuration. Renders as a `Popover` trigger + grid of swatches + optional custom hex input.

**API:**

```tsx
<ColorPicker
  value: string                              // hex (e.g. '#FF5733')
  onChange: (next: string) => void
  swatches?: string[]                        // default DS-curated palette
  allowCustom?: boolean                      // default true; hex input
  size?: 'sm' | 'default'
  disabled?: boolean
/>
```

Default swatches: 16 colors curated from the DS palette (red, orange, amber, yellow, lime, emerald, teal, cyan, sky, blue, indigo, violet, fuchsia, pink, rose, slate). Each as `bg-{color}-500` token, NOT arbitrary hex (avoids the brand-hex anti-pattern — these are *picker* options, not *brand mandates*).

**Tests:** Smoke test asserts selection callback, custom hex input parsing (`#fff`, `#ffffff`, invalid → no-op), disabled cascade.

---

### 4. CommandMenu (new)

**Figma node:** TBD.

**Purpose:** Cmd+K (Ctrl+K on Windows) global command palette — searchable list of actions, pages, recently-viewed entities. Distinct from `Combobox` (in-form) and `Select` (closed-list).

**API:**

```tsx
<CommandMenu open={open} onOpenChange={setOpen}>
  <CommandMenuInput placeholder='Type a command...' />
  <CommandMenuList>
    <CommandMenuEmpty>No results.</CommandMenuEmpty>
    <CommandMenuGroup heading='Pages'>
      <CommandMenuItem onSelect={...}>Customers</CommandMenuItem>
      <CommandMenuItem onSelect={...}>Sales</CommandMenuItem>
    </CommandMenuGroup>
    <CommandMenuGroup heading='Actions'>
      <CommandMenuItem onSelect={...} shortcut='⌘N'>New person</CommandMenuItem>
    </CommandMenuGroup>
  </CommandMenuList>
</CommandMenu>
```

Built on `cmdk` (confirm as direct dep or transitive). Fuzzy search, keyboard navigation (↑/↓/Enter), `shortcut` slot renders `Kbd`. Renders inside a `Dialog` with `forceMount`-style mounting so global hotkey listener can open it from any page.

**Tests:** Smoke test asserts open/close via prop, item `onSelect` fires, group rendering, empty state.

---

### 5. Drawer (new)

**Figma node:** No dedicated node in the DS Open Mercato library (audited via `search_design_system` — only `Modal Overlay [1.1]` covers the overlay surface; no side-positioned variants ship). Styling inferred from DS tokens per R4 in the v5 spec.

**Purpose:** Side sheet — slides in from `right` (default), `left`, `top`, or `bottom`. Used for detail panes, secondary forms, mobile menus. Distinct from `Dialog` — `Drawer` is *contextual / non-blocking-feeling*, `Dialog` is *modal / focused*.

**API:**

```tsx
<Drawer open={open} onOpenChange={setOpen} side='right'>
  <DrawerTrigger>Open</DrawerTrigger>
  <DrawerContent>
    <DrawerHeader>
      <DrawerTitle>Edit person</DrawerTitle>
      <DrawerDescription>...</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* scroll-area inside */}</DrawerBody>
    <DrawerFooter>
      <Button>Save</Button>
      <DrawerClose asChild><Button variant='ghost'>Cancel</Button></DrawerClose>
    </DrawerFooter>
  </DrawerContent>
</Drawer>
```

Uses Radix Dialog under the hood with custom positioning (Drawer is a Dialog variant in Radix). Default width: `420px` (`max-w-md`) for right/left, `60vh` for top/bottom. `Cmd+Enter` and `Escape` keyboard contract per UI rules.

**Tests:** Smoke test asserts open/close, side prop applies positioning class, Escape closes, focus trap activates.

---

### 6. NotificationFeed (new)

**Figma node:** TBD.

**Purpose:** Persistent panel listing in-app notifications (the "you have 5 notifications" inbox). Distinct from existing `Notification` (single toast) and `NotificationStack` (top-right toast pile). NotificationFeed is what opens when the user clicks the bell icon.

**API:**

```tsx
<NotificationFeed
  items: NotificationFeedItem[]
  onItemClick?: (item) => void
  onMarkAllRead?: () => void
  isLoading?: boolean
  emptyState?: ReactNode
  groupBy?: 'day' | 'unread-vs-read' | 'none'
/>
```

`NotificationFeedItem` = `{ id, type, title, body, createdAt, read, actor?, action? }`. Renderers per `type` come from the existing notification renderer system (`notifications.client.ts`).

**Tests:** Smoke test asserts item click, mark-all-read callback, grouping, empty state.

---

### 7. Pagination (new — primitive)

**Figma node:** [`Pagination Group [1.1]`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=199985-4135) — DS Open Mercato componentSet `199985:4135`. Three variants (Basic / Group / Full Radius) × three booleans (`First/Last`, `Next/Previous`, `Advanced`). v5 ships the Basic variant 1:1: `[Page X of Y]  [⏮ ◀ pages ▶ ⏭]  [N / page CompactSelect]`. Cell 32×32 rounded-8, white default, `#F7F7F7` muted when selected. Page-size select uses existing `CompactSelect` (size `xs`, h-7).

**Purpose:** Standalone pagination primitive. Today, pagination lives inside `DataTable` as an internal sub-component — this PR extracts the visual + accessibility primitive so non-DataTable lists can reuse it (portal lists, search results, etc.).

**API:**

```tsx
<Pagination
  page: number                          // 1-indexed
  pageSize: number
  total: number
  onPageChange: (next: number) => void
  showPageSize?: boolean                // default true; renders a Select for pageSize
  pageSizeOptions?: number[]            // default [10, 25, 50, 100]
  onPageSizeChange?: (next: number) => void
  siblingCount?: number                 // default 1; pages on either side of current
  boundaryCount?: number                // default 1; pages at start/end
/>
```

Renders: `« First < Prev [1] [2] ... [N-1] [N] Next > Last »` with `Kbd`-style indicators when keyboard-navigable. Total count shows as "Showing X–Y of Z".

`DataTable` keeps its internal pager **for backward compat in this PR**; migration to the new `Pagination` primitive happens in a follow-up.

**Tests:** Smoke test asserts page navigation, page-size change, sibling/boundary count math, disabled state at boundaries.

---

### 8. Rating (new)

**Figma node:** [`Rating & Review [1.0]`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=199969-1797) — DS Open Mercato componentSet `199969:1797`, key `544eab9fbc72c0038c0a28b7ff27a93ab8c3c01a`. 6-variant set = 2 types (Star | Heart) × 3 alignments (Only Ratings | Vertical | Horizontal); item size 20×20, gap 2px, star fill `#F6B51E` (mapped to `status-warning-icon`).

**Purpose:** 1-to-N star/heart/dot rating widget. Read-only display mode and interactive input mode.

**API:**

```tsx
<Rating
  value: number                         // 0..max
  max?: number                          // default 5
  onChange?: (next: number) => void     // optional → read-only when absent
  size?: 'sm' | 'default' | 'lg'
  icon?: 'star' | 'heart' | 'circle'    // default 'star'
  allowHalf?: boolean                   // default false; half-icon precision
  disabled?: boolean
  'aria-label'?: string                 // required when interactive
/>
```

Tests: Smoke test asserts read-only vs interactive (no onChange → no hover state), keyboard arrow nav, half-icon math.

---

### 9. ScrollArea (new)

**Figma node:** No dedicated node in the DS Open Mercato library (audited via `mcp__figma__search_design_system` on 2026-05-13 — only `Progress Bar` matched in this library; `Scrollbar - Horizontal/Vertical` results belonged to other libraries). Styling inferred from DS scrollbar tokens (muted-foreground thumb, transparent track, hover state) — see R4 in `Risks & Open Questions` for the inferred-design protocol.

**Dependencies:** Requires `@radix-ui/react-scroll-area` direct dep (added to `packages/ui/package.json` in the ScrollArea commit).

**Purpose:** DS-styled scrollbars in scrollable containers. Wraps Radix `ScrollArea` with our token-driven styling (thumb color, track width, hover state). Replaces ad-hoc `overflow-auto` + native scrollbar styling.

**API:**

```tsx
<ScrollArea className='h-72'>
  <div className='py-2'>{children}</div>
</ScrollArea>
```

Single-component primitive — no compound API needed.

**Tests:** Smoke test asserts horizontal/vertical scrolling, thumb renders only when content overflows.

---

### 10. Slider (new)

**Figma node:** [`Slider [1.1]`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=2617-1169) — DS Open Mercato componentSet `2617:1169`. 5-variant set parameterized by `Percentage` (0% / 25% / 50% / 75% / 100%); boolean props for Label / Sublabel / Tooltip. Track 6px `#EBEBEB`, progress `#6366F1` (indigo-500), 16px thumb with white outer + 6×6 indigo inner dot.

**Purpose:** Numeric value selector (single value or range). Used for price ranges, quantity selectors, opacity / brightness controls.

**API:**

```tsx
<Slider
  value={[20]}                          // [single] or [min, max]
  onValueChange={(next) => ...}
  min?: number                          // default 0
  max?: number                          // default 100
  step?: number                         // default 1
  disabled?: boolean
  showValue?: boolean                   // default false; tooltip on thumb
/>
```

Built on Radix Slider. Single thumb when `value.length === 1`, range when `value.length === 2`.

**Tests:** Smoke test asserts single vs range, step quantization, disabled cascade, keyboard arrow nav.

---

### 11. StepIndicator (new)

**Figma nodes:** DS Open Mercato ships four related component sets that together define the step indicator (initial `search_design_system` query missed them — the documentation page is named "Step Indicator [Overview]" at [`479:14388`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=479-14388)):

- `Step Indicator Horizontal [1.1]` — componentSet `3507:28`. Wrapper with `Quantity` variant (3 / 4 / 5). Inter-item separator is `arrow-right-s-line` icon, NOT a line.
- `Step Indicator Horizontal Items [1.1]` — componentSet `3505:3498`. Item with `State` variant (Default / Active / Completed). Dot 20×20 rounded-full. Active fill `#6366F1` (indigo-500), Completed fill `#16A34A` (green-600).
- `Step Indicator Vertical [1.1]` — componentSet `3507:227`. Vertical wrapper with `Quantity` variant; each item is its own pill (not a connecting line).
- `Step Indicator Vertical Items [1.1]` — componentSet `3507:190`. Item `cornerRadius: 10`; bg per state (`#F7F7F7` muted for past/future, `#FFFFFF` for active). Active variant also renders `arrow-right-s-line` trailing the label as "you are here".

Mapped to DS tokens: `accent-indigo` (active), `status-success-icon` (complete), `muted/40` + `border-muted-foreground/30` (pending). Figma source defines only three states; the primitive extends them with `'error'` (status-error-icon + X glyph) for product surfaces that need failure indication.

**Purpose:** Progress display for multi-step flows (wizards, onboarding, checkout). Distinct from `Progress` (continuous %) — `StepIndicator` is discrete (Step 2 of 5, with labels).

**API:**

```tsx
<StepIndicator
  steps: { id: string; label: string; status: 'pending' | 'current' | 'complete' | 'error' }[]
  orientation?: 'horizontal' | 'vertical'       // default 'horizontal'
  size?: 'sm' | 'default'
  onStepClick?: (stepId: string) => void        // optional; renders clickable if present
/>
```

Each step shows: dot indicator (filled/outlined per status), connecting line, label. Current step is brand-violet; complete steps are status-success; error step is status-error.

**Tests:** Smoke test asserts status visual per step, orientation, clickability when `onStepClick` provided.

---

### 12. SegmentedControl (new)

**Figma node:** TBD.

**Purpose:** Mutually-exclusive view toggle (e.g. "All / Active / Archived" tabs on a list page that aren't full tabs). Visually similar to iOS segmented control.

**API:**

```tsx
<SegmentedControl
  value: string
  onValueChange: (next: string) => void
  size?: 'sm' | 'default'
  disabled?: boolean
>
  <SegmentedControlItem value='all'>All</SegmentedControlItem>
  <SegmentedControlItem value='active'>Active</SegmentedControlItem>
  <SegmentedControlItem value='archived'>Archived</SegmentedControlItem>
</SegmentedControl>
```

Compound API. Renders inside a `bg-muted/40` track with the selected item highlighted via a `bg-background` indicator (smooth slide on selection change).

**Tests:** Smoke test asserts selection, keyboard arrow nav, disabled cascade, controlled value.

---

### 13. Avatar (rewrite)

**Figma node:** TBD (DS file → "Avatar" master component).

**Purpose:** Visual identifier for a user/entity. Existing primitive already supports sizes xs/sm/md/lg/xl, image fallback, initials generation. Rewrite aligns with Figma styling — possibly: status indicator dot, group/team variant, optional ring color per role.

**Backward compatibility:**
- `<Avatar label='...'>` keeps working (PR #1869 renamed `name=` → `label=`).
- All sizes (`xs | sm | md | lg | xl`) keep their pixel values.
- `src` / `alt` / `className` keep working.
- `AvatarStack` API unchanged.

**New (additive):**
- `status?: 'online' | 'offline' | 'busy' | 'away'` — renders a status dot at corner.
- `ringColor?: string` — optional DS-token-backed ring for role indication.

**Tests:** Smoke test asserts status dot rendering, ring color application, initial generation unchanged.

---

### 14. Badge (rewrite — HIGH cascade, 83 import sites)

**Figma node:** TBD.

**Purpose:** Small categorical label. Used everywhere — every DataTable status column, every detail page header, every list row. 83 import sites makes this the riskiest rewrite in v5.

**Backward compatibility (HARD constraint):**
- Every existing `variant` (`default | secondary | destructive | outline | success | warning | brand`) MUST stay callable verbatim with identical visual output.
- Every existing `size` MUST stay callable.
- The `dot` prop MUST stay callable.
- `StatusBadge` (separate primitive in `status-badge.tsx`) is **not** rewritten in this PR. Its `variant` API (`active | pending | failed | ...`) is independent and lives on. Touch only if Figma explicitly requires it; otherwise defer.

**New (additive):**
- Figma may introduce additional variants — add them as additional union members on the discriminant, never replace existing values.
- New `size` if Figma adds one (e.g. `xs` for inline-in-text mentions).
- New `icon` slot if Figma shows badges with leading icons (separate from `dot`).

**Migration audit step (mandatory before commit):**

```bash
# Re-run after rewrite to confirm zero behavioural drift on existing call sites.
grep -rn "<Badge" packages apps --include='*.tsx' | wc -l
yarn workspace @open-mercato/ui test badge
yarn test:integration:ephemeral  # full suite — Badge is too cascade-heavy for selective
```

**Tests:** Existing badge tests stay green; new tests cover any new variants/sizes/icon slot.

---

### 15. Dialog (rewrite — MEDIUM cascade, 40 import sites)

**Figma node:** TBD.

**Purpose:** Modal overlay. 40 import sites makes this the second-riskiest rewrite.

**Backward compatibility (HARD constraint):**
- The compound API (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`) MUST stay callable verbatim.
- `Cmd/Ctrl+Enter` submit and `Escape` cancel contract MUST stay enforced.
- `forceMount`, `modal`, `defaultOpen` Radix passthroughs MUST stay supported.

**New (additive / styling-only):**
- Figma may adjust padding, radius, shadow, header treatment, animation timing — all internal styling, no API break.
- Optional `size` discriminant if Figma documents `sm | default | lg | xl` Dialog widths.

**Tests:** Existing dialog tests stay green; new test for `size` variants.

---

### 16. Separator (rewrite — a.k.a. Content Divider)

**Figma node:** TBD.

**Purpose:** Visual divider between content blocks. Existing primitive is a thin `<div className='border-t'>` wrapper.

**Backward compatibility:**
- `<Separator orientation='horizontal' | 'vertical'>` keeps working.
- All `className` passthrough works.

**New (additive):**
- Figma may introduce labeled separators (e.g. `<Separator label='OR'>` with text in the middle and lines on both sides — common login-page pattern).
- Optional `decorative` prop (Radix passthrough — affects ARIA role).
- Optional `dashed` / `dotted` variants.

**Tests:** Smoke test for labeled variant, vertical orientation, custom variants.

---

### 17. Progress (rewrite)

**Figma node:** TBD.

**Purpose:** Determinate / indeterminate progress bar.

**Backward compatibility:**
- `<Progress value={N}>` keeps working.
- `className` passthrough works.

**New (additive):**
- Optional `size` discriminant.
- Optional `variant` discriminant (e.g. `default | success | warning` for status-colored progress).
- Optional `indeterminate` boolean (animated stripe / shimmer).
- Optional `showValue` (render "42%" overlay).

**Tests:** Existing test stays green; new tests for variant, indeterminate animation, showValue.

---

### 18. Notification (toast — rewrite)

**Figma node:** TBD.

**Purpose:** Single toast notification (existing primitive `notification.tsx`). Distinct from new `NotificationFeed` (§ 6, inbox panel).

**Backward compatibility:**
- Existing `<Notification>` props (`title`, `description`, `type`, `onClose`) keep working.
- `NotificationStack` (top-right pile) keeps working unchanged.

**New (additive):**
- Optional `action` slot (button inside the toast).
- Optional `icon` override.
- Figma styling alignments — padding, radius, shadow.

**Tests:** Existing test stays green; new tests for action slot, icon override.

---

### 19. Tabs (rewrite — a.k.a. Tab Menu)

**Figma node:** TBD.

**Purpose:** Tab navigation for detail-page sections. Existing primitive `tabs.tsx` ships standard Radix Tabs styling.

**Backward compatibility:**
- Compound API (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) stays verbatim.
- `value` / `defaultValue` / `onValueChange` Radix passthroughs unchanged.

**New (additive):**
- Optional `variant`: `default` (underline) | `pills` (filled background) | `vertical` (sidebar-style).
- Optional `size` for the trigger row.
- Optional `count` slot on `TabsTrigger` (badge with item count, common in inbox / segmented list views).

**Tests:** Existing test stays green; new tests for variant, count slot, vertical orientation.

---

### 20. Table (polish pass)

**Figma node:** TBD.

**Purpose:** Low-level `<table>` primitive used inside `DataTable`. Per user — "muszę jeszcze poprawić kilka rzeczy".

**Scope of polish (closed list):**
- Header cell padding alignment with Figma.
- Row-hover state token (was `bg-muted/40`, Figma may use a different token).
- Sortable-header indicator placement (current arrow vs Figma indicator).
- Empty-state row rendering when `data.length === 0` (currently inconsistent across consumers).
- Striped variant (`<Table variant='striped'>`) per Figma if applicable.

**Backward compatibility:**
- All existing exports (`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`) stay verbatim.
- `DataTable.tsx` consumer code unchanged (relies on table primitive internals).

**Tests:** Existing tests stay green; new test for `variant='striped'`.

---

### Bonus — FilterBar / FilterOverlay / DataTable filters (polish — backend, not primitive)

**Scope:** Per user — "filtry do tabel". The existing `FilterBar` + `FilterOverlay` are backend components, not DS primitives. v5 alignment with Figma is a polish pass — same closed-list approach as `Table`:

- FilterBar layout per Figma (gap, padding, button order).
- FilterOverlay popover styling alignment with Figma.
- Filter chip rendering (active filters as removable chips above the table).

**Backward compatibility:** `FilterDef` API and `FilterValues` shape stay unchanged. The `dateRange` filter branch already uses `DateRangePicker` (from v3). Other filter branches (select, multiselect, text) get visual polish only.

**Tests:** Existing FilterBar tests stay green.

---

## Implementation Plan

Atomic commit sequence (one concern per commit):

### Phase A — New primitives (12 commits)

Order chosen so primitives with lower dependency are first; primitives that depend on others (e.g. `CommandMenu` uses `Dialog`) come after.

1. `feat(ds): add ScrollArea primitive` — leaf utility, used by Drawer/CommandMenu.
2. `feat(ds): add ButtonGroup primitive`
3. `feat(ds): add SegmentedControl primitive`
4. `feat(ds): add Slider primitive`
5. `feat(ds): add Rating primitive`
6. `feat(ds): add StepIndicator primitive`
7. `feat(ds): add ColorPicker primitive`
8. `feat(ds): add Pagination primitive` (standalone — DataTable migration deferred)
9. `feat(ds): add Drawer primitive` (uses ScrollArea)
10. `feat(ds): add CommandMenu primitive` (uses Dialog + ScrollArea)
11. `feat(ds): add ActivityFeed primitive` (uses Avatar + EmptyState + Skeleton)
12. `feat(ds): add NotificationFeed primitive`

Each commit includes: primitive file, unit test file, `.ai/ui-components.md` section, `packages/ui/AGENTS.md` quick-ref row, i18n keys (if any).

### Phase B — Rewrites (8 commits, low-blast → high-blast)

13. `refactor(ds): rewrite Progress primitive per Figma — additive variants` (3 import sites)
14. `refactor(ds): rewrite Notification toast primitive per Figma — additive` (0 import sites)
15. `refactor(ds): rewrite Separator primitive per Figma — add labeled / dashed variants` (5 import sites)
16. `refactor(ds): rewrite Avatar primitive per Figma — add status + ring` (4 import sites)
17. `refactor(ds): rewrite Tabs primitive per Figma — add pills / vertical / count` (6 import sites)
18. `refactor(ds): polish Table primitive — padding / hover / sortable indicator / striped` (1 direct + DataTable internals)
19. `refactor(ds): rewrite Dialog primitive per Figma — additive size variant` (40 import sites)
20. `refactor(ds): rewrite Badge primitive per Figma — additive variants/sizes` (83 import sites)

### Phase C — Backend polish + i18n + docs (5 commits)

21. `refactor(ds): polish FilterBar / FilterOverlay per Figma — visual-only`
22. `feat(i18n): add ui.* keys for v5 primitives (en/pl/de/es)`
23. `docs(ds): update .ai/ui-components.md with v5 sections`
24. `docs(ds): update packages/ui/AGENTS.md + design-system docs`
25. `docs(ds): record v5 changelog row in 2026-04-25-ds-foundation.md`

### Phase D — Test selector catch-up (1–2 commits, only if needed)

26. `test(integration): update Playwright selectors for v5 primitive role changes` — only if any rewrite changes a role attribute (e.g. SegmentedControl rendering as `tablist` vs `radiogroup`).

## Migration & Backward Compatibility

The 8 rewrites carry the largest BC risk. Per `BACKWARD_COMPATIBILITY.md`:

| Contract surface | Verdict |
|---|---|
| Public component exports (named) | **PRESERVED** — every existing export name keeps working with identical TypeScript signature; new props are optional and additive. |
| Default visual output for existing variants | **PRESERVED for existing variants** — Figma styling drift is bound to new variants/sizes only. Behaviour: if the rewrite would visually re-style an existing variant, the rewrite is treated as a new variant under a new discriminant value, and the existing variant stays callable with identical output until a follow-up PR removes it (deprecation protocol). |
| Compound API (`Dialog.*`, `Tabs.*`) | **PRESERVED** — sub-component names, slot order, ref forwarding unchanged. |
| Role / aria attributes | **PRESERVED** — no role downgrades (would break Playwright selectors). Role *upgrades* (e.g. adding `aria-label` to icon-only slots) acceptable. |
| `data-*` attributes used by integration tests | **PRESERVED** — no removal of `data-crud-field-id`, `data-menu-item-id`, etc. |

For any rewrite where Figma demands an existing variant be visually changed (not just augmented), the rewrite ships **the new look as a new variant** alongside the old variant, and the migration path lands in a follow-up PR — never in the same PR as the rewrite.

## Testing

### Unit tests — MANDATORY per primitive

Every new primitive and every rewritten primitive with behavioural surface (`useState` / conditional JSX / a11y toggle / controlled-vs-uncontrolled) MUST ship a smoke test at `packages/ui/src/primitives/__tests__/<name>.test.tsx`.

Per `feedback_pre_pr_primitive_adding_checklist`, each smoke test covers (where applicable):

- Controlled vs uncontrolled paths.
- Disabled propagation (parent → children).
- Conditional render (e.g. Pagination prev/next disabled at boundaries; SegmentedControl indicator slide).
- Ref forwarding (`React.forwardRef`).
- Prop overrides (consumer-passed `aria-label`/`autoComplete` wins over default).
- Key interactions (Enter, Escape, Arrow keys for stepper-like primitives).

Thin wrappers (e.g. `ScrollArea` = Radix wrapper + styling, no state) — exempt but documented as "trivial wrapper" in the file's JSDoc.

### Integration tests

Full `yarn test:integration:ephemeral` (no `--filter`, no sampling) MUST pass locally before push per `feedback_pre_pr_review_checklist`.

For rewrites with cascade ≥ 40 import sites (`Dialog`, `Badge`), additional verification:

- After the rewrite commit, run a grep audit: `grep -rln "import.*Badge\|import.*Dialog" packages apps` and verify count is unchanged.
- After the rewrite commit, render any 3 random consumer surfaces from the audit list locally (`yarn dev` → click through) to confirm visual sanity before pushing.

### Cascade audit per rewrite

Per `feedback_pre_pr_primitive_adding_checklist` § 5, every rewrite that adds a default attribute or behaviour to a primitive MUST grep its consumers and walk the cascade. Specifically:

- **Badge rewrite**: if a new visual default cascades through `StatusBadge` or DataTable column renderers, surface this in the commit message.
- **Dialog rewrite**: if `Cmd/Ctrl+Enter` / `Escape` keyboard contract changes, every consumer's dialog footer must be tested (40 sites).
- **Tabs rewrite**: if the default variant changes from `underline` to `pills`, every detail-page tab in customers/sales/auth must be verified.

## Pre-Push Checklist (per `feedback_pre_pr_primitive_adding_checklist`)

Before the `git push` that creates the v5 PR:

- [ ] Each new primitive has a smoke test file.
- [ ] Role-aware `rounded-*` audit — every new `rounded-*` matches DS decision tree (interactive = `rounded-md`, container = `rounded-lg`, tiny = `rounded-sm`, large = `rounded-xl`). No `rounded-2xl` / `rounded-[Npx]`.
- [ ] Role-aware `shadow-*` audit — DS tokens only, never inline `shadow-[Npx_...]`.
- [ ] No context-dependent defaults in new primitives (`autoComplete`, `inputMode`, `aria-label`, `autoCapitalize`, `spellCheck`). Consumer passes explicit.
- [ ] Cascade audit grep run for each rewrite (`Badge`, `Dialog`, others) — counts verified unchanged.
- [ ] Inline `style={{...}}` audit — `height` / `width` / `padding` / `margin` use Tailwind scale. Only `color` / `backgroundColor` with brand data + dynamic `transform` allowed inline.
- [ ] Full `yarn test:integration:ephemeral` (no `--filter`) green.
- [ ] `yarn workspace @open-mercato/ui test` green.
- [ ] `yarn i18n:check-sync` green.
- [ ] `yarn i18n:check-usage` green (or pre-existing missing keys, verified against `develop`).
- [ ] `yarn lint` green (or pre-existing infra failures, verified against `develop`).

## Out of scope (follow-up PRs)

- Bulk consumer migration of `ActivityTimeline`, `ChangelogFilters`, similar ad-hoc surfaces → new `ActivityFeed`.
- `DataTable` pagination → new `Pagination` primitive (keeps internal pager in v5).
- Deprecation removal of any pre-v5 variants that Figma asks to retire (if any) — handled via the deprecation protocol in `BACKWARD_COMPATIBILITY.md`.
- Storybook / per-primitive demo pages (DS doc site is a separate workstream).

## Risks & Open Questions

Concrete failure scenarios per the AGENTS.md rule: each entry has a severity, affected area, mitigation, and residual risk.

### R1. Badge visual drift breaks 83 import sites — **SEV: HIGH**

- **Affected area:** Every DataTable status column, every detail page header, every list row. 83 import sites.
- **Failure scenario:** A Figma alignment commit accidentally re-styles the `default` variant (or any of the seven existing variants) instead of adding a new variant. Consumers expecting the old look render with new colors / padding / radius — visual regression across every list view.
- **Mitigation:** Existing seven variants stay callable verbatim with byte-identical visual output. Any Figma styling alignment that changes a current variant's look ships as a new variant under a new union value, not as a replacement. Cascade audit grep (`grep -rln "<Badge" packages apps` count unchanged) before commit. Visual sanity check on 3 random consumer surfaces (`yarn dev` click-through) before push.
- **Residual risk:** If Figma's "default" matches our existing "secondary" exactly and the user wants to reassign which variant is the default, that's a deprecation-protocol question, not a v5 spec question. v5 ships visual additions only.

### R2. Dialog refactor breaks `Cmd/Ctrl+Enter` / `Escape` keyboard contract — **SEV: HIGH**

- **Affected area:** 40 import sites, all dialogs in the product (CRUD forms, confirmation dialogs, return wizards, AI mutation approvals).
- **Failure scenario:** Styling refactor accidentally removes the keyboard event handlers wired in `dialog.tsx` (per AGENTS.md "Every dialog must support `Cmd/Ctrl + Enter` and `Escape`"). Users can no longer submit forms with keyboard.
- **Mitigation:** No behavioural changes in the rewrite — internal CSS / token replacements only. The unit test for Dialog already asserts Escape close; we add an assertion for Cmd+Enter submit if not present. Cascade audit greps that the `<DialogClose>` and `keydown` listener paths are unchanged.
- **Residual risk:** Radix DialogContent internals may shift behaviour if Radix bumps a major version mid-PR. Pin Radix version in `package.json` for the duration of the PR.

### R3. Atomic-commit discipline slippage under 25-commit scope — **SEV: MEDIUM**

- **Affected area:** Code review experience. Carry-forward / autofix narrow path.
- **Failure scenario:** Mid-PR fixup commits (e.g. "fix typo in commit 8") snowball into a non-atomic history. Reviewer (`pkarw`'s auto-review-pr) can't grep commit messages to find the primitive a regression came from.
- **Mitigation:** Use `git commit --amend` for typo-class fixes BEFORE push (allowed per memory rules; only post-push amend is banned). Use `git rebase -i HEAD~N` to squash fixups before push. Verify commit log shape (`git log --oneline upstream/develop..HEAD`) matches Implementation Plan exactly before push.
- **Residual risk:** Forced re-push (`--force-with-lease`) discipline must be maintained. If the PR is partially reviewed mid-PR, post-rebase force-push will discard reviewer comments on the squashed commits. Avoid rebase after first review comment lands.

### R4. Figma node IDs marked `TBD` block per-primitive Figma fidelity — **SEV: MEDIUM**

- **Affected area:** 20 of 20 primitive specs in `## Per-Primitive Specs` carry `**Figma node:** TBD`.
- **Failure scenario:** Implementation proceeds without consulting Figma source, drifts from canonical visual — auto-review-pr flags Figma-fidelity issues, forcing carry-forward.
- **Mitigation:** Each Phase A / Phase B commit's pre-implementation step is `mcp__figma__search_design_system` for the component name to retrieve the node ID, then `use_figma` (via `figma-use` skill) to inspect the canonical look. Node ID is written into the spec section BEFORE the implementation commit lands.
- **Residual risk:** Some Figma nodes may not exist for components we infer from product usage (e.g. `ActivityFeed`, `NotificationFeed`). For those, document the inferred design in the spec section and the implementation commit message — explicitly call out "no Figma source; inferred from current product usage".

### R5. `cmdk` as a new direct dependency for `CommandMenu` — **SEV: LOW**

- **Affected area:** `package.json` of `@open-mercato/ui`.
- **Failure scenario:** Adding `cmdk` as a direct dep increases bundle size for every consumer (~6KB gzipped). Audit gate might block the PR.
- **Mitigation:** Confirm `cmdk` is already transitively present via Radix. If yes, no new dep needed — import via existing path. If no, declare direct dep in the CommandMenu commit and justify in commit message + spec.
- **Residual risk:** None — `cmdk` is the de-facto standard for Cmd+K palettes and is unavoidable without re-implementing fuzzy search from scratch.

### R6. Test coverage gap on rewrites — **SEV: MEDIUM**

- **Affected area:** Existing primitives (`Avatar`, `Badge`, `Dialog`, `Separator`, `Progress`, `Notification`, `Tabs`, `Table`) may have legacy tests that pre-date the rewrite — the test suite asserts the OLD visual, not the NEW additive variants.
- **Failure scenario:** New variants ship without tests; auto-review-pr H1-class finding ("missing test coverage for new behaviour").
- **Mitigation:** Per the per-primitive `Tests:` subsection — every rewrite extends its existing test file with assertions for new variants/sizes/sub-slots. The pre-push checklist gates this.
- **Residual risk:** If a legacy test asserts a visual that the Figma rewrite changes (e.g. padding value), the test must be updated AND the change documented in the commit message as "visual update per Figma node X".

### Open Questions

1. **Is `cmdk` already transitively installed?** Resolve before commit 10 (CommandMenu). If not, decide between direct dep and a hand-rolled fuzzy search wrapper.
2. **Does Figma specify the `ActivityFeed` / `NotificationFeed` markup explicitly, or are they inferred patterns?** Resolve during Figma search step of each primitive commit.
3. **`StatusBadge` rewrite — in scope or out?** Spec says out of scope unless Figma explicitly requires it. Confirm during Phase B planning.
4. **Drawer vs Sheet naming** — Radix calls this pattern "Sheet" in shadcn variants. The user said "drawer". Going with `Drawer` per user request; document in spec section that this is a Radix Dialog under the hood.

## Final Compliance Report

To be filled in after all phases land and before opening the PR. Sections:

- [ ] **Phase A — 12 new primitives** implemented per the API contracts above.
- [ ] All 12 new primitives have unit tests passing.
- [ ] **Phase B — 8 rewrites** completed with backward-compatible API.
- [ ] All 8 rewrites: existing tests stay green, new variant/feature tests added.
- [ ] Cascade audit per high-blast rewrite:
  - [ ] Badge: `grep -rln "<Badge" packages apps` count unchanged from pre-rewrite (83).
  - [ ] Dialog: `grep -rln "import.*Dialog" packages apps` count unchanged from pre-rewrite (40).
  - [ ] Visual sanity-check on 3 random consumer surfaces per high-blast rewrite (`yarn dev` click-through).
- [ ] **Phase C — Backend polish + i18n + docs** completed.
- [ ] FilterBar / FilterOverlay visual polish — no `FilterDef` / `FilterValues` API change.
- [ ] All i18n keys added to `apps/mercato/src/i18n/{en,pl,de,es}.json` and sorted.
- [ ] All documentation updated:
  - [ ] `.ai/ui-components.md` — full section per primitive (new and rewritten).
  - [ ] `packages/ui/AGENTS.md` — quick-reference rows.
  - [ ] `docs/design-system/components.md` — status updates / new sections.
  - [ ] `docs/design-system/component-apis.md` — TS interfaces.
  - [ ] `.ai/specs/2026-04-25-ds-foundation.md` — Phase 5 changelog row.
- [ ] **Phase D — Test selector catch-up** (only if any rewrite changed an ARIA role).
- [ ] Figma node IDs resolved for every primitive (no remaining `TBD` in spec).
- [ ] `yarn workspace @open-mercato/ui test` — all suites green.
- [ ] `yarn workspace @open-mercato/core test` — all suites green.
- [ ] `yarn workspace @open-mercato/ui typecheck` — clean.
- [ ] `yarn workspace @open-mercato/core typecheck` — clean.
- [ ] `yarn i18n:check-sync` — in sync (en/pl/de/es).
- [ ] `yarn i18n:check-usage` — clean (or pre-existing gaps verified against `develop`).
- [ ] `yarn lint` — clean (or pre-existing infra failures verified against `develop`).
- [ ] **Full `yarn test:integration:ephemeral`** (no `--filter`) — green.
- [ ] Pre-push grep for legacy patterns clean (per `feedback_pre_pr_primitive_adding_checklist`):
  - [ ] No `rounded-2xl` / `rounded-3xl` / `rounded-[Npx]` in added lines.
  - [ ] No inline `shadow-[Npx_...]` — DS tokens only.
  - [ ] No context-dependent defaults in new primitives.
  - [ ] No inline `style={{ height/width/padding/margin }}` — Tailwind scale only.
- [ ] DS Guardian baseline shows no regression.
- [ ] PR description references this spec.
- [ ] PR body includes the cascade-audit summary for Badge + Dialog.

## Changelog

| Date | Status | Notes |
|---|---|---|
| 2026-05-13 | DRAFT | Initial spec. Awaiting user approval before commit 1. Scope: 12 new primitives + 8 rewrites + Table polish + FilterBar polish. 25-commit Implementation Plan. Per-primitive Figma node IDs marked `TBD` (resolved during each primitive's commit). |
