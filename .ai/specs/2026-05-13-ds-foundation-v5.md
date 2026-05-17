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
- **New third-party deps audit**. `CommandMenu` uses `cmdk` — was transitive in `yarn.lock`; **promoted to direct dep** in the A.10 commit alongside `@radix-ui/react-dialog` (also previously transitive via shadcn-style imports in the Drawer/Dialog primitives but missing from `packages/ui/package.json`). `ScrollArea` requires `@radix-ui/react-scroll-area` (**added in the A.1 commit**). `Slider` requires `@radix-ui/react-slider` (**added in the A.4 commit**). All other primitives use already-installed Radix packages or no third-party deps.

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

### 1. ActivityFeed (new) — **IMPLEMENTED (Phase A.11)**

**Figma source:** DS Open Mercato `Activity Feed` page (`164611:26451`) — `Activity Feed [1.1]` (`166035:46833`, 5 entry variants: plain, file attachments, comment, avatar stack, task-status pills); `Activity Feed File Items [1.1]` (`165967:4028`); `Activity Feed Comment Items [1.1]` (`166017:612`); `Activity Feed Task Status Items [1.1]` (`166035:47290`, 4 statuses: success / warning / info / error); assembled example `166707:8700`.

**Purpose:** Chronological list of actor-actions scoped to an entity (deal, person, order, audit log). Distinct from `Notification` (toast) and the planned `NotificationFeed` (inbox panel). Used in detail-page "Activity" / "Timeline" tabs, audit logs, customer-interaction feeds.

**Final API (as shipped — compound, opted for inline composability over a data-driven `items={[]}` prop because Figma title sentences mix bold actor names with muted verbs + inline chips that JSON shapes would fight):**

```tsx
<ActivityFeed>
  <ActivityFeedItem
    avatar={<Avatar label="Wei Chen" size="sm" />}
    title={
      <>
        Wei Chen <span className="text-muted-foreground font-normal">uploaded</span>{' '}
        <strong>Q2 financial report</strong>
      </>
    }
    timestamp="4 min ago"
    actions={<IconButton variant="ghost" size="sm" aria-label="More"><MoreHorizontal /></IconButton>}
  >
    <ActivityFeedFileChip name="apex-report.pdf" size="4mb" onDownload={...} />
  </ActivityFeedItem>

  <ActivityFeedItem
    avatar={<Avatar label="Laura Perez" size="sm" />}
    title={<>Laura Perez <span className="text-muted-foreground font-normal">requested changes</span> <ActivityFeedStatusChip status="error">Needs revision</ActivityFeedStatusChip></>}
    timestamp="6 days ago"
  >
    <ActivityFeedComment onReply={...}>
      Please revise the risk metrics and review portfolio allocations.
    </ActivityFeedComment>
  </ActivityFeedItem>
</ActivityFeed>
```

**Compound surface:** `ActivityFeed` (root `<ol>` list, `flex flex-col gap-3`) / `ActivityFeedItem` (avatar + ReactNode title + muted timestamp suffix + actions + optional indented children) / `ActivityFeedFileChip` (paperclip + filename + size + optional download button) / `ActivityFeedComment` (speech-bubble icon + body + optional `Reply` link) / `ActivityFeedStatusChip` (status pill — `success`/`warning`/`info`/`error`/`neutral`, icon-tinted per status token, chip surface stays neutral matching Figma `Task Status Items [1.1]`).

**Implementation notes:**
- Title is a ReactNode rather than `{ actor, verb, target }` — Figma sentences interleave bold + muted + inline chips ("Lena Muller added document 📎 financial-report.pdf, 3 days ago"); a structured shape would either drop chips or force escape hatches. The compound approach also lets consumers translate verbs in their own i18n layer without re-wrapping the primitive.
- Timestamp slot renders as a `text-muted-foreground` suffix on the title row. No separator glyph (the wrapping `gap-x-2` provides the visual separation). Consumers pass plain strings (e.g. `"4 min ago"`) and use `formatRelativeTime()` to render.
- Status chip icon colors come from `--status-{success,warning,info,error}-icon` tokens; chip surface stays neutral (matches Figma — visual weight sits with the icon, not the surface).
- The primitive does NOT render the "Activity" page heading or the dotted divider visible in Figma's assembled example — those are page-chrome decisions. Consumers wrap with their own `<h2>` + `<Separator />`.
- The primitive does NOT include a comment composer (Figma example shows a textarea below the feed — out of scope for this primitive; reuse `Textarea` + `Button`).
- No grouping (`groupBy: 'day' | 'week'`), no `isLoading` skeletons, no `items={[]}` data-driven shape. The original spec called for those — the compound API obsoletes them. Grouping is a content concern (consumers render a `<h3>` between groups); loading skeletons reuse the existing `Skeleton` primitive.

