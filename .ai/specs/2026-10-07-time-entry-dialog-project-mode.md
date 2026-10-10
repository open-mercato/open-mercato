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
   4. `'task'` when settings are unreadable (the existing `FALLBACK_SETTINGS` path) or carry no `entryMode` (the field is optional on the exported type).

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
| `lib/time-tracking/settings.ts` | Export `TIME_TRACKING_DEFAULTS_ENTRY_MODE_KEY = 'defaults.entryMode'`, append it to `TIME_TRACKING_SETTING_KEYS` (additive; the FROZEN rule forbids renames/removals, not additions), export `type TimeEntryMode = 'task' \| 'project'`, and add an **optional** `entryMode?: TimeEntryMode` to the exported `TimeTrackingEntryDefaults` (and through it to `TimeTrackingSettings['defaults']`). Absent means `'task'`; see [Typed settings compatibility](#typed-settings-compatibility-entrymode). |
| `lib/time-tracking-ui/timeTrackingSettingsForm.ts` + `backend/staff/time-tracking/settings/page.tsx` | Add an optional `defaultsEntryMode?` to the exported `TimeTrackingSettingsDraft`, and add it to the read mapping (`settings.defaults.entryMode ?? 'task'`), the write mapping and the dirty check (each falls back to `'task'`); render a `SegmentedControl` ("Task" / "Project") in the "Entry defaults" card, gated by the page's existing manage feature. |
| `lib/time-tracking-ui/TimeEntryDialog.tsx` | `mode` prop; effective-mode resolution; mode-aware validation, payload, focus and dirty snapshot; task filter; read-only project line; mounts the project field leaf; export the props schema. `readSettings` reads `defaults.entryMode` with `'task'` as the fallback. Net growth is capped (see [Frontend Architecture Contract](#-frontend-architecture-contract)). |
| `lib/time-tracking-ui/TimeEntryProjectField.tsx` (new) | The project-mode field as its own client leaf: `ComboboxInput`, project search and pin lookup, the `projectUnavailable` fallback label. It reports every project it resolves to the dialog through a callback, for the `projectById` merge. |
| `lib/time-tracking-ui/timeEntryDialogState.ts` | A pure `resolveTimeEntryDialogMode({ entry, propMode, settingMode })` helper, so the precedence is unit-tested outside the component. `settingMode` accepts `undefined` and treats anything but `'project'` as `'task'`. |
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

## 📝 Frontend Architecture Contract

This section follows `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`. The numbers come from `develop` at `bdf2d0456` and from `node scripts/check-client-boundaries.mjs --json` run on that tree.

### 1. Server/Client boundary map

| Route / surface | Server root | Client islands | Data owner | Notes |
|---|---|---|---|---|
| `/backend/staff/time-tracking`, `/backend/staff/time-tracking/timesheet`, `/backend/staff/time-tracking/entries` (dialog hosts) | `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` (server component; resolves the module page from the route manifest) | The existing module page roots `backend/staff/time-tracking/page.tsx` (854 LOC), `timesheet/page.tsx` (800) and `entries/page.tsx` (1,229) are `"use client"`. Each mounts `TimeEntryDialog`, which resolves the `staff.time_entry_dialog` handle through `useRegisteredComponent` and renders `DefaultTimeEntryDialog`. In project mode that dialog renders the new `TimeEntryProjectField` leaf. | Client queries through `apiCall`: `GET /api/staff/timesheets/settings`, `/time-projects`, `/tasks`, plus the existing `POST`/`PUT /time-entries` | No host page is edited. The dialog's queries are `enabled: open`, so nothing new runs during SSR or page hydration. |
| `/backend/staff/time-tracking/settings` | Same catch-all server root | Existing `"use client"` page root `settings/page.tsx` (701 LOC). It gains one `SegmentedControl` row in the "Entry defaults" card and nothing else. | `GET`/`PUT /api/staff/timesheets/settings` through the page's existing load and save | The draft mapping lives in the pure module `timeTrackingSettingsForm.ts`. |

No new route, page root, layout or provider is added.

### 2. `"use client"` ledger

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `lib/time-tracking-ui/TimeEntryDialog.tsx` (existing, touched) | A stateful modal form: `@tanstack/react-query` queries, focus management through `requestAnimationFrame`, keyboard shortcuts, `InjectionSpot` events, `useGuardedMutation`, and the `registerComponent` side effect for its handle. | The three host pages | No new dependency. It keeps `@tanstack/react-query` and `lucide-react`, which the backend shell already loads. | Effects are keyed on `open`. The new effects (late mode application, refocus after a mode switch) must cancel their `requestAnimationFrame` in cleanup. The resolved-project lookup map is reset on every open. | Server component: impossible, because this is an interactive form inside client host pages. |
| `lib/time-tracking-ui/TimeEntryProjectField.tsx` (new) | Async typeahead: `ComboboxInput` with `loadSuggestions` (debounced 200 ms inside `ComboboxInput`, stale results cancelled), `resolveLabel` for the pinned project, and the unavailable fallback. | `TimeEntryDialog.tsx` only | None. `ComboboxInput` comes from `@open-mercato/ui/backend/inputs`. | The `ComboboxInput` timer is cleared on unmount. The leaf mounts only in project mode, so task-mode dialogs pay nothing. | Inline in the dialog: rejected, because it grows an already 1,929-line client file (see §3). |
| `backend/staff/time-tracking/settings/page.tsx` (existing page root, touched) | The existing client settings form | The generated backend route manifest | None new. `SegmentedControl` is a `@open-mercato/ui` primitive. | None new | Converting the page to a server root: out of scope. It belongs to the backend page-root migration in `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md`. |

`timeEntryDialogState.ts`, `timeTrackingSettingsForm.ts`, `settings.ts` and `settingKeys.ts` stay plain modules without a directive. All new logic that does not need the DOM (mode precedence, settings mapping, the `entryMode` fallback) goes there, where it can be unit-tested without rendering. `TaskPicker.tsx` is not touched: the dialog passes it the filtered options.

### 3. Client blob guardrail (files over 300 LOC)

- `TimeEntryDialog.tsx` is 1,929 LOC on `develop`, far past the 300-line guard, and all of that size predates this spec. Splitting the whole dialog is out of scope. It would rewrite the published `staff.time_entry_dialog` default component and every one of its tests, which belongs in its own change. This spec takes a **documented temporary exception** for the existing file, with two limits:
  1. **New UI goes into new leaves.** The project field (search, pin lookup, option rendering, unavailable label) ships as `TimeEntryProjectField.tsx`, under 300 LOC. The mode precedence ships in the pure `timeEntryDialogState.ts`. The dialog keeps only the wiring: mode state, `timeProjectId` in form state, validation, payload, dirty snapshot, focus target, and the task-mode read-only line.
  2. **Growth cap.** `TimeEntryDialog.tsx` may grow by at most **+200 LOC** net over its `develop` base (measured with `wc -l`).
- Exit criterion and migration task: a follow-up issue decomposes `TimeEntryDialog.tsx` into leaves of at most 300 LOC (interval fields, task section, details and tags, footer and actions). The implementation PR opens it and links it here.
- `settings/page.tsx` (701 LOC) and the three host pages are existing oversized client page roots. They are listed by `check:client-boundaries` today, and none of them is in an allowlist, because `.ai/client-boundary-allowlist.json` does not exist. This change adds about 30 lines to the settings page and nothing to the host pages. Their migration belongs to the client-boundary spec named above, not to this one.

### 4. Budgets

| Budget | Default target | Spec value |
|---|---|---|
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 new. The `check:client-boundaries` page-root counts do not change. At `bdf2d0456` they are 287 page roots, 262 of them backend. |
| Touched client page/root files over 300 LOC | 0 unless justified | `settings/page.tsx` (701, +~30 lines, existing page root) is justified in §3. No new oversized file. |
| Touched client leaves over 300 LOC | 0 unless justified | `TimeEntryDialog.tsx`: the exception in §3, with net growth of at most +200 LOC. `TimeEntryProjectField.tsx`: under 300 LOC. |
| Heavy browser libraries at page/provider root | 0 | 0 new. The heavy-import hits in `check:client-boundaries` stay the same, and the existing `@tanstack/react-table` hits on the host pages are not touched. |
| Interactivity | — | One project search request per settled term (200 ms debounce in `ComboboxInput`), `pageSize=50`. At most one pin request (`time-projects?ids=`) per selected project that is not on the first page. The task directory and search queries are keyed on the selected project, so changing the project issues one new directory request. No request runs while the dialog is closed or in task mode. |
| Memory | — | Query results live in the existing `DIALOG_QUERY_ROOT` react-query cache with the dialog's current stale times (60 s for directories, 300 s for settings). The resolved-project map holds only the projects resolved during one open and is cleared on the next seed. No global listener or interval is added. |
| Per-route hydration smoke test | Required for each changed interactive route | TC-TT-024 loads the entries page (a dialog host) and the settings page in a real browser and interacts with both (cases 1 and 5). |
| Performance evidence | Static check + one runtime/build/bundle/RSS signal when feasible | Static: `yarn check:client-boundaries` output before and after, plus `wc -l` for the dialog and the new leaf. Build: `yarn build:app` succeeds. A bundle or RSS measurement is not required, because no dependency is added and no provider or page root changes. |

### 5. Provider / bootstrap scope

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
|---|---|---|---|---|
| `QueryProvider` (`@open-mercato/ui/theme/QueryProvider`, mounted by `AppProviders` and the backend `AppShell`) | Yes (existing) | Consumed, not changed | The dialog's queries | n/a. Nothing is added. |
| `BackendChromeProvider`, the confirm dialog, the i18n context, the organization scope (all existing, from the backend shell) | Backend shell (existing) | Consumed, not changed | The dialog already uses them | n/a |
| Component registry (`registerComponent` / `useRegisteredComponent`) | Module side effect (existing) | Unchanged handle `staff.time_entry_dialog`. The new leaf is not registered as a handle. | Keeps the EP-31 replacement surface as it is | n/a |

No provider is added, and nothing is added to the global bootstrap.

### 6. Test and evidence plan

- Hydration and route load: TC-TT-024 cases 1 to 4 open the dialog on the entries page, and case 5 loads, saves and reloads the settings page (see [Integration Coverage](#-integration-coverage)).
- Key interactions: the `TimeEntryDialog.test.tsx` cases listed in step 7, plus unit tests for `TimeEntryProjectField` (search, pin, 404 fallback).
- `yarn check:client-boundaries`: attach the before and after summaries to the implementation PR. The page-root counts and heavy-import hits must not change.
- `wc -l` of `TimeEntryDialog.tsx` against the base, and of `TimeEntryProjectField.tsx`: attach both to the implementation PR to show the +200 cap and the 300-line limit hold.

## 📝 Data Model

None. No entity, column or migration changes. The new setting is one more `ModuleConfigService` row under module `staff.time_tracking` (name `defaults.entryMode`, tenant scope), created only when an admin saves the settings page; an absent row reads as the default `'task'`.

## 📝 API Contracts

- **`GET/PUT /api/staff/timesheets/settings`** — additive: the `defaults` group gains `entryMode: 'task' | 'project'`. The PUT schema is built from the registry, so it accepts the key and defaults it when omitted; existing clients that send no `entryMode` keep working. The OpenAPI doc picks it up from the same registry.
- **Typed settings** — `TimeTrackingEntryDefaults.entryMode` is optional; see below.
- **`TimeEntryDialogProps`** — additive optional `mode?: 'task' | 'project'`; `timeEntryDialogPropsSchema` gains `mode: z.enum(['task', 'project']).nullable().optional()` (the prop is `TimeEntryMode | null`, `null` meaning "use the setting"). A replacement that does not declare `mode` still validates, because `z.object` strips unknown keys.
- **Exported schemas** — ten new named exports (table above). Per `BACKWARD_COMPATIBILITY.md` (types and import paths) they become STABLE contract: shape changes from now on are additive-only.
- **Injection context** — the `entryFormValues` passed to injected widgets (`onFieldChange`, render spots) gain `timeProjectId`. Additive, but observable to widgets.
- The exported schemas keep their declared type `z.ZodType<Props>`: they are for `metadata.propsSchema` of a replacement, used as is. Consumers that want to `.extend()` one must wrap it (`z.intersection`); this is documented next to the exports in EP-31.
- No change to `POST/PUT /api/staff/timesheets/time-entries`, the bulk route or any command.

### Typed settings compatibility (`entryMode`)

`TimeTrackingEntryDefaults` and `TimeTrackingSettings` are exported from `lib/time-tracking/settings.ts`, which is published through the `./*` export of `@open-mercato/core`. Under `BACKWARD_COMPATIBILITY.md` they are STABLE types, and only additive changes are allowed. A required field would break every existing typed object literal of either type, such as a test fixture, a mock or a contributed settings UI. So:

- **The field is optional**: `entryMode?: TimeEntryMode` on the exported type, and `defaultsEntryMode?` on the exported `TimeTrackingSettingsDraft` for the same reason. No second, "normalized" internal type is added. One fallback expression per consumer is cheaper than a parallel type that has to be kept in sync.
- **It is normalized at read time.** The server read (`readTimeTrackingSettings` / `normalizeTimeTrackingSettings`) fills every absent key from the registry default, so the `GET` response always carries `entryMode`. Code that receives the type still treats absence as `'task'`: `toSettingsDraft` reads `settings.defaults.entryMode ?? 'task'`, `toSettingsPayload` and `isSettingsDraftDirty` read `draft.defaultsEntryMode ?? 'task'`, the dialog's `readSettings` maps anything but `'project'` to `'task'`, and `resolveTimeEntryDialogMode` does the same for `settingMode`.
- **Writers always send it.** `toSettingsPayload` always includes `entryMode`, and the PUT schema defaults it when a caller omits it.
- The compile fixture follows the repo's `*.typecheck.tsx` convention (precedent: `packages/shared/src/lib/i18n/config.typecheck.tsx`).
- **A legacy-shape compile fixture** keeps the pre-change shape compiling (Implementation Plan step 3). It must live outside `__tests__`. `packages/core`'s `tsconfig.json` excludes `**/__tests__/**` from `yarn typecheck`, and the core Jest transform (ts-jest with `isolatedModules`) only transpiles. I checked this: a test file with a type error still passes. A fixture inside `__tests__` would therefore prove nothing.
- No `UPGRADE_NOTES.md` entry is needed for the type, because nothing breaks. The key-collision note below stays.

## 📝 UI/UX

Illustrative mockups: [project mode](assets/time-entry-dialog-project-mode/mockup-01-dialog-project-mode.png), [project required](assets/time-entry-dialog-project-mode/mockup-02-dialog-project-required.png), [task mode with the project line](assets/time-entry-dialog-project-mode/mockup-03-dialog-task-mode.png), [settings row](assets/time-entry-dialog-project-mode/mockup-04-settings-entry-defaults.png).

**Settings page — "Entry defaults" card.** A new row: label "New entries are logged against", a `SegmentedControl` with "a task" / "a project", and a hint: "Project mode lets people log time to a project without picking a task. Tasks stay optional." It saves with the page's existing Save button.

**Dialog — project mode** (top of the form):

1. **Project** \* — rendered by the `TimeEntryProjectField` leaf: a searchable combobox (`ComboboxInput` from `@open-mercato/ui/backend/inputs`, `allowCustomValues={false}`, `loadSuggestions` + `resolveLabel`), the same dropdown shape as the task field, over `time-projects?q=…&status=active&pageSize=50` (the first page loads on open with an empty term; `q` matches the project name), each option showing the project name and, when present, the customer. Seeded from `entry.timeProjectId`, else `defaults.timeProjectId`. The selected project that is not on the first page is resolved through `time-projects?ids=…` (the same pinning pattern the task picker uses). That route answers **404** (not an empty list) for a project the caller cannot access; the dialog treats any non-ok pin response as "unresolved", shows the fallback label `projectUnavailable` and flashes nothing. Every project the field resolves (search results and the pinned one) is merged into the dialog's `projectById` map, so rate, currency and cost previews work for a project beyond the existing first-100 directory.
2. **Task** (optional) — the existing `TaskPicker`. Its directory and search requests add `timeProjectId=<selected>`, and the recent-task ids, the pinned task and the by-id task lookup are filtered to the selected project too, so no task from another project is offered; without a selected project it lists nothing and says "Pick a project first". Choosing a task from another project (possible only through a seeded `defaults.taskId`) sets the project to the task's project. Changing the project clears a task that belongs to a different project.
3. Hint under the task: "Optional — leave empty to log the time to the project."
4. Required-field error under the project field: "Pick the project this time belongs to." The task error is not shown in project mode. `FieldIssues`/`readFieldIssues` gain a `project` key, so a server field error on `timeProjectId` lands under the field instead of a toast.
5. Keyboard loop (T7.4): the initial focus and the post-"save and add another" focus go to the project field in project mode, the task picker in task mode.

**Dialog — task mode:** unchanged, except that when a task is selected the hint line becomes a read-only line "Project: {project} · {customer}" in `text-muted-foreground` (customer omitted when the project has none; when the projects list was not readable the original hint stays). With no task selected the existing hint stays.

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
| Settings request fails (non-ok answer or a thrown request) | No tenant mode is known, so the dialog stays in the mode it was seeded with. That is `'task'`, unless rule 1 (a project-only entry) or rule 2 (a `mode` prop) chose otherwise at seed time. The dialog uses `FALLBACK_SETTINGS`, does not retry inside the open dialog, and flashes nothing. A later open reads the settings again under the existing query-cache rules. |
| Settings request is slow but succeeds | The same rule as Proposed Solution §2 applies: the setting is applied **once per open, only while the form is pristine**, and never over rules 1 and 2. If nothing was typed when the answer arrives, the form switches to the tenant mode (the row "First open of a session, project-mode tenant" below). If the user has already typed, the mode stays as seeded (the row "Settings arrive after the user typed" below). An answer that arrives after that one check does not flip the form again. |
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

- **Blast radius: medium.** One large shared component (~1,900 lines) changes, but only behind a mode that defaults to the current behaviour. New project-mode UI goes into a separate leaf, and the dialog's growth is capped (see the Frontend Architecture Contract). With the setting at its default and no `mode` prop, the only visible change is the read-only project line in task mode (Q3).
- **Contract surfaces** (`BACKWARD_COMPATIBILITY.md`): additive only — one settings key (FROZEN list grows, nothing renamed), one **optional** field on the exported `TimeTrackingEntryDefaults` type (a legacy-shape compile fixture guards it), one optional prop, one injection-context field, ten new exports. No route, event, ACL, DI or schema change.
- **Built-in key collision:** a third-party module that already contributes `defaults.entryMode` through `registerTimeTrackingSettingKey` would now throw at load (a contribution cannot replace a built-in). The risk is small (the key is new), but it gets an `UPGRADE_NOTES.md` line.
- **Rebase overlap:** PR #6998 (not merged) edits `commands/timesheets-entries.ts`, the bulk route and the five staff locale files; #6990 edits `entries/page.tsx`, the time-entries list route and `DataTable`/`FilterBar`. This change touches neither command nor route, and avoids `entries/page.tsx`; the locale files will need a trivial merge.
- **Rollback:** revert the PR. A stored `defaults.entryMode` row becomes an unregistered key and is ignored by the registry-driven read; project-only entries created meanwhile are valid data the API already supported.

## 📋 Phasing

- **Phase 1 — Export the published props schemas.** Independently shippable, no behaviour change.
- **Phase 2 — The `defaults.entryMode` setting.** Key, types, settings page control, locales. No dialog change yet; the stored value is simply unused.
- **Phase 3 — Dialog project mode.** Mode resolution, project field, task filtering, validation, payload, read-only project line, tests and docs.

## 📋 Implementation Plan

### Phase 1 — Exported schemas
1. As its own commit (so it can be reverted alone): change the ten `const …PropsSchema` declarations to `export const` (files in the Architecture table). Add a unit test `lib/time-tracking-ui/__tests__/componentPropsSchemas.test.tsx` that imports each export and asserts it is a zod schema that accepts a minimal valid props object for its component (and rejects one with a non-function callback). Verify: the test passes; `yarn typecheck`.
2. Document the exports in the EP-31 section of `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md` (changelog entry) and in the staff `AGENTS.md` component-replacement notes. Verify: `yarn agents:check-budget`.

### Phase 2 — Setting
3. Add `timeTrackingEntryModeSchema` and the built-in `defaults.entryMode` key in `settingKeys.ts`; add the constant, the type and the **optional** `TimeTrackingEntryDefaults.entryMode?` field in `settings.ts`. Every consumer of the type falls back to `'task'` when the field is absent (`toSettingsDraft`, the dialog's `readSettings`, `resolveTimeEntryDialogMode`). Add the **legacy-shape compile fixture** `lib/time-tracking/settings.typecheck.tsx`. It follows the `*.typecheck.tsx` convention, is imported by nothing at runtime, and sits outside `__tests__` so that `yarn typecheck` compiles it. It assigns the pre-change literal `{ billable: true, chainStartFromPreviousEnd: false }` to `TimeTrackingEntryDefaults`, a pre-change settings literal (all eight built-in keys, no `entryMode`) to `TimeTrackingSettings`, and a draft without `defaultsEntryMode` to `TimeTrackingSettingsDraft`. Add runtime tests that a settings object without `entryMode` maps to `'task'` in `toSettingsDraft`, `toSettingsPayload` and `resolveTimeEntryDialogMode`. Keep `TIME_TRACKING_SETTING_KEYS` and the built-in id set in lockstep (`settingKeys.test.ts` asserts they are equal), and update every hard-coded "eight" (comments in `settings.ts`, `settingKeys.ts`, `timeTrackingSettingsForm.ts`, `data/validators.ts`, staff `AGENTS.md`, the tests). Update `settingKeys.test.ts` / `settings.test.ts` (nine built-ins; default `'task'`; an invalid stored value falls back). Add the `UPGRADE_NOTES.md` line for the built-in key collision. Verify: those tests and `yarn typecheck`. To prove the fixture is live, add a required field to it temporarily and check that `yarn typecheck` fails.
4. Settings page: extend `timeTrackingSettingsForm.ts` (draft field, read, write) and render the `SegmentedControl` row in the "Entry defaults" card; add the four settings locale keys to all five locale files. Extend the form-mapping unit test. Verify: unit tests, `yarn i18n:check-sync`.

### Phase 3 — Dialog
5. Add `resolveTimeEntryDialogMode` to `timeEntryDialogState.ts` with unit tests for the four precedence rules. Verify: `timeEntryDialogState.test.ts`.
6. Dialog plumbing: `mode` prop and schema field, `readSettings` reads `entryMode`, resolve the mode at seed time (rules 1–2) and apply the setting late while pristine (rule 3, `billableDefaultRef` pattern), add a unit test where settings resolve after the dialog opens, add `timeProjectId` to form state, `FormValues`, `formSnapshot`, `resetForm` and `buildPayload`; in task mode `timeProjectId` stays derived exactly as today. Verify: the existing `TimeEntryDialog.test.tsx` stays green.
7. Project field and task filter: the new client leaf `TimeEntryProjectField.tsx` (under 300 LOC), which holds the `ComboboxInput` project field (search and pinned selection; a non-ok pin → `projectUnavailable`) and reports each resolved project to the dialog for the `projectById` merge. Then the dialog wiring: `timeProjectId` filter on the task directory/search requests and on recent/pinned/by-id tasks, `project` in `FieldIssues`/`readFieldIssues`, project↔task consistency rules, mode-aware `validateRequired` and focus target, the read-only project line in task mode, and the dialog locale keys in all five files. Extend `TimeEntryDialog.test.tsx`: project mode saves a project-only entry; task optional; filtered task requests; task from another project switches the project; project-only entry opens in project mode under task default; prop overrides setting; project required error; read-only line in task mode; a 404 pin shows the fallback label without a flash; rate preview uses a searched project beyond the first page. Add a `TimeEntryProjectField` unit test (search, pin, 404 fallback). Verify: unit tests, `yarn i18n:check-sync`, `yarn i18n:check-usage`, the FAC evidence (`yarn check:client-boundaries` before and after with unchanged page-root and heavy-import counts; `wc -l` showing `TimeEntryDialog.tsx` at most +200 LOC over its base and the leaf under 300), and open the follow-up issue that decomposes the dialog.
8. Integration test `__integration__/TC-TT-024.spec.ts`. It is self-contained: fixtures are created through the API, the previous `defaults.entryMode` is read in setup and restored in `finally`, and every created entry, task and project is deleted in `finally`. Each case creates its own projects (and a customer where needed) and assigns the `employee` integration user to them through the API. The dialog is opened with "Add entry" on the entries list (a dialog host).
   - **Case 1 — project-only entry.** Set `defaults.entryMode=project` through `PUT /api/staff/timesheets/settings`. Pick the project, leave the task empty, enter a duration and save. Assert through `GET /api/staff/timesheets/time-entries` that `taskId` is null and `timeProjectId` matches. Reopen the entry, assert project mode with the project selected, change the duration, save, and assert the update kept it project-only.
   - **Case 2 — access scoping.** The employee is a member of project A but not project B. The project field lists A and not B.
   - **Case 3 — task-mode read-only line.** With the setting at `task`, the project field is absent, and after a task is picked the read-only project line shows the task's project.
   - **Case 4 — project-scoped tasks (`GET /api/staff/timesheets/tasks?timeProjectId=`).** Project mode. Projects A and B both have the employee as a member, with tasks `A1` and `B1` whose titles share the test stamp, so an unfiltered request would return both. Before a project is picked, the task field says "Pick a project first". Pick project A, then search the task field for the stamp. Assert that the task request carries `timeProjectId=<A>` (captured with `page.waitForRequest`), that `A1` is offered, and that `B1` is not. Pick `A1`, enter a duration, save, and assert through the API that the entry was accepted with `taskId = A1` and `timeProjectId = A`. In a second dialog, pick project A and task `A1`, switch the project to B, and assert that the task is cleared.
   - **Case 5 — settings control (the settings page UI).** Log in as `admin` with the setting at `task`. Open `/backend/staff/time-tracking/settings`, choose "a project" in the "Entry defaults" `SegmentedControl` (`data-testid="time-tracking-settings-entry-mode"`), and save with the page's Save button. Reload the page and assert that "a project" is still selected. Assert that `GET /api/staff/timesheets/settings` returns `defaults.entryMode = 'project'`, and that a newly opened "Add entry" dialog shows the project field. The teardown restores the original value through the API.

   Verify: `yarn test:integration` for the spec.
9. Docs: the staff `AGENTS.md` (entry dialog modes and the new setting) and a changelog entry on the consulting-suite spec (there is no time-tracking page under `apps/docs/docs/` today). Run the full validation gate.

## 🧪 Integration Coverage

| Path | Coverage |
|------|----------|
| `PUT/GET /api/staff/timesheets/settings` (`defaults.entryMode`) | TC-TT-024 case 5 (written through the UI, read back after a reload and through the API); setup and teardown of every case; `settings.test.ts` |
| `GET /api/staff/timesheets/time-projects?q=&status=active` from the dialog | TC-TT-024 cases 1 and 2 (project picked through the UI; employee sees only the accessible project) |
| `GET /api/staff/timesheets/tasks?timeProjectId=` from the dialog | TC-TT-024 case 4 (only the chosen project's tasks are offered; the picked task is accepted on save); `TimeEntryDialog.test.tsx` |
| `POST /api/staff/timesheets/time-entries` with `taskId: null` from the dialog | TC-TT-024 case 1 |
| `POST /api/staff/timesheets/time-entries` with a project and one of its tasks from the dialog | TC-TT-024 case 4 |
| `PUT /api/staff/timesheets/time-entries` of a project-only entry from the dialog | TC-TT-024 case 1 (reopen and save) |
| Settings page "Entry defaults" control | TC-TT-024 case 5 (operate, save, reload, the value persists); form-mapping unit test |
| Task-mode read-only project line | TC-TT-024 case 3 |

## ✅ Final Compliance Report

| Rule | Status |
|------|--------|
| Tenant scoping / no cross-tenant data | Pass — reads go through existing scoped routes; the setting is tenant-scoped by the registry. |
| No direct ORM relationships, no new entities | Pass — no data-model change. |
| Canonical primitives (`apiCall`, `ComboboxInput`, `useGuardedMutation`, settings registry) | Pass — nothing parallel is invented. |
| i18n — no hard-coded strings, all five locales | Pass — keys listed above; every key goes into en/de/es/ko/pl. |
| DS tokens | Pass — `text-muted-foreground`, existing status tokens for errors. |
| Backward compatibility | Pass — additive only. `TimeTrackingEntryDefaults.entryMode` is optional with a `'task'` fallback at every consumer, and a legacy-shape compile fixture that `yarn typecheck` compiles guards it. The key-collision risk is noted with an `UPGRADE_NOTES.md` line. |
| Integration coverage for affected API and UI paths | Pass (planned) — every affected API path and key UI path in the table above has a TC-TT-024 case: settings via the real control (case 5), project search and access scoping (cases 1–2), project-scoped tasks (case 4), create and update (cases 1 and 4), and the task-mode line (case 3). All five cases must ship in the implementation PR. |
| Frontend Architecture Contract (`om-spec-writing` → `frontend-architecture-contract.md`) | Pass with a documented exception — no new page root, provider or heavy dependency. `TimeEntryDialog.tsx` keeps a temporary over-300-LOC exception, capped at +200 LOC net, with new UI in a separate leaf and a decomposition follow-up. |

## 📝 Changelog

- 2026-10-07 — Initial spec for #6989; Open Questions Q1–Q6 resolved on the issue (all option A).
- 2026-10-07 — Implementation review (#7001): `mode` schema accepts `null`; the task-mode line keeps the hint when the project cannot be resolved; a server `timeProjectId` field error is shown under the project field only in project mode and flashed otherwise; `TimeTrackingEntryDefaults.entryMode` is a required field on an always-normalized read type (upgrade note added).
- 2026-10-07 — Fresh-context review applied: late setting application, project-mode-only dirty snapshot, `projectById` merge, 404 pin handling, `ComboboxInput` instead of `LookupSelect`, task filtering of recent/pinned tasks, access-scoping integration case, key-collision and "eight" wording notes, sibling i18n key names.
- 2026-10-09 — Spec review on #7000 (haxiorz, 5458686481): `TimeTrackingEntryDefaults.entryMode` is now **optional** with a `'task'` fallback at every consumer. This replaces the required-field decision recorded in the implementation-review entry above, and that entry's type `UPGRADE_NOTES.md` line is no longer needed. Added a legacy-shape compile fixture (`settings.typecheck.tsx`, matching #7001) outside `__tests__`, because neither `yarn typecheck` nor the core Jest transform type-checks test files. Added the Frontend Architecture Contract: boundary map, `use client` ledger, the `TimeEntryProjectField` leaf, a +200 LOC growth cap and a decomposition follow-up for the dialog, budgets, provider scope and the evidence plan. Added TC-TT-024 case 4 (project-scoped tasks, offered and accepted) and case 5 (the real settings control persists across a reload), and corrected the coverage table and the compliance row. Split the settings-failure edge case into "fails" and "slow but succeeds", following the pristine-only, once-per-open rule. Aligned the Phase 1 test file name and the TC-TT-024 host page with #7001.
