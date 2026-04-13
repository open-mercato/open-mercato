# Timesheets UX Enhancements

## TLDR

**Key Points:**
- Enhance the My Timesheets page from a basic monthly grid into a Toggl-inspired experience with weekly view, inline project management, integrated timer, and list view.
- UI-focused changes extending SPEC-069 Phase 1, with one additive DB migration (`color` on `staff_time_projects`).

**Scope:**
- Weekly view as default with weekly/monthly toggle
- Calendar date picker for week navigation
- "+ Add row" with project selector dropdown
- "Create new project" dialog (full CrudForm, admin only)
- Project color dots (admin-defined, predefined 12-color palette, auto-generate fallback)
- Timer bar at the top of My Timesheets page
- List view (entries grouped by day) as alternative to grid
- Bulk save retained (no auto-save change)

**Concerns:**
- Timer moves from dashboard-only to grid top bar — conscious deviation from SPEC-069
- Significant UI rewrite of My Timesheets page within tight deadline

---

## Overview

Transform the My Timesheets UI from a monthly-only grid into a modern, Toggl-inspired time tracking interface. The current implementation follows SPEC-069 Phase 1 faithfully but was identified during PR review as "very difficult to use" and lacking the polish expected for production use.

This spec covers frontend UX improvements only. All backend APIs, commands, events, and entities from SPEC-069 Phase 1 are reused without modification (except one additive migration).

> **Market Reference**: Toggl Track (timesheet view). Adopted: weekly grid, "+ Add row" project selector, timer bar, list view, project colors, calendar week picker. Rejected: billable toggle (Phase 3), calendar block view, client grouping, tag system.

## Problem Statement

1. **Monthly grid is overwhelming** — 30-31 columns make scanning difficult; most users track time weekly.
2. **No inline project management** — users must navigate away to add projects to the grid.
3. **Timer only in dashboard** — users must leave My Timesheets to start/stop a timer.
4. **No visual project identification** — all projects look the same in the grid.
5. **No alternative view** — some users prefer a chronological list of entries over a grid.
6. **Week navigation missing** — no way to quickly jump to a specific week.

## Proposed Solution

Rewrite the My Timesheets page (`packages/core/src/modules/staff/backend/staff/timesheets/page.tsx`) with:

1. **View mode state** — `weekly` (default) or `monthly`, persisted in URL query param
2. **View type state** — `timesheet` (grid) or `list`, persisted in URL query param
3. **Timer bar component** — top of page, reuses existing timer start/stop API endpoints
4. **"+ Add row" component** — inline dropdown with project search, admin gets "Create new project"
5. **Calendar date picker** — dropdown for week selection with quick links
6. **Project color system** — predefined 12-color palette stored on `staff_time_projects.color`

All changes are frontend-only except the `color` field migration.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Weekly view as default | Most time tracking is done weekly; monthly is secondary |
| Bulk save retained (not auto-save) | SPEC-069 defines bulk save with confirmation; changing save semantics is risky for deadline |
| Predefined 12-color palette | Simpler UX than hex picker; consistent project colors; matches Toggl pattern |
| Projects don't auto-appear in grid | User controls which projects are visible; cleaner grid; matches Toggl behavior |
| Each project appears once in grid | Prevents confusion; time entries aggregate per project+day cell |
| Timer in grid auto-updates state | When timer stops, grid state updates immediately without page refresh |

## User Stories

1. As an **employee**, I can switch between weekly and monthly views so I can focus on the current week or see the full month.
2. As an **employee**, I can add projects to my grid via "+ Add row" so I can track time against assigned projects.
3. As an **employee**, I can start/stop a timer from the My Timesheets page so I don't have to navigate to the dashboard.
4. As an **employee**, I can see a list view of my entries grouped by day so I have a chronological overview.
5. As an **employee**, I can navigate to any week using the calendar picker so I can review or edit past time.
6. As an **admin**, I can create a new project directly from the "+ Add row" dropdown so I can start tracking immediately.
7. As an **admin**, I can assign colors to projects so teams can visually identify them in the grid.

## Architecture

### Component Structure