**Anti-patterns this replaces:** Ad-hoc `<div>`-based activity lists in `customers/components/detail/ActivityTimeline.tsx`, `customers/components/detail/ChangelogList.tsx`, sales-document audit panels. Migration of those consumers is **out of scope for this PR** (per Concerns) — they migrate in a follow-up.

**Tests (12 smoke tests, all passing):** root `<ol>` + data-slot marker; title + muted timestamp suffix without any separator glyph; timestamp slot omitted when absent; avatar + actions slots render; indented content block renders for children; content block omitted when no children; FileChip download button gated on `onDownload` + click handler fires; Comment Reply button gated on `onReply` + click handler fires; StatusChip renders the correct `data-status` + tone class per status; StatusChip defaults to `neutral`; className forwarded on all 5 compound slots; inline-status pattern (StatusChip nested inside the title ReactNode) renders correctly.

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

### 4. CommandMenu (new) — **IMPLEMENTED (Phase A.10)**

**Figma source:** DS Open Mercato `Command Menu` page (`4152:24764`) — `Command Menu Search Input [1.1]` (`4187:559`), `Command Menu Items [1.1]` (`4171:15653`), `Command Menu Footer [1.1]` (`4172:16590`).

**Purpose:** Cmd+K (Ctrl+K on Windows) global command palette — searchable list of actions, pages, recently-viewed entities. Distinct from `Combobox` (in-form) and `Select` (closed-list).

**Final API (as shipped):**

```tsx
<CommandMenu open={open} onOpenChange={setOpen}>
  <CommandMenuContent title="Command palette">
    <CommandMenuInput placeholder="Search HR tools or press..." />
    <CommandMenuList>
      <CommandMenuEmpty>No results.</CommandMenuEmpty>
      <CommandMenuGroup heading="Pages" actionLabel="See all" onAction={...}>
        <CommandMenuItem value="customers" leading={<Users className="size-4" />} onSelect={...}>Customers</CommandMenuItem>
        <CommandMenuItem value="sales" leading={<DollarSign className="size-4" />} onSelect={...}>Sales</CommandMenuItem>
      </CommandMenuGroup>
      <CommandMenuSeparator />
      <CommandMenuGroup heading="Actions">
        <CommandMenuItem value="new-person" shortcut={<Kbd>⌘N</Kbd>} onSelect={...}>New person</CommandMenuItem>
      </CommandMenuGroup>
    </CommandMenuList>
    <CommandMenuFooter helpSlot={<a href="/help">Contact</a>} />
  </CommandMenuContent>
</CommandMenu>
```

**Compound surface:** `CommandMenu` (Radix Dialog root) / `CommandMenuTrigger` / `CommandMenuContent` (Portal + auto SR-only title + `cmdk` root) / `CommandMenuInput` (leading magnifier + `⌘K` kbd swapped to × clear once user types) / `CommandMenuList` / `CommandMenuEmpty` / `CommandMenuGroup` (with optional `actionLabel` + `onAction` "see all" affordance per Figma group header) / `CommandMenuItem` (with `leading`, `description`, `shortcut`, auto chevron on selected) / `CommandMenuSeparator` / `CommandMenuFooter` (default ↑/↓ Navigate, ↵ Select hints + optional `helpSlot`).

**Implementation notes:**
- Built on `cmdk` (`Command`, `Command.Input`, `Command.List`, `Command.Group`, `Command.Item`, `Command.Separator`, `Command.Empty`) hosted inside `@radix-ui/react-dialog`. Inherits dialog ARIA + focus trap + ESC dismissal + outside-click dismissal.
- `cmdk` is now a **direct dependency** of `packages/ui` (was transitive — promoted in the A.10 commit). `@radix-ui/react-dialog` likewise promoted to direct (previously implicit via the Drawer/Dialog primitives but missing from `dependencies`).
- Surface does NOT bind `⌘K` globally — consumer wires the shortcut at the host so multiple palettes can coexist (e.g. global launcher + per-page quick actions).
- `cmdk` auto-filters items based on each item's `value` prop (NOT `children`) — every `CommandMenuItem` MUST pass a stable lowercase `value` capturing the search tokens. For server-side search pass `commandProps={{ shouldFilter: false }}`.

