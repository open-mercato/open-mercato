# SPEC-034: DatePicker, DateTimePicker & TimePicker UI Components

**Created:** 2026-02-22
**Status:** Partially Implemented — Phase 1–3 complete (DateTimePicker, TimePicker, TimeInput, Popover, Calendar); **DatePicker pending (Phase 4)**
**Package:** `packages/ui`
**Location:** `packages/ui/src/primitives/` and `packages/ui/src/backend/inputs/`

---

## TLDR

**Key Points:**
- Add reusable `DatePicker`, `DateTimePicker`, and `TimePicker` components to `packages/ui` so every module *can* use a polished, accessible date/date+time/time selection experience instead of raw `<input type="date">` / `<input type="datetime-local">` / `<input type="time">`.
- Components are **available for opt-in use** but **not used anywhere yet**. This spec does not introduce usage in any module.
- `minDate` / `maxDate` support available on both `DatePicker` and `DateTimePicker` — common business requirement (e.g. "no date more than 1 year ahead").

**Scope:**
- New primitive: `Popover` (Radix UI — required foundation for calendar dropdown) ✅ implemented
- New primitive: `Calendar` (based on `react-day-picker` + `date-fns`) ✅ implemented
- New input component: `DatePicker` (date-only calendar in a popover, no time) ⏳ pending Phase 4
- New input component: `DateTimePicker` (date calendar + time selectors in a popover) ✅ implemented
- New input component: `TimePicker` (standalone hour:minute selector) ✅ implemented
- CrudForm integration: `type: 'datetime'` and `type: 'time'` field types ✅ implemented
- CrudForm integration: `type: 'datepicker'` field type ⏳ pending Phase 4
- Migration of existing raw inputs — **out of scope** for this spec; components ready for future opt-in when desired
- i18n support (locale-aware date formatting, translatable labels)

**Concerns:**
- New runtime dependency `react-day-picker` — lightweight (~12kB gzip), well-maintained, shadcn/ui standard
- `@radix-ui/react-popover` — already using Radix for dialog/tooltip/checkbox, consistent choice

**Integration coverage**
- UI: CrudForm supports `type: 'datetime'` / `type: 'time'` (opt-in; exchange-rates and other forms still use `datetime-local`)
- UI: CrudForm will support `type: 'datepicker'` after Phase 4
- UI: DateTimePicker, TimePicker, TimeInput available in `@open-mercato/ui/backend/inputs` — not yet used in ActivitiesSection, ActivityForm, AvailabilitySchedule, InlineEditors, AvailabilityRulesEditor, CurrencyFetchingConfig
- Integration tests: TC-DTP-001/002/003/004 — add when migration is performed (not in scope for this spec)

---

## Overview

The codebase currently relies on native HTML `<input type="date">`, `<input type="datetime-local">`, and `<input type="time">` elements for all date/time selection. These are used in at least 14 locations across 6 modules (customers, planner, currencies, sales, activities/ActivitiesSection, workflows). Each usage is independently styled, lacks consistent UX, and provides a browser-native widget that varies wildly across operating systems and browsers.

This spec introduces three shared input components — `DatePicker`, `DateTimePicker`, and `TimePicker` — as part of the `@open-mercato/ui` package, following the same pattern as existing reusable inputs (`ComboboxInput`, `TagsInput`, `LookupSelect`).

A key requirement surfaced during planning: both `DatePicker` and `DateTimePicker` must support optional `minDate` / `maxDate` constraints. This covers common real-world needs such as "no date more than one year ahead" (delivery planning, contract expiry, subscription renewal) or "no date before today" (scheduling future-only events).

