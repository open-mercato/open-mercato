# CRM Calendar — full-page Day/Week/Month/Agenda views over customer interactions

## TLDR
**Key Points:**
- A new full-page admin Calendar at `/backend/calendar` (sidebar: first item of the **Customers** group — see UI/UX adaptations; the mockup's "General" group does not exist in the app shell) that renders existing `CustomerInteraction` records — meetings, calls, events, tasks — in four switchable views: **Day, Week, Month, Agenda**.
- Pixel-faithful implementation of the UX mockups in Figma file `oTF1oZoaNgFUdtmxEX2oSc` (*SPEC-048 CRM Detail Pages UX Mockup*), page **Calendar** (`1759:723`): Week `1759:6779`, Day `1761:7917`, Month `1761:8607`, Agenda `1761:9420`.
- **No new entity, no new API route, no schema change.** The calendar is a read view + create/edit dialog over the canonical interactions model (SPEC-046b) and its existing `/api/customers/interactions` route (`from`/`to` range filtering already exists).

**Scope:**
- Calendar page scaffold: header (dynamic title + subtitle + "New event" CTA), toolbar (Today, range presets, jump-to-date range chip, search, filter), category tabs (All Scheduled / Meetings / Events), view switcher (Day | Week | Month | Agenda), shortcuts/timezone footer.
- Week & Day time-grid views with overlap-packing event blocks (title, time, participant avatars, meeting-platform chip, venue/link line), muted past/done styling, hatched non-working day columns.
- Month grid with per-type colored pills and `+N more` overflow; Agenda view with day-grouped rows (time, color bar, title, `Type · Location`, avatars, type badge).
- Upcoming highlight cards (next 4 upcoming items) with status variants: live/today + Join link, conflicted, cancelled, future.
- Conflict surfacing: client-side overlap pairs for grid badges/cards.
- Create/edit via a new **`CalendarEventEditor`** implementing the designer's six typed editor modals (Figma frames `1771:11122/11220/11309/11384/11423/11521` — Meeting/Call/Email/Note/Event/Task variants of one "New event" modal with a type switcher and per-type fields), submitting through the existing interactions API with `useGuardedMutation` + optimistic-lock headers. `ScheduleActivityDialog` (detail pages) ships untouched. Keyboard shortcuts (`T D W M A N / ?`), timezone indicator.

**Concerns (if any):**
- The mockups carry a few design-template artifacts (header CTAs "Schedule" / "Create Request", backward-looking "Last 7 days" preset, 5-column week). Resolved adaptations are documented in **UI/UX → Documented mockup adaptations** — visual style is preserved, semantics are made calendar-correct.
- Month view at scale: list API caps pages at 100 items; the data hook follows cursors with a hard cap (see Risks).

## Overview
CRM users plan their day around scheduled touchpoints — meetings, calls, demos, tasks. Open Mercato already stores all of these as canonical `CustomerInteraction` records (SPEC-046b) with scheduling fields (`scheduledAt`, `durationMinutes`, `allDay`, `location`, `participants`, `status`, `recurrenceRule`), but the only calendar surfaces are per-customer detail widgets (`MiniWeekCalendar`, `ActivitiesDayStrip`). There is no place to see *everything scheduled* across the CRM. This spec adds that page, following UX mockups prepared by the design team after business consultation.

> **Market Reference**: Studied **Odoo CRM** (open-source leader: activity calendar with day/week/month views, type-colored entries, click-to-create) and **Pipedrive's Activities calendar** / **HubSpot Meetings** (commercial canon: activity types, linked contacts/deals, conference-platform chips, conflict hints). Adopted: type-driven colors, view switcher incl. agenda, quick create, "effective date" semantics (done → occurred, planned → scheduled). Rejected: drag-and-drop rescheduling and external calendar sync (Google/Outlook) — neither appears in the mockups; sync belongs to the integrations framework as a future provider package.

## Problem Statement
- Scheduled CRM work is invisible outside individual customer detail pages; users cannot answer "what is happening this week?" without opening records one by one.
- Planned interactions cannot be reviewed per day/week/month, so double-bookings (same owner or participant, overlapping times) go unnoticed.
- Creating a scheduled interaction requires navigating into a specific customer first.

## Proposed Solution
A single new backend page in the **customers module** (which owns the data) — `packages/core/src/modules/customers/backend/calendar/page.tsx` → route `/backend/calendar` — registered as the first item of the **Customers** sidebar group. A thin server `page.tsx` renders a client `CalendarScreen` island that:
1. Computes the visible range from `view + anchorDate` (day/week/month) or an agenda horizon (default next 7 days).
2. Fetches interactions for the range via the existing `GET /api/customers/interactions?from&to` (cursor-following, `apiCall`), org/tenant scoping enforced server-side as today.
3. Derives everything else client-side: category tab counts, conflict pairs, recurrence expansion within the window, upcoming cards.
4. Renders the active view with hand-rolled, DS-token-compliant components that match the Figma mockups.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Page lives in `customers` module | The data is `CustomerInteraction`; placing the page in its owning module avoids cross-module ORM access and keeps the module self-contained. Sidebar: `pageGroup: 'Customers'` with the lowest `pageOrder` in the group — the mockup's "General" group does not exist (no Dashboard sidebar item either; group order is hardcoded in `normalizeGroupWeights()`, `auth/lib/backendChrome.tsx`), and adding one would touch shared auth chrome for zero functional gain. |
| Reuse `CustomerInteraction` + existing API | Fields map 1:1 to the mockups (type, schedule, duration, all-day, location, participants, status, recurrence). `from`/`to` filter on `coalesce(occurred_at, scheduled_at, created_at)` already implements "effective calendar date". No BC surface touched. |
| Hand-rolled view components (no `react-big-calendar`) | Pixel fidelity + DS-token compliance are incompatible with overriding rbc's stylesheet (its CSS was already demoted to a lazy chunk for perf, PR #2856). The existing `ScheduleCalendar` stays untouched for staff scheduling; its `ScheduleItem` model (availability/exception kinds) does not fit interaction rendering (avatars, platform chips, category pills). Week/day overlap packing is a well-understood column-packing algorithm (~80 LOC, unit-tested). |
| Conflict badges client-side; save-time conflict check server-side | Grid/card badges need all-pairs detection over the visible window (trivial client-side, ≤ a few hundred items). The editor reuses the **existing** `/api/customers/interactions/conflicts` endpoint (same one `ScheduleActivityDialog` consumes) for a save-time warning — no new API surface either way. |
| Create/edit via a new `CalendarEventEditor` (designer-specified) | The 2026-06-12 Figma revision added six explicit "Event editor" modal mockups — one unified modal with a Meeting/Call/Email/Note/Event/Task switcher and per-type field morphology (Starts+Ends vs When vs Sent vs Logged vs Due; Location vs Phone/link; Attendees vs To vs single Assignee; Task-only Priority). Restyling the shared `ScheduleActivityDialog` to this design would mutate a maintained detail-page component for zero detail-page benefit; the calendar gets its own editor that submits via the SAME API/commands (`useGuardedMutation`, lock header, conflict check). The earlier plan to extend `ScheduleActivityDialog` was superseded and reverted. |
| Editor field → interaction mapping | `title`←Title/Subject/Note; `entityId`←Related-to person/company (required); `dealId`←Related-to deal chip (optional); `allDay`; `scheduledAt`←Starts/When/Sent/Logged/Due (+time); `durationMinutes`←Ends−Starts (types with an end); `recurrenceRule`←Repeat (Weekly+BYDAY+Never/On date/After ⇒ UNTIL/COUNT — exactly the platform's existing producer subset); `interactionType`←Category dictionary entry when picked, else the active tab kind; `location`←Location/Phone-link; `participants`←Attendees/To (staff + customer contacts per validator support); `ownerUserId`←Task Assignee; `priority`←Task Priority; `body`←Description. All creates are `status: 'planned'` at the chosen datetime. |
| Seed an `event` activity type (additive) | Tabs split Meetings vs Events; `ACTIVITY_TYPE_DEFAULTS` (in `cli.ts`, consumed by `seedCustomerDictionaries`) has no `event` entry. Seeding one (idempotent, additive, appearance color distinct from the existing palette — note `meeting` already owns amber `#f59e0b`) makes the Events tab meaningful on fresh tenants without affecting existing data. Mockup tint colors are illustrative; runtime colors always come from the tenant's dictionary. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| New standalone `calendar` module | Would either duplicate interaction storage or read another module's entity; a view-only module owning no data fails the "modules own their data" smell test and adds DI/ACL/setup surface for zero data value. |
| New `calendar_events` entity | Splits scheduling state into a second source of truth; contradicts SPEC-046b unification which just consolidated activities/todos into interactions. |
| Extending `ScheduleCalendar` (react-big-calendar) | See Design Decisions — CSS override surface, model mismatch, perf regression risk on a shared component used by staff module. |
| Dynamic tab-per-dictionary-type | Mockups fix three tabs (All Scheduled / Meetings / Events); a type→category mapping keeps mockup parity and tolerates custom tenant types (unmapped types appear under All Scheduled). |

## User Stories / Use Cases
- **A sales rep** wants to **see this week's meetings and tasks in a time grid** so that **they can prepare for each appointment**.
- **A sales manager** wants to **spot overlapping meetings for their team** so that **double-bookings get resolved before they happen**.
- **A CRM user** wants to **create a scheduled meeting from the calendar** (picking the related person/company) so that **they don't have to navigate to the customer record first**.
- **A user** wants to **switch Day/Week/Month/Agenda with keyboard shortcuts** so that **navigation is instant**.

## Architecture
```
/backend/calendar (server page.tsx — metadata, translations, shell)
  └─ CalendarScreen ("use client")
       ├─ state: view (day|week|month|agenda), anchorDate, agendaHorizon, tab, search, filters
       ├─ useCalendarItems(range) ── apiCall GET /api/customers/interactions?from&to (+cursor follow)
       │     └─ expandRecurrences(items, range)  (display-only)
       ├─ derive: categories • tabCounts • conflicts • upcomingCards • client search
       ├─ <CalendarHeader/> <CalendarToolbar/> <UpcomingCards/> <CalendarTabs/>
       ├─ view === week|day → <TimeGrid days={1|7}/>   (overlap packing)
       ├─ view === month    → <MonthGrid/>             (pills + "+N more")
       ├─ view === agenda   → <AgendaList/>            (day-grouped rows)
       ├─ <CalendarFooter/> (shortcuts legend + timezone)
       └─ <CalendarEventEditor/> (lazy; six-type modal per Figma 1771:111xx; useGuardedMutation + lock header)
```
Data flow is read-mostly; the only writes go through the existing interactions API (command bus → undo/audit, events `customers.interaction.*` emitted as today). No new commands, no new events, no widget spots, no DI registrations.

### Commands & Events
- Reused, not new: command ids `customers.interactions.create` / `.update` (via POST/PUT route); events already emitted by those commands. The calendar adds **no** new command or event ids.

## Data Models
**No new entities. No migrations.** Read model is `CustomerInteraction` (`packages/core/src/modules/customers/data/entities.ts`): `interactionType`, `title`, `status` (`planned|done|canceled`), `scheduledAt`, `occurredAt`, `durationMinutes`, `allDay`, `location`, `participants` (`{userId,name?,email?,status?}[]`), `recurrenceRule`, `recurrenceEnd`, `appearanceIcon`, `appearanceColor`, `ownerUserId`, `entityId`, `dealId`, `updatedAt`.

### Derived (client-side, pure functions in `lib/calendar/`)
- **Effective start**: `occurredAt ?? scheduledAt` (items with neither are excluded from all calendar views — an interaction without any date has no calendar placement; the API's `createdAt` coalesce only affects which rows are fetched).
- **Effective end**: `start + durationMinutes` (default 30 min when null); `allDay` items render in the all-day lane (week/day) / as pills (month).
- **Category mapping** (`interactionType` → tab/badge): `meeting, call, video-call → meeting`; `event, webinar → event`; `task, todo, deadline → task`; anything else → `other` (All Scheduled only). Mapping is a plain exported const so tenants' custom types degrade gracefully.
- **Conflict**: two items conflict when both are non-`canceled`, time ranges overlap, and they share `ownerUserId` or any `participants[].userId`. Computed over loaded window + upcoming-cards items.
- **Type color**: dictionary `appearanceColor` for the type (fallback chain: item `appearanceColor` → dictionary entry color → neutral).

### Seed addition (additive, idempotent)
`ACTIVITY_TYPE_DEFAULTS` (`packages/core/src/modules/customers/cli.ts`, consumed by `seedCustomerDictionaries`) gains an `event` entry in the `activity-types` dictionary (label "Event", appearance color distinct from existing defaults — `meeting` already owns amber `#f59e0b`) — only inserted when absent, same pattern as existing seeded types. `setup.ts` itself is unchanged.

## API Contracts
**No new endpoints.** Usage contract of the existing routes:
### List interactions for a range
- `GET /api/customers/interactions?from=<iso>&to=<iso>&limit=100[&cursor=…][&interactionType=…][&status=…]`
- `from` is sent padded by −1 day to catch items spanning midnight into the range.
- Client follows `nextCursor` (response shape `{ items, nextCursor }`) until exhausted or a hard cap of **500 items** per window (then a non-blocking notice "Showing first 500 items for this range" — see Risks).
- **Toolbar search is client-side** over the loaded window: interaction `title`/`body` are encrypted at rest (tenant encryption defaults ON), so the route's server-side `?search=` ILIKE cannot match them (documented in the route); list payloads arrive decrypted, making client filtering both correct and cheap.
- Relevant response fields consumed: listed in Data Models (already returned today, incl. `updatedAt` for locking).
### Create / edit
- `POST | PUT /api/customers/interactions` from `CalendarEventEditor` via `useGuardedMutation` (`retryLastMutation` in injection context); create requires `entityId` + `interactionType` (existing validator) → the editor's "Related to" picker supplies `entityId` (+ optional `dealId`).
- Optimistic locking: PUT carries `buildOptimisticLockHeader(item.updatedAt)`; 409 surfaced via `surfaceRecordConflict(err, t)`.
### Conflict check (editor)
- Existing check at `/api/customers/interactions/conflicts` (same endpoint `ScheduleActivityDialog` consumes) warns about overlapping items at save time. Grid badges/cards use the client-side pair detection instead (different problem: all-pairs over a window vs candidate-vs-existing).
### Supporting reads
- Activity-type dictionary: same endpoint/hook the detail pages use for `activity-types` (labels + colors for tabs/pills/legend).
- Participant/owner names for avatars: `participants[].name` (stored) with `/api/staff/team-members/assignable` (existing `fetchAssignableStaffMembers`) only inside the dialog's participant picker — the grid renders avatars from stored participant names (no N+1 lookups).

## Internationalization (i18n)
All new strings under `customers.calendar.*` in `packages/core/src/modules/customers/i18n/{en,de,es,pl}.json`. Key groups: `nav` (sidebar/breadcrumb), `header` (title formats, subtitle counts — ICU-style plurals via existing t() params), `toolbar` (today, presets, search placeholder, filter), `tabs`, `views` (day/week/month/agenda), `grid` (allDay lane, more count), `cards` (join, seeConflict, cancelled, conflictedCount, daysLater), `agenda` (today/tomorrow markers, eventsCount), `dialog` (field labels, validation), `shortcuts` (legend + help dialog), `footer.timezone`, `empty` states, `errors`. No hardcoded user-facing strings; internal throws prefixed `[internal]`.

## UI/UX
**Source of truth:** Figma `oTF1oZoaNgFUdtmxEX2oSc` page *Calendar*; frames: Week `1759:6779`, Day `1761:7917`, Month `1761:8607`, Agenda `1761:9420` (each: `Sidebar` 280px — existing app shell, out of scope — and `main` 1160px: `1759:6837`, `1761:7975`, `1761:8665`, `1761:9478`). Implementers MUST pull `get_design_context` for the `main` frames and match spacing/typography/radii exactly. Mockup variables map onto the app DS: Inter; `Label/Small` 14/20 −0.006em; `Paragraph/X Small` 12/16; `Subheading/2X Small` 11/12 ls-2 uppercase (grid column headers); borders `#e5e5e5`/soft `#ebebeb` → `border-border`/`border-soft`-equivalent tokens; text `#171717`/`#5c5c5c`/`#a3a3a3`/`#737373` → foreground/sub/soft/muted tokens; state colors success `#16a34a`+`#f0fdf4`, warning `#d97706`+`#fffbeb`, error `#dc2626`+`#fef2f2` → `{property}-status-{status}-{role}` tokens; radii 4/6/8/10/12/full → DS scale. Event tints (e.g. `blue/200 #c7d2fe`, `yellow/200 #ffecc0`) are **data-driven** type colors (dictionary `appearanceColor`) applied via inline style with soft-tint derivation, exactly like existing activity timeline appearance colors — never hardcoded Tailwind color classes.

### Common chrome (all four views)
- **Header** (per the 2026-06-12 Figma revision, which REMOVED the icon square and subtitle): title only — Day & Week → `MMM dd, yyyy`; Month → `MMMM yyyy`; Agenda → "Upcoming". Right: primary CTA **"+ New event"** (dark primary button, radius-10).
- **Toolbar**: `Today` button · range preset select (This week / Next 7 days / This month / Next 30 days — sets view+anchor) · range chip with calendar icon showing the computed visible range, click opens DatePicker to jump anchor · right side: search input (kbd hint `/`; filters the loaded window client-side — see API Contracts) · `Filter` button opening a popover (type multi-select, status, owner) with active-count badge.
- **Upcoming cards**: next 4 upcoming non-cancelled… **correction**: next 4 upcoming items by effective start ≥ now (cancelled ones included to surface the Cancelled state, matching mockup); card = title, time range, chevron menu (Open, Edit, Cancel), status strip: *today* → green `Today` + `Join Meeting` link when `location` is a URL/platform; *conflicted* → warning `{n} Conflicted` + `See Conflict` (navigates to that time in week view and pulses the involved blocks); *cancelled* → error `Cancelled` + date; *future* → neutral relative time (`3 days later`) + date.
- **Tabs**: `All Scheduled` (grid icon) / `Meetings (n)` / `Events (n)` — counts from the loaded window after search/filter; underline-style active state per mockup. Right-aligned view switcher: segmented `Day | Week | Month | Agenda`.
- **Footer bar**: kbd legend `T Today · D Day view · W Week · M Month · A Agenda · N New event · / Search · ? Shortcuts` + right-aligned resolved timezone "Europe/Warsaw (GMT+2)" (from `Intl.DateTimeFormat` resolved options; display-only).
- **States**: loading via `LoadingMessage`/skeleton rows; error via `ErrorMessage`; empty ranges get per-view `EmptyState` (e.g. "Nothing scheduled this week") with a New event action.

### Week & Day views (TimeGrid)
- Sticky day-header row: `dd EEE` uppercase (`04 MON`) `Subheading/2X Small`; prev/next chevron pair at the gutter corner; Day view header `EEEE — dd`.
- Time gutter labels `9 AM` … (Paragraph/X Small, soft); hour rows ≈ 84px per Figma; half-hour hairlines soft.
- Event block: radius-6, 1px gap stacking, soft type-tinted background, title `Label/X Small` strong, time `Paragraph/X Small` sub; optional bottom meta row: `AvatarStack` (xs, max 3 + `+N`) and right-aligned platform chip (`on Zoom` / `on Meet` / `on Slack` derived from `location` matching known platforms; 🌐-style icon + truncated link for URLs; pin icon + `Venue: …` for physical locations). Past/done items render muted (faded background, sub text); `canceled` items render struck-through title + faded.
- Overlapping items column-pack side-by-side (equal widths within the overlap cluster).
- All-day lane between header and grid when all-day items exist in range.
- **Non-working days** (Sat/Sun): column background uses the Figma diagonal hatch treatment (taken from frame `1759:6779`'s hatched column).
- Week starts Monday; 7 columns (see adaptations).

### Month view (MonthGrid)
- 7-column MON–SUN header (`Subheading/2X Small` uppercase); 5–6 week rows ≈ 86px height; out-of-month day numbers soft; today = filled dark circle badge on the day number.
- Items as single-line pills: tinted background (type color), centered dot + UPPERCASE truncated title `Label/X Small`; max 2 pills per cell then `+N more` (soft text button → switches to Day view on that date).
- Cell click on empty space → Day view for that date; pill click → edit dialog.

### Agenda view (AgendaList)
- Sticky-ish day group headers: `EEEE, MMM d` strong + `· Today/Tomorrow` marker + `{n} events` right-soft, on `bg-weak` band.
- Rows: time column (start strong, end below soft) · 3px rounded type-color bar · title `Label/Small` strong with subtitle `Type · Location` soft · right: `AvatarStack` (xs) + category badge (`MEETING` info-tint / `EVENT` warning-tint / `TASK` neutral-dark) uppercase `Label/X Small`.
- Horizon: anchor + `agendaHorizon` (default 7 days, presets can extend); groups only for days with items; row click → edit dialog.

### Create/Edit — CalendarEventEditor (designer-specified, Figma `1771:11122/11220/11309/11384/11423/11521`)
One 440px modal (`rounded-[16px]`, heavy drop shadow, Modal Header "New event" + close, Body `px-[24px] py-[22px] gap-[18px]`, Modal Footer Cancel/"Save event") with a joined **type switcher** (Meeting | Call | Email | Note | Event | Task; active segment `bg-weak` + strong text) morphing the field set:
| Field | Meeting | Call | Email | Note | Event | Task |
|---|---|---|---|---|---|---|
| Title label | Title | Title | Subject | Note | Title | Title |
| Related to (person/company chip + optional deal badge chip) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| All day toggle | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Date/time | Starts + Ends (date select + 120px time input each) | When (single) | Sent (single) | Logged (single) | Starts + Ends | Due (single) |
| Repeat (freq select + 36px M–S day pills + Ends: Never/On date/After) | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Category (select rendering the activity-types dictionary entry as an uppercase tinted pill) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Location/contact | Location (map-pin, URL/venue) | Phone / link | — | — | Location | — |
| People | Attendees (multi chips: staff + customer w/ CUSTOMER badge) | Participants (same) | To (recipients) | — | Attendees | Assignee (single staff) |
| Priority (Low/Med/High button group) | — | — | — | — | — | ✓ |
| Description textarea | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
Behavior: Cmd/Ctrl+Enter submit, Escape cancel; create defaults to the calendar's anchor date; edit mode opens with the item's type tab active and fields prefilled; save-time server conflict warning (existing endpoint) shown non-blocking; success → flash + window refetch. Deletion is not in the editor (not mocked); cards' Cancel action sets `status: canceled` via the same guarded PUT. Field-mapping per the Design Decisions table; `status` is always `planned` on create.

### Keyboard shortcuts
Page-scoped `keydown` listener (ignores events from inputs/dialogs): `t` today, `d/w/m/a` views, `n` new event, `/` focus search, `?` opens a small shortcuts dialog mirroring the legend. Listener detaches on unmount; no global registry changes.

### Settings / Customization modal (Figma `1788:3701`, added 2026-06-13)
The toolbar gear (previously omitted — see adaptations) now opens a **Customization** modal (`rounded-2xl`, header "Customization" + "Customise your calendar module." + close, body, footer Cancel / **Save Changes**). It is a per-user **view-preference** panel, persisted to **localStorage** scoped by user id (mirrors the approved `deals/pipeline` lane-width pattern) — **no new entity, API, or migration**, consistent with the spec's premise. Contents:
- **Event Categories** (max 8) — `TagInput`; user-defined grouping labels offered as quick category options in the editor. Starts empty (the Figma example chips are illustrative).
- **Activity Types** (max 6) — `TagInput`; **seeded from the tenant `activity-types` dictionary** on first open, used as the editor's category quick-pick set. Editing it personalizes the per-user pick list only — it **never mutates the shared tenant dictionary** (which keeps its own admin surface) and never hides existing events.
- Four `Switch` toggles wired to real behavior: **Show CRM activities on calendar** (default on; off → only `meeting`/`event` categories render), **AI summaries & quick actions** (default on; gates the peek popover's meta-summary line + Join quick action), **Conflict warnings** (default on; gates conflict rings, the inline "N conflicts" badge, and the conflicted upcoming-card variant), **Show weekends** (default **off** → week renders Mon–Fri; on → Mon–Sun with the existing non-working hatch).

### Week-view states (Figma `1786:2934`, added 2026-06-13)
- **Empty**: per-view `EmptyState` gains a description ("Plan a meeting, event or task to fill your week.") and a **New event** action (gated by `customers.interactions.manage`).
- **Loading**: initial load keeps `LoadingMessage` (skeleton-grid is a documented future refinement; non-blocking).
- **Hover · selected**: clicking a time-grid block selects it (2px `ring-foreground` + shadow) and opens an `EventPeekPopover` (title, `EEE, MMM d · h:mm` range, optional meta "platform · N attendees", **Join** when joinable, **Edit**). Edit opens the full editor; the peek replaces the previous click-opens-editor-directly behavior on the time grid (month/agenda still open the editor directly).
- **Conflict**: each time-grid column with conflicting blocks shows an inline error-tint **"N conflicts"** badge (in addition to the per-block ring), gated by the Conflict warnings toggle.
- **Drag to create**: pointer-drag on empty grid space draws a dashed preview block and, on release, opens the create editor with the dragged date + start/end prefilled (snapped to 15-minute steps, min 30 minutes). Drag-to-**create** only — drag-to-reschedule remains out of scope. Gated by `customers.interactions.manage`.

### Documented mockup adaptations (deliberate, business-logic-driven)
| Mockup artifact | Decision |
|---|---|
| Header CTAs `Schedule` + `Create Request` | Design-template carryover; replaced by a single primary **"+ New event"** (the mockup's own footer legend defines `N New event`). Visual style of the primary button preserved. |
| Sidebar group `GENERAL` with a `Dashboard` item above Calendar | The app shell has no "General" sidebar group and no Dashboard sidebar item (logo navigates to `/backend`); group order is hardcoded in shared auth chrome. Calendar registers as the **first item of the Customers group** instead — no shared-chrome modification. |
| Toolbar preset `Last 7 days` (backward) | Forward-looking calendar presets (This week / Next 7 days / This month / Next 30 days). Same select styling. |
| Week view shows 5 columns (04 MON–08 FRI, FRI hatched) with header range `Feb 04 – Feb 11` | Inconsistent demo data (Feb 04 2024 was a Sunday). Implemented as a Monday-start **7-day week**; the hatch treatment is applied to non-working days (Sat/Sun). Keeps every event visible; preserves the hatch visual language. |
| Toolbar gear icon | Now wired to the **Customization** modal added in the 2026-06-13 Figma revision (`1788:3701`) — see the Settings / Customization subsection. (Was omitted in v1 when the gear had no defined behavior.) |
| Settings persistence not specified in the mockup | View preferences (toggles + the two tag lists) persist to per-user **localStorage**, not a new server entity/API — keeps the spec's "no new entity/API/migration" premise. Tag lists personalize the editor's category pick list only and never mutate the tenant dictionary. Documented for review; a server-backed/tenant-wide settings store is clean future work. |
| "AI summaries & quick actions" toggle has no dedicated mocked affordance | Wired to the peek popover's meta-summary line + Join quick action (default on). LLM-generated summaries are future work behind the same flag — no new dependency added. |
| Topbar/sidebar (Acme tenant, AI chips, Reservations NEW…) | Existing app shell; not part of this feature. |
| Search kbd hint `⌘1` | Uses `/` per the mockup's own footer legend. |

## Frontend Architecture Contract
### Server/Client Boundary Map
| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/calendar` | `backend/calendar/page.tsx` (server: metadata, `resolveTranslations`, shell) | `CalendarScreen` (orchestrator), lazy `InteractionDialog` | existing interactions API via `apiCall` | No page-root `"use client"`; view leaves are plain client children of `CalendarScreen` |

### "use client" Ledger
| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/calendar/CalendarScreen.tsx` | stateful view/anchor/tab state, data fetching, keydown listener | server page | none (date-fns only, already in tree) | keydown listener removed on unmount | RSC — calendar is inherently interactive |
| `components/calendar/CalendarEventEditor.tsx` (lazy-mounted) | typed create/edit modal (form state, guarded mutations) | CalendarScreen (`next/dynamic`) | none new | none | extending `ScheduleActivityDialog` — would mutate a maintained detail-page component into a different design |
View leaves (`TimeGrid`, `MonthGrid`, `AgendaList`, `UpcomingCards`, `CalendarToolbar`, …) are client components by inheritance (no own `"use client"` directive needed) — each ≤ ~250 LOC.

### Client Blob Guardrail & Budgets
| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client page/root files over 300 LOC | 0 unless justified | 0 (CalendarScreen split into leaves; each ≤ ~250 LOC) |
| Heavy browser libraries at page/provider root | 0 | 0 (**no** react-big-calendar, no new deps) |
| Per-route hydration smoke test | required | Playwright TC-CAL-002 loads `/backend/calendar`, asserts grid + interacts |
| Performance evidence | static + one runtime signal | `yarn check:client-boundaries` + `yarn build:app` route size note in PR |

### Provider / Bootstrap Scope
None touched. No global providers, no bootstrap registry changes.

## Configuration
None. No env vars, no settings.

## Migration & Compatibility
- **DB**: none.
- **Seeds**: additive `event` entry in `activity-types` dictionary defaults (skipped when present).
- **BC surfaces** (per `BACKWARD_COMPATIBILITY.md` categories): no type/signature/import-path/event-id/spot-id/DB/DI/CLI changes. Additive only: new backend page route `/backend/calendar` (new surface), new i18n keys, new module-internal components. Existing `MiniWeekCalendar`/detail pages untouched. The interactions API is consumed, not modified.
- **RBAC**: page gated by existing `customers.interactions.view`; dialog mutations already gated by `customers.interactions.manage` server-side (CTA hidden without it via existing feature-check helpers).

## Implementation Plan
Reference implementations: page+meta `backend/customer-tasks/page.{tsx,meta.ts}`; screen composition `backend/customers/deals/page.tsx`; data calls `apiCall`; appearance colors: activity timeline components.

### Phase 1 — Scaffold & data plumbing
1. `backend/calendar/page.meta.ts` (requireAuth, `customers.interactions.view`, `pageGroup: 'Customers'` + existing `customers.nav.group` key, lowest `pageOrder` in the group, calendar icon, breadcrumb) + server `page.tsx`.
2. `lib/calendar/` pure utils: `range.ts` (view→range math, Monday weeks, padding), `categories.ts` (mapping + counts), `conflicts.ts`, `recurrence.ts` (window expansion; **local minimal RRULE subset matching what the platform's only producer — `ScheduleActivityDialog.buildRecurrenceRule` — emits: `FREQ=DAILY|WEEKLY` + `BYDAY` + `COUNT`/`UNTIL`**; `expandRecurringItems` from packages/ui ignores `BYDAY` and targets a different item shape, so it is not reused) — **with unit tests** (`__tests__/`).
3. `useCalendarItems` hook (range fetch + cursor follow + cap + refetch).
4. `CalendarScreen` shell: header, toolbar (Today/presets/range chip), tabs, view switcher, footer; views stubbed; i18n keys (all 4 locales); `yarn generate`.
   *Exit: page renders with chrome + empty states; unit tests green.*

### Phase 2 — TimeGrid (Week + Day)
5. `TimeGrid` (days=7|1): sticky headers, gutter, hour grid, all-day lane, hatched non-working columns, overlap packing, `EventBlock` (tints, avatars `AvatarStack`, platform/venue/link chips, muted past/done, struck cancelled), block click → dialog (Phase 5 wires create; until then no-op view).
   *Exit: week/day pixel-pass vs Figma `1759:6837`/`1761:7975`.*

### Phase 3 — MonthGrid + AgendaList
6. Month cells, pills, `+N more` → day-view jump, today badge.
7. Agenda day groups + rows per mockup.
   *Exit: month/agenda pixel-pass vs `1761:8665`/`1761:9478`.*

### Phase 4 — Upcoming cards, conflicts, search & filter
8. `UpcomingCards` with 4 status variants; conflict detection wiring (`See Conflict` navigates + pulses); search (server `search` within window, debounced) + filter popover (type/status/owner); tab counts react to filters.
   *Exit: conflicts visible for overlapping fixtures; cards match mockup.*

### Phase 5 — CalendarEventEditor + shortcuts + footer polish
9. Build `CalendarEventEditor` per the six Figma editor frames (type switcher, per-type fields, Related-to person/company+deal picker, staff+customer attendees, recurrence builder, category pill select, task priority/assignee); submits via `useGuardedMutation` (+ lock header on PUT, conflicts endpoint warning); lazy-mount from `CalendarScreen` for create (header CTA / `N`) and edit (block/row/card click).
10. Keyboard shortcuts + `?` help dialog; timezone footer.
    *Exit: full create→render→edit loop works.*

### Phase 6 — Integration tests, DS pass, docs
11. Implement Integration Test Coverage below; `om-ds-guardian` pass on touched UI; spec changelog + Implementation Status update.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/backend/calendar/page.meta.ts` | Create | Route metadata, ACL, sidebar (General), icon, breadcrumb |
| `packages/core/src/modules/customers/backend/calendar/page.tsx` | Create | Server shell + translations |
| `packages/core/src/modules/customers/components/calendar/CalendarScreen.tsx` | Create | Client orchestrator (state, data, derivations, layout) |
| `…/components/calendar/{CalendarHeader,CalendarToolbar,UpcomingCards,CalendarTabs,TimeGrid,EventBlock,MonthGrid,AgendaList,CalendarFooter,ShortcutsDialog,CalendarEventEditor}.tsx` | Create | View leaves + typed editor per UI/UX (`ScheduleActivityDialog` stays untouched) |
| `…/components/calendar/useCalendarItems.ts` | Create | Ranged fetch hook (cursor follow, cap, refetch) |
| `…/components/calendar/CalendarSettingsModal.tsx` | Create | Customization modal (tag inputs + four preference toggles) per Figma `1788:3701` |
| `…/components/calendar/useCalendarPreferences.ts` | Create | localStorage-backed per-user calendar preferences hook |
| `…/components/calendar/EventPeekPopover.tsx` | Create | Time-grid block peek popover (title/date·time/meta, Join/Edit) per Figma `1786:2934` |
| `…/lib/calendar/preferences.ts` | Create | Preference defaults, merge/normalize, storage key (+ unit tests) |
| `…/lib/calendar/grid.ts` | Create | Weekend visibility + drag-to-create time math (+ unit tests) |
| `packages/core/src/modules/customers/lib/calendar/{range,categories,conflicts,recurrence}.ts` | Create | Pure derivation utils |
| `packages/core/src/modules/customers/lib/calendar/__tests__/*.test.ts` | Create | Unit tests for the four utils |
| `packages/core/src/modules/customers/cli.ts` (`ACTIVITY_TYPE_DEFAULTS`) | Modify | Additive `event` default activity type |
| `packages/core/src/modules/customers/i18n/{en,de,es,pl}.json` | Modify | `customers.calendar.*` keys |
| `packages/core/src/modules/customers/__integration__/TC-CAL-*.spec.ts` | Create | Integration coverage below |

### Testing Strategy
- **Unit** (jest, module-local): range math (Monday weeks, month grids incl. DST boundaries), category mapping (custom types → other), conflict pairs (owner overlap, participant overlap, cancelled excluded, touching-not-overlapping), recurrence windowing, platform-chip derivation from `location`.
- **Integration** (Playwright): see below.
- **Manual/preview**: pixel pass against the four Figma frames at 1440px.

## Integration Test Coverage (required)
Self-contained Playwright specs in `packages/core/src/modules/customers/__integration__/` (API fixtures created in setup, cleaned in teardown; no seeded-data reliance):
- **TC-CAL-001 — API range read**: create person + three interactions via API (planned meeting tomorrow 10:00–11:00, done call yesterday, planned task next week); `GET /api/customers/interactions?from&to` window returns exactly the in-range items with `scheduledAt/durationMinutes/participants/updatedAt`; 401 unauthenticated; 403 for a user without `customers.interactions.view`.
- **TC-CAL-002 — page load & week grid (hydration smoke)**: `/backend/calendar` renders header, tabs, switcher, footer; fixture meeting visible as a week-grid block with title + time; sidebar shows Calendar in the Customers group.
- **TC-CAL-003 — view switching & navigation**: switcher and `D/W/M/A` keys swap views (day column header, month pill, agenda row all show the fixture); `T` returns to today; prev/next chevrons shift the visible range label.
- **TC-CAL-004 — tabs & filtering**: fixtures of types meeting + event + task; Meetings/Events tab counts correct; activating Meetings hides the event pill; search narrows to a fixture by title.
- **TC-CAL-005 — create via editor**: `N` opens the editor; switch type tab (field set morphs — e.g. Task shows Due + Priority); fill title/Related-to person/date/time; save; flash shown; new block appears in the grid without reload; teardown deletes it.
- **TC-CAL-006 — conflict surfacing**: two overlapping planned meetings sharing owner → upcoming card shows `Conflicted` badge and `See Conflict` navigates to the overlap time.
- **TC-CAL-007 — settings/customization modal** (Figma `1788:3701`): the toolbar gear opens the Customization modal (Event Categories + Activity Types tag inputs seeded from the activity-types dictionary, four toggles); toggling **Show weekends** ON + Save makes the week render 7 day-columns (Sat/Sun appear); the preference survives a page reload (localStorage, per-user scope); Cancel discards an unsaved toggle change.
- **TC-CAL-008 — week-view states** (Figma `1786:2934`): clicking a time-grid event block opens the peek popover (title, date · time, **Edit**; **Join** only when the location is a URL and AI summaries are on) and marks the block selected; **Edit** opens the editor in edit mode; a drag on empty grid space opens the create editor with the dragged start/end prefilled; with two overlapping planned meetings the column shows the inline **"N conflicts"** badge, which disappears when **Conflict warnings** is toggled off.
- **TC-CAL-009 — editor conflict detection**: two overlapping planned meetings sharing an owner; opening the editor on one surfaces the **"Overlaps with: …"** warning naming the other — verifying the editor's conflict warning uses the same `findConflicts` rules as the grid badges/rings.

## Risks & Impact Review
### Data Integrity Failures
- Read-only views cannot corrupt data. Writes go through the existing command-backed API (transactional, undo-integrated). Dialog edit conflicts are covered by the default optimistic-lock header + conflict bar.

### Cascading Failures & Side Effects
- No new events/subscribers. A failing dictionary fetch degrades to neutral colors (UI fallback, non-blocking).

### Tenant & Data Isolation Risks
- All reads/writes ride the existing interactions route, which already enforces tenant/org scope + email-visibility filtering server-side. The page adds no query surface of its own.

### Migration & Deployment Risks
- No migrations. Seed change is insert-if-absent. Rollback = remove page files.

### Operational Risks
- Blast radius: the new route only. No shared component is modified.

### Risk Register
#### Large ranges exceed the fetch cap
- **Scenario**: A month window holds > 500 interactions; cursor-following stops at the cap and some items are not rendered.
- **Severity**: Medium
- **Affected area**: Month view completeness for very active tenants.
- **Mitigation**: Hard cap with an explicit on-page notice ("Showing first 500…"), counts labelled accordingly; week/day windows are far below the cap.
- **Residual risk**: Month pill counts may undercount for extreme tenants — acceptable for v1; server aggregation endpoint listed as future work.
#### Recurrence expansion mismatch
- **Scenario**: Client RRULE expansion disagrees with future server-side expectations (e.g. complex BYDAY rules unsupported).
- **Severity**: Low
- **Mitigation**: Expansion limited to display; unsupported rules render the base occurrence only; unit tests pin supported subset (DAILY/WEEKLY + interval + until/count).
- **Residual risk**: Exotic rules show fewer occurrences — acceptable, matches current platform behavior (nothing expands them today).
#### Mockup-data ambiguities mis-resolved
- **Scenario**: An adaptation (7-day week, CTA naming, presets) contradicts the designer's intent.
- **Severity**: Low
- **Mitigation**: Every adaptation is documented in UI/UX with rationale; all are presentation-level and reversible in minutes.
- **Residual risk**: Possible follow-up tweak PR — acceptable.
#### Timezone display vs stored timestamps
- **Scenario**: Users in different timezones see shifted blocks and blame data.
- **Severity**: Low
- **Mitigation**: All rendering uses the browser timezone and says so in the footer (mockup behavior). Storage stays UTC.
- **Residual risk**: No per-user tz preference exists platform-wide — out of scope here.

## Final Compliance Report — 2026-06-11
### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — Task Router rows: Module Development, API Routes (consumption), Backend pages/DataTable/CrudForm, Optimistic locking, Integration tests, DS rules
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Single-module feature; avatars via existing staff API |
| root AGENTS.md | Tenant/org scoping on all data access | Compliant | Reuses scoped interactions route exclusively |
| root AGENTS.md | `apiCall`, never raw fetch | Compliant | Hook uses `apiCall`; editor mutations via `useGuardedMutation` |
| root AGENTS.md | Optimistic locking default ON | Compliant | Editor PUTs send `buildOptimisticLockHeader(updatedAt)` + `surfaceRecordConflict`; API returns `updatedAt` |
| root AGENTS.md | No hardcoded user-facing strings | Compliant | `customers.calendar.*` across en/de/es/pl |
| root AGENTS.md | Dialogs: Cmd/Ctrl+Enter submit, Escape cancel | Compliant | CrudForm dialog + shortcuts dialog |
| root AGENTS.md | `pageSize` ≤ 100 | Compliant | limit=100 + cursor follow |
| DS rules | No hardcoded status colors / arbitrary values / `dark:` on tokens | Compliant | Editor controls use shared primitives and token classes; data-driven type tints remain inline by dictionary color |
| DS rules | lucide icons, no inline `<svg>` in page body | Compliant | lucide-react throughout (page.meta icon follows existing meta convention) |
| core AGENTS.md | API routes export openApi | N/A | No new routes |
| customers AGENTS.md | Commands for mutations + undo | Compliant | Reuses existing command-backed route |
| spec skill | Encryption maps for sensitive columns | N/A | No new columns; reads via existing route (decryption server-side) |
| spec skill | Frontend Architecture Contract | Compliant | Section included above |
| .ai/qa/AGENTS.md | Self-contained integration tests in same change | Compliant | TC-CAL-001…006 defined + Phase 6 |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Read fields ⊆ existing list payload |
| API contracts match UI/UX section | Pass | All UI data derivable from listed fields |
| Risks cover all write operations | Pass | Single write path (dialog) covered |
| Commands defined for all mutations | Pass | Existing `customers.interactions.*` reused |
| Cache strategy covers all read APIs | Pass (N/A) | No new read APIs; client refetch on window/mutation |

### Non-Compliant Items
None.

### Verdict
- **Implemented**: ready for final verification after branch-level template parity and live UI QA.

## Implementation Status
- [x] Phase 1 — Scaffold & data plumbing (page.meta/page, lib utils + 90 unit tests, useCalendarItems, i18n ×4)
- [x] Phase 2 — TimeGrid (Week + Day) (Figma-exact: 120px hour rows, hatch via color-mix, overlap packing)
- [x] Phase 3 — MonthGrid + AgendaList (pills + "+N more", day groups, status-token badges)
- [x] Phase 4 — Upcoming cards, conflicts, search & filter (client search per encrypted-field constraint)
- [x] Phase 5 — CalendarEventEditor (six typed variants per 2026-06-12 Figma revision) + shortcuts + footer
- [ ] Phase 6 — Final verification gate (TC-CAL-001…006 specs are present; live Playwright run, visual QA, and branch-level template parity remain final QA steps)
- [x] Phase 7 — 2026-06-13 Figma revision: Customization modal (`1788:3701`) + week-view states (`1786:2934`) — peek popover, inline conflict badge, drag-to-create, enriched empty state, four wired preference toggles; new unit tests (preferences, grid) green; TC-CAL-007/008 added; preview-verified (settings modal, 5-day-week default, peek + selected ring, conflict badges)

## Changelog
### 2026-06-11
- Initial specification (Figma `oTF1oZoaNgFUdtmxEX2oSc` page `1759:723`; mockup adaptations documented; no schema/API changes).
- Pre-implement audit corrections applied (`.ai/specs/analysis/ANALYSIS-2026-06-11-crm-calendar.md`): sidebar group Customers (no "General" group exists), client-side search (encrypted title/body), local RRULE subset incl. `BYDAY` (producer: `ScheduleActivityDialog.buildRecurrenceRule`), reuse + extend `ScheduleActivityDialog` (existing `/api/customers/interactions/conflicts` check), seed lives in `cli.ts` `ACTIVITY_TYPE_DEFAULTS`.

### 2026-06-12
- Figma revision absorbed (designer added modals + adjustments): six "Event editor" frames (`1771:11122/11220/11309/11384/11423/11521`) specify a unified typed create/edit modal → new `CalendarEventEditor` component (per-type field morphology, Related-to person/company+deal, staff+customer attendees, task priority/assignee); the planned `ScheduleActivityDialog` extension was superseded and reverted (component ships untouched). Page header simplified in all four views (icon square + subtitle line removed).
- Implemented through review fixes. Visual-verification fixes: stronger weekend hatch, "This week" initial preset, singular "1 day later"/"1 event", agenda platform display names (Google Meet/Zoom/…), visible-range re-filter so fetch padding never leaks into counts/cards, month grid stretches to fill the view area. Review fixes: conflicts computed over the pre-tab filtered window; "New event"/edit affordances hidden without `customers.interactions.manage` (feature-check + shared wildcard matcher); undated interactions documented as excluded from all views.
- Cross-model review fixes (Codex 5.5 xhigh, both confirmed real): editor conflict probe now unwraps the conflicts endpoint's `{ok, result}` envelope (warning never displayed before; note — `ScheduleActivityDialog` carries the same pre-existing dormant bug, flagged for a separate fix); recurrence expansion treats `recurrenceEnd` (stored as UTC midnight of the until-date) as inclusive end-of-day so the final occurrence is no longer dropped (regression test added). Client search additionally matches the description body.
- Responsive overhaul (Google/Outlook mobile patterns; verified at 390/1440 px against a ~280-event dataset): phones default to Day view; toolbar stacks (Today + range row, full-width search + icon filter; preset hidden); upcoming cards become a snap carousel; week grid scrolls horizontally with sticky time gutter/header corner (rows span content width — sticky-in-flex parent-clamp fix) and 120px column floors; month cells render color dots + "+N" with single-letter weekday header; agenda hides avatars and tightens columns; editor opens as a full-screen sheet; shortcuts footer hidden on touch. Participant avatars de-overlapped everywhere (agenda: max 2 separated circles + "+N" text; data-level de-dupe of duplicate participant userIds fixing React key collisions). Manual QA (Opus agent, 19-area pass over all flows incl. all six editor types end-to-end): two findings fixed — weekly-recurrence day pills now follow the start date instead of today (BYDAY correctness, unit-tested) and the mobile sticky gutter; everything else passed with zero functional console errors.

### 2026-06-13
- Absorbed the designer's later Figma additions — two new frames: **Calendar settings / Customization modal** (`1788:3701`) and **Calendar / Week view — states** (`1786:2934`).
- **Customization modal** (`CalendarSettingsModal` + `useCalendarPreferences`): per-user view preferences persisted to localStorage (no new entity/API/migration). Event Categories (max 8) + Activity Types (max 6, seeded from the `activity-types` dictionary, non-destructive) tag inputs, and four wired toggles — Show CRM activities (category filter), AI summaries & quick actions (peek meta-summary + Join), Conflict warnings (rings/badge/card gating), Show weekends (week Mon–Fri ↔ Mon–Sun, default off). Opened from a new toolbar gear (previously omitted).
- **Week-view states**: `EventPeekPopover` on time-grid block select (title, date·time, meta, Join/Edit) with a 2px selected ring; inline per-column "N conflicts" badge; pointer **drag-to-create** (15-min snap, ≥30-min, opens the editor with the range prefilled via a new `createDefaultFormState` range arg + editor `defaultRange` prop); enriched empty state (description + New event action).
- New pure helpers `lib/calendar/{preferences,grid}.ts` with unit tests (18 cases). New i18n keys `customers.calendar.{settings,peek}.*` + `grid.conflict(s)Count` + `empty.description` across en/de/es/pl. Integration coverage TC-CAL-007 (settings) and TC-CAL-008 (week-view states) added. Decisions (localStorage persistence, non-destructive tag lists, AI-toggle wiring) documented in Documented mockup adaptations; preview-verified at 1440px.
- Review-feedback fixes: (1) the Customization settings modal showed a **double close (X)** — it rendered its own header X on top of `DialogContent`'s auto X; added `dismissible={false}` (matching `CalendarEventEditor`) so only the header X remains. (2) **Editor conflict detection was inconsistent with the grid** — the save-time probe used the `/interactions/conflicts` endpoint, which scopes overlaps to the *current user's* authored/owned events and ignores participants, so conflicts the grid shows (shared owner *or* participant) were often not surfaced in the editor. The editor now detects conflicts client-side with the **same `findConflicts` rules as the grid** (extracted into `findEditorConflictItems`, unit-tested) against a freshly-fetched ±1-day window, keyed on the edited event's owner (or the current user for new events) + its participants. The shared `/interactions/conflicts` endpoint is left untouched (still used by `ScheduleActivityDialog`). New unit suite `editorConflicts.test.ts` (owner/participant match, no-overlap, exclude-self, canceled) + integration test TC-CAL-009.
- Cross-model review (Codex 5.5 xhigh) fixes — three real defects the in-family review missed, all caught by Codex: (1) the Event Categories / Activity Types tag lists were decorative — now wired into the editor via `buildEditorCategoryOptions` (unit-tested): Activity Types filters the editor's category set (empty = show-all floor, so the picker is never unusable), Event Categories add custom quick-pick labels; (2) drag-to-create crashed because `moveDrag` read `event.currentTarget` inside a deferred `setState` updater — now read synchronously; (3) the time-grid event-block container occluded the drag-to-create layer (same z-level, painted on top) — container is now `pointer-events-none` with blocks `pointer-events-auto`, so empty-space drags reach the layer while blocks stay clickable. TC-CAL-008 gained a real-mouse drag test that exercises the full pointer→`onCreateRange`→editor `defaultRange` path (which exposed defects 2 and 3). The cross-model BC findings (new required props on `TimeGridProps`/`CalendarToolbarProps`) were not applicable — the calendar components are new in this same unmerged PR, so the prop interfaces have no released third-party consumers.
