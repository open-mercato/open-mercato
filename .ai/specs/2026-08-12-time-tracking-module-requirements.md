# Time Tracking Module — Specification

## 1. Purpose

A time tracking module for consulting work: track time across multiple customers and projects, organize it by task, and turn it into billable time & cost reports per customer.

## 2. Domain model

The core hierarchy:

```
Customer → Project → Task → Time entry
```

| Entity | Belongs to | Notes |
|---|---|---|
| **Customer** | — | Top-level; time is organized per customer. |
| **Project** | Customer | Has an hourly rate (per customer) and a currency. Members are assigned to it. |
| **Task** | Project | Lives inside one project. Supports subtasks and comments. |
| **Time entry** | Task | The unit of tracked time; logs against a task (and therefore its project). |

### Relationships

- A customer has many projects.
- A project has many tasks and many assigned team members.
- A task has many subtasks, comments, and time entries.
- A time entry belongs to one task and one person (its creator).

## 3. Roles & permissions

| Capability | Team Member | Team Leader |
|---|---|---|
| Create a project | — | ✅ |
| Assign members to a project | — | ✅ |
| Access a project | Only if assigned | ✅ |
| Create tasks | ✅ (in assigned projects) | ✅ |
| Track time / create entries | ✅ (in assigned projects) | ✅ |

- **Team members** get access on a per-project basis, not to all projects by default.
- **Team Leaders** create projects and assign members to them.

## 4. Tasks & Kanban

Each task has:

- **Title**
- **Status** — rendered on a **Kanban board** view.
- **Tags**
- **Assignee**
- **Time tracking** — accumulated logged time.

Tasks also support:

- **Subtasks**
- **Comments**
- **Inline fast time-entry** — quick time logging directly on a task, without opening the full entry form.

## 5. Time entry

### Fields

| Field | Description |
|---|---|
| **Task** | The task the entry is logged against. |
| **Description** | Free-text note. |
| **Billable** | Toggle: billable / non-billable. |
| **Tags** | List of tags. |
| **Start time** | Start timestamp. |
| **End time** | End timestamp. |
| **Tracked time** | Duration; related to start & end. |
| **Creator** | Auto-assigned to the person who creates the entry. |

### Duration logic

Flexible, computable in either direction:

- **Start + tracked time** → end time calculated automatically, **or**
- **Start + end time** → tracked time calculated automatically.

### Duration input

Accepts natural formats — e.g. `1h 40m` ("one hour forty minutes") — so hours and minutes can be typed directly.

### Behavior

- Entries are **editable** after creation.
- Entries can be created from the task, from the inline fast-entry, and from the timesheet.

## 6. Timesheet

Presents tracked time from multiple angles:

- **Period selector** — year, quarter, month, week.
- **Filters** — by project (or an all-projects view) and/or by person.
- **Add time entry** directly from this level.
- **Per-day summary** — for the selected period, hours tracked per day (calendar-style or a switchable list/summary view).

## 7. Rates & cost

- **Project rate** — each project carries an hourly rate set for its customer.
- **Currency** — set per project; reports for a customer total in that currency.
- **Entry-level override** — the rate can be overridden on an individual time entry.
- **Cost** = tracked time × applicable rate.

## 8. Reports

Generate time & cost reports scoped to a single **customer**:

- **Period** — weekly, monthly, or yearly (selectable).
- **Project selection** — hand-pick which of the customer's projects to include.
- **Summarization** — total tracked time and associated cost (from rates).

## 9. Proposed enhancements

Not yet confirmed — consulting-oriented features to consider:

- **Live timer (start/stop)** — click-to-start a timer on a task; stopping it creates a time entry. Complements inline fast-entry.
- **Lock / freeze reported entries** — once an entry is in a generated/sent report, it locks against edits to protect billing integrity.
- **Rounding rules** — round entries up to the nearest 5/15 min, etc. **Global setting for now** (not per project/customer).
- **Budget / cap per project** — ceiling in hours or money, with burn tracking and a warning near the limit. Useful for fixed-scope work.
- **Report export** — PDF for client-facing summaries; CSV/XLSX for records and invoicing.

## 10. Decisions & deferrals

- **Rounding scope** — global for now.
- **Currency** — per project (see §7).
- **Approval step** — not now (deferred; listed under §9 for the future).
- **Admin role** — not needed for now; Team Leader is the top role.

---

## 11. User story map

Stories follow the format **As a [role], I want [capability], so that [outcome]**, with acceptance criteria (AC) that capture the UX details distinguishing a real product from a CRUD form. Roles: **TM** = Team Member, **TL** = Team Leader (a TL can do everything a TM can).