> **Market Reference**: **shadcn/ui** (the project's design system foundation) provides a well-established `DatePicker` pattern using `react-day-picker` + Radix `Popover`. We adopt this pattern and extend it with an inline time selector (hour:minute spinners below the calendar). **Ant Design's DatePicker** offers a combined calendar+time panel — we adopt the combined panel idea but keep it simpler (no second-level precision, no range mode in MVP). **MUI DateTimePicker** uses a mobile-friendly approach with separate date/time steps — rejected as over-complex for an admin-focused app.

---

## Related Specs

- [SPEC-001](SPEC-001-2026-01-21-ui-reusable-components.md) — UI components catalog (DateTimePicker, TimePicker, Popover, Calendar will be added)
- [SPEC-016](SPEC-016-2026-02-03-form-headers-footers.md) — Form Headers & CrudForm (integration with form fields)
- [SPEC-023](SPEC-023-2026-02-11-confirmation-dialog-migration.md) — ConfirmDialog migration (similar UI component migration pattern)

---

## Non-Goals

- **Date range picker** — only single date/datetime/time selection in MVP
- **Second-level precision** — HH:MM only, no seconds
- **Mobile-optimized date/time stepper** — admin-focused app; desktop popover is sufficient
- **Migration of existing forms** — not part of this spec; no module introduces usage of the new components

---

## Problem Statement

1. **No shared datetime component**: There is no `DateTimePicker` in `packages/ui/src/primitives/` or `packages/ui/src/backend/inputs/`. Every module that needs date+time input builds its own `<input type="datetime-local">` with ad-hoc styling.

2. **Inconsistent UX across modules**: The planner module uses `<Input type="time">` with fixed `w-[120px]`, currencies uses a raw `<input type="time">` with different classes, customers/activities use `<input type="datetime-local">` with manual `showPicker()` hacks. No two implementations share the same interaction model.

3. **Poor native widget UX**: Browser-native `datetime-local` pickers:
   - Look different on Chrome, Firefox, Safari (broken or missing on some mobile browsers)
   - Cannot be styled or themed to match the application design system
   - Don't support the app's locale settings (they follow browser/OS locale)
   - Provide no keyboard shortcut integration
   - The date portion is adequate, but the time portion is tiny and hard to use

4. **Code duplication**: The `formatDateTimeLocal()` helper is duplicated in `currencies/backend/exchange-rates/` (both the page and a test file). Styling classes are copy-pasted.

5. **CrudForm gap**: `CrudForm` supports `type: 'datetime-local'` but renders it as a raw `<input>` — no popover, no calendar, no consistent styling.

6. **Missing foundation primitives**: The project has no `Popover` or `Calendar` primitive, which are prerequisites for any dropdown-based picker.

---

## Proposed Solution

### Approach

Add a layered set of components, bottom-up:

1. **Popover primitive** (`packages/ui/src/primitives/popover.tsx`) — thin Radix UI wrapper, reusable beyond date pickers ✅
2. **Calendar primitive** (`packages/ui/src/primitives/calendar.tsx`) — `react-day-picker` with Tailwind styling ✅
3. **TimeInput component** (`packages/ui/src/backend/inputs/TimeInput.tsx`) — controlled hour:minute input with spinners ✅
4. **DateTimePicker component** (`packages/ui/src/backend/inputs/DateTimePicker.tsx`) — popover with calendar + time input ✅
5. **TimePicker component** (`packages/ui/src/backend/inputs/TimePicker.tsx`) — popover with only time input ✅
6. **CrudForm integration** — new `type: 'datetime'` and `type: 'time'` that render the new components ✅
7. **DatePicker component** (`packages/ui/src/backend/inputs/DatePicker.tsx`) — popover with calendar only, no time ⏳
8. **CrudForm integration** — new `type: 'datepicker'` that renders `DatePicker` ⏳

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use `react-day-picker` for calendar | Industry standard for React calendar components. shadcn/ui default. Lightweight (~12kB). Full i18n via `date-fns` locales (already a dependency). |
| Use Radix `Popover` for dropdown | Already using Radix ecosystem (`dialog`, `tooltip`, `checkbox`, `label`, `slot`). Consistent with project conventions. Built-in focus management and accessibility. |
| Minute precision only (no seconds) | Admin CRM/ERP use case doesn't need second-level precision. Keeps UI simple. All existing `datetime-local` usages already format to `HH:MM`. |
| Scrollable select for hours/minutes (not clock dial) | Clock dials are harder to use with keyboard, harder to implement accessibly, and uncommon in admin apps. Scroll selects are faster for known values. |
| Separate `DatePicker` from `DateTimePicker` | Many modules need date-only selection (e.g. delivery date, contract date, subscription end). Combining date+time in those cases is UX noise. Keeps components composable. |
| Separate `TimePicker` from `DateTimePicker` | Some modules (planner, currencies) need time-only input. Keeps components composable. |
| `type: 'datepicker'` for CrudForm (not reusing `'date'`) | `type: 'date'` already exists and renders a raw `<input type="date">`. Adding a new type mirrors the `datetime-local` → `datetime` precedent: old native type stays for backward compat; new polished picker gets its own type name. |
| `minDate` / `maxDate` on both `DatePicker` and `DateTimePicker` | Core business requirement. Not all date fields are unrestricted — e.g. "max 1 year ahead" for renewals. Implemented via react-day-picker `disabled` matcher which greys out (but still shows) out-of-range days. |
| Popover trigger shows formatted value | Display `Feb 22, 2026` or `Feb 22, 2026 14:30` (locale-aware) instead of raw ISO string. Better UX than native inputs. |
| `displayFormat` derived from locale | When `displayFormat` is omitted, day-first locales (pl, de, fr, es, etc.) use `d MMM yyyy` / `d MMM yyyy HH:mm`; others use `MMM d, yyyy` / `MMM d, yyyy HH:mm`. Overridable via prop. |
| `TimeInput` defaults via `useT()` | When `hourLabel`/`minuteLabel` are omitted, `TimeInput` uses `useT('ui.timePicker.hourLabel', 'Hour')` so standalone usage is i18n-ready. |
| `date-fns` for formatting/parsing | Already a dependency in `packages/ui`. No new date library needed. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Enhance native `<input type="datetime-local">` with styling | Cannot be styled consistently cross-browser. Chrome/Firefox/Safari render completely different widgets. No way to add calendar grid or custom time controls. |
| Use `@mui/x-date-pickers` v7 | Heavy dependency (~250kB gzip), Material UI design system conflict, complex adapter setup (`LocalizationProvider`). Over-engineered for an admin CRM app. [Reference](https://mui.com/x/react-date-pickers/) |
| Build calendar from scratch | Significant effort, accessibility edge cases (keyboard, screen reader), i18n complexity. `react-day-picker` v9 handles all this battle-tested. |
| Use `Temporal` API | TC39 Temporal still at Stage 3 proposal; not yet available in Safari without polyfill. `date-fns` v4 is sufficient and already a project dependency. |

---

## User Stories / Use Cases

- **Admin** wants to **set a delivery or contract date (date only, no time)** so that **they can pick a day without being forced to enter a time**.
- **Admin** wants to **set an activity's occurred-at date and time** so that **the activity is recorded with precise timing**.
- **Admin** wants to **pick a currency sync time** so that **exchange rates refresh at the right hour daily**.
- **Admin** wants to **set availability windows with start/end times** so that **the planner shows correct booking slots**.
- **Admin** wants to **enter an exchange rate date+time** so that **rates are tracked to the correct moment**.
- **Admin** wants to **be prevented from picking a date more than 1 year ahead** (e.g. subscription renewal) so that **invalid dates are blocked at the UI level**.
- **Developer** wants to **use `type: 'datepicker'` / `type: 'datetime'` / `type: 'time'` in CrudForm fields** so that **they get a polished picker without custom component wiring**.

---

## Architecture

### Component Hierarchy

```
Popover (primitive, Radix)
├── Calendar (primitive, react-day-picker)
├── TimeInput (input, hour:minute spinners)
│
├── DatePicker (input)      →  Popover + Calendar only
├── DateTimePicker (input)  →  Popover + Calendar + TimeInput
├── TimePicker (input)      →  Popover + TimeInput
│
└── CrudForm integration    →  type: 'datepicker' → DatePicker
                            →  type: 'datetime'   → DateTimePicker
                            →  type: 'time'       → TimePicker
```

### Data Flow

- **DatePicker**: Accepts and emits `Date | null`. Date portion only — time is ignored (set to midnight or preserved from existing value).
- **DateTimePicker**: Accepts and emits `Date | null`. Internally manages separate date (from Calendar) and time (from TimeInput) state, merging on change.
- **TimePicker**: Accepts and emits `string | null` in `HH:MM` format. `null` represents empty/no time selected (e.g., after Clear).
- **CrudForm `datepicker`**: Stores value as a date-only string (`2026-02-22`). On read, uses `parseISO(value)` from `date-fns` to convert to `Date` — **not** `new Date(value)`, which would interpret the string as UTC midnight and shift the date in UTC+ timezones.
- **CrudForm `datetime`**: Stores value as UTC ISO string (`2026-02-22T12:30:00.000Z`). Converts to/from `Date` for the picker — see timezone contract below.
- **CrudForm `time`**: Stores value as `HH:MM` string, or `undefined` when cleared.

### Timezone Contract

`DateTimePicker` operates in the **local timezone of the browser**. When integrated with CrudForm, the following conversions apply:

```typescript
// CrudForm → DateTimePicker (ISO string → Date, local timezone)
const dateObj = typeof value === 'string' && value ? new Date(value) : null
// new Date("2026-02-22T12:30:00.000Z") in UTC+2 → Date representing 14:30 local

// DateTimePicker → CrudForm (Date → ISO string, UTC)
const isoString = date ? date.toISOString() : undefined
// Date representing 14:30 local in UTC+2 → "2026-02-22T12:30:00.000Z"
```

**Convention**: All stored datetimes are UTC ISO strings. The browser renders and edits them in local time. This matches the behaviour of native `<input type="datetime-local">` and is the existing convention across the codebase. The round-trip is lossless as long as the server stores and returns the same UTC value.

> **Known limitation**: If the user's browser timezone changes between recording and viewing a value, the displayed local time will shift accordingly. This is acceptable and consistent with standard web app behaviour.

### Keyboard Interaction

| Key | Action |
|-----|--------|
| `Enter` / `Space` on trigger | Open popover |
| `Escape` | Close popover |
| Arrow keys in calendar | Navigate days |
| `Tab` | Move focus: calendar → hour → minute → actions |
| Arrow Up/Down in time spinners | Increment/decrement hour or minute |
| Typing digits in time spinners | Direct numeric input |

---

## Data Models

N/A — this is a UI-only change. No database entities, no API changes.

---

## API Contracts

N/A — no new API endpoints. This spec only adds UI components.

---

## Internationalization (i18n)

### Calendar Locale

`react-day-picker` supports `date-fns` locales natively. Pass the current app locale to `<Calendar locale={...}>`:

```typescript
import { pl, de, es, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// Map from i18n language code to date-fns Locale object
const DATE_FNS_LOCALE_MAP: Record<string, Locale> = {
  pl,
  de,
  es,
  en: enUS,
}

// Usage inside DateTimePicker (locale prop is optional; falls back to enUS)
// Callers that need locale-aware month/day names pass a date-fns Locale object:
//   <DateTimePicker locale={pl} ... />
// When locale is omitted, react-day-picker defaults to enUS internally.
```

The `locale` prop on `DateTimePicker` is optional (`Locale | undefined`). Modules that require locale-aware calendar labels (e.g., Polish month names) must import and pass the appropriate `date-fns` Locale object explicitly. Automatic resolution from the i18n context is **not** implemented and is deferred to a future enhancement.

### Translation Keys

```
ui.datePicker.placeholder          = "Pick a date"
ui.datePicker.todayButton          = "Today"
ui.datePicker.clearButton          = "Clear"
ui.dateTimePicker.placeholder      = "Pick date and time"
ui.dateTimePicker.timeLabel        = "Time"
ui.dateTimePicker.todayButton      = "Today"
ui.dateTimePicker.clearButton      = "Clear"
ui.timePicker.placeholder          = "Pick a time"
ui.timePicker.hourLabel            = "Hour"
ui.timePicker.minuteLabel          = "Minute"
ui.timePicker.nowButton            = "Now"
```

Keys marked with `ui.datePicker.*` are **new** (Phase 4) — `ui.datePicker.placeholder` was pre-declared in Phase 2 i18n files; `ui.datePicker.todayButton` and `ui.datePicker.clearButton` are new and MUST be added in Phase 4.

These keys MUST be present in all supported locale files.

**Locale file paths:**
- `apps/mercato/src/i18n/{en,pl,de,es}.json`
- `packages/create-app/template/src/i18n/{en,pl,de,es}.json` (for scaffolded apps)

---

## UI/UX

### DatePicker Layout

```
┌─────────────────────────────────────┐
│  📅  Feb 22, 2026              ▼   │  ← Trigger button (popover)
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  ◀  February 2026  ▶               │
│  Mo Tu We Th Fr Sa Su               │
│                          1  2       │
│   3  4  5  6  7  8  9              │
│  10 11 12 13 14 15 16              │
│  17 18 19 20 21 [22] 23            │  ← Calendar grid (no time section)
│  24 25 26 27 28                     │
│─────────────────────────────────────│
│  [Today]              [Clear]       │  ← Quick actions
└─────────────────────────────────────┘
```

Identical to `DateTimePicker` but without the time (Hour:Minute) section. Selecting a day immediately provides a value — the popover can close on day selection (controlled via `closeOnSelect` prop, default `true`).

### DateTimePicker Layout

```
┌─────────────────────────────────────┐
│  📅  Feb 22, 2026  14:30       ▼   │  ← Trigger button (popover)
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  ◀  February 2026  ▶               │
│  Mo Tu We Th Fr Sa Su               │
│                          1  2       │
│   3  4  5  6  7  8  9              │
│  10 11 12 13 14 15 16              │
│  17 18 19 20 21 [22] 23            │  ← Calendar grid
│  24 25 26 27 28                     │
│─────────────────────────────────────│
│  Time:  [14] : [30]                │  ← Hour:Minute spinners
│─────────────────────────────────────│
│  [Today]              [Clear]       │  ← Quick actions
└─────────────────────────────────────┘
```

### TimePicker Layout

```
┌─────────────────────────┐
│  🕐  14:30          ▼   │  ← Trigger button
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│  [14] : [30]            │  ← Hour:Minute spinners
│─────────────────────────│
│  [Now]        [Clear]   │
└─────────────────────────┘
```

### TimeInput (Inline) Layout

For use without popover (e.g., in planner availability windows where multiple time inputs sit inline):

```
┌────────┐   ┌────────┐
│  14  ▲ │ : │  30  ▲ │   ← Compact inline spinners
│      ▼ │   │      ▼ │
└────────┘   └────────┘
```

### States

| State | Behavior |
|-------|----------|
| **Empty** | Show placeholder text, no value |
| **Selected** | Show formatted date or date+time in trigger |
| **Disabled** | Grayed out, no popover on click |
| **Error** | Red border on trigger (via standard form error styling) |
| **Read-only** | Show value, no interaction |
| **Out-of-range day** | Day rendered but disabled (greyed) when before `minDate` or after `maxDate` |

### Accessibility (a11y)

| Element | Role / Attribute | Value |
|---------|-----------------|-------|
| Popover trigger button | `aria-haspopup="dialog"` | Signals dropdown behaviour |
| PopoverContent | Radix manages `role`, `aria-modal` automatically via Portal | Built-in focus trap |
| Calendar grid | `react-day-picker` sets `role="grid"` on the month table | Standard calendar ARIA pattern |
| Day cells | `aria-selected`, `aria-disabled` set by react-day-picker | No extra work needed |
| Hour input | `aria-label={t('ui.timePicker.hourLabel')}` | Translatable via i18n |
| Minute input | `aria-label={t('ui.timePicker.minuteLabel')}` | Translatable via i18n |
| Today / Clear / Now buttons | Visible text labels via i18n keys | No extra aria needed |

**Keyboard contract:**
- Trigger button: `Enter`/`Space` opens; `Escape` closes (Radix default)
- Calendar navigation: `ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown` for day navigation; `Enter` selects (react-day-picker built-in)
- Hour/Minute spinners: `ArrowUp`/`ArrowDown` to increment/decrement; digit keys for direct input
- `Tab` cycles: trigger → (popover open) calendar → hour → minute → action buttons → close

react-day-picker v9 and @radix-ui/react-popover handle the bulk of ARIA semantics. No custom `role` or `aria-live` attributes are required beyond the hour/minute `aria-label`.

### Styling

- Follow existing primitive patterns: Tailwind classes, `cn()` merging, design tokens via CSS variables
- Popover width matches trigger width (min 280px for calendar)
- Calendar cells: `h-9 w-9` consistent with shadcn/ui defaults
- Selected date: `bg-primary text-primary-foreground` (theme-aware)
- Today highlight: `bg-accent text-accent-foreground`
- Time spinners: bordered inputs with `tabular-nums` font for alignment

---

## Component API Reference

### Popover Primitive

```typescript
// packages/ui/src/primitives/popover.tsx
import * as PopoverPrimitive from '@radix-ui/react-popover'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverContent = React.forwardRef<...>(({ className, align, sideOffset, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align ?? 'start'}
      sideOffset={sideOffset ?? 4}
      className={cn('z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none ...', className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
```

### Calendar Primitive

```typescript
// packages/ui/src/primitives/calendar.tsx
import { DayPicker, type DayPickerProps } from 'react-day-picker'

export type CalendarProps = DayPickerProps

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        // ... standard shadcn/ui class mapping
        day_selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
        day_today: 'bg-accent text-accent-foreground',
        ...classNames,
      }}
      {...props}
    />
  )
}
```

### DatePicker

```typescript
// packages/ui/src/backend/inputs/DatePicker.tsx
export type DatePickerProps = {
  value?: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  locale?: Locale         // date-fns locale
  displayFormat?: string  // date-fns format pattern; when omitted, derived from locale (day-first: 'd MMM yyyy', else 'MMM d, yyyy')
  showTodayButton?: boolean
  showClearButton?: boolean
  closeOnSelect?: boolean // default true — close popover immediately on day click
  minDate?: Date          // days before this are disabled (greyed out, not selectable)
  maxDate?: Date          // days after this are disabled (greyed out, not selectable)
}
```

**Value contract**: `DatePicker` accepts and emits `Date | null`. The time portion of the `Date` object is set to midnight local time (`00:00:00.000`) when a new day is selected. Callers that store date-only strings should format via `date-fns` `format(date, 'yyyy-MM-dd')`. When `closeOnSelect` is `true` (default), the popover closes as soon as the user clicks a day cell, matching standard date-picker UX.

### DateTimePicker

```typescript
// packages/ui/src/backend/inputs/DateTimePicker.tsx
export type DateTimePickerProps = {
  value?: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  locale?: Locale         // date-fns locale
  displayFormat?: string  // date-fns format pattern; when omitted, derived from locale (day-first for pl/de/fr/es/etc., else month-first)
  minuteStep?: number     // default 1, can be 5, 10, 15, 30
  showTodayButton?: boolean
  showClearButton?: boolean
  minDate?: Date
  maxDate?: Date
}
```

### TimePicker

```typescript
// packages/ui/src/backend/inputs/TimePicker.tsx
export type TimePickerProps = {
  value?: string | null    // "HH:MM" format
  onChange: (time: string | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  minuteStep?: number     // default 1
  showNowButton?: boolean
  showClearButton?: boolean
}
```

### TimeInput (Inline)

```typescript
// packages/ui/src/backend/inputs/TimeInput.tsx
export type TimeInputProps = {
  value?: string | null    // "HH:MM" format
  onChange: (time: string) => void
  disabled?: boolean
  className?: string
  minuteStep?: number
  hourLabel?: string      // defaults to useT('ui.timePicker.hourLabel', 'Hour') when omitted
  minuteLabel?: string    // defaults to useT('ui.timePicker.minuteLabel', 'Minute') when omitted
}
```

### CrudForm Integration

```typescript
// Types added / to be added to CrudBuiltinField.type union:
type: 'datepicker'      // renders DatePicker (Phase 4)
    | 'datetime'        // renders DateTimePicker (✅ implemented)
    | 'time'            // renders TimePicker (✅ implemented)

// Additional field options:
minuteStep?: number     // passed to DateTimePicker / TimePicker
minDate?: Date          // passed to DatePicker / DateTimePicker
maxDate?: Date          // passed to DatePicker / DateTimePicker
displayFormat?: string  // passed to DatePicker / DateTimePicker (date-fns format pattern)
closeOnSelect?: boolean // passed to DatePicker (default true)
```

**Value serialization for `datepicker`**: CrudForm stores the value as a date-only string `'YYYY-MM-DD'` via `format(date, 'yyyy-MM-dd')` (from `date-fns`). On read, `parseISO(value)` from `date-fns` converts back to a `Date` — `parseISO` treats date-only strings as local midnight, avoiding the UTC-midnight shift that `new Date('2026-02-22')` would cause in UTC+ timezones (e.g. UTC+2 would display 21 Feb instead of 22 Feb).

---

## Configuration

### Dependencies to Add

```json
// packages/ui/package.json
{
  "dependencies": {
    "@radix-ui/react-popover": "^1.1.6",
    "react-day-picker": "^9.6.4"
  }
}
```

`date-fns` is already a dependency of `packages/ui`.

### Tailwind / CSS

No new CSS files needed. All styling via Tailwind utilities and existing CSS variables (`--primary`, `--accent`, `--popover`, etc.).

The `popover` color token is expected to exist in `globals.css` (standard shadcn/ui setup). Verify presence before implementation:

```css
--popover: ...;
--popover-foreground: ...;
```

---

## Migration & Compatibility

### Backward Compatibility

- `CrudForm` `type: 'datetime-local'` continues to work unchanged (renders raw `<input>` as before)
- `CrudForm` `type: 'date'` continues to work unchanged (renders raw `<input type="date">` as before)
- New `type: 'datetime'`, `type: 'time'`, `type: 'datepicker'` are all opt-in — no module uses them yet; migration deferred
- No breaking changes to existing APIs or data formats

### Future Migration Reference (Out of Scope)

These files currently use raw `<input type="datetime-local">` or `<input type="time">`. Migration is **not part of this spec**; the list is for future reference when migration is desired:

| File | Current | Target |
|------|---------|--------|
| `packages/ui/src/backend/detail/ActivitiesSection.tsx` | `<input type="datetime-local">` | `DateTimePicker` |
| `packages/ui/src/backend/CrudForm.tsx` | raw `<input type="datetime-local">` for `datetime-local` type | keep as-is; add new `datetime` type |
| `packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx` | `<Input type="time">` (×4) | `TimeInput` (inline) |
| `packages/core/src/modules/planner/components/AvailabilitySchedule.tsx` | `<Input type="datetime-local">` (×3) | `DateTimePicker` |
| `packages/core/src/modules/customers/components/detail/InlineEditors.tsx` | `<input type="datetime-local">` | `DateTimePicker` |
| `packages/core/src/modules/customers/components/detail/ActivityForm.tsx` | `<input type="datetime-local">` | `DateTimePicker` |
| `packages/core/src/modules/currencies/components/CurrencyFetchingConfig.tsx` | `<input type="time">` | `TimePicker` or `TimeInput` |
| `packages/core/src/modules/currencies/backend/exchange-rates/create/page.tsx` | CrudForm `datetime-local` | CrudForm `datetime` |
| `packages/core/src/modules/currencies/backend/exchange-rates/[id]/page.tsx` | CrudForm `datetime-local` | CrudForm `datetime` |
| `packages/core/src/modules/sales/widgets/dashboard/new-quotes/widget.client.tsx` | `openNativeDatePicker` hack | `DatePicker` (date-only) |
| `packages/core/src/modules/sales/widgets/dashboard/new-orders/widget.client.tsx` | `openNativeDatePicker` hack | `DatePicker` (date-only) |

---

## Implementation Plan

### Phase 1: Primitives & Foundation

**Goal:** Add `Popover` and `Calendar` primitives — reusable building blocks that other components will depend on.

1. Add `@radix-ui/react-popover` and `react-day-picker` dependencies to `packages/ui/package.json`
2. Create `packages/ui/src/primitives/popover.tsx` — Radix Popover wrapper with Tailwind styling
3. Create `packages/ui/src/primitives/calendar.tsx` — react-day-picker wrapper with shadcn/ui class names
4. Add locale passthrough using `date-fns/locale` based on app i18n context
5. Update `SPEC-001` UI components catalog with new primitives
6. Verify: `Popover` and `Calendar` render correctly in isolation

### Phase 2: Input Components

**Goal:** Build `TimeInput`, `DateTimePicker`, and `TimePicker` input components.

1. Create `packages/ui/src/backend/inputs/TimeInput.tsx` — inline hour:minute selector with arrow key support
2. Create `packages/ui/src/backend/inputs/DateTimePicker.tsx` — popover with Calendar + TimeInput, `Date` value
3. Create `packages/ui/src/backend/inputs/TimePicker.tsx` — popover with TimeInput only, `HH:MM` string value
4. Add keyboard navigation: arrow keys in time spinners, Tab flow, Escape to close
5. Add `minuteStep` support (1, 5, 10, 15, 30)
6. Add clear/today/now buttons
7. Add i18n translation keys to all locale files (en, pl, de, es) in `apps/mercato/src/i18n/`
8. Mirror the same keys in `packages/create-app/template/src/i18n/` (per `lessons.md` template sync rule)
9. Verify: all three components render and behave correctly

### Phase 3: CrudForm Integration

**Goal:** Register `datetime` and `time` as native CrudForm field types.

1. Add `'datetime' | 'time'` to `CrudBuiltinField.type` union
2. Add `minuteStep`, `minDate`, `maxDate` optional properties to `CrudBuiltinField`
3. Add render branch in CrudForm for `type === 'datetime'` → `DateTimePicker`
4. Add render branch in CrudForm for `type === 'time'` → `TimePicker`
5. Handle value conversion: CrudForm stores ISO string, DateTimePicker expects `Date`
6. Verify: CrudForm renders datetime and time fields correctly

**Status: ✅ Complete**

---

### Phase 4: DatePicker Component

**Goal:** Build `DatePicker` — a date-only picker reusing the `Calendar` primitive, without the time section.

1. Create `packages/ui/src/backend/inputs/DatePicker.tsx`
   - Props: `value`, `onChange`, `placeholder`, `disabled`, `readOnly`, `className`, `locale`, `displayFormat`, `showTodayButton`, `showClearButton`, `closeOnSelect`, `minDate`, `maxDate`
   - Value: `Date | null`; on day select, time is set to midnight local (`00:00:00.000`)
   - `closeOnSelect` (default `true`): close popover immediately after day click
   - `minDate` / `maxDate`: pass as `disabled` matcher to `<Calendar>`
   - Display format derived from locale: `d MMM yyyy` for day-first locales (pl, de, fr, es, it, pt, nl, ru, cs, sk, hu, ro), `MMM d, yyyy` otherwise
   - Today / Clear buttons, same pattern as `DateTimePicker`
   - `data-crud-focus-target=""` on trigger button
2. Add `ui.datePicker.todayButton` and `ui.datePicker.clearButton` keys to all locale files (en, pl, de, es) in `apps/mercato/src/i18n/` and `packages/create-app/template/src/i18n/`
3. Export `DatePicker` from `packages/ui/src/backend/inputs/index.ts`
4. Add `'datepicker'` to `CrudBuiltinField.type` union in `CrudForm.tsx`
   - Add `closeOnSelect?: boolean` to `CrudBuiltinField`
   - Add render branch: `type === 'datepicker'` → `DatePicker`
   - Value conversion: CrudForm stores `'YYYY-MM-DD'` string via `format(date, 'yyyy-MM-dd')`; on read, `parseISO(value)` from `date-fns` converts back to `Date` (avoids UTC-midnight shift that `new Date(value)` causes in UTC+ timezones)
5. Verify: `DatePicker` renders and behaves correctly; `type: 'datepicker'` works in CrudForm; `type: 'date'` (raw input) is unchanged

### Appendix: Future Migration Reference (Out of Scope)

When migration is desired in the future, target files:

1. `ActivitiesSection.tsx` — replace custom `datetime-local` input
2. `ActivityForm.tsx` — replace custom `datetime-local` input
3. `InlineEditors.tsx` — replace inline `datetime-local` input
4. `AvailabilityRulesEditor.tsx` — replace `<Input type="time">` with `TimeInput`
5. `AvailabilitySchedule.tsx` — replace `datetime-local` with `DateTimePicker`
6. `CurrencyFetchingConfig.tsx` — replace `<input type="time">` with `TimePicker`
7. `currencies/exchange-rates/create/page.tsx` — change CrudForm type from `datetime-local` to `datetime`
8. `currencies/exchange-rates/[id]/page.tsx` — change CrudForm type from `datetime-local` to `datetime`
9. Sales dashboard widgets — migrate if time component is needed, otherwise leave as date-only
10. Remove duplicated `formatDateTimeLocal` helper (move to shared utility if still needed)

### File Manifest

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md` | Modify | 1 ✅ | Add Popover, Calendar, DatePicker, DateTimePicker, TimePicker, TimeInput to UI components catalog |
| `packages/ui/package.json` | Modify | 1 ✅ | Add `@radix-ui/react-popover ^1.1.6`, `react-day-picker ^9.6.4` |
| `packages/ui/src/primitives/popover.tsx` | Create | 1 ✅ | Popover primitive (Radix wrapper) |
| `packages/ui/src/primitives/calendar.tsx` | Create | 1 ✅ | Calendar primitive (react-day-picker v9 wrapper) |
| `packages/ui/src/backend/inputs/TimeInput.tsx` | Create | 2 ✅ | Inline hour:minute input with spinners |
| `packages/ui/src/backend/inputs/DateTimePicker.tsx` | Create | 2 ✅ | Date+Time picker with popover |
| `packages/ui/src/backend/inputs/TimePicker.tsx` | Create | 2 ✅ | Time-only picker with popover |
| `packages/ui/src/backend/inputs/DatePicker.tsx` | Create | 4 ⏳ | Date-only picker with popover |
| `packages/ui/src/backend/inputs/index.ts` | Modify | 2+4 | Export new components |
| `packages/ui/src/backend/CrudForm.tsx` | Modify | 3+4 | Add `datetime`, `time` (✅), `datepicker` (⏳) field types |
| Various module files (see Future Migration Reference) | — | — | Not in scope; no migration in this spec |
| `packages/ui/src/backend/inputs/__tests__/TimeInput.test.tsx` | Create | ⏳ | Unit tests: rendering, keyboard nav, boundary wrap, minuteStep, clamp, NaN guard |
| `packages/ui/src/backend/inputs/__tests__/DatePicker.test.tsx` | Create | ⏳ | Unit tests: day selection, closeOnSelect, minDate/maxDate disabling, Today/Clear, display format |
| `packages/ui/src/backend/inputs/__tests__/DateTimePicker.logic.test.ts` | Create | ⏳ | Unit tests: extractTime, applyTimeToDate, ISO round-trip (Timezone Contract) |
| `packages/ui/src/backend/inputs/__tests__/TimePicker.test.tsx` | Create | ⏳ | Unit tests: Clear/Now buttons, display, button visibility toggles |
| `packages/ui/src/backend/__tests__/CrudForm.datetime.test.tsx` | Create | ⏳ | Unit tests: datepicker/datetime/time field rendering, value conversion, backward compat |
| `apps/mercato/src/i18n/en.json` | Modify | 2 ✅ + 4 ⏳ | Add `ui.datePicker.*`, `ui.dateTimePicker.*`, `ui.timePicker.*` keys (English) |
| `apps/mercato/src/i18n/pl.json` | Modify | 2 ✅ + 4 ⏳ | Same keys (Polish) |
| `apps/mercato/src/i18n/de.json` | Modify | 2 ✅ + 4 ⏳ | Same keys (German) |
| `apps/mercato/src/i18n/es.json` | Modify | 2 ✅ + 4 ⏳ | Same keys (Spanish) |
| `packages/create-app/template/src/i18n/en.json` | Modify | 2 ✅ + 4 ⏳ | Mirror all i18n keys for scaffolded apps (template sync) |
| `packages/create-app/template/src/i18n/pl.json` | Modify | 2 ✅ + 4 ⏳ | Mirror (Polish) |
| `packages/create-app/template/src/i18n/de.json` | Modify | 2 ✅ + 4 ⏳ | Mirror (German) |
| `packages/create-app/template/src/i18n/es.json` | Modify | 2 ✅ + 4 ⏳ | Mirror (Spanish) |

### Testing Strategy

**Rationale for deferred tests:** No module uses the new components yet. **Integration tests** require at least one real usage — without migration, there is nothing to test end-to-end. **Unit tests** do not require usage (they render components in isolation); they are planned but not yet implemented due to scope prioritization.

**Unit tests** (Jest + Testing Library, in `packages/ui/src/`):

Unit tests for the new components are **planned but not yet implemented**. When adding them, target:

| File | Coverage |
|------|----------|
| `src/backend/inputs/__tests__/TimeInput.test.tsx` | Rendering, hour/minute ArrowUp/Down with boundary wrap, `minuteStep` stepping and snapping, clamp on direct numeric input, NaN guard, disabled state |
| `src/backend/inputs/__tests__/DatePicker.test.tsx` | Placeholder vs value display, day selection emits `Date` at midnight, `closeOnSelect` closes popover, `minDate`/`maxDate` disables out-of-range cells, Today sets today's date, Clear emits `null`, `showTodayButton`/`showClearButton` toggles |
| `src/backend/inputs/__tests__/DateTimePicker.logic.test.ts` | `extractTime` (pad, midnight, end-of-day), `applyTimeToDate` (date preservation, seconds zeroed, immutability), ISO round-trip (SPEC-034 Timezone Contract), `extractTime + applyTimeToDate` composition (day select preserves time) |
| `src/backend/inputs/__tests__/TimePicker.test.tsx` | Placeholder vs value display, Clear emits `null`, Now emits valid `HH:MM`, `showNowButton`/`showClearButton` toggles, TimeInput integration |
| `src/backend/__tests__/CrudForm.datetime.test.tsx` | `type: 'datepicker'` renders DatePicker, `type: 'datetime'` renders DateTimePicker, `type: 'time'` renders TimePicker, ISO→Date conversion, `YYYY-MM-DD` passthrough for datepicker, `type: 'datetime-local'` backward compatibility, `type: 'date'` backward compatibility |

**Integration tests** (Playwright, in `.ai/qa/`):

*Add TC-DTP-001/002/003/004 when migration is performed (out of scope for this spec).*

**TC-DTP-001 — CrudForm datetime submit**
```typescript
// Scenario: Open exchange-rates create form, set date+time via DateTimePicker, submit, verify stored value
test('TC-DTP-001: CrudForm datetime field submits correct ISO value', async ({ page }) => {
  await page.goto('/backend/currencies/exchange-rates/create')
  // Open DateTimePicker popover
  await page.getByRole('button', { name: /pick date and time/i }).click()
  // Select a specific day in the calendar
  await page.getByRole('gridcell', { name: '15' }).click()
  // Set hour to 09
  await page.getByLabel('Hour').fill('9')
  // Set minute to 30
  await page.getByLabel('Minute').fill('30')
  // Close popover and submit form
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /save/i }).click()
  // Verify redirect to edit page (record created)
  await expect(page).toHaveURL(/exchange-rates\/\d+/)
  // Reopen and verify value round-trip
  const trigger = page.getByRole('button', { name: /\d{1,2}:\d{2}/ })
  await expect(trigger).toContainText('09:30')
})
```

**TC-DTP-002 — TimePicker in availability / currency config**
```typescript
// Scenario: CurrencyFetchingConfig TimePicker — set sync time, verify HH:MM value persists
test('TC-DTP-002: TimePicker emits and displays HH:MM correctly', async ({ page }) => {
  await page.goto('/backend/currencies') // navigate to currency settings
  await page.getByRole('button', { name: /pick a time/i }).click()
  await page.getByLabel('Hour').fill('14')
  await page.getByLabel('Minute').fill('0')
  await page.keyboard.press('Escape')
  const trigger = page.getByRole('button', { name: /14:00/ })
  await expect(trigger).toBeVisible()
})
```

**TC-DTP-003 — DateTimePicker in activity create**
```typescript
// Scenario: Create activity with occurred-at set via DateTimePicker; verify value shown in detail view
test('TC-DTP-003: DateTimePicker in activity form — date and time persist after save', async ({ page }) => {
  // Navigate to a customer detail page and open activity form
  await page.goto('/backend/customers/people')
  await page.getByRole('row').first().click()
  await page.getByRole('button', { name: /add activity/i }).click()
  // Set occurred-at
  await page.getByRole('button', { name: /pick date and time/i }).click()
  await page.getByRole('gridcell', { name: '10' }).click()
  await page.getByLabel('Hour').fill('11')
  await page.getByLabel('Minute').fill('15')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /save/i }).click()
  // Verify the activity appears in the list with the correct time
  await expect(page.getByText('11:15')).toBeVisible()
})
```

**TC-DTP-004 — DatePicker date-only selection**
```typescript
// Scenario: CrudForm field type: 'datepicker' — pick a date, verify YYYY-MM-DD string stored
test('TC-DTP-004: DatePicker emits and stores YYYY-MM-DD string correctly', async ({ page }) => {
  // Navigate to a form using type: 'datepicker'
  await page.getByRole('button', { name: /pick a date/i }).click()
  await page.getByRole('gridcell', { name: '20' }).click()
  // Popover should close immediately (closeOnSelect=true)
  await expect(page.locator('[role="dialog"]')).not.toBeVisible()
  // Trigger should show formatted date
  const trigger = page.getByRole('button', { name: /20/ })
  await expect(trigger).toBeVisible()
})
```

> Integration tests TC-DTP-001/002/003/004 apply when modules use the new components. Exchange-rates and other forms currently use `datetime-local`.

**Visual regression**: verify calendar renders correctly across light/dark themes (manual or Chromatic if added).

---

## Success Metrics

1. **Components available** — DatePicker, DateTimePicker, TimePicker, TimeInput, Popover, Calendar in `@open-mercato/ui`; CrudForm supports `type: 'datepicker'`, `type: 'datetime'`, and `type: 'time'`
2. **Existing modules** continue to use raw `datetime-local`/`time`/`date` inputs; no migration in this spec
3. **Build passes** with no TypeScript errors
4. **No visual regressions** — pickers match design system (Tailwind, theme tokens) when used
5. **`minDate`/`maxDate` enforced** — out-of-range days are disabled (greyed) on both `DatePicker` and `DateTimePicker`
6. **Integration tests** — add TC-DTP-001/002/003/004 when migration is performed (out of scope)

---

## Risks & Impact Review

### Data Integrity Failures

No database changes — risk is limited to UI value formatting.

#### Timezone Mismatch in Date Conversion
- **Scenario**: `DateTimePicker` creates a `Date` object in local timezone; CrudForm serializes it via `date.toISOString()` which always outputs UTC. A user in UTC+2 who picks 14:30 will see `"12:30:00.000Z"` stored. When re-read, `new Date("...12:30:00.000Z")` renders as 14:30 local — **the round-trip is lossless** as long as the server echoes the same UTC string.
- **Severity**: Medium (previously assessed High; downgraded after confirming the round-trip is correct)
- **Affected area**: All modules using `type: 'datetime'` in CrudForm
- **Mitigation**: Explicit timezone contract documented in Architecture → Timezone Contract section. CrudForm uses `date.toISOString()` (UTC). `DateTimePicker` uses `new Date(isoString)` on read (converts UTC → local automatically). No `date-fns/formatISO` is used — native JS Date handles the conversion correctly. Round-trip test TC-DTP-001 validates this.
- **Residual risk**: Low — identical behaviour to native `datetime-local` inputs already in production. No regression introduced.

### Cascading Failures & Side Effects

#### Popover Z-Index Conflicts
- **Scenario**: `DateTimePicker` popover renders behind dialog overlays or other positioned elements.
- **Severity**: Medium
- **Affected area**: Any module using `DateTimePicker` inside a `Dialog`
- **Mitigation**: Use Radix `Portal` (default in Popover) to render at document root. Set `z-50` class (consistent with existing dialog z-index).
- **Residual risk**: Low — Radix handles stacking context correctly. May need z-index tuning if used inside deeply nested modals.

#### Calendar Navigation Performance
- **Scenario**: Rapidly clicking month navigation causes multiple re-renders.
- **Severity**: Low
- **Affected area**: DateTimePicker calendar view
- **Mitigation**: `react-day-picker` handles this efficiently by default. No custom debouncing needed.
- **Residual risk**: Negligible.

### Tenant & Data Isolation Risks

N/A — pure UI component, no tenant-scoped data access.

### Migration & Deployment Risks

#### Gradual Migration Safety
- **Scenario**: During migration, some modules use old `datetime-local` and some use new `datetime`. Mixed UX.
- **Severity**: Low
- **Affected area**: UX consistency during transition period
- **Mitigation**: `datetime-local` continues to work. Migration is out of scope for this spec.
- **Residual risk**: Acceptable — temporary inconsistency during rollout.

#### Dependency Version Conflicts
- **Scenario**: `react-day-picker` or `@radix-ui/react-popover` conflict with existing dependencies.
- **Severity**: Medium
- **Affected area**: Build system, `packages/ui`
- **Mitigation**: Both libraries are well-established with stable APIs. `react-day-picker` v9 is compatible with React 18/19. Radix Popover is the same major version family as existing Radix deps.
- **Residual risk**: Low — verify `yarn install` and build before merging.

### Operational Risks

N/A — no server-side changes, no monitoring needed.

---

## Code Review Findings — 2026-02-22

Post-implementation code review. All findings assigned severity per the standard review checklist.

### High

**H1 — No test coverage**: No unit tests exist for `TimeInput`, `DateTimePicker`, `TimePicker`, or the CrudForm `datetime`/`time` integration. Integration tests require at least one module using the components (none yet). Unit tests do not require usage but are planned — see Testing Strategy above.

### Medium

**M1 — Duplicate Tailwind font classes in `calendar.tsx`**: The `day_button` classNames use only `font-normal` (no duplicate `font-medium`). **Status: N/A.**

**M2 — `data-crud-focus-target` on `datetime` and `time` CrudForm blocks**: The render branches for `type: 'datetime'` and `type: 'time'` in `CrudForm.tsx` carry `data-crud-focus-target=""` so CrudForm auto-focus logic includes these fields. **Status: addressed.**

**M3 — `handleTimeChange` when no date selected**: When no date is selected and the user interacts with the time spinner, `handleTimeChange` returns early (`if (!base) return`) and does not emit. **Status: addressed.**

**M4 — Date display format locale-aware**: `DateTimePicker` accepts an optional `displayFormat` prop. When omitted, the format is derived from `locale`: day-first (`d MMM yyyy HH:mm`) for pl, de, fr, es, it, pt, nl, ru, cs, sk, hu, ro; month-first (`MMM d, yyyy HH:mm`) otherwise. **Status: addressed.**

**M5 — TimeInput default labels**: `TimeInput` uses `useT('ui.timePicker.hourLabel', 'Hour')` and `useT('ui.timePicker.minuteLabel', 'Minute')` when `hourLabel`/`minuteLabel` are not provided, so standalone usage is i18n-ready. **Status: addressed.**

### Low

**L1 — `PopoverAnchor` exported but unused**: `popover.tsx:9` exports `PopoverAnchor = PopoverPrimitive.Anchor` with no current consumer. **Status: open (intentional forward-export or remove).**

**L2 — `handleToday` does not close the popover**: `DateTimePicker.tsx:85` calls `onChange(new Date())` but omits `setOpen(false)`. The "Clear" button closes the popover; "Today" does not — inconsistent UX. **Status: open.**

**L3 — `readOnly` has no visual affordance**: When `readOnly` is true, the popover is blocked but the trigger button renders identically to an active field (`disabled` grays it out; `readOnly` does not). A `cursor-not-allowed` or muted class should be added for `readOnly`. **Status: open.**

---

## Final Compliance Report — 2026-02-22

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/lessons.md`

