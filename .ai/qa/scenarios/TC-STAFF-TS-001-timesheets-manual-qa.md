# TC-STAFF-TS-001 — Timesheets manual QA (timer, entries, projects, reporting)

> **Type:** QA verification ticket (single ticket, many browser scenarios)
> **Tracks:** [open-mercato/open-mercato#2456](https://github.com/open-mercato/open-mercato/issues/2456) — *bug: run manual tests for the Timesheets* (fixes landed via #2309).
> **Module:** `packages/core/src/modules/staff/` (timesheets area)
> **Goal:** Manually verify the Timesheets feature in the browser — with special focus on the two reported defects: **(a) start/stop timer "sometimes does not work"**, and **(b) the ongoing/running timer "loses the task description"**. Then cover the full surface (manual entries, segments, projects, membership, reporting, ACL).
>
> <!-- INTEGRATION-TEST CANDIDATE (NEXT STAGE):
>   Every scenario below is a candidate for a Playwright integration test under
>   `packages/core/src/modules/staff/__integration__/...timesheets*.spec.ts`.
>   The "Expected" column is the assertion contract. Timer/description scenarios (T-*)
>   and concurrency scenarios (C-*) are the highest-value automation targets because
>   they map directly to #2456. DO NOT write the tests now — this ticket is the manual
>   QA pass first. Automation is the next step once the browser pass confirms behavior
>   and surfaces the real repro for the "sometimes" failures.
> -->

---

## 0. Test environment & accounts

- **Boot the branch app** (NOT the :3000 standalone): build → generate → build:packages → `next dev -p 3100`. Login `admin@acme.com` / `secret`.
- Needs **two accounts** to exercise ownership/ACL:
  - **Admin** (`staff.*`) — manage all projects/entries, assign members.
  - **Employee** (`staff.timesheets.view`, `.manage_own`, `.projects.view`) — own entries only, no project management.
- The acting user must be **linked to a staff member** (`staff.timesheets.errors.noStaffMember` appears otherwise) — verify this prerequisite first.
- Use **two browsers/tabs** (or one normal + one incognito) for concurrency and cross-surface scenarios.

**Key surfaces under test**
| Surface | Route / location |
|---|---|
| My Timesheets (timer + grid + list) | `/backend/staff/timesheets` |
| Projects portfolio | `/backend/staff/timesheets/projects` |
| Project details (members) | `/backend/staff/timesheets/projects/{id}` |
| Create / edit project | `/backend/staff/timesheets/projects/create`, `.../{id}/edit` |
| Sidebar running-timer indicator | injected in left sidebar (all backend pages) |
| Dashboard widget — Time Reporting (quick timer) | Dashboard |
| Dashboard widget — Hours by Project | Dashboard |

**Reference fields (assertion targets):** `StaffTimeEntry`(date, durationMinutes, startedAt, endedAt, **notes**, timeProjectId, source, deletedAt), `StaffTimeEntrySegment`(startedAt, endedAt, segmentType work/break), `StaffTimeProject`(name, code[unique/org], status, color, …), `StaffTimeProjectMember`(staffMemberId, role, status active/inactive, showInGrid, assignedStart/End).

---

## 1. PRIORITY P0 — Timer start/stop reliability (#2456a)

A "running" entry = `startedAt` set, `endedAt` null, with an open work segment. Start = POST create entry → POST `…/{id}/timer-start`. Stop = POST `…/{id}/timer-stop` (closes segment, recomputes `durationMinutes` from work segments).

| ID | Scenario (browser steps) | Expected |
|---|---|---|
| T1 | On My Timesheets, pick a project, click **Start**. | Timer begins; elapsed counter ticks `H:MM:SS`; Start → **Stop** (red). One running entry exists. |
| T2 | Click **Stop**. | Timer stops; entry shows computed duration; counter resets; Start re-enabled. |
| T3 | **Start with no project selected.** | Either blocked with a clear validation message OR starts per design — verify it is intentional and consistent, not a silent no-op. |
| T4 | **Double-click Start** rapidly. | Exactly **one** running entry/segment created; no duplicate; no error toast left dangling. (Pessimistic lock returns 409 on the loser.) |
| T5 | **Double-click Stop** rapidly. | One stop applied; second is a clean no-op/409 ("no active segment"); duration not double-counted. |
| T6 | Start, then **immediately Stop** (sub-second). | Stop succeeds; very small/zero duration; no orphan open segment. |
| T7 | Start timer, **reload the page** (F5) while running. | After reload the timer still shows **running** with correct elapsed and the **same project** (state reloaded from API, not lost). |
| T8 | Start on project A, then try to **Start again** (same or different project) without stopping. | Cannot run two timers; UI prevents/guards a second start, or surfaces a clear message. Verify no two `started_at`/`endedAt=null` entries exist. |
| T9 | Start, wait **5+ minutes**, observe sidebar indicator + grid. | Elapsed keeps advancing accurately on both the bar and the sidebar indicator (30s poll); no drift/reset. |
| T10 | Start timer in **tab A**, open My Timesheets in **tab B**. | Tab B reflects the running timer (on load/poll); stopping in one tab is reflected in the other after refresh/poll. |
| T11 | **Stop with the network throttled/offline** (DevTools), then restore. | Stop either succeeds on retry or shows a clear error AND the timer remains running on the server (no silent loss). Re-verify state after reload. |
| T12 | Start a timer, **navigate to another module** and back to `/backend/staff/timesheets`. | Timer still running, elapsed correct; no duplicate entry created on return. |

---

## 2. PRIORITY P0 — Ongoing timer keeps the task description (#2456b)

The description is the `notes` field captured at start. Suspected loss points: sidebar indicator does not carry notes; page reload/navigation may not restore typed text; stop clears the field even on failure. Verify each path.

| ID | Scenario | Expected |
|---|---|---|
| D1 | Type a long description (e.g. 200 chars), pick project, **Start**. | Running timer shows the **full description** (read-only/locked while running). |
| D2 | While running, **navigate away** (e.g. to Projects) then **back** to My Timesheets. | Description is **still shown** on the running timer — not blank. |
| D3 | While running, **reload the page** (F5). | Description **reloads from the entry** and is visible — not lost. |
| D4 | While running, hover/open the **sidebar timer indicator**, then return to the page. | Description is preserved on the timesheet timer (indicator may show project only, but returning must not wipe the description). |
| D5 | Start with description → **Stop** successfully. | Entry persists with the description in the saved row (List view → entry's notes). Description visible in history. |
| D6 | Start with description → **Stop fails** (throttle/offline). | Typed description is **not silently discarded**; user can recover/retry; server still has the notes on the running entry. |
| D7 | Start with **empty** description; while running, edit the entry's notes inline in **List view**. | Notes save (PUT) and show on the running entry/row consistently. |
| D8 | Description with special chars / emoji / newlines / 2000-char max. | Saved and redisplayed intact; >2000 chars rejected per validator (max 2000). |
| D9 | Open the **Dashboard Time Reporting widget**, enter notes, start there, then open My Timesheets. | The same running timer + its description are consistent across the widget and the page (single source of truth). |

---

## 3. PRIORITY P1 — Sidebar indicator & dashboard widgets

| ID | Scenario | Expected |
|---|---|---|
| S1 | No timer running. | Sidebar indicator is **hidden**. |
| S2 | Start a timer. | Sidebar shows pulsing dot + **project name** + live elapsed; clicking it navigates to `/backend/staff/timesheets`. |
| S3 | Stop the timer. | Sidebar indicator disappears within one poll cycle (≤30s) / immediately on the acting page. |
| S4 | Indicator after full navigation across modules. | Persists (sessionStorage-backed) without flashing away; elapsed stays correct. |
| S5 | **Hours by Project** widget, default range "this month". | Shows hours grouped by project, total correct for the signed-in user; changing the date-range preset updates totals. |
| S6 | **Time Reporting** widget remembers last project. | Re-selecting is pre-filled with `lastProjectId`; start/stop here behaves identically to the page timer (re-run T1–T2, D9). |

---

## 4. PRIORITY P1 — Manual time entries (no timer) & segments

| ID | Scenario | Expected |
|---|---|---|
| M1 | Add a manual entry: date, project, duration, notes via **Add row**. | Saves; appears in grid + list; duration shown. |
| M2 | Edit an entry (change date/duration/project/notes). | Persists; updated values reflected. |
| M3 | Delete an entry (with confirmation). | Soft-deleted; removed from grid/list; totals update. |
| M4 | Duration validation: enter `0`, `1440`, `1441`, negative, non-numeric. | 0–1440 accepted; out-of-range/invalid rejected with message. |
| M5 | **Bulk save** several rows at once (create + edit mix). | All persist (limit 200); new rows created, owned existing rows updated; project validated per row. |
| M6 | Weekly vs Monthly view toggle; Timesheet vs List view toggle; calendar date navigation. | Each view shows correct entries for the selected period; daily/weekly totals correct. |
| M7 | Work/break **segments**: a timer entry should sum only **work** segments into duration. | `durationMinutes` = sum of work segments; break time excluded. |
| M8 | Entry on a project the user is **not assigned to**. | Blocked / `notAssigned` error — cannot log to unassigned project. |

---

## 5. PRIORITY P1 — Projects & membership (admin)

| ID | Scenario | Expected |
|---|---|---|
| P1 | Create project: name, **code**, status, color, type, start date, cost center, description. | Saves; appears in portfolio. |
| P2 | Create a second project with a **duplicate code**. | Rejected (409 / `projectCodeDuplicate`). |
| P3 | Edit project fields. | Persist; reflected in cards/table + details. |
| P4 | Delete project (soft-delete). | Removed from active lists; existing time entries are **not** cascade-deleted (orphan rows remain). |
| P5 | Portfolio views: cards ↔ table toggle; status saved-views (Active/All/Mine/On Hold/Completed); search by name/code; filters; export; columns chooser. | Each filters/sorts correctly; KPI strip totals (counts, hours week/month, team active) consistent. |
| P6 | Project details → **assign member** (employee, role, start/end date). | Member added with `active` status. |
| P7 | Toggle member **active ↔ inactive**; **unassign** member. | Inactive/unassigned members can no longer log time to the project; existing entries remain. |
| P8 | Employee **My Projects**: only assigned/active projects appear; toggle **show in grid** per project. | Grid reflects only checked projects; toggle is per-user. |

---

## 6. PRIORITY P2 — ACL / ownership / scoping

| ID | Scenario | Expected |
|---|---|---|
| A1 | Employee tries to open Create/Edit Project. | Blocked (no `projects.manage`); page guarded. |
| A2 | Employee edits/deletes **another user's** entry. | Forbidden (`notOwner`); only `manage_all` bypasses. |
| A3 | Admin with `manage_all` edits an employee's entry. | Allowed. |
| A4 | User with no staff-member link opens Timesheets. | Clear `noStaffMember` message, no crash. |
| A5 | Tenant/org isolation: timer, entries, projects, KPIs scoped to current org. | No cross-tenant/org data visible; switching org changes the data set. |

---

## 7. Defect-hunting checklist (map results back to #2456)

When any T*/D*/C* scenario fails, capture the **exact repro** (clicks, timing, network state), a screenshot/video, the failing API call + status (DevTools Network), and the entry's DB state (`started_at`, `ended_at`, `notes`, segments). Specifically confirm or rule out:
- Start "doesn't work" = double-click 409 / two-running-timers / slow-network state mismatch / page-return race (T4, T8, T11, T12).
- Description "lost" = sidebar indicator drops notes / navigation-back wipes field / reload doesn't rehydrate / stop clears on error (D2, D3, D4, D6).

---

## 8. Reporting & next stage

For each row record: pass/fail, environment, repro steps, screenshot, and (for failures) the network/DB evidence above. File failures as `bug` against #2456 with `priority-high` for any timer start/stop or description-loss defect (P0).

**Next stage (automation):** convert the confirmed P0 timer/description scenarios (Sections 1–2) and concurrency cases first into Playwright integration tests under `packages/core/src/modules/staff/__integration__/`, then the remaining surface. See the INTEGRATION-TEST CANDIDATE comment at the top — do not build the tests until this manual pass confirms the repros.
