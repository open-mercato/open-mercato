# TimeEntryDialog Project Mode and Exported Component Props Schemas

> Issue: #6989 (part C of umbrella #6987). Related: #6988 / PR #6998 (part B: write access checks the entry date against the assignment window).
> Builds on: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md` and `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md` (EP-31 published `propsSchema`s, EP-42 setting-key registry).
> Paths are relative to `packages/core/src/modules/staff/` unless stated otherwise.

## 📝 TLDR

The time entry dialog (`staff.time_entry_dialog`) can only log time against a **task**: the project always comes from the selected task. Teams that track time per project (client, contract, cost centre) and do not use tasks cannot create or edit their entries there, although the data model, the time-entries API and the timesheet grid all accept project-only entries. This spec adds a **project mode** to the dialog. A new tenant setting, `defaults.entryMode` (`'task'` by default), turns it on, and an optional `mode` prop overrides it per host. In project mode the user picks a project from their accessible projects, and the task becomes optional and is filtered to that project. Task mode stays the default and now shows the derived project read-only. The spec also **exports all ten published component `propsSchema`s**, so a replacement can import the exact contract instead of copying it.

## ✅ Decisions (Open Questions resolved on #6989)

| # | Question | Decision |
|---|----------|----------|
| Q1 | How is project mode turned on? | A tenant time-tracking setting `defaults.entryMode: 'task' \| 'project'` (default `'task'`), plus an optional `mode` prop on `TimeEntryDialogProps` that overrides it per host. |
| Q2 | The task in project mode | Optional. The task picker lists only the chosen project's tasks; picking a task sets the project. |
| Q3 | The project in task mode | A read-only "Project · Customer" line under the task picker replaces today's hint text. |
| Q4 | An existing entry with no task | Opens in project mode for that entry, whatever the configured or passed mode. |
| Q5 | Which schemas are exported, from where | All ten published `propsSchema`s, each as a named export from its own component file, documented as STABLE in EP-31. |
| Q6 | One spec or two | One spec and one implementation PR. |

## 📝 Problem Statement

- `lib/time-tracking-ui/TimeEntryDialog.tsx` `validateRequired` blocks saving without a task (`staff.time_tracking.entryDialog.errors.taskRequired`).
- `projectId = selectedTask?.timeProjectId ?? entry?.timeProjectId ?? defaults?.timeProjectId`: the user can never choose a project. An existing project-only entry (written by the grid or the API) cannot be saved from the dialog at all.
- The server already supports project-only entries. `data/validators.ts` declares both `taskId` and `timeProjectId` `optional().nullable()` on create and update, `commands/timesheets-entries.ts` resolves the project from `timeProjectId` when there is no task, and the grid bulk save writes project-only rows.
- `timeEntryDialogPropsSchema` and the nine sibling `propsSchema`s registered for EP-31 are module-local `const`s. A replacement has to re-declare the schema by hand. In development, `useRegisteredComponent` (`packages/ui/src/backend/injection/useRegisteredComponent.tsx`) validates props against the replacement's schema and falls back to the default component on a mismatch. A stale copy therefore silently swaps the replacement out in dev, while production still renders it.

## 📝 Proposed Solution

1. **Setting.** Register one more built-in key in the EP-42 setting-key registry: `defaults.entryMode`, schema `z.enum(['task', 'project'])`, default `'task'`. It is stored, read, validated and defaulted through the existing registry. No new storage, route or migration is needed. The settings page gets one control in its existing "Entry defaults" card.
2. **Dialog mode.** `TimeEntryDialogProps` gains an optional `mode?: 'task' | 'project'`. The effective mode is resolved once per open dialog:
   1. an edited entry with `timeProjectId` set and `taskId` null → `'project'` (Q4);
   2. otherwise the `mode` prop, when passed;
   3. otherwise the tenant's `defaults.entryMode` from the `GET /api/staff/timesheets/settings` response the dialog already loads;
   4. `'task'` when settings are unreadable (the existing `FALLBACK_SETTINGS` path).

   The create seed runs as soon as the dialog opens, before the settings answer on the first open of a session. The setting-driven mode is therefore applied the way the late billable default is today (`billableDefaultRef`): once per open, when the settings arrive, and only while the form is still pristine. A user who already typed keeps the mode they are in. Rules 1 and 2 need no settings and apply at seed time.
3. **Project mode UI.** A project field sits above the task field. It is required in project mode and searches the existing, access-scoped `GET /api/staff/timesheets/time-projects` (`q`, `status=active`). The task field below it becomes optional and is filtered to the chosen project. Picking a task whose project differs from the selected one switches the project to the task's project.
4. **Task mode UI.** Unchanged behaviour (task required, project derived), except that the helper hint under the picker is replaced by a read-only "Project · Customer" line once a task is selected. The hint stays when no task is selected yet.
5. **Schema exports.** Each of the ten `const xPropsSchema` declarations becomes `export const`. Nothing moves; the import path is the component file, already reachable through the `@open-mercato/core/modules/staff/...` wildcard export of `packages/core/package.json`.

### Alternatives considered

- **Prop only** (no setting): hosts would have to opt in one by one, and a task-less team would get nothing until each host page changes. Rejected in Q1.
- **Automatic when there are no tasks:** the mode would flip as soon as anyone creates a task, and "no tasks" is per-caller under access scoping. Rejected in Q1.
- **A schema-only module** re-exporting the schemas: it would have to import the `"use client"` component files (and their `registerComponent` side effects) or move props types out of them. Rejected in Q5.
- **Market check.** Toggl Track, Clockify and Harvest all make the *project* the primary field and the task optional, filtered by project; Harvest additionally requires the task per company setting. A tenant-level switch between "task first" and "project first" matches that range without per-project configuration, which the consulting-suite spec §10 excludes (settings are tenant-global).

## 📝 Architecture

| Area | Change |
|------|--------|
| `lib/time-tracking/settingKeys.ts` | Add `{ group: 'defaults', key: 'entryMode', schema: timeTrackingEntryModeSchema, default: 'task', labelKey: 'staff.time_tracking.settings.defaults.entryMode' }` to `BUILT_IN_SETTING_KEYS`; export `timeTrackingEntryModeSchema = z.enum(['task', 'project'])`. |
| `lib/time-tracking/settings.ts` | Export `TIME_TRACKING_DEFAULTS_ENTRY_MODE_KEY = 'defaults.entryMode'`, append it to `TIME_TRACKING_SETTING_KEYS` (additive; the FROZEN rule forbids renames/removals, not additions), add `entryMode: TimeEntryMode` to `TimeTrackingEntryDefaults`, and export `type TimeEntryMode = 'task' \| 'project'`. |
| `lib/time-tracking-ui/timeTrackingSettingsForm.ts` + `backend/staff/time-tracking/settings/page.tsx` | Add `defaultsEntryMode` to the draft, the read and the write mapping; render a `SegmentedControl` ("Task" / "Project") in the "Entry defaults" card, gated by the page's existing manage feature. |
| `lib/time-tracking-ui/TimeEntryDialog.tsx` | `mode` prop; effective-mode resolution; project field; task filter; validation; read-only project line; export the props schema. `readSettings` reads `defaults.entryMode` with `'task'` as the fallback. |
| `lib/time-tracking-ui/timeEntryDialogState.ts` | A pure `resolveTimeEntryDialogMode({ entry, propMode, settingMode })` helper, so the precedence is unit-tested outside the component. |
| Nine sibling component files (below) | `const` → `export const` on the `propsSchema` declaration only. |
| `widgets/components.ts` / EP-31 docs | The handle catalogue documents the exported schema name next to each handle. |

The ten exported schemas and their files:

| Handle | Export | File |
|--------|--------|------|
| `staff.time_entry_dialog` | `timeEntryDialogPropsSchema` | `lib/time-tracking-ui/TimeEntryDialog.tsx` |
| `staff.timer_bar` | `timerBarPropsSchema` | `lib/timesheets-ui/TimerBar.tsx` |
| `staff.kanban_card` | `kanbanCardPropsSchema` | `lib/time-tracking-ui/KanbanCard.tsx` |
| `staff.kanban_column` | `kanbanColumnPropsSchema` | `lib/time-tracking-ui/KanbanColumn.tsx` |
| `staff.timesheet_grid` | `gridViewPropsSchema` | `backend/staff/time-tracking/timesheet/GridView.tsx` |
| `staff.timesheet_list` | `listViewPropsSchema` | `lib/timesheets-ui/ListView.tsx` |
| `staff.timesheet_calendar` | `timesheetCalendarPropsSchema` | `lib/time-tracking-ui/TimesheetCalendar.tsx` |
| `staff.report_sheet` | `reportSheetPropsSchema` | `lib/time-tracking-ui/ReportSheet.tsx` |
| `staff.project_card` | `projectCardPropsSchema` | `lib/timesheets-projects-ui/ProjectCard.tsx` |
| `staff.entries_summary_footer` | `timeEntriesSummaryFooterPropsSchema` | `lib/time-tracking-ui/TimeEntriesSummaryFooter.tsx` |

No host page changes: every host (`backend/staff/time-tracking/page.tsx`, `timesheet/page.tsx`, `entries/page.tsx`) picks the mode up from the setting. That keeps this change off the entries list page (#6990 is changing it) and off the write path (PR #6998).

### Access

No new access logic. The project field reads `GET /api/staff/timesheets/time-projects`, which already intersects rows with `resolveProjectAccess` for callers without `staff.timesheets.projects.manage` (active memberships whose window, extended by `access.assignmentGraceDays`, contains today), and returns all projects to managers, who may write anywhere. The default `employee` role holds `staff.timesheets.projects.view`. Writes stay authorised server-side by the PR #6998 rule (membership today **and** the entry's date inside a granting assignment window). The dialog does not pre-filter by the entry's date; a 403 reaches the user through the dialog's existing error path.

## 📝 Data Model

None. No entity, column or migration changes. The new setting is one more `ModuleConfigService` row under module `staff.time_tracking` (name `defaults.entryMode`, tenant scope), created only when an admin saves the settings page; an absent row reads as the default `'task'`.

## 📝 API Contracts

- **`GET/PUT /api/staff/timesheets/settings`** — additive: the `defaults` group gains `entryMode: 'task' | 'project'`. The PUT schema is built from the registry, so it accepts the key and defaults it when omitted; existing clients that send no `entryMode` keep working. The OpenAPI doc picks it up from the same registry.
- **`TimeEntryDialogProps`** — additive optional `mode?: 'task' | 'project'`; `timeEntryDialogPropsSchema` gains `mode: z.enum(['task', 'project']).optional()`. A replacement that does not declare `mode` still validates, because `z.object` strips unknown keys.
- **Exported schemas** — ten new named exports (table above). Per `BACKWARD_COMPATIBILITY.md` (types and import paths) they become STABLE contract: shape changes from now on are additive-only.
- **Injection context** — the `entryFormValues` passed to injected widgets (`onFieldChange`, render spots) gain `timeProjectId`. Additive, but observable to widgets.
- The exported schemas keep their declared type `z.ZodType<Props>`: they are for `metadata.propsSchema` of a replacement, used as is. Consumers that want to `.extend()` one must wrap it (`z.intersection`); this is documented next to the exports in EP-31.
- No change to `POST/PUT /api/staff/timesheets/time-entries`, the bulk route or any command.

## 📝 UI/UX

Illustrative mockups: [project mode](assets/time-entry-dialog-project-mode/mockup-01-dialog-project-mode.png), [project required](assets/time-entry-dialog-project-mode/mockup-02-dialog-project-required.png), [task mode with the project line](assets/time-entry-dialog-project-mode/mockup-03-dialog-task-mode.png), [settings row](assets/time-entry-dialog-project-mode/mockup-04-settings-entry-defaults.png).

**Settings page — "Entry defaults" card.** A new row: label "New entries are logged against", a `SegmentedControl` with "a task" / "a project", and a hint: "Project mode lets people log time to a project without picking a task. Tasks stay optional." It saves with the page's existing Save button.

**Dialog — project mode** (top of the form):

1. **Project** \* — a searchable combobox (`ComboboxInput` from `@open-mercato/ui/backend/inputs`, `allowCustomValues={false}`, `loadSuggestions` + `resolveLabel`), the same dropdown shape as the task field, over `time-projects?q=…&status=active&pageSize=50` (the first page loads on open with an empty term; `q` matches the project name), each option showing the project name and, when present, the customer. Seeded from `entry.timeProjectId`, else `defaults.timeProjectId`. The selected project that is not on the first page is resolved through `time-projects?ids=…` (the same pinning pattern the task picker uses). That route answers **404** (not an empty list) for a project the caller cannot access; the dialog treats any non-ok pin response as "unresolved", shows the fallback label `projectUnavailable` and flashes nothing. Every project the field resolves (search results and the pinned one) is merged into the dialog's `projectById` map, so rate, currency and cost previews work for a project beyond the existing first-100 directory.
2. **Task** (optional) — the existing `TaskPicker`. Its directory and search requests add `timeProjectId=<selected>`, and the recent-task ids, the pinned task and the by-id task lookup are filtered to the selected project too, so no task from another project is offered; without a selected project it lists nothing and says "Pick a project first". Choosing a task from another project (possible only through a seeded `defaults.taskId`) sets the project to the task's project. Changing the project clears a task that belongs to a different project.
3. Hint under the task: "Optional — leave empty to log the time to the project."
4. Required-field error under the project field: "Pick the project this time belongs to." The task error is not shown in project mode. `FieldIssues`/`readFieldIssues` gain a `project` key, so a server field error on `timeProjectId` lands under the field instead of a toast.
5. Keyboard loop (T7.4): the initial focus and the post-"save and add another" focus go to the project field in project mode, the task picker in task mode.

**Dialog — task mode:** unchanged, except that when a task is selected the hint line becomes a read-only line "Project: {project} · {customer}" in `text-muted-foreground` (customer omitted when the project has none; the project name falls back to the code when the projects list was not readable). With no task selected the existing hint stays.

**Locked entry:** both fields render disabled, as today.

**Dirty tracking:** `FormValues` gains `timeProjectId`, and `formSnapshot` includes it **in project mode only**. In task mode the project is derived from the task and may resolve after the seed (for example `defaults.taskId` without `timeProjectId`), so snapshotting it there would open the form dirty.

**Payload:** in project mode `buildPayload` sends `timeProjectId` from the project field and `taskId` (possibly null); in task mode it is unchanged.

### i18n keys (en/de/es/ko/pl — all five staff locale files)

- `staff.time_tracking.settings.defaults.entryMode` — "New entries are logged against"
- `staff.time_tracking.settings.defaults.entryModeHint` — "Project mode lets people log time to a project without picking a task. Tasks stay optional."
- `staff.time_tracking.settings.defaults.entryModeTask` — "a task"
- `staff.time_tracking.settings.defaults.entryModeProject` — "a project"
- `staff.time_tracking.entryDialog.project` — "Project"
- `staff.time_tracking.entryDialog.projectPlaceholder` — "Search projects"
- `staff.time_tracking.entryDialog.projectEmpty` — "No projects you can log time to."
- `staff.time_tracking.entryDialog.taskOptionalHint` — "Optional — leave empty to log the time to the project."
- `staff.time_tracking.entryDialog.projectUnavailable` — "Project not available"
- `staff.time_tracking.entryDialog.taskPickProjectFirst` — "Pick a project first"
- `staff.time_tracking.entryDialog.projectReadOnly` — "Project: {project}"
- `staff.time_tracking.entryDialog.projectReadOnlyWithCustomer` — "Project: {project} · {customer}"
- `staff.time_tracking.entryDialog.errors.projectRequired` — "Pick the project this time belongs to."

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| Settings request fails or is slow | The mode falls back to `'task'` (existing `FALLBACK_SETTINGS`); a `mode` prop still wins. The mode is fixed when the form is seeded, so a late settings response does not flip the open form. |
| Caller lacks `staff.timesheets.projects.view` | The projects request fails; in project mode the project field shows `projectEmpty` and Save stays blocked by the required project. Task mode is unaffected (it already treats the project list as best effort). |
| Caller has no accessible projects | The route returns an empty list; the field shows `projectEmpty`. |
| Entry date outside the assignment window (PR #6998) | The server answers 403; the existing failure path flashes the translated message and the dialog stays open. |
| Edit an entry whose task is set, in project mode | The project field shows the entry's project and the task stays selected; clearing the task saves a project-only entry. |
| Edit a project-only entry with the tenant in task mode | Opens in project mode (Q4); saving keeps it project-only. |
| Edit an entry whose project is archived or no longer accessible | The project is pinned by id when the API still returns it; a 404 or other non-ok pin shows `projectUnavailable` with no flash, and the server decides on save (403 surfaces as above). |
| First open of a session, project-mode tenant | The form seeds in task mode, then switches to project mode when settings arrive, because the form is still pristine. |
| Settings arrive after the user typed | The mode does not change under the user. |
| Seeded `defaults.taskId` from another project | The project follows the task. |
| `defaults.entryMode` holds an unknown stored value | The registry rejects it and returns the default `'task'`. |
| A replacement registered with an old copied schema | Still validates (`mode` is optional); no behaviour change. |

## 📝 Risks & Impact Review

- **Blast radius: medium.** One large shared component (~1,900 lines) changes, but only behind a mode that defaults to the current behaviour. With the setting at its default and no `mode` prop, the only visible change is the read-only project line in task mode (Q3).
- **Contract surfaces** (`BACKWARD_COMPATIBILITY.md`): additive only — one settings key (FROZEN list grows, nothing renamed), one optional prop, one injection-context field, ten new exports. No route, event, ACL, DI or schema change.
- **Built-in key collision:** a third-party module that already contributes `defaults.entryMode` through `registerTimeTrackingSettingKey` would now throw at load (a contribution cannot replace a built-in). The risk is small (the key is new), but it gets an `UPGRADE_NOTES.md` line.
- **Rebase overlap:** PR #6998 (not merged) edits `commands/timesheets-entries.ts`, the bulk route and the five staff locale files; #6990 edits `entries/page.tsx`, the time-entries list route and `DataTable`/`FilterBar`. This change touches neither command nor route, and avoids `entries/page.tsx`; the locale files will need a trivial merge.
- **Rollback:** revert the PR. A stored `defaults.entryMode` row becomes an unregistered key and is ignored by the registry-driven read; project-only entries created meanwhile are valid data the API already supported.

## 📋 Phasing

- **Phase 1 — Export the published props schemas.** Independently shippable, no behaviour change.
- **Phase 2 — The `defaults.entryMode` setting.** Key, types, settings page control, locales. No dialog change yet; the stored value is simply unused.
- **Phase 3 — Dialog project mode.** Mode resolution, project field, task filtering, validation, payload, read-only project line, tests and docs.

## 📋 Implementation Plan

### Phase 1 — Exported schemas
1. As its own commit (so it can be reverted alone): change the ten `const …PropsSchema` declarations to `export const` (files in the Architecture table). Add a unit test `lib/time-tracking/__tests__/componentSchemaExports.test.ts` that imports each export and asserts it is a zod schema that accepts a minimal valid props object for its component (and rejects one with a non-function callback). Verify: the test passes; `yarn typecheck`.
2. Document the exports in the EP-31 section of `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md` (changelog entry) and in the staff `AGENTS.md` component-replacement notes. Verify: `yarn agents:check-budget`.

### Phase 2 — Setting
3. Add `timeTrackingEntryModeSchema` and the built-in `defaults.entryMode` key in `settingKeys.ts`; add the constant, the type and the `TimeTrackingEntryDefaults.entryMode` field in `settings.ts`. Keep `TIME_TRACKING_SETTING_KEYS` and the built-in id set in lockstep (`settingKeys.test.ts` asserts they are equal), and update every hard-coded "eight" (comments in `settings.ts`, `settingKeys.ts`, `timeTrackingSettingsForm.ts`, `data/validators.ts`, staff `AGENTS.md`, the tests). Update `settingKeys.test.ts` / `settings.test.ts` (nine built-ins; default `'task'`; an invalid stored value falls back). Add the `UPGRADE_NOTES.md` line. Verify: those tests.
4. Settings page: extend `timeTrackingSettingsForm.ts` (draft field, read, write) and render the `SegmentedControl` row in the "Entry defaults" card; add the four settings locale keys to all five locale files. Extend the form-mapping unit test. Verify: unit tests, `yarn i18n:check-sync`.

### Phase 3 — Dialog
5. Add `resolveTimeEntryDialogMode` to `timeEntryDialogState.ts` with unit tests for the four precedence rules. Verify: `timeEntryDialogState.test.ts`.
6. Dialog plumbing: `mode` prop and schema field, `readSettings` reads `entryMode`, resolve the mode at seed time (rules 1–2) and apply the setting late while pristine (rule 3, `billableDefaultRef` pattern), add a unit test where settings resolve after the dialog opens, add `timeProjectId` to form state, `FormValues`, `formSnapshot`, `resetForm` and `buildPayload`; in task mode `timeProjectId` stays derived exactly as today. Verify: the existing `TimeEntryDialog.test.tsx` stays green.
7. Project field and task filter: the `ComboboxInput` project field (search + pinned selection; non-ok pin → `projectUnavailable`; resolved projects merged into `projectById`), `timeProjectId` filter on the task directory/search requests and on recent/pinned/by-id tasks, `project` in `FieldIssues`/`readFieldIssues`, project↔task consistency rules, mode-aware `validateRequired` and focus target, the read-only project line in task mode, and the dialog locale keys in all five files. Extend `TimeEntryDialog.test.tsx`: project mode saves a project-only entry; task optional; filtered task requests; task from another project switches the project; project-only entry opens in project mode under task default; prop overrides setting; project required error; read-only line in task mode; a 404 pin shows the fallback label without a flash; rate preview uses a searched project beyond the first page. Verify: unit tests, `yarn i18n:check-sync`, `yarn i18n:check-usage`.
8. Integration test `__integration__/TC-TT-024.spec.ts` (self-contained, API fixtures, cleanup in `finally`): set `defaults.entryMode=project` via `PUT /api/staff/timesheets/settings` (restore the previous value in teardown); create a customer, a project and a membership for the test user; open "Add entry" from the timesheet, pick the project, leave the task empty, enter a duration, save, and assert via `GET /api/staff/timesheets/time-entries?ids=…` that `taskId` is null and `timeProjectId` matches; reopen the entry and assert project mode with the project selected. Second case (access scoping): as an employee-role user created in setup, member of project A but not project B, the project field lists A and not B. Third case: with the setting at `task`, the dialog shows the read-only project line after picking a task. Verify: `yarn test:integration` for the spec.
9. Docs: the staff `AGENTS.md` (entry dialog modes and the new setting) and a changelog entry on the consulting-suite spec (there is no time-tracking page under `apps/docs/docs/` today). Run the full validation gate.

## 🧪 Integration Coverage

| Path | Coverage |
|------|----------|
| `PUT/GET /api/staff/timesheets/settings` (`defaults.entryMode`) | TC-TT-024 setup and teardown; `settings.test.ts` |
| `GET /api/staff/timesheets/time-projects?q=&status=active` from the dialog | TC-TT-024 (project picked through the UI; employee sees only the accessible project) |
| `GET /api/staff/timesheets/tasks?timeProjectId=` from the dialog | `TimeEntryDialog.test.tsx` |
| `POST /api/staff/timesheets/time-entries` with `taskId: null` from the dialog | TC-TT-024 |
| `PUT /api/staff/timesheets/time-entries` of a project-only entry from the dialog | TC-TT-024 (reopen and save) |
| Settings page "Entry defaults" control | Form-mapping unit test; manual QA screenshot |
| Task-mode read-only project line | TC-TT-024 case 3 |

## ✅ Final Compliance Report

| Rule | Status |
|------|--------|
| Tenant scoping / no cross-tenant data | Pass — reads go through existing scoped routes; the setting is tenant-scoped by the registry. |
| No direct ORM relationships, no new entities | Pass — no data-model change. |
| Canonical primitives (`apiCall`, `ComboboxInput`, `useGuardedMutation`, settings registry) | Pass — nothing parallel is invented. |
| i18n — no hard-coded strings, all five locales | Pass — keys listed above; every key goes into en/de/es/ko/pl. |
| DS tokens | Pass — `text-muted-foreground`, existing status tokens for errors. |
| Backward compatibility | Pass — additive only; key-collision risk noted with an `UPGRADE_NOTES.md` line. |
| Integration coverage for affected API and UI paths | Pass — TC-TT-024 plus unit tests (table above). |

## 📝 Changelog

- 2026-10-07 — Initial spec for #6989; Open Questions Q1–Q6 resolved on the issue (all option A).
- 2026-10-07 — Fresh-context review applied: late setting application, project-mode-only dirty snapshot, `projectById` merge, 404 pin handling, `ComboboxInput` instead of `LookupSelect`, task filtering of recent/pinned tasks, access-scoping integration case, key-collision and "eight" wording notes, sibling i18n key names.