### Backbone (the journey)

| # | Epic | The user is trying to… |
|---|---|---|
| A | Access & onboarding | Get into the app and reach the work that's theirs |
| B | Project & team setup | Stand up a customer's project and staff it |
| C | Tasks & Kanban | Break work down and see its state at a glance |
| D | Tracking time | Capture time with the least possible friction |
| E | Timesheet | See, correct, and complete their own time |
| F | Rates & cost | Make tracked time carry a monetary value |
| G | Reporting & billing | Turn time into a defensible client deliverable |

---

### Epic A — Access & onboarding

**US-A1 — Land on my work**
_As a TM, I want to land directly on the projects and tasks assigned to me, so that I'm not hunting through customers I have no access to._
- AC: The home view shows only assigned projects; unassigned/other customers are not visible.
- AC: If nothing is assigned yet, an **empty state** explains why and points to "Ask your Team Leader to add you to a project" rather than showing a blank screen.

**US-A2 — Understand what I can do**
_As a TM, I want actions I'm not permitted to use (create project, assign members) to be absent rather than shown-and-disabled, so that the UI reflects my real capabilities._
- AC: TL-only actions don't render for a TM.
- AC: Attempting a TL action via a stale link fails gracefully with a clear message, not a raw error.

---

### Epic B — Project & team setup

**US-B1 — Create a project for a customer**
_As a TL, I want to create a project under a customer, so that time has a place to live._
- AC: Creating a project requires a customer (pick existing or create inline).
- AC: Rate and currency can be set at creation or left for later without blocking.

**US-B2 — Assign members to a project**
_As a TL, I want to assign team members to a project, so that they can see it and log time against it._
- AC: Assigning grants the member access immediately (no re-login).
- AC: Multi-select assignment; a member can be on many projects.
- AC: Removing a member preserves their historical entries (access ≠ data ownership).

**US-B3 — See project health**
_As a TL, I want each project to show tracked hours and cost to date at a glance, so that I can spot over-runs early._
- AC: Project list/summary shows total hours and cost in the project's currency.

---

### Epic C — Tasks & Kanban

**US-C1 — Create a task**
_As a TM, I want to create a task with title, status, tags, and assignee, so that work is captured where I'll track against it._
- AC: Title is the only required field; everything else is optional and editable later.
- AC: New tasks default to the first status column and to me as assignee (overridable).

**US-C2 — Work the Kanban board**
_As a TM, I want to drag a task between status columns, so that updating state feels physical and instant._
- AC: Drag-and-drop updates status optimistically; failure rolls back with a toast.
- AC: Columns show a task count; long columns scroll without losing the header.
- AC: **Inline quick-add** at the top/bottom of a column creates a task without a modal.

**US-C3 — Break work into subtasks**
_As a TM, I want to add subtasks to a task, so that larger work is trackable in pieces._
- AC: Subtasks can be checked off; parent shows progress (e.g. 2/5).

**US-C4 — Discuss on the task**
_As a TM, I want to comment on a task, so that context lives with the work rather than in chat._
- AC: Comments are timestamped and attributed to their author.

**US-C5 — Log time from the task**
_As a TM, I want an inline fast time-entry on the task, so that I can record time the moment I finish without a full form._
- AC: One field accepts a duration (see US-D2) and logs against this task with sensible defaults (today, me, billable).

---

### Epic D — Tracking time (the heart of the module)

**US-D1 — Add a time entry manually**
_As a TM, I want to create a time entry with task, description, billable flag, tags, and times, so that I can record work I didn't time live._
- AC: Entry auto-attaches to me as creator.
- AC: I can create it from a task, the inline fast-entry, or the timesheet — same underlying entry.

**US-D2 — Enter duration naturally**
_As a TM, I want to type duration in natural formats, so that I never do mental math or fight a picker._
- AC: Accepts at least `1h 40m`, `1.5h`, `90m`, and `1:40`; all normalize to the same stored value.
- AC: Invalid input is flagged inline without discarding what I typed.

**US-D3 — Let the system do the arithmetic**
_As a TM, I want to give any two of {start, end, duration} and have the third computed, so that I enter the minimum and the app fills the rest._
- AC: start + duration → end; start + end → duration.
- AC: Editing one field recomputes the derived one live, and the relationship stays consistent on save.

