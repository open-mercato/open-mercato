# DS Foundation v3 — Implementation Spec

> **Phase 3 monolithic delivery** of the DS Foundation programme. Companion to the umbrella spec [`2026-04-25-ds-foundation.md`](./2026-04-25-ds-foundation.md). Builds directly on Phase 1 (PR [#1708](https://github.com/open-mercato/open-mercato/pull/1708)) and Phase 2 (PR [#1739](https://github.com/open-mercato/open-mercato/pull/1739)) which are merged into `develop`.

## TLDR

**Key Points:**
- Single PR delivering **10 missing primitives** from the Figma DS Open Mercato source of truth, completing the "Components" layer of the 7-layer DS framework. All primitives are atomic — they wrap existing v1/v2 primitives or `react-day-picker` and ship without touching consumer modules (one targeted exception: `FilterOverlay` `dateRange` branch).
- **Two date-family primitives** anchored on Figma node [`435:8548`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=435-8548): `DatePicker` (single date, Figma `446:7413`) and `DateRangePicker` (range with optional preset sidebar, Figma `446:7412`). Both wrap existing `Calendar` primitive in a `Popover`. Both expose `withFooter` (Apply/Cancel buttons, default `true`) and `withTime` (HH:MM input, default `false`) per Figma "Event Calendar" Block.
- **Two feedback primitives**: `EmptyState` (full primitive replacing ad-hoc `<div className="text-center py-8">…` patterns; was P0 in hackathon and only `TabEmptyState` shipped in Phase 0) and `Skeleton` (loading placeholder, sibling to existing `Spinner`).
- **Six form-variant primitives** from Phase 3.A track: `TagInput` (Figma `428:4860`), `CounterInput` (`428:5656`), `DigitInput` / OTP (`429:5172`), `InlineInput`, `CompactSelect` (h-7 dense), `InlineSelect`. All wrap v2 `Input` or `Select` primitives.
- **One internal helper**: `defaultDateRangePresets()` returning the 8 presets from Figma Block 3 (Today / Yesterday / Last 7d / Last 30d / Last 90d / This month / Last month / This year).
- **One additive consumer migration** in same PR: `FilterOverlay`'s `dateRange` filter branch swaps two raw `<input type="date">` for the new `DateRangePicker` (no public `FilterDef` API change, internal-only swap). All other ad-hoc consumers (`ChangelogFilters`, `ActivityTimelineFilters`) are deferred to follow-up PRs.

**Scope:**
- 10 new primitive files in `packages/ui/src/primitives/`.
- 1 helper file in `packages/ui/src/primitives/date-picker-helpers.ts`.
- Unit tests in `packages/ui/src/primitives/__tests__/` — **mandatory** per primitive.
- Documentation updates (mandatory per the Phase 3 roadmap):
  - `.ai/ui-components.md` — full section per primitive.
  - `packages/ui/AGENTS.md` — quick-reference rows.
  - `docs/design-system/components.md` — status updates / new sections.
  - `docs/design-system/component-apis.md` — TS interfaces.
  - `.ai/specs/2026-04-25-ds-foundation.md` — Phase 3 changelog row.
- 1 internal swap inside `packages/ui/src/backend/FilterOverlay.tsx` (DateRangePicker for raw inputs; public `FilterDef` API unchanged).

**Concerns:**
- Monolithic-PR scope (10 primitives) carries the v2 risk of accumulating `fix(qa)` churn during review. Mitigated by **strict atomic-commit discipline**: 1 commit = 1 finished concern (primitive + tests + docs together OR cleanly separated, no mid-flight fixups). See [Implementation Plan](#implementation-plan) for the commit sequence.
- `react-day-picker` is the only third-party dep involved (already installed via `Calendar` primitive); no new deps. No backwards-compatibility breaks anywhere — every change is additive.
- Per-primitive Figma node IDs for the 3.A track (`InlineInput`, `CompactSelect`, `InlineSelect`) are listed as TBD in the umbrella roadmap. Their APIs are inferred from existing usages (e.g. `PersonHighlights` for `InlineInput`, toolbar/filter UIs for `CompactSelect`). API design must be confirmed against the Figma file before implementation.
- The Date Picker module also defines a "Quick Date Picker" pattern (Block 1 in Figma — Tomorrow / Later this week / Next week / No date) and an "Event Calendar" pattern (Block 2 — date+time pair). Both are **out of scope** for v3 — they are compositions consumers can build on `DatePicker` + Menu/Input.

---

## Overview

The Open Mercato Design System workstream began with the April 2026 hackathon ([PR #1226](https://github.com/open-mercato/open-mercato/pull/1226)) and has progressed through:

1. **Phase 0** — semantic tokens, FormField, StatusBadge, SectionHeader, DS Guardian skill, AGENTS.md DS rules.
2. **Phase 1** ([PR #1708](https://github.com/open-mercato/open-mercato/pull/1708)) — brand tokens, shadow + radius scales, Tag/Avatar/AvatarStack/Kbd, Button family unification, Checkbox unification, repo-wide token sweep (279 files).
3. **Phase 2** ([PR #1739](https://github.com/open-mercato/open-mercato/pull/1739)) — Input/Select/Switch/Radio/Textarea/Tooltip rewrite to Figma spec, SwitchField/RadioField, raw-input/select sweep migrations (136 files).

Phase 3 in the umbrella spec is described as an *umbrella programme of multiple PRs (one per primitive)*. **This v3 spec consciously departs from that strategy** — the user has chosen a single monolithic PR for the 10 primitives that ship together, mirroring the v1/v2 naming and structure. The trade-off (review burden vs. PR-overhead) was accepted explicitly. Mitigation is enforced via atomic-commit discipline (see [Implementation Plan](#implementation-plan)) and a hard scope freeze on the 10 primitives listed below.

The 10 primitives come from two parallel tracks of the Phase 3 umbrella:
- **Track 3.A** — specialized form variants (6 primitives) wrapping v2 `Input` and `Select`. All were blocked on v2 merge; now unblocked.
- **Track 3.B** — independent primitives (4 primitives: `DatePicker`, `DateRangePicker`, `EmptyState`, `Skeleton`).

What is **deferred to v4 / future PRs** (still under the Phase 3 umbrella):
- `Toast` (dedicated primitive replacing `FlashMessages`) — large consumer migration surface.
- Menu rewrite (sidebar / topbar / dropdown) — touches `AppShell.tsx` + menu injection system.
- `CommandPalette` — net-new feature surface.
- `FileUpload` — net-new feature surface.
- `RichTextEditor` refactor (currently MDEditor wrapped) — needs upstream review.
- Migration of `ChangelogFilters` and `ActivityTimelineFilters` to `DateRangePicker` (changes URL params and consumer callbacks — separate PR per module).
- Visual regression testing tool (Phase 3.C), `forwardRef` Selects deprecation (Phase 3.D), QA toolbox (Phase 3.E), Next.js memory-leak follow-up (Phase 3.F).

---

## Problem Statement

The Figma DS file ([`qCq9z6q1if0mpoRstV5OEA`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato)) defines primitives that have no implementation in `packages/ui/src/primitives/` after Phases 0–2. The most consumer-impactful gaps (audited from current ad-hoc usages):

### Date pickers (Figma node `435:8548` "Date Picker" docs section)

The Figma module defines two complete primitives (`DatePicker` for single date, `DateRangePicker` for ranges with optional preset sidebar) and four sub-components (`Day Labels`, `Day Cells`, `Date Selector`, `Period Range`). Current state in code:

- `Calendar` primitive exists ([`packages/ui/src/primitives/calendar.tsx`](../../packages/ui/src/primitives/calendar.tsx)) — wraps `react-day-picker` but has no `Popover` anchor and no `DateRangePicker`/`DatePicker` wrapper.
- `FilterOverlay` `dateRange` filter type ([`packages/ui/src/backend/FilterOverlay.tsx:230`](../../packages/ui/src/backend/FilterOverlay.tsx)) uses **two raw `<input type="date">`** elements — violates the AGENTS.md rule "no raw `<input>`".
- `ChangelogFilters` ([`packages/core/src/modules/customers/components/detail/ChangelogFilters.tsx`](../../packages/core/src/modules/customers/components/detail/ChangelogFilters.tsx)) — preset chips only (`'7d' | '30d' | '90d'`), no calendar.
- `ActivityTimelineFilters` ([`packages/core/src/modules/customers/components/detail/ActivityTimelineFilters.tsx`](../../packages/core/src/modules/customers/components/detail/ActivityTimelineFilters.tsx)) — two separate `dateFrom` / `dateTo` callbacks, no shared widget.
- `business_rules/logs` page uses `FilterBar` `dateRange` (auto-migrates via swap in `FilterOverlay`).

### Empty states

- Hackathon priority table flagged this as **P0** (`docs/design-system/components.md` § 4.18: "EXISTS but 79% of pages do not use it"). Phase 0 only delivered `TabEmptyState` (tabs-specific). Pages still hand-roll `<div className="text-center py-8 text-muted-foreground">No items</div>` patterns.

### Loading skeletons

- Only `Spinner` and `LoadingMessage` exist. No `Skeleton` placeholder for progressive loading.

### Form variants (3.A track)

- `TagInput` / chip-input — used in CRM perspectives, catalog tag editing. Currently each consumer rolls its own.
- `CounterInput` — number with stepper buttons. Currently inlined inside `CrudForm` ([`NumberInput` lines 3316–3377](../../packages/ui/src/backend/CrudForm.tsx)) — not exposed as a primitive.
- `DigitInput` / OTP — used by 2FA setup, magic-link verification. Currently absent.
- `InlineInput` — borderless inline editor. Used by `PersonHighlights`-style inline editors. Currently each consumer styles its own.
- `CompactSelect` (h-7) — toolbar-density Select. Currently each toolbar inlines a `Select` with custom className.
- `InlineSelect` — borderless inline Select. Counterpart to `InlineInput`.

---

## Proposed Solution

10 new primitive files plus one internal helper, shipped together. Public API surface is **strictly additive** — no existing primitive APIs change, no existing exports change, no removed re-exports. Backward-compatibility risk is therefore confined to the new files themselves.

### Summary table

| # | Primitive | Track | Figma node | File | Wraps |
|---|---|---|---|---|---|
| 1 | `DatePicker` | 3.B | `446:7413` | `date-picker.tsx` | `Calendar` + `Popover` |
| 2 | `DateRangePicker` | 3.B | `446:7412` | `date-range-picker.tsx` | `Calendar` + `Popover` |
| 3 | `EmptyState` | 3.B | TBD | `empty-state.tsx` | — |
| 4 | `Skeleton` | 3.B | TBD | `skeleton.tsx` | — |
| 5 | `TagInput` | 3.A | `428:4860` | `tag-input.tsx` | `Input` + `Tag` |
| 6 | `CounterInput` | 3.A | `428:5656` | `counter-input.tsx` | `Input` + `IconButton` |
| 7 | `DigitInput` (OTP) | 3.A | `429:5172` | `digit-input.tsx` | `Input` |
| 8 | `InlineInput` | 3.A | TBD | `inline-input.tsx` | `Input` |
| 9 | `CompactSelect` | 3.A | TBD | `compact-select.tsx` | `Select` |
| 10 | `InlineSelect` | 3.A | TBD | `inline-select.tsx` | `Select` |

Plus:
- `date-picker-helpers.ts` — `defaultDateRangePresets()` returning 8 standard presets.
- One internal swap in `FilterOverlay.tsx` (raw inputs → `DateRangePicker`).

### Common architectural patterns

| Pattern | Applies to | Detail |
|---|---|---|
| Popover-anchored | DatePicker, DateRangePicker, CompactSelect (no — Select uses Radix internally) | `Popover` from primitives, `align="start"` default, `side="bottom"`. |
| Trigger-as-Input | DatePicker, DateRangePicker | Trigger renders as a styled `Input`-shaped button with leftIcon (calendar), placeholder, and value text. |
| `withFooter` prop | DatePicker, DateRangePicker | Default `true` per Figma. When `true`, renders Apply/Cancel buttons in popover footer; Apply commits, Cancel reverts. When `false`, every cell click commits immediately. |
| `withTime` prop | DatePicker, DateRangePicker | Default `false`. When `true`, renders `HH:MM` `<Input>` next to date. Output `Date` includes time. |
| CVA size variants | All inputs (5–10) | `size: 'sm' \| 'default'`, matches v2 Input/Select scale. |
| `disabled` prop | All | Standard React form disabled semantics. |
| `aria-*` from FormField | All form-variant primitives | Composed properly when wrapped in `FormField`. |

---

## Per-Primitive Specs

### 1. `DatePicker` (single date)

**Figma:** [`446:7413`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=446-7413) — 368×432 popover.

**API:**

```ts
type DatePickerProps = {
  value?: Date | null
  onChange?: (value: Date | null) => void
  placeholder?: string                   // default: t('ui.datePicker.placeholder')
  size?: 'sm' | 'default'                // default 'default' (h-9), sm = h-8
  disabled?: boolean
  withFooter?: boolean                   // default true; when true, Apply/Cancel buttons
  withTime?: boolean                     // default false; when true, renders HH:MM input
  align?: 'start' | 'center' | 'end'     // default 'start'
  minDate?: Date
  maxDate?: Date
  format?: (value: Date) => string       // default toLocaleDateString()
  className?: string                     // applied to trigger
  popoverClassName?: string              // applied to popover content
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}
```

**States:** default, focus, disabled, error (via aria-invalid forwarded from FormField), open.

**Tests** (`__tests__/date-picker.test.tsx`):
- Renders trigger with placeholder when value is null.
- Opens popover on click.
- Selecting a day commits when `withFooter={false}`.
- Apply button commits and closes when `withFooter={true}`.
- Cancel button reverts and closes.
- `withTime` renders HH:MM input and commits combined Date.
- `disabled` blocks open and forwards aria.
- `minDate` / `maxDate` disable out-of-range cells.

### 2. `DateRangePicker`

**Figma:** [`446:7412`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=446-7412) — 936×432 popover with optional preset sidebar.

**API:**

```ts
type DateRange = { from?: Date; to?: Date }
type DateRangePreset = { id: string; label: string; range: () => DateRange }

type DateRangePickerProps = {
  value?: DateRange | null
  onChange?: (value: DateRange | null) => void
  presets?: DateRangePreset[]            // sidebar (Today, Last 7d, …); pass [] to hide sidebar
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  withFooter?: boolean                   // default true; renders Apply/Cancel
  withTime?: boolean                     // default false; renders HH:MM for from/to
  align?: 'start' | 'center' | 'end'
  minDate?: Date
  maxDate?: Date
  numberOfMonths?: 1 | 2                 // default 2 (Figma spec)
  formatRange?: (value: DateRange) => string
  className?: string
  popoverClassName?: string
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}
```

**Helper:** `defaultDateRangePresets()` returns 8 presets per Figma Block 3:
1. Today
2. Yesterday
3. Last 7 days
4. Last 30 days
5. Last 90 days
6. This month
7. Last month
8. This year

**Tests** (`__tests__/date-range-picker.test.tsx`):
- Renders trigger with placeholder when value is null.
- Selecting a preset highlights sidebar item and updates calendar selection.
- Selecting from-date then to-date commits range when `withFooter={false}`.
- Apply commits and closes when `withFooter={true}`.
- Cancel reverts and closes.
- `withTime` renders HH:MM inputs for both ends.
- Hovering during range selection highlights pending cells.
- `defaultDateRangePresets()` returns 8 presets with correct label keys.

### 3. `EmptyState`

**API:**

```ts
type EmptyStateProps = {
  icon?: React.ReactNode                 // typically a lucide-react icon
  title: string                          // required
  description?: string
  actions?: React.ReactNode              // typically <Button>
  size?: 'sm' | 'default' | 'lg'         // controls padding + icon size
  variant?: 'default' | 'subtle'         // subtle = no border, transparent bg
  className?: string
  children?: React.ReactNode             // alternative to `actions` for custom content
}
```

**Tests:**
- Renders title.
- Renders icon + description + actions when provided.
- `variant='subtle'` removes border.
- `size` variants apply correct padding tokens.
- Forwards `className`.

**Note:** existing `TabEmptyState` (tab-specific) coexists — `EmptyState` is the general primitive; `TabEmptyState` becomes a thin wrapper around it in a follow-up PR (out of v3 scope).

### 4. `Skeleton`

**API:**

```ts
type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  shape?: 'rect' | 'circle' | 'text'     // default 'rect'
  lines?: number                         // for shape='text', renders N lines (default 1)
}
```

Renders a `<div>` with `animate-pulse bg-muted rounded-*` per shape variant. No props beyond shape and lines — all sizing via `className`.

**Tests:**
- Renders with default shape.
- `shape='text'` with `lines={3}` renders 3 lines.
- Forwards `className` and other HTML props.
- Includes `aria-busy="true"` and `role="status"`.

### 5. `TagInput`

**Figma:** [`428:4860`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=428-4860).

**API:**

```ts
type TagInputProps = {
  value?: string[]
  onChange?: (value: string[]) => void
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  maxTags?: number
  validate?: (tag: string) => boolean | string  // false/string blocks insert; string = error message
  separator?: string | RegExp                   // default `,` and Enter; controls split
  allowDuplicates?: boolean                     // default false
  className?: string
  id?: string
  name?: string
  'aria-label'?: string
}
```

Behaviour: tags render as `Tag` primitives with close (`×`) button. Backspace on empty input removes last tag. Enter / separator commits current input as new tag.

**Tests:**
- Adds tag on Enter.
- Adds tag on separator (`,`).
- Backspace on empty input removes last tag.
- Click `×` on tag removes it.
- `maxTags` blocks further adds.
- `validate` returning `false` rejects.
- `validate` returning `string` rejects + flashes error.
- `allowDuplicates={false}` skips duplicates silently.

### 6. `CounterInput`

**Figma:** [`428:5656`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=428-5656).

**API:**

```ts
type CounterInputProps = {
  value?: number | null
  onChange?: (value: number | null) => void
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  min?: number
  max?: number
  step?: number                                  // default 1
  precision?: number                             // decimal places, default 0
  className?: string
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  buttonAlign?: 'split' | 'right'                // 'split' (- left, + right) default per Figma
}
```

**Tests:**
- `+` button increments by `step`.
- `−` button decrements by `step`.
- Buttons disabled at `min` / `max`.
- Direct typing commits valid number.
- Invalid input does not commit.
- `precision=2` formats to 2 decimals.
- Keyboard arrow up/down increments/decrements.

### 7. `DigitInput` (OTP)

**Figma:** [`429:5172`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=429-5172).

**API:**

```ts
type DigitInputProps = {
  value?: string                                 // length === length prop
  onChange?: (value: string) => void
  length?: number                                // default 6
  disabled?: boolean
  autoFocus?: boolean
  inputMode?: 'numeric' | 'text'                 // default 'numeric'
  mask?: boolean                                 // default false; if true, dots instead of chars
  onComplete?: (value: string) => void           // fires when all N filled
  className?: string
  'aria-label'?: string
}
```

Renders `length` separate `<input>` boxes. Auto-focuses next on type, prev on Backspace. Pasting a string of length N distributes across boxes.

**Tests:**
- Renders `length` boxes.
- Typing in box N auto-focuses box N+1.
- Backspace in empty box auto-focuses box N-1.
- Paste of length-N string fills all boxes and fires `onComplete`.
- `inputMode='numeric'` rejects letters.
- `mask=true` renders dots.

### 8. `InlineInput`

**Figma node:** TBD (will confirm against Figma file before implementation).

**API:**

```ts
type InlineInputProps = Omit<InputProps, 'size'> & {
  size?: 'sm' | 'default'                        // default 'sm'
  showBorderOnHover?: boolean                    // default true
  showBorderOnFocus?: boolean                    // default true (always, for a11y)
}
```

Borderless variant of `Input`. Used by inline editors (`PersonHighlights`-style). When not focused/hovered, looks like plain text. On hover/focus, shows subtle border. Output / commit semantics identical to `Input` (consumer wires `onBlur` for "save on blur" pattern).

**Tests:**
- Renders without border at rest.
- Hover shows border when `showBorderOnHover={true}`.
- Focus shows border ring (always, for a11y).
- Forwards all `Input` props.

### 9. `CompactSelect`

**Figma node:** TBD.

**API:**

```ts
type CompactSelectProps = Omit<SelectProps, 'size'> & {
  // size is fixed at h-7 / text-xs by definition
  triggerLabel?: React.ReactNode                 // optional prefix label inside trigger
}
```

Toolbar/filter-density `Select`. Fixed size h-7 (vs default h-9). Used in DataTable filter bars, perspectives panel, etc.

**Tests:**
- Renders at h-7.
- Forwards all `Select` props.
- Renders `triggerLabel` prefix when provided.

### 10. `InlineSelect`

**Figma node:** TBD.

**API:**

```ts
type InlineSelectProps = Omit<SelectProps, 'size'> & {
  size?: 'sm' | 'default'                        // default 'sm'
  showBorderOnHover?: boolean                    // default true
}
```

Borderless variant of `Select`. Counterpart to `InlineInput` for select-typed inline editors.

**Tests:**
- Renders without border at rest.
- Hover shows border.
- Focus shows ring.
- Forwards all `Select` props.

---

## Migration & Backward Compatibility

Per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md), v3 is reviewed against the 13 contract surfaces. **All changes are additive — no deprecation protocol triggered.**

### Per-surface review

| # | Surface | Risk | Notes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | None | No new file conventions introduced. |
| 2 | Type definitions & interfaces | None | All new types; no existing type changes. |
| 3 | Function signatures | None | All new functions; no signature changes. |
| 4 | Import paths | None | All new files at `@open-mercato/ui/primitives/{file}`. No moves. |
| 5 | Event IDs | N/A | No events. |
| 6 | Widget injection spot IDs | N/A | No widgets. |
| 7 | API route URLs | N/A | No API routes. |
| 8 | Database schema | N/A | No DB changes. |
| 9 | DI service names | N/A | No DI registrations. |
| 10 | ACL feature IDs | N/A | No ACL. |
| 11 | Notification type IDs | N/A | No notifications. |
| 12 | CLI commands | N/A | No CLI. |
| 13 | Generated file contracts | N/A | Generators not touched. |

### Internal `FilterOverlay` swap

`FilterOverlay.tsx:230` `dateRange` branch swaps two raw `<input type="date">` for one `DateRangePicker`. The public `FilterDef` type (`{ id, label, type: 'dateRange', … }`) is unchanged. The output `FilterValues[id]` shape stays `{ from?: string; to?: string }` (ISO date strings) — the `DateRangePicker` `Date` values are converted to ISO strings before writing to filter values, so consumer code (`business_rules/logs/page.tsx` etc.) sees no behavioural difference.

This is an additive UX improvement only. No consumer migration required. Not part of any deprecation protocol.

### Deferred consumer migrations (separate follow-up PRs)

- `ChangelogFilters` → `DateRangePicker` with custom presets (`'7d' | '30d' | '90d'`). Changes URL param handling.
- `ActivityTimelineFilters` → `DateRangePicker`. Changes `dateFrom` / `dateTo` callbacks into single `onChange(DateRange)` callback. Consumer URL state is touched.
- `CrudForm` `NumberInput` (lines 3316–3377) → `CounterInput`. Internal-only swap, but `CrudForm` is high-blast-radius — separate PR with full integration test pass.

---

## Integration Test Coverage

Per AGENTS.md ("For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths") and the Phase 3 roadmap ("Integration test if the primitive replaces a UX surface that has existing integration coverage").

| Primitive | Integration test | Coverage |
|---|---|---|
| `DateRangePicker` | Existing `business_rules/logs` integration tests cover the `FilterBar dateRange` path. After the `FilterOverlay` swap, those tests should pass unchanged (output `FilterValues` shape preserved). New TC-DS-DRP-001: "Apply date range filter via DateRangePicker" added under `packages/ui/src/__integration__/`. |
| `DatePicker` | New TC-DS-DP-001: "Pick a date and commit via Apply button". |
| Other 8 primitives | Unit tests only (no existing UX surface displaced in v3). Integration coverage added when consumers migrate in follow-up PRs. |

Unit test convention: `packages/ui/src/primitives/__tests__/{primitive-slug}.test.tsx`. Vitest + Testing Library + `@testing-library/user-event`. Radix Select gets the existing test helpers (per `feedback_radix_test_migration_traps.md`).

---

## Implementation Plan

**Hard rule:** 1 commit = 1 finished concern. No mid-flight `fix(qa)` accumulation. If a primitive needs a fixup, amend NEW work into the next primitive commit OR open a follow-up PR — do not retroactively patch landed primitives.

### Commit sequence (planned 13 commits)

| # | Commit | Files |
|---|---|---|
| 1 | `docs(ds): spec for DS Foundation v3 (10 primitives)` | `.ai/specs/2026-05-09-ds-foundation-v3.md` (this file) |
| 2 | `feat(ds): add DatePicker primitive` | `packages/ui/src/primitives/date-picker.tsx`, `date-picker-helpers.ts`, `__tests__/date-picker.test.tsx`, `__tests__/date-picker-helpers.test.ts` |
| 3 | `feat(ds): add DateRangePicker primitive` | `packages/ui/src/primitives/date-range-picker.tsx`, `__tests__/date-range-picker.test.tsx` |
| 4 | `feat(ds): add EmptyState primitive` | `empty-state.tsx`, `__tests__/empty-state.test.tsx` |
| 5 | `feat(ds): add Skeleton primitive` | `skeleton.tsx`, `__tests__/skeleton.test.tsx` |
| 6 | `feat(ds): add TagInput primitive` | `tag-input.tsx`, `__tests__/tag-input.test.tsx` |
| 7 | `feat(ds): add CounterInput primitive` | `counter-input.tsx`, `__tests__/counter-input.test.tsx` |
| 8 | `feat(ds): add DigitInput primitive` | `digit-input.tsx`, `__tests__/digit-input.test.tsx` |
| 9 | `feat(ds): add InlineInput primitive` | `inline-input.tsx`, `__tests__/inline-input.test.tsx` |
| 10 | `feat(ds): add CompactSelect primitive` | `compact-select.tsx`, `__tests__/compact-select.test.tsx` |
| 11 | `feat(ds): add InlineSelect primitive` | `inline-select.tsx`, `__tests__/inline-select.test.tsx` |
| 12 | `refactor(ds): FilterOverlay dateRange uses DateRangePicker` | `packages/ui/src/backend/FilterOverlay.tsx` |
| 13 | `docs(ds): document v3 primitives` | `.ai/ui-components.md`, `packages/ui/AGENTS.md`, `docs/design-system/components.md`, `docs/design-system/component-apis.md`, `.ai/specs/2026-04-25-ds-foundation.md` (Phase 3 changelog row) |

### Pre-merge gates

Before pushing for PR:
1. `yarn lint` clean.
2. `yarn test` (unit) clean — every new primitive has its test file.
3. `yarn build` clean.
4. DS Guardian baseline: `.ai/skills/ds-guardian/scripts/ds-health-check.sh` shows no regression.
5. `yarn test:integration:ephemeral` (full suite, no `--filter`) clean — per `feedback_pre_pr_review_checklist.md`.
6. Local check-and-commit skill review.

### What goes into the PR description

- Link to this spec.
- Summary of 10 primitives + 1 helper + 1 internal swap.
- Test plan checklist.
- Screenshots of each primitive (matching Figma frames where node IDs are known).
- Explicit "no public API changes" callout for backward compatibility reviewers.

---

## Risks & Open Questions

1. **Figma node IDs for `InlineInput` / `CompactSelect` / `InlineSelect`** are TBD in the umbrella roadmap. API specified above is inferred from existing usages. **Action before implementation:** confirm against Figma. If the file does not specify these exactly, document the inferred API as the canonical one and update the umbrella spec.
2. **`DigitInput` accessibility** with `mask=true` — masked inputs have known screen-reader UX issues. We will follow Radix Toggle pattern for `aria-live` announcement of digit count, but not character content.
3. **`react-day-picker` v8 → v9 migration** is happening upstream; Phase 1's `Calendar` primitive uses v8 API. We pin to the version currently installed and do not bump in v3.
4. **`withTime` time format localization** — initial implementation uses 24h `HH:MM`. 12h support deferred (consumer can format display via `format` prop; underlying `Date` is timezone-naive).
5. **`FilterOverlay` swap edge case** — current implementation accepts both ISO date strings and `Date` objects in `FilterValues`. The swap normalizes to ISO strings on output. Need to verify all `FilterBar dateRange` consumers handle the same shape (currently: only `business_rules/logs`).

---

## Final Compliance Report

To be filled in after all 13 commits land and before opening the PR. Sections:

- [ ] All 10 primitives implemented per the API contracts above.
- [ ] All 10 primitives have unit tests passing.
- [ ] `defaultDateRangePresets()` helper implemented and tested.
- [ ] `FilterOverlay` `dateRange` branch swapped, no public API change.
- [ ] All documentation updated per the "Documentation updates per primitive PR" checklist in `project_ds_phase3_component_roadmap.md`:
  - [ ] `.ai/ui-components.md` — full section per primitive.
  - [ ] `packages/ui/AGENTS.md` — quick-reference rows.
  - [ ] `docs/design-system/components.md` — status updates / new sections.
  - [ ] `docs/design-system/component-apis.md` — TS interfaces.
  - [ ] `.ai/specs/2026-04-25-ds-foundation.md` — Phase 3 changelog row.
- [ ] DS Guardian baseline shows no regression.
- [ ] `yarn lint`, `yarn test`, `yarn build`, `yarn test:integration:ephemeral` all clean.
- [ ] PR description linked to this spec.

---

## Changelog

| Date | Status | Notes |
|---|---|---|
| 2026-05-09 | DRAFT | Initial spec. Awaiting user approval before commit 1. |