```
MyTimesheetsPage
├── TimerBar                     ← NEW: "What are you working on?" + play/stop
│   ├── ProjectSelectorDropdown  ← reuses assigned projects API
│   └── TimerDisplay             ← elapsed time, running state
├── ViewControls
│   ├── ViewModeSwitcher         ← Weekly | Monthly toggle
│   ├── ViewTypeSwitcher         ← List view | Timesheet toggle
│   └── CalendarDatePicker       ← NEW: week selector dropdown
├── TimesheetGrid                ← ENHANCED: weekly/monthly, + Add row
│   ├── ProjectRow[]             ← with color dots
│   ├── AddRowDropdown           ← NEW: project selector + create
│   └── DailyTotalRow
├── ListView                     ← NEW: entries grouped by day
│   └── DayGroup[]
│       └── EntryRow[]
└── SummaryCards                 ← existing: Total Hours, Working Days, etc.
```

### Data Flow

- **Timer bar** → `POST /api/staff/timesheets/time-entries` (create entry) → `POST .../timer-start` → UI shows running state → `POST .../timer-stop` → update local grid state immediately
- **Grid cells** → collect dirty cells → `POST /api/staff/timesheets/time-entries/bulk` (unchanged)
- **"+ Add row"** → `GET /api/staff/timesheets/time-projects` (assigned projects) → select → add to local grid state
- **"Create project"** → open CrudForm dialog → `POST /api/staff/timesheets/time-projects` → auto-assign creator → add to local grid state
- **List view** → `GET /api/staff/timesheets/time-entries?staffMemberId=...&from=...&to=...` → group by date → render

### Commands & Events

No new commands or events. All mutations reuse existing Phase 1 commands:

| Action | Command |
|--------|---------|
| Timer start | `staff.timesheets.time_entry.timer_start` |
| Timer stop | `staff.timesheets.time_entry.timer_stop` |
| Create entry (timer) | `staff.timesheets.time_entry.create` |
| Bulk save grid | via bulk endpoint (compound create/update) |
| Create project (dialog) | `staff.timesheets.time_project.create` |
| Assign creator to project | `staff.timesheets.time_project_member.assign` |
| Update project color | `staff.timesheets.time_project.update` |

### Access Control

No new ACL features. Existing features govern all actions:

| Action | Required Feature |
|--------|-----------------|
| View timesheets, grid, list view | `staff.timesheets.view` |
| Start/stop timer, save entries | `staff.timesheets.manage_own` |
| See "+ Create new project" in dropdown | `staff.timesheets.projects.manage` |
| Set project color | `staff.timesheets.projects.manage` |

## Data Models

### StaffTimeProject (Modified — additive only)

New field added to existing entity:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `color` | varchar(20), nullable | `null` | Predefined color key (e.g. `'blue'`, `'green'`, `'purple'`). Null = auto-generate from name hash. |

### StaffTimeProjectMember (Modified — additive only)

> **Added 2026-04-13 (post-original-spec)**: This field was **not in the original specification**. During Phase 2 implementation we realised that "projects don't auto-appear in grid — user controls which projects are visible" (a design decision documented above) requires a persistence mechanism per-user. Local-only state would lose grid membership on refresh and between devices. Storing visibility on the assignment row is the simplest additive-only option that matches Toggl's per-user grid behaviour.

New field added to existing entity:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `show_in_grid` | boolean, not null | `false` | When true, the project appears as a row in the user's My Timesheets weekly/monthly grid. Toggled via "+ Add row" (true) and the new X remove button (false). |

Migration backfill: existing memberships where the user already has time entries are set to `true`, so current users don't lose visibility on existing tracked projects.

Predefined palette (12 colors):

```typescript
export const PROJECT_COLORS = [
  { key: 'blue',       hex: '#3B82F6' },
  { key: 'green',      hex: '#22C55E' },
  { key: 'purple',     hex: '#A855F7' },
  { key: 'red',        hex: '#EF4444' },
  { key: 'orange',     hex: '#F97316' },
  { key: 'yellow',     hex: '#EAB308' },
  { key: 'pink',       hex: '#EC4899' },
  { key: 'teal',       hex: '#14B8A6' },
  { key: 'indigo',     hex: '#6366F1' },
  { key: 'cyan',       hex: '#06B6D4' },
  { key: 'emerald',    hex: '#10B981' },
  { key: 'slate',      hex: '#64748B' },
] as const
```

Auto-generate fallback: `PROJECT_COLORS[hashCode(project.name) % PROJECT_COLORS.length]`

## API Contracts

One new self-service endpoint (added 2026-04-13, see Data Models section). All existing Phase 1 endpoints are reused otherwise.

### New Endpoint (added 2026-04-13)

**`PATCH /api/staff/timesheets/my-projects/{projectId}`**

Self-service endpoint for the authenticated user to toggle grid visibility of their own project assignments without the admin-only `staff.timesheets.projects.manage` feature.

