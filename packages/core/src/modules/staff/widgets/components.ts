import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

/**
 * Component replacement handles the staff module publishes (EP-31 of
 * `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md`).
 *
 * Each handle is registered by the component's own module through
 * `registerComponent`, and the shipping component resolves itself through
 * `useRegisteredComponent`, so another module can `replace`, `wrapper` or
 * `props`-transform it without forking the screen that renders it. Every entry
 * publishes a zod `propsSchema` — in development `useRegisteredComponent` parses
 * the resolved props against it and falls back to the original component when a
 * replacement does not satisfy it, so the schema is the contract, not a comment.
 *
 * | Handle | Registered by | Props |
 * |---|---|---|
 * | `staff.time_entry_dialog`      | `lib/time-tracking-ui/TimeEntryDialog.tsx`           | `TimeEntryDialogProps` |
 * | `staff.timer_bar`              | `lib/timesheets-ui/TimerBar.tsx`                    | `TimerBarProps` |
 * | `staff.kanban_card`            | `lib/time-tracking-ui/KanbanCard.tsx`               | `KanbanCardProps` |
 * | `staff.kanban_column`          | `lib/time-tracking-ui/KanbanColumn.tsx`             | `KanbanColumnProps` |
 * | `staff.timesheet_grid`         | `backend/staff/time-tracking/timesheet/GridView.tsx`| `GridViewProps` |
 * | `staff.timesheet_list`         | `lib/timesheets-ui/ListView.tsx`                    | `ListViewProps` |
 * | `staff.timesheet_calendar`     | `lib/time-tracking-ui/TimesheetCalendar.tsx`        | `TimesheetCalendarProps` |
 * | `staff.report_sheet`           | `lib/time-tracking-ui/ReportSheet.tsx`              | `ReportSheetProps` |
 * | `staff.project_card`           | `lib/timesheets-projects-ui/ProjectCard.tsx`        | `ProjectCardProps` |
 * | `staff.entries_summary_footer` | `lib/time-tracking-ui/TimeEntriesSummaryFooter.tsx` | `TimeEntriesSummaryFooterProps` |
 *
 * The array below is the staff module's own *outgoing* overrides — it targets no
 * other module's components today, so it is empty. Adding an entry here would
 * override somebody else's component, not one of the handles above.
 */
export const componentOverrides: ComponentOverride[] = []

export default componentOverrides