**Tests (12 smoke tests, all passing):** content slots inside Radix Dialog; controlled open via trigger click; auto SR-only dialog title; default leading magnifier + `⌘K` kbd; kbd swaps to × clear toggle when value present; clear button clears value; item description + auto chevron slots; `onSelect` fires on item click; group action button renders + invokes `onAction`; default footer Navigate/Select hints; `helpSlot` renders; `className` forwarded to content without dropping default positioning. Test file polyfills `Element.prototype.scrollIntoView` because `cmdk` calls it on selection change and jsdom does not implement it.

---

### 5. Drawer (new) — **IMPLEMENTED (Phase A.9 + A.9-fixup)**

**Figma source:** DS Open Mercato `Drawer` page (`486:7366`) — `Drawer Header [1.1]` (`3187:2897`, 4 variants: title only / title + leading icon / title + description / title + description + leading icon badge); `Drawer Footer [1.1]` (`4096:21416`, 6 variants: 50/50 stretched, right-aligned compact, left checkbox + right buttons, left switch + right buttons, left step dots + right buttons, left link button + right buttons); assembled examples `167124:24738` (Service Fee), `167124:24794` (Goal), `167124:24859` (Internet Banking Support). The initial A.9 commit shipped with R4 "inferred from DS tokens" framing — incorrect; the A.9-fixup commit aligns the primitive to the canonical Figma source.

**Purpose:** Side sheet — slides in from `right` (default), `left`, `top`, or `bottom`. Used for detail panes, secondary forms, mobile menus. Distinct from `Dialog` — `Drawer` is *contextual / non-blocking-feeling*, `Dialog` is *modal / focused*.

**Final API (as shipped):**

```tsx
<Drawer open={open} onOpenChange={setOpen} side="right">
  <DrawerTrigger asChild><Button>Open</Button></DrawerTrigger>
  <DrawerContent>
    <DrawerHeader leading={<Clock className="size-4" />}>
      <DrawerTitle>Service fee</DrawerTitle>
      <DrawerDescription>Configure your service pricing and terms.</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* scrollable content */}</DrawerBody>
    <DrawerFooter
      leading={<CheckboxField checked={dontShow} onCheckedChange={...} label="Don't show again" />}
    >
      <DrawerClose asChild><Button variant="outline">Cancel</Button></DrawerClose>
      <Button>Continue</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>

// Or 50/50 stretched footer per Figma Footer variant 1:
<DrawerFooter layout="equal">
  <DrawerClose asChild><Button variant="outline">Cancel</Button></DrawerClose>
  <Button>Continue</Button>
</DrawerFooter>
```

**Implementation notes (post-fixup):**
- Uses Radix Dialog under the hood with custom positioning. Default width: `max-w-md` (~420px) for right/left, `max-h-[80vh]` for top/bottom.
- **Panel chrome per Figma:** inner-edge rounded corners only (`rounded-l-2xl` for right, `rounded-r-2xl` for left, `rounded-b-2xl` for top, `rounded-t-2xl` for bottom), `shadow-2xl`, NO border on the seam. The page-facing edge stays flush against the viewport.
- **Header per Figma:** no chrome `border-b` (the initial A.9 commit had this — removed in fixup). Optional `leading` prop renders a `size-10 rounded-full border` icon badge to the left of the title block, matching Figma `Drawer Header [1.1]` variants 2 + 4.
- **Footer per Figma:** no chrome `border-t` (removed in fixup). Two layouts: `default` (right-aligned with optional `leading` slot for checkbox / switch / link / step-indicator) and `equal` (children stretched flex-1 — confirmation-flow 50/50 shape, mutually exclusive with `leading`).
- `Cmd+Enter` and `Escape` keyboard contract inherited from Radix Dialog.