- Guard: `requireFeatures: ['staff.timesheets.manage_own']`
- Enforces: the membership row's `staff_member_id` must match the authenticated user's staff member.

Request body:

```typescript
{
  showInGrid: boolean
}
```

Response: `{ ok: true, showInGrid: boolean }` on success; `403` if the assignment does not belong to the caller; `404` if no active assignment exists for `projectId`.

### Modified Request (additive)

**`PATCH /api/staff/timesheets/time-projects/{id}`**

New optional field in request body:

```typescript
{
  // ... existing fields ...
  color?: string | null  // Predefined color key or null to reset
}
```

**`POST /api/staff/timesheets/time-projects`**

New optional field in request body:

```typescript
{
  // ... existing fields ...
  color?: string | null  // Predefined color key
}
```

Validation: `color` must be one of `PROJECT_COLORS[].key` or `null`.

## Internationalization (i18n)

| Key | EN Default |
|-----|-----------|
| `staff.timesheets.my.viewMode.weekly` | `Weekly` |
| `staff.timesheets.my.viewMode.monthly` | `Monthly` |
| `staff.timesheets.my.viewType.timesheet` | `Timesheet` |
| `staff.timesheets.my.viewType.list` | `List view` |
| `staff.timesheets.my.timer.placeholder` | `What are you working on?` |
| `staff.timesheets.my.timer.start` | `Start Timer` |
| `staff.timesheets.my.timer.stop` | `Stop Timer` |
| `staff.timesheets.my.timer.running` | `Timer running` |
| `staff.timesheets.my.addRow` | `+ Add row` |
| `staff.timesheets.my.addRow.search` | `Search by project` |
| `staff.timesheets.my.addRow.noProjects` | `No projects assigned` |
| `staff.timesheets.my.addRow.createProject` | `+ Create a new project` |
| `staff.timesheets.my.calendar.thisWeek` | `This week` |
| `staff.timesheets.my.calendar.lastWeek` | `Last week` |
| `staff.timesheets.my.weekTotal` | `Week Total` |
| `staff.timesheets.my.list.today` | `Today` |
| `staff.timesheets.my.list.yesterday` | `Yesterday` |
| `staff.timesheets.my.list.addDescription` | `Add description` |
| `staff.timesheets.projects.form.color` | `Project color` |
| `staff.timesheets.my.removeRow` | `Remove from grid` |
| `staff.timesheets.my.removeRow.confirm` | `Remove {projectName} from your timesheet grid? You can re-add it anytime via "+ Add row".` |
| `staff.timesheets.my.removeRow.error` | `Could not remove the project. Please try again.` |
| `staff.timesheets.my.addRow.error` | `Could not add the project. Please try again.` |

## UI/UX

### My Timesheets — Weekly Timesheet View (default)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ What are you working on?          [Project ▾]   ▶ Play    0:00:00      │
├──────────────────────────────────────────────────────────────────────────┤
│ ◀  W16: 13 - 19 Apr 2026  ▶  [📅]    WEEK TOTAL: 32.5h               │
│                                        [List view] [Timesheet]         │
│                                        [Weekly ▾]                      │
├──────────────────────────────────────────────────────────────────────────┤
│ PROJECT          MON    TUE    WED    THU    FRI    SAT    SUN   TOTAL │
├──────────────────────────────────────────────────────────────────────────┤
│ 🟢 Website       8.0    7.5    8.0    7.0    8.0     -      -    38.5 │
│ 🔵 Mobile App    0      0      2.0    3.0    0       -      -     5.0 │
│ 🟣 API Work      0      0.5    0      1.0    0       -      -     1.5 │
├──────────────────────────────────────────────────────────────────────────┤
│ + Add row                                                              │
├──────────────────────────────────────────────────────────────────────────┤
│                  TOTAL   8.0    8.0   10.0   11.0    8.0     -      -  │
│ [Save Changes]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### My Timesheets — List View

