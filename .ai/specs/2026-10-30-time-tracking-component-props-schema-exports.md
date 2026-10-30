# Time-Tracking Component Props Schema Exports

> Issue: #6989 (split out of spec PR #7000 on review, 2026-10-30). Companion: `.ai/specs/2026-10-07-time-entry-dialog-project-mode.md`, which exports `timeEntryDialogPropsSchema` (implementation PR #7001).
> Builds on: `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md` (EP-31 replaceable components and their published `propsSchema`s).
> Paths are relative to `packages/core/src/modules/staff/` unless stated otherwise.

## 📝 TLDR

The staff module publishes ten replaceable time-tracking components (EP-31). Each one declares a zod `propsSchema` that `useRegisteredComponent` checks in development, but nine of them keep that schema in a module-local `const`, so anyone writing a replacement has to copy it by hand. This spec turns those nine declarations into named exports, so a replacement imports the exact contract. The tenth, `timeEntryDialogPropsSchema`, is exported by the project-mode spec. Nothing else changes: no behaviour, no new file, no moved code.

## 📝 Overview

- **Audience:** developers of third-party modules who replace or wrap a time-tracking component through `widgets/components.ts`.
- **Value:** a replacement stays in step with the published contract. Without the export, a stale copy fails the dev-time check after an upstream additive change, and the registry silently falls back to the default component in development while production still renders the replacement.
- **Scope:** the nine sibling schemas only. They ship independently of project mode, which is why the 2026-10-30 review of #7000 split them out.

## 📝 Problem Statement

- In `useRegisteredComponent` (`packages/ui/src/backend/injection/useRegisteredComponent.tsx`), development mode parses a replacement's props against the replacement's own `metadata.propsSchema` and renders the default component when parsing fails.
- The nine schemas below are `const` declarations, invisible outside their files. A replacement author re-declares the shape. When upstream adds an optional prop, the copy does not change. If the author forgot a callback, or typed it more strictly, the replacement disappears in development only. That bug is hard to see, because production behaves differently.

## 📝 Proposed Solution

Each of the nine `const xPropsSchema` declarations becomes `export const`. Nothing moves. The import path is the component file, which the `./*` wildcard export of `packages/core/package.json` already makes reachable as `@open-mercato/core/modules/staff/...`.

| Handle | Export | File |
|--------|--------|------|
| `staff.timer_bar` | `timerBarPropsSchema` | `lib/timesheets-ui/TimerBar.tsx` |
| `staff.kanban_card` | `kanbanCardPropsSchema` | `lib/time-tracking-ui/KanbanCard.tsx` |
| `staff.kanban_column` | `kanbanColumnPropsSchema` | `lib/time-tracking-ui/KanbanColumn.tsx` |
| `staff.timesheet_grid` | `gridViewPropsSchema` | `backend/staff/time-tracking/timesheet/GridView.tsx` |
| `staff.timesheet_list` | `listViewPropsSchema` | `lib/timesheets-ui/ListView.tsx` |
| `staff.timesheet_calendar` | `timesheetCalendarPropsSchema` | `lib/time-tracking-ui/TimesheetCalendar.tsx` |
| `staff.report_sheet` | `reportSheetPropsSchema` | `lib/time-tracking-ui/ReportSheet.tsx` |
| `staff.project_card` | `projectCardPropsSchema` | `lib/timesheets-projects-ui/ProjectCard.tsx` |
| `staff.entries_summary_footer` | `timeEntriesSummaryFooterPropsSchema` | `lib/time-tracking-ui/TimeEntriesSummaryFooter.tsx` |

### Alternatives considered

- **A schema-only module re-exporting all schemas.** It would have to import the `"use client"` component files, which brings their `registerComponent` side effects with them, or move the props types out of the components. Rejected, because the component file is already the published import path.
- **Exporting schemas on demand, one per request.** Rejected: the nine are published together under EP-31, and exporting them in one change keeps a single, consistent contract and one upgrade note.

## 📝 Architecture