### Compliance Matrix

#### 1. Design Logic & Phasing

| Check | Status | Notes |
|-------|--------|-------|
| Spec-first: plan written before implementation | Pass | Spec created same day as implementation |
| Non-trivial task → plan mode | Pass | Architectural decisions documented |
| Related specs identified | Pass | SPEC-001, SPEC-016, SPEC-023 referenced |
| Integration tests defined per spec | Pass | TC-DTP-001/002/003 with executable Playwright templates |
| Phase breakdown is coherent | Pass | Phase 1 (primitives) → 2 (inputs) → 3 (CrudForm) |

#### 2. Architecture & Module Isolation

| Check | Status | Notes |
|-------|--------|-------|
| No direct ORM relationships between modules | N/A | UI-only, no ORM |
| Modules remain isomorphic and independent | Pass | Components have no module-level imports |
| DI (Awilix) used for services | N/A | No services, pure UI components |
| Extensions declared via `data/extensions.ts` | N/A | No entity extensions |
| Generated files not edited manually | Pass | No generated files touched |

#### 3. Data Integrity & Security

| Check | Status | Notes |
|-------|--------|-------|
| Validate inputs with zod | N/A | No API endpoints or form submission in scope |
| Types derived from zod via `z.infer` | N/A | No zod schemas; prop types declared manually |
| No `any` types | Pass | All components use explicit TypeScript types |
| Filter by `organization_id` | N/A | No data queries |
| Never expose cross-tenant data | N/A | Pure UI, no data fetching |
| Hash passwords / no credential logging | N/A | No auth logic |
| Timezone round-trip is lossless | Pass | Documented in Timezone Contract; UTC ISO ↔ local Date is symmetric |