```
┌──────────────────────────────────────────────────────────────────────────┐
│ What are you working on?          [Project ▾]   ▶ Play    0:00:00      │
├──────────────────────────────────────────────────────────────────────────┤
│ ◀  W16: 13 - 19 Apr 2026  ▶  [📅]    WEEK TOTAL: 32.5h               │
│                                        [List view] [Timesheet]         │
├──────────────────────────────────────────────────────────────────────────┤
│ Today                                                          8:00:00 │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Add description   • 🟢 Website    8:00 AM - 12:00 PM     4:00:00 │ │
│ │ API endpoint work • 🔵 Mobile     1:00 PM -  4:00 PM     3:00:00 │ │
│ │ Meeting notes     • 🟣 API Work   4:30 PM -  5:30 PM     1:00:00 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ Yesterday                                                      7:30:00 │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Homepage design   • 🟢 Website    8:00 AM - 12:00 PM     4:00:00 │ │
│ │ Code review       • 🟢 Website    1:00 PM -  4:30 PM     3:30:00 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Notes:
- Timer-created entries (source: `timer`) show time range (start - end)
- Manual entries (source: `manual`) show duration only (e.g. `4h`)
- Description is inline editable ("Add description" placeholder)

### Calendar Date Picker

```
┌───────────────────────────┐
│ 📅 04/06/2026 - 04/12/2026│
├───────────────────────────┤
│ This week                 │
│ Last week                 │
├───────────────────────────┤
│      April 2026 ▾        │
│  Mo Tu We Th Fr Sa Su    │
│ W14  30  1  2  3  4  5  6│
│ W15 [7] [8][9][10][11]12 │  ← current week highlighted
│ W16  13 14 15 16 17 18 19│
│ W17  20 21 22 23 24 25 26│
│ W18  27 28 29 30  1  2  3│
└───────────────────────────┘
```

### "+ Add Row" Dropdown

```
┌──────────────────────────────┐
│ 🔍 Search by project         │
├──────────────────────────────┤
│ ● No Project                 │
├──────────────────────────────┤
│ 🟢 Website Redesign          │
│ 🔵 Mobile App                │
│ 🟣 API Integration           │
│ 🟠 Internal Tools            │
├──────────────────────────────┤
│ + Create a new project       │  ← admin only
└──────────────────────────────┘
```

### Color Picker (in project create/edit)

```
┌──────────────────────────────┐
│ Project color                │
│ ● ● ● ● ● ● ● ● ● ● ● ●  │  ← 12 predefined colors
│ (selected: 🟢)               │
└──────────────────────────────┘
```

## Migration & Compatibility

### Database Migration

**Additive only — backward compatible:**

```sql
ALTER TABLE staff_time_projects
  ADD COLUMN color varchar(20) DEFAULT NULL;

-- Added 2026-04-13
ALTER TABLE staff_time_project_members
  ADD COLUMN show_in_grid boolean NOT NULL DEFAULT false;