| Area | Change |
|------|--------|
| The nine component files (table above) | `const` → `export const` on the `propsSchema` declaration only. |
| `lib/time-tracking-ui/__tests__/componentPropsSchemas.test.tsx` | Created by #7001 for the dialog. This spec adds the nine schemas to it. Each export must be the exact object registered for its handle (`getComponentEntry(componentId).metadata.propsSchema`), and together with the dialog's export the list covers all ten handles exactly once. |
| Staff `AGENTS.md` (Replaceable components) and EP-31 in `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md` | The handle table gains a "Schema export" column, and the EP-31 note lists all ten exports. |

**Dependency on #7001.** Implementation starts after #7001 merges, for two reasons. #7001 creates the test file this spec extends. It also fixes `optionalCallbackProp` in `lib/time-tracking/componentContracts.ts` so that it marks its key optional: under zod 4, an omitted optional callback failed the dev-time check. Three of the nine schemas (`kanbanCardPropsSchema`, `kanbanColumnPropsSchema`, `listViewPropsSchema`) use `optionalCallbackProp`, so exporting them before that fix would publish contracts that reject valid props.

### Frontend Architecture Contract

No route, page root, provider, `"use client"` directive or dependency is added or changed. The edit is one keyword on an existing line in each file. Client-boundary counts, LOC budgets and hydration are unaffected, and `yarn check:client-boundaries` output does not change.

## 📝 Data Models

None.

## 📝 API Contracts

- **Nine new named exports** (table above). Under `BACKWARD_COMPATIBILITY.md` (types and import paths) they become STABLE contract: from now on, their shape changes are additive-only.
- Each export keeps its declared type `z.ZodType<Props>`. It is meant to be passed, unchanged, as a replacement's `metadata.propsSchema`. A consumer that wants to add fields wraps it with `z.intersection`, because `.extend()` is not available on `ZodType`. EP-31 and the staff `AGENTS.md` document this next to the exports.
- No HTTP route, event, ACL feature, DI key, widget spot or database change.

## 📝 Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|------|----------|------|------------|----------|
| The exports freeze shapes that are still evolving | Medium | Contract surface | Additive-only is already the rule for props of a published handle; the export makes the existing obligation importable rather than creating a new one. | Future removals need the deprecation protocol, as they already do for the props types. |
| Importing a schema pulls the component module and its `registerComponent` side effect | Low | Bundling | The replacement already lives in client code that renders the component's host; the registration is idempotent per handle. | None observed. |
| Shipping before #7001's `optionalCallbackProp` fix | Medium | Dev-time validation | The implementation PR is gated on #7001 being merged (see Architecture). | None once sequenced. |

- **Blast radius:** low. No runtime behaviour changes.
- **Rollback:** revert the PR. Consumers that already import a schema would break, which is why the exports are STABLE once released.

## 📋 Phasing

One phase, independently shippable after #7001: the nine exports, the extended test, the docs, and an `UPGRADE_NOTES.md` line in the unreleased section.

## 📋 Implementation Plan

1. Change the nine `const …PropsSchema` declarations to `export const`. Verify: `yarn typecheck`.
2. Extend `componentPropsSchemas.test.tsx` with the nine exports. Each must be the registered schema for its handle, and the ten exports together must cover the ten handles exactly once. Verify: the staff Jest suite.
3. Docs: add the "Schema export" column to the staff `AGENTS.md` handle table, list the ten exports in the EP-31 note, and add an `UPGRADE_NOTES.md` entry ("the nine remaining time-tracking component `propsSchema`s are named exports"). Verify: `yarn agents:check-budget`.
4. Run the full validation gate.

## 🧪 Integration Coverage

No API path or UI path changes, so there is no new integration case. The contract is covered by the unit test in step 2, which checks each export against the live component registry.

## ✅ Final Compliance Report

| Rule | Status |
|------|--------|
| One independently deployable capability | Pass. The schema exports only, split from project mode. |
| Tenant scoping, data model, ORM relations | N/A. No data access. |
| Backward compatibility | Pass. Additive only: nine new exports, nothing renamed or removed. |
| i18n, DS tokens | N/A. No user-facing strings or styles. |
| Integration coverage | N/A, with justification above. Unit coverage is planned. |
| Frontend Architecture Contract | Pass. No boundary, budget or provider change. |

## 📝 Changelog

- 2026-10-30. Initial spec, split out of #7000 on spec review (pkarw, review 5718058063): the nine sibling `propsSchema` exports are an independently deployable capability, separate from the time entry dialog project mode.