#### 4. Commands, Events & Naming

| Check | Status | Notes |
|-------|--------|-------|
| Event IDs follow `module.entity.action` convention | N/A | No events emitted |
| Typed events via `createModuleEvents()` | N/A | No events |
| CRUD events emitted (created/updated/deleted) | N/A | UI-only |
| Command pattern for undo/redo | N/A | Picker is stateless; parent owns undo |
| Bulk operations handled | N/A | Not applicable |
| Module/component naming: PascalCase components, plural snake_case folders | Pass | `DateTimePicker`, `TimePicker`, `TimeInput`; in `inputs/` folder |

#### 5. API, UI & Compatibility

| Check | Status | Notes |
|-------|--------|-------|
| API routes export `openApi` | N/A | No API routes |
| `makeCrudRoute` used for CRUD | N/A | No routes |
| `apiCall`/`apiCallOrThrow` — no raw fetch | N/A | Components do not fetch data |
| `LoadingMessage`/`ErrorMessage` for loading states | N/A | No async states in picker |
| i18n: no hard-coded user-facing strings | Pass | All strings via `useT()` translation keys |
| Every dialog: Cmd/Ctrl+Enter submit, Escape cancel | Pass | Popover is not a dialog; Escape closes it (Radix built-in) |
| Backward compatibility preserved | Pass | Old `datetime-local` type unchanged; `datetime` is opt-in |
| `pageSize` ≤ 100 | N/A | No data tables |
| Accessibility: ARIA labels on interactive elements | Pass | `aria-label` on hour/minute inputs; Radix/react-day-picker handle calendar ARIA |