-- Backfill: preserve visibility for members that already have entries
UPDATE staff_time_project_members m
SET show_in_grid = true
WHERE EXISTS (
  SELECT 1 FROM staff_time_entries e
  WHERE e.time_project_id = m.time_project_id
    AND e.staff_member_id = m.staff_member_id
    AND e.deleted_at IS NULL
);
```

- `color`: no data backfill needed (null = auto-generate fallback)
- `show_in_grid`: backfilled from existing entries so current users don't lose visibility
- No existing columns modified or removed
- No index needed (both columns are not queried/filtered directly)

### Backward Compatibility

- All existing API contracts remain unchanged
- New `color` field is optional in all requests
- Existing UI behavior (monthly grid, save button) preserved within monthly view mode
- No breaking changes to events, commands, or ACL features

## Implementation Plan

### Phase 1: Weekly View & Navigation

**Step 1**: Add view mode state and weekly grid layout
- Add `viewMode` state (`weekly` | `monthly`) with URL query param sync
- Refactor grid to render 7 columns (Mon-Sun) in weekly mode
- Week navigation header: `< W16: 13 - 19 Apr 2026 >`
- Retain existing monthly mode as toggle option

**Step 2**: Calendar date picker
- Dropdown component triggered from week navigation
- Month calendar with week rows (W14, W15...)
- "This week" / "Last week" quick links
- Click week → update grid date range

**Step 3**: View type toggle (Timesheet | List view)
- Add `viewType` state (`timesheet` | `list`) with URL query param
- Toggle buttons in header
- List view component: entries grouped by day
- Timer entries show time range; manual entries show duration only

### Phase 2: Timer Bar & Project Management

**Step 4**: Timer bar at top of page
- "What are you working on?" input + project selector dropdown
- Play button: create entry + start timer via existing API
- Running state: elapsed time display, project tag
- Stop button: stop timer → update grid state immediately (no refresh)
- Project selector: assigned projects with color dots

**Step 5**: "+ Add row" with project selector
- Inline dropdown below last project row
- Search field filtering assigned projects
- "No projects assigned" empty state for employees
- Admin sees "+ Create a new project" at bottom
- Selecting project adds row to grid state

**Step 6**: "Create new project" dialog (admin)
- Full CrudForm in dialog modal
- Triggered from "+ Add row" → "+ Create a new project"
- On create: auto-assign creator + add project to grid

**Step 6.5** (added 2026-04-13): Persist grid membership + remove row
- Add `show_in_grid` boolean to `staff_time_project_members` (migration + backfill)
- New self-service endpoint `PATCH /api/staff/timesheets/my-projects/{projectId}` guarded by `staff.timesheets.manage_own`
- `+ Add row` now calls PATCH to set `show_in_grid = true` (persists across refreshes/devices)
- New X button on each grid project row → simple confirm dialog → PATCH `show_in_grid = false`
- On initial load, grid renders only assignments with `show_in_grid = true`

### Phase 3: Project Colors & Polish

**Step 7**: Color field migration + entity update
- Add `color` column to `staff_time_projects`
- Add `color` to create/update validators (enum of predefined keys)
- Auto-generate fallback from name hash

**Step 8**: Color picker UI
- Color palette component (12 predefined colors)
- Add to project create dialog and edit page
- Color dots in grid rows, "+ Add row" dropdown, timer project selector

**Step 9**: Integration tests
- Update existing TC-STAFF-020 (grid) for weekly view
- New test: timer bar start/stop flow
- New test: "+ Add row" and project creation from grid
- New test: list view rendering

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/staff/backend/staff/timesheets/page.tsx` | Modify | Rewrite with weekly/monthly toggle, view type toggle, timer bar, + add row |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/TimerBar.tsx` | Create | Timer bar component |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/CalendarPicker.tsx` | Create | Calendar week picker dropdown |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/AddRowDropdown.tsx` | Create | "+ Add row" project selector |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/ListView.tsx` | Create | List view (entries grouped by day) |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/ColorPicker.tsx` | Create | 12-color palette picker |
| `packages/core/src/modules/staff/backend/staff/timesheets/components/ViewSwitcher.tsx` | Create | Weekly/Monthly + Timesheet/List toggles |
| `packages/core/src/modules/staff/backend/staff/timesheets/lib/colors.ts` | Create | PROJECT_COLORS constant + auto-generate helper |
| `packages/core/src/modules/staff/backend/staff/timesheets/projects/projectFormConfig.ts` | Modify | Add color field to form config |
| `packages/core/src/modules/staff/backend/staff/timesheets/projects/[id]/page.tsx` | Modify | Add color dot display |
| `packages/core/src/modules/staff/data/entities.ts` | Modify | Add `color` field to StaffTimeProject |
| `packages/core/src/modules/staff/data/validators.ts` | Modify | Add `color` validation (enum of predefined keys) |
| `packages/core/src/modules/staff/i18n/en.json` | Modify | Add new i18n keys |
| `packages/core/src/modules/staff/i18n/pl.json` | Modify | Sync new keys |
| `packages/core/src/modules/staff/i18n/es.json` | Modify | Sync new keys |
| `packages/core/src/modules/staff/i18n/de.json` | Modify | Sync new keys |
| DB migration | Create | Add `color` column to `staff_time_projects`; add `show_in_grid` to `staff_time_project_members` with backfill (added 2026-04-13) |
| `packages/core/src/modules/staff/api/timesheets/my-projects/route.ts` | Modify | Return `show_in_grid` in GET response (added 2026-04-13) |
| `packages/core/src/modules/staff/api/timesheets/my-projects/[projectId]/route.ts` | Create | Self-service PATCH to toggle `show_in_grid` (added 2026-04-13) |

## Risks & Impact Review

#### Timer State Inconsistency
- **Scenario**: User starts timer in top bar, navigates away, returns — timer state lost in UI
- **Severity**: Medium
- **Affected area**: Timer bar component, My Timesheets page
- **Mitigation**: On page load, query existing entries for today with `ended_at IS NULL` to detect running timer. Restore running state from API data.
- **Residual risk**: Brief flash of non-running state before API response arrives (acceptable — loading state)

#### Concurrent Grid and Timer Edits
- **Scenario**: User edits a cell for project X while timer is running for project X on the same day. Bulk save overwrites timer entry.
- **Severity**: High
- **Affected area**: Bulk save endpoint, timer entries
- **Mitigation**: Bulk save uses create-or-update logic keyed on (staffMemberId, timeProjectId, date). Timer entries are separate rows (source: 'timer') and grid entries are (source: 'manual'). They coexist — grid cell shows sum of all entries for that project+day.
- **Residual risk**: None — multiple entries per cell already supported (CellEntry[] pattern from Phase 1)

#### "+ Add Row" Stale Project List
- **Scenario**: Admin creates a project in another tab; employee's "+ Add row" doesn't show it
- **Severity**: Low
- **Affected area**: "+ Add row" dropdown
- **Mitigation**: Fetch projects on each dropdown open (not cached). Minimal latency impact — small dataset.
- **Residual risk**: None

#### Color Field Migration on Large Tables
- **Scenario**: Migration adds nullable column to `staff_time_projects` — potential lock on large tables
- **Severity**: Low
- **Affected area**: Deployment
- **Mitigation**: `ADD COLUMN ... DEFAULT NULL` on PostgreSQL is metadata-only (no table rewrite). Safe for any table size.
- **Residual risk**: None

#### Grid Membership Persistence — `show_in_grid`
- **Scenario**: A user removes a project from their grid (X button) while they still have saved time entries for that project. On the next refresh the grid hides the row but the entries remain in the DB.
- **Severity**: Low
- **Affected area**: My Timesheets grid rendering
- **Mitigation**: Removing from grid only flips `show_in_grid` — no entries are deleted or hidden elsewhere (reports, list view, exports still show them). The "+ Add row" dropdown lets the user re-surface the row instantly; i18n copy makes this explicit. Confirm dialog before removal prevents accidental clicks.
- **Residual risk**: None — entries are preserved; only the per-user grid layout changes.

#### Page Rewrite Regression
- **Scenario**: Major rewrite of `page.tsx` introduces regressions in existing monthly grid or bulk save
- **Severity**: High
- **Affected area**: My Timesheets core functionality
- **Mitigation**: Existing integration tests (TC-STAFF-020) validate grid behavior. Monthly mode retained as-is. Step-by-step implementation — each step results in working application.
- **Residual risk**: Manual testing recommended for edge cases (weekend cells, month boundaries)

## Final Compliance Report — 2026-04-08

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No cross-module ORM changes |
| root AGENTS.md | Filter by organization_id | Compliant | All existing queries scoped; no new queries |
| root AGENTS.md | Use apiCall, not raw fetch | Compliant | All API calls via apiCall/readApiResultOrThrow |
| root AGENTS.md | Validate inputs with Zod | Compliant | color field added to existing Zod validators |
| root AGENTS.md | Use findWithDecryption | Compliant | No new ORM queries (frontend-only changes) |
| root AGENTS.md | i18n: never hard-code strings | Compliant | All new strings use useT() with locale keys |
| root AGENTS.md | Every dialog: Cmd+Enter submit, Escape cancel | Compliant | Create project dialog follows convention |
| root AGENTS.md | pageSize ≤ 100 | Compliant | All API calls within limit |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | No new API routes |
| packages/ui/AGENTS.md | Use CrudForm for create/edit | Compliant | Create project dialog uses CrudForm |
| Backward compatibility | Additive-only DB changes | Compliant | Nullable column with default null |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | color field added to entity and validators |
| API contracts match UI/UX section | Pass | All UI actions map to existing endpoints |
| Risks cover all write operations | Pass | Timer, bulk save, project create covered |
| Commands defined for all mutations | Pass | All reuse existing Phase 1 commands |
| No new ACL features needed | Pass | Existing features cover all new UI actions |

### Verdict

**Fully compliant** — ready for implementation.

## Changelog

### 2026-04-13
- Added `show_in_grid` boolean to `staff_time_project_members` (additive migration + backfill) to persist per-user grid membership. This closed a gap in the original spec: the design decision "projects don't auto-appear in grid — user controls which projects are visible" did not define a persistence mechanism, so "+ Add row" was only updating local React state.
- Added new self-service endpoint `PATCH /api/staff/timesheets/my-projects/{projectId}` (guarded by `staff.timesheets.manage_own`) so the same user who owns the assignment can toggle visibility without needing the admin-only `staff.timesheets.projects.manage` feature.
- Added X remove button on grid rows with a confirm dialog; new i18n keys for remove/add errors. Remove preserves all existing time entries (only flips visibility).
- Updated Phase 2 implementation plan with Step 6.5 and extended File Manifest accordingly. New "Grid Membership Persistence" entry added to Risks.

### 2026-04-08
- Initial specification based on PR #1111 review feedback and Toggl Track reference
- Extends SPEC-069 Phase 1 with UI/UX improvements