**Tests (17 smoke tests, all passing):** content slots inside Radix Dialog; controlled open via trigger click; default `right` side data attribute; per-side classes incl. inner-edge rounded corners (`rounded-l-2xl` / `rounded-r-2xl` / `rounded-b-2xl` / `rounded-t-2xl`); auto close button by default; `hideCloseButton` hides the button; ARIA labelledby/describedby from Title + Description; DrawerClose dismisses the drawer; header `leading` badge renders when provided; header is borderless by default; footer is borderless by default + trailing wrapper anchors right when no `leading`; footer `layout="equal"` stretches children via `[&>*]:flex-1`; footer `leading` slot anchors left and drops the trailing wrapper's `ml-auto`; className forwarded to content without dropping default classes.

---

### 6. NotificationFeed (new) — **IMPLEMENTED (Phase A.12)**

**Figma source:** DS Open Mercato `Notifications` page (`4096:21398`) — `Notifications Items [1.1]` (`4308:731`, 8 variants — 4 designs × 2 states: default + hover/selected: plain, inline Approve/Deny buttons, file attachment, reply preview); `Notifications Header [1.1]` (`4308:1004`); `Notifications Footer [1.1]` (`4308:5526`); `Notifications Tab Menu [1.1]` (`4349:46656`). Assembled examples: `166926:7047`, `166926:7088`, `166926:7114`, `166926:7138`.

**Purpose:** Persistent panel listing in-app notifications (the "you have 5 notifications" inbox). Distinct from existing `Notification` (single toast) and `NotificationStack` (top-right toast pile). NotificationFeed is what opens when the user clicks the bell icon.

**Final API (as shipped — compound, opted for inline composability over a data-driven `items={[]}` prop because Figma items mix titles/bodies with arbitrary inline children: file chips, Approve/Deny pairs, reply previews):**

```tsx
<NotificationFeed>
  <NotificationFeedHeader title="Notifications">
    <IconButton variant="ghost" size="sm" aria-label="Settings">
      <Settings />
    </IconButton>
  </NotificationFeedHeader>

  <NotificationFeedList>
    <NotificationFeedItem
      icon={
        <NotificationFeedIconBadge tone="indigo">
          <UserPlus className="size-5" />
        </NotificationFeedIconBadge>
      }
      title="New Lead Generated"
      body="John Smith submitted web form"
      timestamp="10 minutes ago"
      unread
      onClick={() => router.push('/leads/123')}
      actions={
        <IconButton variant="ghost" size="sm" aria-label="More">
          <MoreHorizontal />
        </IconButton>
      }
    />

    <NotificationFeedItem
      icon={<NotificationFeedIconBadge tone="info"><CheckCircle2 className="size-5" /></NotificationFeedIconBadge>}
      title="Document approval requested"
      body="Wei Chen asks you to approve Q2 financial report"
      timestamp="2 hours ago"
      unread
    >
      <div className="flex gap-2">
        <Button variant="outline" size="sm">Deny</Button>
        <Button size="sm">Approve</Button>
      </div>
    </NotificationFeedItem>
  </NotificationFeedList>

  <NotificationFeedFooter>
    <Button variant="outline" className="w-full">Archive all</Button>
  </NotificationFeedFooter>
</NotificationFeed>
```

**Compound surface:** `NotificationFeed` (root rounded card with `border-input` + `shadow-lg`) / `NotificationFeedHeader` (title + actions slot, bordered bottom) / `NotificationFeedList` (`<ol>` with `divide-y` so items auto-separate) / `NotificationFeedItem` (icon + title + body + timestamp + actions + indented children; `unread` toggles a small indigo dot; `onClick` makes the row clickable with Enter/Space activation) / `NotificationFeedFooter` (bordered top, free-form children) / `NotificationFeedIconBadge` (size-10 rounded-full helper with 7 tones: `indigo` / `success` / `warning` / `error` / `info` / `brand` / `neutral`).