**US-D4 — Run a live timer**
_As a TM, I want to start a timer on a task and stop it later to create an entry, so that I capture time as it happens._
- AC: Only **one timer runs at a time**; starting a new one prompts to stop the current.
- AC: The running timer **survives page refresh and browser close** (persisted server-side), and keeps counting.
- AC: A running timer is visible from anywhere in the app (persistent indicator), not only on the task.
- AC: Navigating away with a timer running gives a non-blocking reminder, not silent loss.

**US-D5 — Correct fast, safely**
_As a TM, I want inline editing and an undo on delete, so that fixing mistakes is quick and low-risk._
- AC: Editing a cell in the entry list saves on blur/Enter; Esc cancels.
- AC: Deleting an entry shows a toast with **Undo** for a few seconds before it's final.

**US-D6 — Repeat yesterday**
_As a TM, I want to duplicate a previous entry (or copy a day), so that recurring work doesn't mean retyping._
- AC: Duplicate prefills task, description, tags, and billable; I adjust duration/date.

**US-D7 — Avoid double-logging**
_As a TM, I want the app to warn when a new entry overlaps an existing one, so that my day doesn't accidentally exceed reality._
- AC: Overlapping start/end ranges surface a non-blocking warning (overlap allowed but flagged).

---

### Epic E — Timesheet

**US-E1 — See time by period**
_As a TM, I want to switch between year, quarter, month, and week, so that I can review at the right granularity._
- AC: Period switch keeps the current date context (switching week↔month stays "around now").

**US-E2 — Slice by project and person**
_As a TM/TL, I want to filter by project (or all) and by person, so that I can focus a view._
- AC: TMs can filter their own time; TLs can filter by any assigned person.
- AC: **Filters persist** across sessions so I return to the view I use most.

**US-E3 — Read the day at a glance**
_As a TM, I want a per-day summary of hours for the selected period, so that I can see gaps and heavy days instantly._
- AC: Each day shows a total; a simple bar/heat cue conveys light vs heavy days.
- AC: Period total and (if a target exists) under/over target are visible.

**US-E4 — Add time from the timesheet**
_As a TM, I want to add an entry directly in the timesheet grid, so that filling gaps doesn't send me elsewhere._
- AC: Inline add uses the same duration parsing and defaults as everywhere else.

---

### Epic F — Rates & cost

**US-F1 — Set a project rate & currency**
_As a TL, I want to set an hourly rate and currency on a project, so that its time converts to money for the customer._
- AC: Rate + currency are project-level; currency drives all cost display for that project.

**US-F2 — Override a rate on an entry**
_As a TM/TL, I want to override the rate on a specific entry, so that exceptions (discounted, premium) are captured accurately._
- AC: Overridden entries are visibly marked; the report reflects the override, not the project default.

**US-F3 — Trust the cost math**
_As a TM/TL, I want cost computed as tracked time × applicable rate with global rounding applied, so that totals are predictable._
- AC: Rounding is applied consistently (global setting) and the rounded value is what's costed.

---

### Epic G — Reporting & billing

**US-G1 — Generate a customer report**
_As a TL, I want to generate a report for one customer over a chosen period, so that I can bill or update them._
- AC: Scope = one customer; period = week/month/year.
- AC: I hand-pick which of the customer's projects to include.

**US-G2 — Preview before it leaves**
_As a TL, I want to preview the report with time and cost summarized, so that I catch errors before the client does._
- AC: Preview groups by project (and can group by task/person), shows subtotals and a grand total in the correct currency.
- AC: Non-billable time is either excluded or clearly separated from billable.

**US-G3 — Lock what's been reported**
_As a TL, I want entries included in a generated/sent report to lock, so that billed time can't silently change afterward._
- AC: Locked entries are read-only and visibly marked; unlocking is an explicit, audited action.

**US-G4 — Export the deliverable**
_As a TL, I want to export the report as PDF (client-facing) and CSV/XLSX (records/invoicing), so that it fits both the client and my back-office._
- AC: Export honors the current grouping, filters, rounding, and currency.

---

### Cross-cutting UX principles

These apply across every epic and are what keep the module from feeling like CRUD:

- **Keyboard-first** — the whole time-entry loop (pick task → duration → save → next) is doable without the mouse.
- **Smart defaults** — today's date, me as creator, last-used task/project, billable-by-default, start = end of previous entry.
- **Optimistic UI with rollback** — actions feel instant; failures surface a clear, reversible message.
- **Reversibility** — destructive actions (delete, unlock) offer undo or require explicit confirmation; nothing important is lost silently.
- **Meaningful empty states** — every list explains what it is and offers the primary action when empty.
- **Persistent context** — filters, period, and grouping are remembered per user.
- **Consistent time input** — one duration parser and one entry model reused on tasks, timesheet, timer, and inline add.
