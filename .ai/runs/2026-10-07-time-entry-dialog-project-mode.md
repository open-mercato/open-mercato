# Execution plan — TimeEntryDialog project mode and exported props schemas

Source doc: .ai/specs/2026-10-07-time-entry-dialog-project-mode.md (spec PR #7000)
Issue: #6989

## Goal

Let people log time to a project without a task from the time entry dialog (tenant setting `defaults.entryMode` plus an optional `mode` prop), show the derived project in task mode, and export the ten published component `propsSchema`s.

## Scope

- `packages/core/src/modules/staff/`: the setting-key registry and settings types, the settings page form, `TimeEntryDialog.tsx` and `timeEntryDialogState.ts`, the nine sibling component files (export keyword only), the five staff locale files, tests, TC-TT-024, staff `AGENTS.md`, `UPGRADE_NOTES.md`, the EP-31 and consulting-suite spec changelogs.

## Non-goals

- No change to `commands/timesheets-entries.ts`, the time-entries routes or the bulk route (PR #6998 owns them).
- No change to `backend/staff/time-tracking/entries/page.tsx`, `DataTable` or `FilterBar` (#6990 owns them).
- No host page changes; no new endpoint; no access logic.

## Implementation Plan

### Phase 1: Exported schemas
1.1 Export the ten `propsSchema`s and add the export unit test.
1.2 Document the exports in EP-31 and the staff `AGENTS.md`.

### Phase 2: Setting
2.1 Register the built-in `defaults.entryMode` key, constants and types; update tests and the "eight" wording; add the `UPGRADE_NOTES.md` line.
2.2 Settings page control, form mapping, locale keys.

### Phase 3: Dialog
3.1 `resolveTimeEntryDialogMode` helper with unit tests.
3.2 Dialog plumbing: `mode` prop and schema, settings read, mode resolution (late, pristine-only setting application), project in form state, snapshot and payload.
3.3 Project field, task filtering, validation, read-only project line, locale keys, unit tests.
3.4 Integration test TC-TT-024.
3.5 Docs and the full validation gate.

## Risks

- Large component; keep task mode byte-for-byte equivalent apart from the read-only line.
- Rebase overlap with PR #6998 in the staff locale files.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Exported schemas

- [x] 1.1 Export the ten propsSchemas and add the export unit test — f10fa800c
- [x] 1.2 Document the exports in EP-31 and the staff AGENTS.md — a4cd6d5e0

### Phase 2: Setting

- [x] 2.1 Register the built-in defaults.entryMode key — e19f3ebbb
- [x] 2.2 Settings page control, form mapping, locale keys — b0d3d66f8

### Phase 3: Dialog

- [ ] 3.1 resolveTimeEntryDialogMode helper with unit tests
- [ ] 3.2 Dialog plumbing for mode, project state, snapshot and payload
- [ ] 3.3 Project field, task filtering, validation, read-only project line
- [ ] 3.4 Integration test TC-TT-024
- [ ] 3.5 Docs and the full validation gate