**Implementation notes:**
- Compound API instead of data-driven `items={[]}` (originally spec'd) — Figma items inline arbitrary children (Approve/Deny pairs, file chips, reply preview cards) that a JSON shape would fight. The compound approach also lets consumers reuse `ActivityFeedFileChip` directly inside `NotificationFeedItem` children for file attachments.
- Item timestamp renders as a separate muted line (smaller `text-xs leading-4`) beneath the body. No separator glyph between body and timestamp — they stack as 3 rows: title / body / timestamp.
- `onClick` wires `role="button"`, `tabIndex="0"`, Enter/Space activation, hover bg `bg-muted/40`, and a focus-visible affordance. Aria-label defaults to the title string.
- Actions slot wrapper has `event.stopPropagation()` on click — kebab/menu clicks don't bubble up to the row's `onClick`. Nested menu items must also stop propagation if they trigger nested actions.
- No grouping (`groupBy: 'day' | 'unread-vs-read'`), no `isLoading` skeletons, no `emptyState` prop, no `items={[]}` shape. The original spec called for those — the compound API obsoletes them. Grouping is a content concern (consumers render a header row between groups); loading skeletons reuse the existing `Skeleton` primitive; empty state is whatever the consumer renders in place of the list.
- Tab filtering (`All` / `Mentions` / `Unread` per Figma `Notifications Tab Menu [1.1]`) is left to the existing `Tabs` primitive — wrap `<NotificationFeed>` in `<Tabs>` rather than building tab UI into the inbox primitive.

**Tests (13 smoke tests, all passing):** root card chrome (rounded-2xl + border + slots); header title + actions; item title/body/timestamp without separator glyph; unread dot gated on `unread`; icon + indented children render; `onClick` wires role="button" + tabIndex + Enter/Space activation; non-clickable when `onClick` omitted; actions slot wrapper stops propagation on click; footer slot; IconBadge tone classes for all 7 tones; IconBadge defaults (tone="indigo", size="default"); IconBadge `size="sm"` variant; className forwarded on all 5 compound slots.

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

1. `feat(ds): add ScrollArea primitive` — leaf utility, used by Drawer/CommandMenu. **DONE (A.1)**
2. `feat(ds): add ButtonGroup primitive` — **DONE (A.2)**
3. `feat(ds): add SegmentedControl primitive` — **DONE (A.3)**
4. `feat(ds): add Slider primitive` — **DONE (A.4)**
5. `feat(ds): add Rating primitive` — **DONE (A.5)**
6. `feat(ds): add StepIndicator primitive` — **DONE (A.6)**
7. `feat(ds): add ColorPicker primitive` — **DONE (A.7)**
8. `feat(ds): add Pagination primitive` (standalone — DataTable migration deferred) — **DONE (A.8)**
9. `feat(ds): add Drawer primitive` (uses ScrollArea) — **DONE (A.9)** + `fix(ds): align Drawer with canonical Figma source (rounded inner edges, leading icon badge, footer layout/leading slots)` — **DONE (A.9-fixup)**
10. `feat(ds): add CommandMenu primitive` (built on `cmdk` + `@radix-ui/react-dialog`; both promoted from transitive to direct deps) — **DONE (A.10)**
11. `feat(ds): add ActivityFeed primitive` (uses Avatar; compound API instead of data-driven `items={[]}`; defers EmptyState/Skeleton to consumers) — **DONE (A.11)**
12. `feat(ds): add NotificationFeed primitive` (compound API; reuses `ActivityFeedFileChip` for file attachments; defers tabs / grouping / empty state / skeletons to consumers) — **DONE (A.12)**

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
- **Realised on A.9 Drawer.** The initial A.9 commit shipped with R4 "inferred from DS tokens" framing (incorrect — `Drawer` page `486:7366` exists in the file with full Header / Footer variant coverage). Caught by the user mid-PR. The fixup commit (A.9-fixup) realigns the primitive to the canonical Figma source: panel `rounded-l-2xl` + `shadow-2xl`, no chrome `border-l/border-b/border-t`, optional header `leading` icon badge, footer `layout="equal"` + `leading` slot. Lesson: ALWAYS check the Figma file's page list first (cheap one-call `figma.root.children.map(p => p.name)`) before declaring a primitive has no source.
- **Mitigation:** Each Phase A / Phase B commit's pre-implementation step is `mcp__figma__search_design_system` for the component name to retrieve the node ID, then `use_figma` (via `figma-use` skill) to inspect the canonical look. Node ID is written into the spec section BEFORE the implementation commit lands. **Pre-flight rule (added post A.9):** if `search_design_system` returns nothing, ALSO list `figma.root.children` and grep for partial name matches before falling back to R4-inferred styling.
- **Residual risk:** Some Figma nodes may not exist for components we infer from product usage (e.g. `ActivityFeed`, `NotificationFeed`). For those, document the inferred design in the spec section and the implementation commit message — explicitly call out "no Figma source; inferred from current product usage".

### R5. `cmdk` as a new direct dependency for `CommandMenu` — **SEV: LOW** — **RESOLVED (A.10)**

- **Affected area:** `package.json` of `@open-mercato/ui`.
- **Failure scenario:** Adding `cmdk` as a direct dep increases bundle size for every consumer (~6KB gzipped). Audit gate might block the PR.
- **Mitigation applied:** `cmdk@^1.0.0` was already transitively in `yarn.lock` (via shadcn). The A.10 commit **promotes it to direct dep** alongside `@radix-ui/react-dialog@^1.1.6` (likewise transitively present, used directly by `dialog.tsx` and `drawer.tsx` without being declared). Both deps are now explicit in `packages/ui/package.json`. Audit impact: zero net bundle change — both packages were already shipped to consumers.
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
| 2026-05-17 | IN PROGRESS — Phase A 10/12 | Shipped A.1 ScrollArea, A.2 ButtonGroup, A.3 SegmentedControl, A.4 Slider, A.5 Rating, A.6 StepIndicator, A.7 ColorPicker, A.8 Pagination, A.9 Drawer, A.10 CommandMenu. A.10 promoted `cmdk` and `@radix-ui/react-dialog` from transitive to direct deps in `packages/ui/package.json`. Remaining: A.11 ActivityFeed, A.12 NotificationFeed, then Phase B (8 rewrites) + Phase C polish. R5 (cmdk new direct dep) resolved. 1152 UI tests passing (12 added for CommandMenu). |
| 2026-05-17 | FIXUP — A.9 Drawer | Realigned Drawer to canonical Figma source (`486:7366` — user-pointed). Panel: `rounded-l-2xl` (and per-side counterparts) + `shadow-2xl`, removed `border-l/r/t/b` from the seam. Header: removed `border-b`, added optional `leading` icon badge slot (`size-10 rounded-full border`) matching `Drawer Header [1.1]` variants 2 + 4. Footer: removed `border-t`, added `layout` variant (`default` / `equal` 50/50 stretched) + optional `leading` slot (checkbox / switch / link / step dots) matching `Drawer Footer [1.1]` variants 1–6. R4 risk note updated with the lesson: always list `figma.root.children` before declaring a primitive has no Figma source. Drawer tests grew from 12 → 17 (5 new cases for leading badge, default no-border, default footer layout, equal layout, footer leading slot). All 1157 UI tests passing. |
| 2026-05-17 | IN PROGRESS — Phase A 11/12 | Shipped A.11 ActivityFeed. Compound API (`ActivityFeed` + `ActivityFeedItem` + `ActivityFeedFileChip` + `ActivityFeedComment` + `ActivityFeedStatusChip`) instead of the originally-spec'd data-driven `items={[]}` shape — title is a ReactNode so Figma sentences (bold actor + muted verb + inline status chip) compose naturally. 12 smoke tests added (1169 UI tests passing). Remaining: A.12 NotificationFeed, then Phase B (8 rewrites) + Phase C polish. |
| 2026-05-17 | PHASE A COMPLETE (12/12) | Shipped A.12 NotificationFeed. Compound API (`NotificationFeed` + `NotificationFeedHeader` + `NotificationFeedList` + `NotificationFeedItem` + `NotificationFeedFooter` + `NotificationFeedIconBadge`) — 7-tone IconBadge helper, `unread` dot, `onClick` row activation with Enter/Space, hover-revealed `actions` slot, indented `children` for inline Approve/Deny pairs / file chips / reply previews. 13 smoke tests added (1182 UI tests total). Phase A done — 12 new primitives shipped: A.1 ScrollArea, A.2 ButtonGroup, A.3 SegmentedControl, A.4 Slider, A.5 Rating, A.6 StepIndicator, A.7 ColorPicker, A.8 Pagination, A.9 Drawer (+ A.9-fixup), A.10 CommandMenu, A.11 ActivityFeed, A.12 NotificationFeed. Next: Phase B (8 rewrites: Avatar, Badge, Dialog, Separator, Progress, Notification toast, Tabs, Table) + Phase C polish (FilterBar, i18n, docs sweep). |