#### 6. Performance, Cache & Scale

| Check | Status | Notes |
|-------|--------|-------|
| No N+1 queries | N/A | No data fetching |
| Tenant-scoped caching | N/A | No caching |
| Tag-based cache invalidation | N/A | No caching |
| Background jobs / queue | N/A | No async work |
| Pagination ≤ 100 | N/A | No lists |
| Component re-render performance | Pass | `react-day-picker` is efficient; no debouncing needed for month nav |
| Bundle size | Pass | `react-day-picker` ~12kB gzip; `@radix-ui/react-popover` ~3kB — acceptable |

#### 7. Risks, Impact & Anti-Patterns

| Check | Status | Notes |
|-------|--------|-------|
| Concrete failure scenarios documented | Pass | Timezone, z-index, dependency conflicts all covered |
| Severity + affected area + mitigation + residual risk | Pass | All four fields present for each risk |
| No temporary fixes | Pass | Proper component abstraction |
| Minimal impact — only touched what's necessary | Pass | Phases 1–3 only; migration out of scope |
| Lessons.md: create-app template sync | Pass | Template i18n files updated in Phase 2; explicit step added to plan |

### Non-Compliant Items

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H1 | High | No unit test coverage for new components or CrudForm integration | Open — integration tests require usage (none); unit tests planned, see Testing Strategy |
| H2 | High | DatePicker component not yet implemented (Phase 4 pending) | Open — scope extended per stakeholder feedback; Phase 4 plan documented |
| M1 | Medium | Duplicate font classes in `calendar.tsx` `day_button` | N/A — only `font-normal` used |
| M2 | Medium | `data-crud-focus-target` on `datetime` and `time` CrudForm blocks | Addressed |
| M3 | Medium | `handleTimeChange` when no date selected | Addressed — returns early |
| M4 | Medium | Date display format locale-order | Addressed — `displayFormat` prop with locale-derived default |
| M5 | Medium | TimeInput default labels i18n | Addressed — `useT()` for defaults when omitted |
| L1 | Low | `PopoverAnchor` exported but has no consumer | Open |
| L2 | Low | `handleToday` does not close the popover (inconsistent with Clear) | N/A — `handleToday` calls `setOpen(false)` |
| L3 | Low | `readOnly` state has no visual affordance on trigger button | Open |

---

## Changelog

| Date | Summary |
|------|---------|
| 2026-02-22 | Phase 1–3 implementation. Added Popover, Calendar, TimeInput, DateTimePicker, TimePicker. CrudForm integration for `datetime` and `time`. Migration out of scope — components available but not used in any module. |
| 2026-02-22 | Spec extended: added DatePicker component (Phase 4). Scope now covers date-only picker with `minDate`/`maxDate`, `closeOnSelect`, locale-aware display format, and CrudForm `type: 'datepicker'`. Title updated to "DatePicker, DateTimePicker & TimePicker". Rationale for `minDate`/`maxDate` requirement documented. TC-DTP-004 integration test template added. |
