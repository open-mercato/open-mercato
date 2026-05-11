# DS Foundation v3 — Implementation Spec

> **Phase 3 monolithic delivery** of the DS Foundation programme. Companion to the umbrella spec [`2026-04-25-ds-foundation.md`](./2026-04-25-ds-foundation.md). Builds directly on Phase 1 (PR [#1708](https://github.com/open-mercato/open-mercato/pull/1708)) and Phase 2 (PR [#1739](https://github.com/open-mercato/open-mercato/pull/1739)) which are merged into `develop`.

## TLDR

**Key Points:**
- Single PR delivering **11 missing primitives** from the Figma DS Open Mercato source of truth, completing the "Components" layer of the 7-layer DS framework. All primitives are atomic — they wrap existing v1/v2 primitives or `react-day-picker` and ship without touching consumer modules (one targeted exception: `FilterOverlay` `dateRange` branch).
- **Two date-family primitives** anchored on Figma node [`435:8548`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=435-8548): `DatePicker` (single date, Figma `446:7413`) and `DateRangePicker` (range with optional preset sidebar, Figma `446:7412`). Both wrap existing `Calendar` primitive in a `Popover`. Both expose `withFooter` (Apply/Cancel buttons, default `true`) and `withTime` (HH:MM input, default `false`) per Figma "Event Calendar" Block.
- **One time-picker compound primitive** anchored on Figma node [`164611:83414`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=164611-83414) "Time Picker [Overview]": `TimePicker` composition + three exported atoms (`TimePickerSlot` for time-slot rows, `TimePickerDurationChip` for quick-duration pills, `TimePickerStatusChip` for availability statuses). Renders as a 348-wide card with optional header, optional duration row, scrollable slot list, optional footer. Slots can be explicit or auto-generated from `startTime`/`endTime`/`intervalMinutes`. Supersedes the legacy [`backend/inputs/TimePicker.tsx`](../../packages/ui/src/backend/inputs/TimePicker.tsx) (kept as a shim re-exporting from the new primitive).
- **Two feedback primitives**: `EmptyState` (full primitive replacing ad-hoc `<div className="text-center py-8">…` patterns; was P0 in hackathon and only `TabEmptyState` shipped in Phase 0) and `Skeleton` (loading placeholder, sibling to existing `Spinner`).
- **Six form-variant primitives** from Phase 3.A track: `TagInput` (Figma `428:4860`), `CounterInput` (`428:5656`), `DigitInput` / OTP (`429:5172`), `InlineInput`, `CompactSelect` (h-7 dense), `InlineSelect`. All wrap v2 `Input` or `Select` primitives.
- **One internal helper**: `defaultDateRangePresets()` returning all 13 presets — adapter on top of the existing `DATE_RANGE_OPTIONS` from [`packages/ui/src/backend/date-range/dateRanges.ts`](../../packages/ui/src/backend/date-range/dateRanges.ts), so the preset list and i18n keys stay in one place.
- **One additive consumer migration** in same PR: `FilterOverlay`'s `dateRange` filter branch swaps two raw `<input type="date">` for the new `DateRangePicker` (no public `FilterDef` API change, internal-only swap). All other ad-hoc consumers (`ChangelogFilters`, `ActivityTimelineFilters`) are deferred to follow-up PRs.

**Scope:**
- 11 new primitive files in `packages/ui/src/primitives/` (the TimePicker file exports a composition + 3 atoms — see § 11 of "Per-Primitive Specs").
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
- Monolithic-PR scope (11 primitives) carries the v2 risk of accumulating `fix(qa)` churn during review. Mitigated by **strict atomic-commit discipline**: 1 commit = 1 finished concern (primitive + tests + docs together OR cleanly separated, no mid-flight fixups). See [Implementation Plan](#implementation-plan) for the commit sequence.
- `react-day-picker` is the only third-party dep involved (already installed via `Calendar` primitive); no new deps. No backwards-compatibility breaks anywhere — every change is additive.
- Per-primitive Figma node IDs for the 3.A track (`InlineInput`, `CompactSelect`, `InlineSelect`) are listed as TBD in the umbrella roadmap. Their APIs are inferred from existing usages (e.g. `PersonHighlights` for `InlineInput`, toolbar/filter UIs for `CompactSelect`). API design must be confirmed against the Figma file before implementation.
- The Date Picker module also defines a "Quick Date Picker" pattern (Block 1 in Figma — Tomorrow / Later this week / Next week / No date) and an "Event Calendar" pattern (Block 2 — date+time pair). Both are **out of scope** for v3 — they are compositions consumers can build on `DatePicker` + Menu/Input.

---

## Overview

The Open Mercato Design System workstream began with the April 2026 hackathon ([PR #1226](https://github.com/open-mercato/open-mercato/pull/1226)) and has progressed through:

1. **Phase 0** — semantic tokens, FormField, StatusBadge, SectionHeader, DS Guardian skill, AGENTS.md DS rules.
2. **Phase 1** ([PR #1708](https://github.com/open-mercato/open-mercato/pull/1708)) — brand tokens, shadow + radius scales, Tag/Avatar/AvatarStack/Kbd, Button family unification, Checkbox unification, repo-wide token sweep (279 files).
3. **Phase 2** ([PR #1739](https://github.com/open-mercato/open-mercato/pull/1739)) — Input/Select/Switch/Radio/Textarea/Tooltip rewrite to Figma spec, SwitchField/RadioField, raw-input/select sweep migrations (136 files).

Phase 3 in the umbrella spec is described as an *umbrella programme of multiple PRs (one per primitive)*. **This v3 spec consciously departs from that strategy** — the user has chosen a single monolithic PR for the 11 primitives that ship together, mirroring the v1/v2 naming and structure. The trade-off (review burden vs. PR-overhead) was accepted explicitly. Mitigation is enforced via atomic-commit discipline (see [Implementation Plan](#implementation-plan)) and a scope freeze on the 11 primitives listed below (TimePicker was added to the freeze on 2026-05-11 — see Changelog).

The 11 primitives come from two parallel tracks of the Phase 3 umbrella:
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

11 new primitive files plus one internal helper, shipped together. Public API surface is **strictly additive** — no existing primitive APIs change, no existing exports change, no removed re-exports. Backward-compatibility risk is therefore confined to the new files themselves. The TimePicker primitive (#11) additionally rewrites `backend/inputs/TimePicker.tsx` as a thin shim re-exporting the new primitive — legacy import paths remain stable.

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
| 11 | `TimePicker` (+ `TimePickerSlot`, `TimePickerDurationChip`, `TimePickerStatusChip`) | 3.B | `164611:83414` | `time-picker.tsx` | `Popover` + existing `Button` |

Plus:
- `date-picker-helpers.ts` — `defaultDateRangePresets()` returning **13 standard presets** by **adapting the existing `DATE_RANGE_OPTIONS`** from [`packages/ui/src/backend/date-range/dateRanges.ts`](../../packages/ui/src/backend/date-range/dateRanges.ts). No duplicate preset list.
- One internal swap in `FilterOverlay.tsx` (raw inputs → `DateRangePicker`).

### Reuse of existing `backend/date-range/` infrastructure

`packages/ui/src/backend/date-range/` already ships a mature preset system used by dashboard/analytics modules:
- **Types**: `DateRange = { start: Date; end: Date }`, `DateRangePreset` (string union of 13 preset IDs), `DateRangeOption = { value, labelKey }`.
- **Constant**: `DATE_RANGE_OPTIONS` — 13 presets with i18n keys (`dashboards.analytics.dateRange.*`).
- **Helpers**: `resolveDateRange(preset, refDate)`, `getPreviousPeriod()`, `isValidDateRangePreset()`, `calculatePercentageChange()`, `determineChangeDirection()`, `getComparisonLabelKey()`.
- **Components**: `DateRangeSelect` (form-style preset dropdown), `InlineDateRangeSelect` (compact preset dropdown), `InlineGranularitySelect`.

v3 **reuses these types and helpers** rather than introducing parallel ones. The existing `DateRangeSelect` / `InlineDateRangeSelect` are **preset-only** (Select dropdowns); they coexist with v3 — they are NOT replaced by `DateRangePicker` (which is calendar + optional preset sidebar). A future PR may migrate them to share the `DateRangePicker` popover for the preset path, but that is out of v3 scope.

### Common architectural patterns

| Pattern | Applies to | Detail |
|---|---|---|
| **Figma fidelity is the priority** | All 11 primitives | When the Figma DS Open Mercato file (`qCq9z6q1if0mpoRstV5OEA`) defines a primitive's anatomy (sub-frames, sub-components, states, sizes, dimensions), match it. Reuse of existing infrastructure (e.g. `backend/date-range/` types and helpers) is welcome **only when it does not compromise Figma fidelity**. If the existing code conflicts with Figma, write the primitive from Figma and leave the existing code as-is for a deferred refactor. |
| Popover-anchored | DatePicker, DateRangePicker, CompactSelect (no — Select uses Radix internally) | `Popover` from primitives, `align="start"` default, `side="bottom"`. |
| Trigger-as-Input | DatePicker, DateRangePicker | Trigger renders as a styled `Input`-shaped button with leftIcon (calendar), placeholder, and value text. |
| `withFooter` prop | DatePicker, DateRangePicker | Default `true` per Figma. When `true`, renders Apply/Cancel buttons in popover footer; Apply commits, Cancel reverts. When `false`, every cell click commits immediately. |
| `withTime` prop | DatePicker, DateRangePicker | Default `false`. When `true`, renders `HH:MM` `<Input>` next to date. Output `Date` includes time. |
| CVA size variants | All inputs (5–10) | `size: 'sm' \| 'default'`, matches v2 Input/Select scale. |
| `disabled` prop | All | Standard React form disabled semantics. |
| `aria-*` from FormField | All form-variant primitives | Composed properly when wrapped in `FormField`. |

---

## Per-Primitive Specs

### 1. `DatePicker` (single date — promote + upgrade)

**Figma:** [`446:7413`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=446-7413) — 368×432 popover.

**Strategy decision (2026-05-09):** Existing `packages/ui/src/backend/inputs/DatePicker.tsx` and `DateTimePicker.tsx` are **promoted** to a single `packages/ui/src/primitives/date-picker.tsx` primitive. The new primitive subsumes both via a `withTime` prop and aligns the footer to Figma (Apply/Cancel buttons instead of "Today"/"Clear" links). Old import paths are preserved via `@deprecated` re-export shims (zero consumer breakage).

**Why one primitive:** User directive — "musimy miec jeden data picker, tylko w nowym wydaniu". Avoid two parallel implementations; ship a single Figma-spec'd primitive in this PR.

**API:**

```ts
import type { Locale } from 'date-fns'

type DatePickerFooter = 'apply-cancel' | 'today-clear' | 'none'

type DatePickerProps = {
  value?: Date | null
  onChange: (value: Date | null) => void
  placeholder?: string                   // default: t('ui.datePicker.placeholder')
  size?: 'sm' | 'default'                // default 'default' (h-9), sm = h-8
  disabled?: boolean
  readOnly?: boolean

  // Figma-aligned footer (default 'apply-cancel' per Figma 'Footer Actions' frame).
  // 'today-clear' preserves the legacy footer style for module-level use cases that prefer it.
  // 'none' renders no footer; in that case selecting a day commits immediately.
  footer?: DatePickerFooter

  withTime?: boolean                     // default false; when true, renders HH:MM input
  minuteStep?: number                    // default 1; only meaningful when withTime=true
  align?: 'start' | 'center' | 'end'     // default 'start'
  minDate?: Date
  maxDate?: Date
  locale?: Locale                        // forwarded to date-fns format() and Calendar
  displayFormat?: string                 // override; default derives from locale (DAY_FIRST_LOCALE_CODES)
  className?: string                     // applied to trigger
  popoverClassName?: string              // applied to popover content
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}
```

**Backwards-compatibility shims** (kept in `packages/ui/src/backend/inputs/`):

```ts
// backend/inputs/DatePicker.tsx
/** @deprecated Use `DatePicker` from `@open-mercato/ui/primitives/date-picker` directly. */
export { DatePicker, type DatePickerProps } from '../../primitives/date-picker'
```

```ts
// backend/inputs/DateTimePicker.tsx
/** @deprecated Use `DatePicker` with `withTime` from `@open-mercato/ui/primitives/date-picker`. */
import * as React from 'react'
import { DatePicker, type DatePickerProps } from '../../primitives/date-picker'

export type DateTimePickerProps = Omit<DatePickerProps, 'withTime'>

export function DateTimePicker(props: DateTimePickerProps) {
  return <DatePicker {...props} withTime />
}
```

CrudForm and all other consumers continue importing from `@open-mercato/ui/backend/inputs/...` and stay zero-diff. The shim files surface the `@deprecated` JSDoc so editors flag the legacy paths; a follow-up PR will mass-migrate consumers to the primitive path and remove the shims (per `BACKWARD_COMPATIBILITY.md` deprecation protocol).

**States:** default, focus, disabled, readOnly, error (via aria-invalid forwarded from FormField), open.

**Figma fidelity notes:**
- Footer = `Buttons [1.1]` (h-36 solid buttons), default `apply-cancel`. Apply commits the popover-internal draft selection; Cancel reverts.
- Trigger = `Date Selector [1.1]` styling (h-9 with leading `CalendarIcon`).
- Popover dimensions track Figma 368×432 for `withTime=false`. With `withTime=true`, height grows by the `Time` row (~52px) per Figma "Event Calendar" Block.

**Tests** (`__tests__/date-picker.test.tsx`):
- Renders trigger with placeholder when value is null.
- Opens popover on click.
- `footer='none'`: selecting a day commits immediately and closes.
- `footer='apply-cancel'` (default): selecting a day stages the choice; Apply commits and closes; Cancel reverts and closes.
- `footer='today-clear'`: legacy buttons commit Today / clear value as before.
- `withTime=true`: renders `TimeInput`, time changes commit combined `Date`.
- `disabled` blocks open and forwards aria.
- `readOnly` opens the popover but blocks selection commit (ARIA-friendly read-only).
- `minDate` / `maxDate` disable out-of-range cells.
- Backwards-compat shim test: `import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'` resolves to the primitive.
- Backwards-compat shim test: `import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'` renders the primitive with `withTime`.

### 2. `DateRangePicker`

**Figma:** [`446:7412`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=446-7412) — 936×432 popover with optional preset sidebar.

**API:**

```ts
// Reused from packages/ui/src/backend/date-range/dateRanges.ts
import type { DateRange, DateRangePreset } from '@open-mercato/ui/backend/date-range'
//   DateRange       = { start: Date; end: Date }
//   DateRangePreset = string union of 13 preset IDs ('today' | 'yesterday' | …)

// New type for v3 — disambiguated from the existing DateRangePreset string union
type DateRangePresetItem = {
  id: DateRangePreset                              // reuses existing string union
  labelKey: string                                 // reuses existing i18n keys
  range: (referenceDate?: Date) => DateRange       // wraps existing resolveDateRange()
}

type DateRangePickerProps = {
  value?: DateRange | null
  onChange?: (value: DateRange | null) => void
  presets?: DateRangePresetItem[]        // sidebar; defaults to defaultDateRangePresets() (all 13)
  showPresets?: boolean                  // default true (per Figma Range Picker layout); pass false to hide sidebar
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  withFooter?: boolean                   // default true; renders Apply/Cancel
  withTime?: boolean                     // default false; renders HH:MM for start/end
  align?: 'start' | 'center' | 'end'
  minDate?: Date
  maxDate?: Date
  numberOfMonths?: 1 | 2                 // default 2 (Figma Range Picker = 2 months side-by-side)
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

**Helper:** `defaultDateRangePresets()` returns **all 13 presets** from `DATE_RANGE_OPTIONS` (matches Figma Period Range track and reuses the existing i18n keys):
1. Today
2. Yesterday
3. This week
4. Last week
5. This month
6. Last month
7. This quarter
8. Last quarter
9. This year
10. Last year
11. Last 7 days
12. Last 30 days
13. Last 90 days

Implementation: `defaultDateRangePresets()` maps `DATE_RANGE_OPTIONS` to `DateRangePresetItem[]` by setting `range: (refDate) => resolveDateRange(option.value, refDate)`. Zero hardcoded preset logic in v3 — it is all in `dateRanges.ts` already.

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
type CounterInputProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange' | 'size' | 'type' | 'children'
> & {
  value?: number | null
  onChange?: (value: number | null) => void
  size?: 'sm' | 'default' | 'lg'                 // 32 / 36 / 40 px per Figma X-Small / Small / Medium
  min?: number
  max?: number
  step?: number                                  // default 1
  precision?: number                             // decimal places, default 0
  decrementAriaLabel?: string                    // default English `Decrease`
  incrementAriaLabel?: string                    // default English `Increase`
  inputClassName?: string
}
```

Split layout (`-` left, `+` right) per Figma — no `buttonAlign` prop. The
`xs` (32) / `sm` (36) / `default` (40) trio in Figma map to Open Mercato's
`sm` / `default` / `lg` size convention shared with `Input` and `Button`.

**Tests:**
- `+` button increments by `step`.
- `−` button decrements by `step`.
- Buttons disabled at `min` / `max`.
- Direct typing commits valid number.
- Empty input emits `null`.
- Typed values are clamped to `min` / `max`.
- `precision=2` formats to 2 decimals.
- Keyboard ArrowUp / ArrowDown step by `step`.
- Uncontrolled mode keeps internal state.
- Custom decrement / increment aria labels are honored.
- `aria-invalid` flips the wrapper border to destructive.
- Size variants apply h-8 / h-9 / h-10 on the wrapper.

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

**Figma node:** TBD. Implementation mirrors `PersonHighlights`-style
inline editors: borderless `Input` wrapper with hover/focus border
overrides via the existing `inputWrapperVariants` cva.



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

**Figma node:** TBD. Implementation derives the dense size from the
existing `Select` `cva` size matrix (the new `xs` rung — `h-7 px-2
text-xs`).

**API:**

```ts
// New 'xs' size variant on the underlying SelectTrigger primitive
type SelectTriggerSize = 'xs' | 'sm' | 'default' | 'lg'

// Thin wrapper that locks the trigger at the xs size and renders an optional
// label prefix inside the button (e.g. "View:" / "Sort by:").
type CompactSelectTriggerProps = Omit<SelectTriggerProps, 'size'> & {
  triggerLabel?: React.ReactNode                  // muted prefix inside trigger
}
```

The composition is a wrapper around the regular `Select` primitive — the
`Select` root, `SelectContent`, `SelectItem`, `SelectGroup`,
`SelectLabel`, `SelectSeparator`, and `SelectValue` are re-exported
from `compact-select.tsx` so consumers can import the whole
composition from one path. Only the trigger is customized.

**Tests:**
- Trigger renders at h-7 / px-2 / text-xs regardless of consumer attempts.
- `triggerLabel` prefix is rendered inside the trigger when provided.
- Trigger label slot has `data-slot="compact-select-trigger-label"` for styling hooks.
- `ref` is forwarded to the underlying `<button>` trigger.
- Consumer `className` merges alongside the size variant.
- `aria-label` and `aria-invalid` pass through to the Radix trigger.

### 10. `InlineSelect`

**Figma node:** TBD. Implementation mirrors `InlineInput`: thin
`SelectTrigger` wrapper that swaps the default border + shadow for a
transparent baseline, then re-enables them on hover/focus.



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

### 11. `TimePicker` (compound primitive)

**Figma:** [`164611:83414`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=164611-83414) "Time Picker [Overview]" — composition example at [`166102:5347`](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=166102-5347).

**Why a compound primitive:** Figma "Time Picker [Overview]" defines three atomic sub-components — Time Picker Items (`165483:5687`), Select Duration chips (`165483:6046`), Select Status chips (`165596:41348`) — composed into 4 documented Block patterns (Select duration, Set focus time, Schedule future transfer, Time-only select). Exporting only the top-level composition would force consumers to either rebuild the atoms or fork the entire card when their use case differs (e.g. status-only or duration-only). v3 ships all four exports from a single file.

**File layout:** single file `packages/ui/src/primitives/time-picker.tsx` with named exports:
- `TimePicker` — full card composition (the default for most consumers).
- `TimePickerSlot` — atomic row, single time entry with optional right text + selected check.
- `TimePickerDurationChip` — atomic duration pill (e.g. "30 min", "1 hour").
- `TimePickerStatusChip` — atomic availability pill (`available` / `busy` / `in-meeting` / `offline`).

#### Sub-primitive APIs

```ts
// Atom 1 — single row in the slot list
type TimePickerSlotProps = {
  value: string                                   // canonical HH:MM 24h ("13:30")
  label?: string                                  // override the displayed label (default formats `value` per `format`)
  rightText?: string                              // optional right-aligned secondary time (e.g. timezone offset)
  state?: 'default' | 'hover' | 'active' | 'disabled'   // visual state — `active` shows trailing check icon
  selected?: boolean                              // semantic — `selected={true}` implies `state='active'`
  disabled?: boolean                              // sets `state='disabled'` + blocks click
  format?: '12h' | '24h'                          // default '12h' (displays "01:30 PM" with grayer suffix)
  onSelect?: (value: string) => void              // fires when interactive (not disabled)
  className?: string
  'aria-label'?: string
}

// Atom 2 — duration chip in the quick-duration row
type TimePickerDurationChipProps = {
  value: number                                   // duration in minutes (15, 30, 60, ...)
  label?: string                                  // override the displayed label (default `formatDuration(value)`)
  state?: 'default' | 'hover' | 'active' | 'disabled'
  selected?: boolean                              // semantic — `selected={true}` implies `state='active'` + leading check
  disabled?: boolean
  onSelect?: (value: number) => void
  className?: string
}

// Atom 3 — status chip for availability picker
type TimePickerStatusVariant = 'available' | 'busy' | 'in-meeting' | 'offline'
type TimePickerStatusChipProps = {
  variant: TimePickerStatusVariant
  label?: string                                  // override the displayed label (default lookup per variant)
  state?: 'default' | 'hover' | 'selected' | 'disabled'
  selected?: boolean
  disabled?: boolean
  icon?: React.ReactNode                          // override the default colored dot icon
  onSelect?: (variant: TimePickerStatusVariant) => void
  className?: string
}
```

#### Main composition API

```ts
type TimePickerValue = string | null              // HH:MM 24h ("13:30") or null

type TimePickerProps = {
  // Selected time
  value?: TimePickerValue
  defaultValue?: TimePickerValue                  // uncontrolled initial value
  onChange?: (value: TimePickerValue) => void     // fires on slot selection (mirrors `defaultValue`/`value` controlled split)

  // Header (default visible)
  showHeader?: boolean                            // default true
  headerIcon?: React.ReactNode                    // default `<ClockIcon />` from lucide-react
  headerTitle?: string                            // default formats `value` per `format`; falls back to `headerPlaceholder`
  headerPlaceholder?: string                      // shown when value is null. Default `'Pick a time'` (i18n key `ui.timePicker.placeholder`).
  onClose?: () => void                            // shows close (X) button in header when provided

  // Duration row (default hidden — opt in by passing `durations`)
  durations?: Array<{ value: number; label?: string; disabled?: boolean }>
  activeDuration?: number                         // value matching one of durations[i].value
  defaultActiveDuration?: number
  onDurationChange?: (value: number) => void

  // Status row (default hidden — opt in by passing `statuses`)
  statuses?: Array<{ variant: TimePickerStatusVariant; label?: string; disabled?: boolean }>
  activeStatus?: TimePickerStatusVariant
  defaultActiveStatus?: TimePickerStatusVariant
  onStatusChange?: (variant: TimePickerStatusVariant) => void
  statusLabel?: string                            // section label above status row (default `'Select status'`)

  // Slot list (essential)
  slots?: string[]                                // explicit HH:MM list; takes precedence over generated slots
  startTime?: string                              // generator start, default '00:00'
  endTime?: string                                // generator end, default '23:30'
  intervalMinutes?: number                        // generator step, default 30
  format?: '12h' | '24h'                          // display format for slots + header, default '12h'
  slotRightText?: (slot: string) => string | undefined  // optional right-aligned secondary text per slot
  slotLabel?: string                              // section label above slot list (default omitted)
  maxHeight?: number                              // px, default 280 (matches Figma)

  // Footer (default visible)
  showFooter?: boolean                            // default true
  cancelLabel?: string                            // default localized 'Cancel'
  applyLabel?: string                             // default localized 'Apply'
  onCancel?: () => void
  onApply?: (value: TimePickerValue) => void

  // Popover anchor mode (optional — for trigger-driven usage)
  trigger?: React.ReactNode                       // when provided, the whole composition is wrapped in a `<Popover>` anchored to `trigger`
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  popoverAlign?: 'start' | 'center' | 'end'       // default 'start'
  popoverSide?: 'top' | 'right' | 'bottom' | 'left'  // default 'bottom'

  // Styling / misc
  className?: string
  disabled?: boolean                              // disables all sub-components inside
  'aria-label'?: string
}
```

#### Helper

`formatDuration(minutes: number, options?: { short?: boolean }): string` — internal helper exported alongside `TimePicker` for consumer convenience. Default short form: `15 min`, `30 min`, `1 hour`, `2 hours`, `12 hours`, `1 day`. Used by both `TimePickerDurationChip` (default label) and any consumer that builds its own UI.

#### Visual contract (per Figma)

- Card: `bg-background` + `border-border` + `rounded-[var(--radius-20,20px)]` + multi-layer shadow (matches Figma drop shadows). Width 348px default (configurable via `className`).
- Header (52px tall): clock icon (`size-5`) left + title (`text-base font-medium`, suffix `AM`/`PM` in `text-muted-foreground`) + close button (rounded-full, `size-7` hit target).
- Select Duration row (56px tall): horizontal `flex gap-2` with chips. Active chip uses brand primary (`bg-primary/10` + `text-primary` + leading check `size-3`). Default chips use `bg-background` + `border-border` + `text-muted-foreground` + `shadow-xs`.
- Slot list: `flex flex-col gap-0.5 p-2`, scrollable region `max-h-280` with right-edge scrollbar track styled per Figma (4px rail). Each slot 36px tall, `rounded-md`, padding `px-3 py-2`. Active slot uses `bg-muted/50` + foreground text + trailing check (`size-3.5`).
- Footer (64px tall): `border-t` + `justify-end gap-3` + `Button` primitives (Cancel `variant='outline' size='sm'`, Apply `variant='default' size='sm'`).

#### Behaviour

- **Slot selection** updates the controlled / uncontrolled value but does NOT auto-close. The footer Apply button is the commit action when `showFooter && trigger` (popover mode) — clicking Apply fires `onApply(value)` and closes the popover. Without trigger (inline mode), Apply just fires `onApply`.
- **Cancel** restores the value to its state at popover-open time (in trigger mode) and closes. In inline mode, Cancel fires `onCancel` only — consumer decides what to do.
- **Keyboard**: Arrow up/down moves slot focus. Enter selects + applies. Escape cancels. Per dialog UX rule (AGENTS.md).
- **Duration chip click** sets `activeDuration`. Consumer is responsible for translating the duration into a `startTime`+`endTime` range or a slot list — the primitive does not auto-derive slots from duration.
- **Status chip click** sets `activeStatus`. Purely advisory state for the consumer.

#### Backwards compatibility — legacy `backend/inputs/TimePicker.tsx`

The legacy `TimePicker` (single HH:MM popover with Now/Clear) is **NOT removed**. Instead:
- `packages/ui/src/backend/inputs/TimePicker.tsx` is rewritten as a thin shim that wraps the new `<TimePicker>` primitive with sensible defaults reproducing the legacy behaviour (no duration, no status, no footer, `Now` and `Clear` rendered as footer link buttons via a `legacyFooterActions` opt-in prop on the primitive — see Tests).
- Existing consumers (`DateTimePicker`, example admin page demo, any CrudForm `type: 'time'` usages) continue to work without code changes.
- The legacy `TimePickerProps` (`value`, `onChange`, `placeholder`, `disabled`, `readOnly`, `className`, `minuteStep`, `showNowButton`, `showClearButton`) maps 1:1 onto the new primitive's props. `minuteStep` → `intervalMinutes`. `showNowButton` / `showClearButton` → renders extra footer link buttons via primitive's `legacyFooterActions` prop.

**Tests:**

Sub-primitive atoms:
- `TimePickerSlot` renders default 12h format ("01:30 PM" with suffix muted), 24h format ("13:30"), selected state with trailing check icon, disabled state with no `onSelect` invocation.
- `TimePickerDurationChip` renders default + active states, leading check on active, click fires `onSelect`, disabled blocks click.
- `TimePickerStatusChip` renders each of the 4 variants with correct color tokens, selected state, click fires `onSelect`.

Main composition:
- Default render (no `durations`, no `statuses`): header + slots + footer; no duration row, no status row.
- `durations` prop renders the duration row; clicking a chip fires `onDurationChange` and visually highlights it.
- `statuses` prop renders the status row above the slot list with the `statusLabel` heading.
- Slots auto-generated from `startTime`/`endTime`/`intervalMinutes` produce expected count and labels.
- Explicit `slots` prop overrides generation.
- Apply button fires `onApply(value)` and closes popover when in trigger mode.
- Cancel button fires `onCancel` and reverts value to open-time snapshot in trigger mode.
- Keyboard: Arrow down moves focus, Enter selects + applies, Escape cancels.
- `showHeader={false}` hides header, `showFooter={false}` hides footer.
- `disabled` propagates to all sub-components.
- Controlled vs uncontrolled (value/defaultValue, activeDuration/defaultActiveDuration, activeStatus/defaultActiveStatus, open/defaultOpen).

Legacy shim:
- `backend/inputs/TimePicker` with `showNowButton` renders "Now" button that fires onChange with current HH:MM.
- `backend/inputs/TimePicker` with `showClearButton` renders "Clear" that fires onChange(null).
- `minuteStep={5}` produces slots in 5-minute increments.

---

## Migration & Backward Compatibility

Per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md), v3 is reviewed against the 13 contract surfaces. **All changes are additive — no deprecation protocol triggered.**

### Per-surface review

| # | Surface | Risk | Notes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | None | No new file conventions introduced. |
| 2 | Type definitions & interfaces | None | All new types; no existing type changes. |
| 3 | Function signatures | None | All new functions; no signature changes. |
| 4 | Import paths | None | All new files at `@open-mercato/ui/primitives/{file}`. No moves. `backend/inputs/TimePicker.tsx` is rewritten as a shim at the same path — import path stable, prop interface preserved bit-for-bit. |
| 5 | Event IDs | N/A | No events. |
| 6 | Widget injection spot IDs | N/A | No widgets. |
| 7 | API route URLs | N/A | No API routes. |
| 8 | Database schema | N/A | No DB changes. |
| 9 | DI service names | N/A | No DI registrations. |
| 10 | ACL feature IDs | N/A | No ACL. |
| 11 | Notification type IDs | N/A | No notifications. |
| 12 | CLI commands | N/A | No CLI. |
| 13 | Generated file contracts | N/A | Generators not touched. |

### Internal `backend/inputs/TimePicker.tsx` rewrite as shim

The legacy `TimePicker` at [`packages/ui/src/backend/inputs/TimePicker.tsx`](../../packages/ui/src/backend/inputs/TimePicker.tsx) (120 lines, popover-anchored single HH:MM input with Now/Clear buttons) is rewritten as a thin shim that wraps the new `<TimePicker>` primitive. The public `TimePickerProps` interface (`value`, `onChange`, `placeholder`, `disabled`, `readOnly`, `className`, `minuteStep`, `showNowButton`, `showClearButton`) is **preserved bit-for-bit** — existing consumers compile and behave identically. The shim translates the legacy props into the new primitive's API (`minuteStep` → `intervalMinutes`, `showNowButton`/`showClearButton` → `legacyFooterActions`).

This is an additive layering change, not a deprecation. The legacy export stays at the same import path forever. Surface 4 (Import paths) remains stable.

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
| `TimePicker` | New TC-DS-TP-001: "Pick a time slot and commit via Apply button". The legacy `backend/inputs/TimePicker` shim path is covered by existing `DateTimePicker` integration tests (no change expected). |
| Other 8 primitives | Unit tests only (no existing UX surface displaced in v3). Integration coverage added when consumers migrate in follow-up PRs. |

Unit test convention: `packages/ui/src/primitives/__tests__/{primitive-slug}.test.tsx`. **Jest** (jest 30 + jest-environment-jsdom) + `@testing-library/react` + `@testing-library/jest-dom`. Radix Select gets the existing test helpers (per `feedback_radix_test_migration_traps.md`).

---

## Implementation Plan

**Hard rule:** 1 commit = 1 finished concern. No mid-flight `fix(qa)` accumulation. If a primitive needs a fixup, amend NEW work into the next primitive commit OR open a follow-up PR — do not retroactively patch landed primitives.

### Commit sequence (planned 14 commits)

| # | Commit | Files |
|---|---|---|
| 1 | `docs(ds): spec for DS Foundation v3 (11 primitives, 14 commits)` | `.ai/specs/2026-05-09-ds-foundation-v3.md` (this file) |
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
| 12 | `feat(ds): add TimePicker primitive (composition + 3 atoms)` | `packages/ui/src/primitives/time-picker.tsx`, `__tests__/time-picker.test.tsx`, `packages/ui/src/backend/inputs/TimePicker.tsx` (rewritten as shim) |
| 13 | `refactor(ds): FilterOverlay dateRange uses DateRangePicker` | `packages/ui/src/backend/FilterOverlay.tsx` |
| 14 | `docs(ds): document v3 primitives` | `.ai/ui-components.md`, `packages/ui/AGENTS.md`, `docs/design-system/components.md`, `docs/design-system/component-apis.md`, `.ai/specs/2026-04-25-ds-foundation.md` (Phase 3 changelog row) |

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
- Summary of 11 primitives + 1 helper + 1 internal swap + 1 legacy shim (backend/inputs/TimePicker.tsx).
- Test plan checklist.
- Screenshots of each primitive (matching Figma frames where node IDs are known).
- Explicit "no public API changes" callout for backward compatibility reviewers.

---

## Risks & Open Questions

1. **Figma node IDs for `InlineInput` / `CompactSelect` / `InlineSelect`** are TBD in the umbrella roadmap. API specified above is inferred from existing usages. **Action before implementation:** confirm against Figma. If the file does not specify these exactly, document the inferred API as the canonical one and update the umbrella spec.
2. **`DigitInput` accessibility** with `mask=true` — masked inputs have known screen-reader UX issues. We will follow Radix Toggle pattern for `aria-live` announcement of digit count, but not character content.
3. **`react-day-picker` v9** is the version currently installed (`^9.14.0` in `packages/ui/package.json`); the existing `Calendar` primitive already uses the v9 `mode='single' | 'range'` API. v3 builds on this — no version bump needed.
4. **`withTime` time format localization** — initial implementation uses 24h `HH:MM`. 12h support deferred (consumer can format display via `format` prop; underlying `Date` is timezone-naive).
5. **`FilterOverlay` swap edge case** — current implementation accepts both ISO date strings and `Date` objects in `FilterValues`. The swap normalizes to ISO strings on output. Need to verify all `FilterBar dateRange` consumers handle the same shape (currently: only `business_rules/logs`).

---

## Final Compliance Report

To be filled in after all 14 commits land and before opening the PR. Sections:

- [ ] All 11 primitives implemented per the API contracts above.
- [ ] All 11 primitives have unit tests passing.
- [ ] Legacy `backend/inputs/TimePicker.tsx` shim verified — existing consumers (DateTimePicker, example admin demo, any CrudForm `type: 'time'`) work unchanged.
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
| 2026-05-11 | SCOPE EXTENSION (DRAFT) | TimePicker added as primitive #11 per user request (`Figma 164611:83414`). Scope freeze updated to 11 primitives + 1 legacy shim rewrite (`backend/inputs/TimePicker.tsx`). Implementation plan extended from 13 to 14 commits. No existing API contracts changed — strictly additive (TimePicker primitive is new file) plus internal-only shim refactor that preserves the legacy `TimePickerProps` interface. |
| 2026-05-12 | SCOPE EXTENSION (COMMITTED) | TimePicker primitive + ScheduleActivityDialog DateTimeFields real-deployment landed. Primitive composition resolves `Cancel` / `Apply` / `Select status` / `Pick a time` / `Time picker` / `Close` / `Quick duration` / scroll-arrow aria labels through `useT('ui.timePicker.*')`. `HorizontalScrollRow` carries English defaults plus `scrollLeftAriaLabel` / `scrollRightAriaLabel` props for callers outside React context. `formatDuration` stays a pure English helper (preserved for tests and standalone atoms); the customers `DateTimeFields` consumer drives its duration `Select` from a translatable lookup table (`customers.schedule.duration.option.*`) instead of calling `formatDuration` directly. Calendar fix (`[&_button]:!bg-transparent` on selected/range cells) keeps existing `DatePicker` snapshots green. `TimeInput` native number-spinner arrows hidden via `[appearance:textfield]`. Legacy `backend/inputs/TimePicker` shim default `showClearButton: true → false` (mild BC break documented). Phase A consumer audit (30+ native date/time + 13+ native selects) deferred to follow-up PRs B–F. |
| 2026-05-12 | SCOPE PROGRESS (COMMITTED) | `CounterInput` primitive (§6) landed. API extended from `'sm' \| 'default'` to `'sm' \| 'default' \| 'lg'` (32 / 36 / 40 px) to cover all three Figma sizes; `buttonAlign` prop dropped (Figma is split-only). Stepper UX with `Minus` / `Plus` Lucide icons, clamping to `min`/`max`, ArrowUp/Down keyboard support, `aria-invalid` driven error border, English `Decrease`/`Increase` aria defaults overridable through `decrementAriaLabel`/`incrementAriaLabel`. 21 unit tests. Real deployment in `sales/components/documents/ReturnDialog.tsx` (return quantity per line, `min=1` / `max=line.available`) with PL/EN locale keys `sales.returns.qty.decrease` / `sales.returns.qty.increase`. |
| 2026-05-12 | SCOPE PROGRESS (COMMITTED) | `CompactSelect` primitive (§9) landed. Added a new `xs` size variant (`h-7 px-2 text-xs`) to the existing `selectTriggerVariants` cva, then wrapped it as `CompactSelectTrigger` with optional `triggerLabel` muted prefix slot. Composition lives in `packages/ui/src/primitives/compact-select.tsx` and re-exports the rest of the `Select` API. 9 unit tests. Real deployment in `packages/ui/src/backend/DataTable.tsx` pagination "Rows per page" selector (was `<SelectTrigger size="sm">`, now h-7 toolbar density that matches the pagination row icon buttons). |
| 2026-05-12 | SCOPE PROGRESS (COMMITTED) | `InlineInput` primitive (§8) landed. Thin `Input` wrapper: `border-transparent bg-transparent shadow-none` baseline, optional `hover:border-input + hover:bg-muted/40` via `showBorderOnHover` (default `true`), and `focus-within:border-foreground` + focus shadow inherited from the underlying `Input` wrapper for keyboard accessibility. Sizes `sm` (h-8, default) and `default` (h-9) match the rest of the form-density tier. 12 unit tests. Real deployment in `packages/ui/src/backend/JsonBuilder.tsx` — the JSON key renamer was a hand-rolled `<input>` with `border-b border-transparent hover:border-gray-300 focus-visible:border-ring bg-transparent` styling; swapped to `<InlineInput inputClassName="text-right text-xs font-mono pr-1">`. `InlineTextEditor` from `@open-mercato/ui/backend/detail/InlineEditors` (the high-level click-to-edit composition with save / cancel buttons, validation, draft state) intentionally stays a separate primitive — `InlineInput` is the low-level atom for cases where consumers wire their own state machine. |
| 2026-05-12 | SCOPE PROGRESS (COMMITTED) | `InlineSelect` primitive (§10) landed. Mirror of `InlineInput` for select-typed editors — thin `SelectTrigger` wrapper with `border-transparent bg-transparent shadow-none` baseline, `showBorderOnHover` (default `true`) for the hover affordance, and focus styling inherited from the underlying `SelectTrigger` for keyboard accessibility. Sizes `sm` (h-8, default) and `default` (h-9). Re-exports the rest of the `Select` API (`Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectSeparator`, `SelectValue`) so consumers import the whole composition from one path. 9 unit tests. No real consumer migration in this PR — the existing inline-select usages live inside `InlineSelectEditor` (high-level click-to-edit with draft/save), which intentionally stays a separate primitive; `InlineSelectTrigger` is the low-level atom for follow-up modules that need an always-live borderless select (e.g. inline kanban card stage selectors, detail-page status changers). |
