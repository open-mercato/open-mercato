import {
  componentExtensionHost,
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

/**
 * Time-tracking host catalog (EP-01 of
 * `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md`).
 *
 * Two id conventions meet here and neither is negotiable:
 *
 *  - `crud-form:` hosts carry the **dot** form of the entity id
 *    (`staff.staff_time_project`). `CrudForm` derives its own spot id from
 *    `entityIds` by replacing every colon with a dot, so the colon form would
 *    name a spot no widget is ever loaded for.
 *  - `detail:` hosts carry the **colon** form (`detail:staff:staff_time_task:header`).
 *    Nothing derives those ids; the host picks them, and these are the ids the
 *    spec froze.
 *
 * Every id below is a FROZEN contract surface once shipped — see
 * `BACKWARD_COMPATIBILITY.md`.
 */

const detailHost = (spotId: string, source: string) => injectionExtensionHost({
  family: 'detail',
  spotId,
  supported: ['render-widget'],
  contextContract: 'staff.time_tracking.detail.v1',
  scopeContract: 'tenant+organization',
  source,
})

const pageHost = (spotId: string, source: string) => injectionExtensionHost({
  family: 'generic',
  spotId,
  supported: ['render-widget'],
  contextContract: 'staff.time_tracking.page.v1',
  scopeContract: 'tenant+organization',
  source,
})

/**
 * EP-32…EP-41. Each registry is a `specialized-registry` host: contributions
 * arrive through the module's own `register*` function rather than through the
 * widget registries, which is what `registry-contribution` names.
 *
 * `runtimeContract` is the id of the built-in strategy the registry ships with.
 * It is the guarantee that makes this whole group additive: with no contribution
 * the built-in is the only candidate, and it is the same code the module ran
 * before the registry existed.
 */
const registryHost = (
  spotId: string,
  source: string,
  contextContract: string,
  builtInId: string,
) => injectionExtensionHost({
  family: 'specialized-registry',
  spotId,
  supported: ['registry-contribution'],
  contextContract,
  scopeContract: 'tenant+organization',
  runtimeContract: builtInId,
  source,
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'staff',
  hosts: {
    timeEntriesTable: dataTableExtensionHost({
      tableId: 'staff.time_entries.list',
      source: 'backend/staff/time-tracking/entries/page.tsx',
    }),
    timeProjectsTable: dataTableExtensionHost({
      tableId: 'staff.time_projects.list',
      source: 'backend/staff/time-tracking/projects/page.tsx',
    }),
    timeReportsTable: dataTableExtensionHost({
      tableId: 'staff.time_reports.list',
      source: 'backend/staff/time-tracking/reports/page.tsx',
    }),

    projectForm: crudFormExtensionHost({
      entityId: 'staff.staff_time_project',
      spotId: 'crud-form:staff.staff_time_project',
      source: 'backend/staff/time-tracking/projects/create/page.tsx',
    }),
    timeEntryForm: crudFormExtensionHost({
      entityId: 'staff.staff_time_entry',
      spotId: 'crud-form:staff.staff_time_entry',
      source: 'lib/time-tracking-ui/TimeEntryDialog.tsx',
    }),
    taskForm: crudFormExtensionHost({
      entityId: 'staff.staff_time_task',
      spotId: 'crud-form:staff.staff_time_task',
      source: 'lib/time-tracking-ui/NewTaskDialog.tsx',
    }),
    reportForm: crudFormExtensionHost({
      entityId: 'staff.staff_time_report',
      spotId: 'crud-form:staff.staff_time_report',
      source: 'backend/staff/time-tracking/reports/create/page.tsx',
    }),

    projectDetailHeader: detailHost('detail:staff:staff_time_project:header', 'backend/staff/time-tracking/projects/[id]/page.tsx'),
    projectDetailStatusBadges: detailHost('detail:staff:staff_time_project:status-badges', 'backend/staff/time-tracking/projects/[id]/page.tsx'),
    projectDetailTabs: detailHost('detail:staff:staff_time_project:tabs', 'backend/staff/time-tracking/projects/[id]/page.tsx'),
    projectDetailSidebar: detailHost('detail:staff:staff_time_project:sidebar', 'backend/staff/time-tracking/projects/[id]/page.tsx'),
    projectDetailFooter: detailHost('detail:staff:staff_time_project:footer', 'backend/staff/time-tracking/projects/[id]/page.tsx'),

    taskDetailHeader: detailHost('detail:staff:staff_time_task:header', 'lib/time-tracking-ui/TaskDrawer.tsx'),
    taskDetailStatusBadges: detailHost('detail:staff:staff_time_task:status-badges', 'lib/time-tracking-ui/TaskDrawer.tsx'),
    taskDetailTabs: detailHost('detail:staff:staff_time_task:tabs', 'lib/time-tracking-ui/TaskDrawer.tsx'),
    taskDetailSidebar: detailHost('detail:staff:staff_time_task:sidebar', 'lib/time-tracking-ui/TaskDrawer.tsx'),
    taskDetailFooter: detailHost('detail:staff:staff_time_task:footer', 'lib/time-tracking-ui/TaskDrawer.tsx'),

    reportDetailHeader: detailHost('detail:staff:staff_time_report:header', 'backend/staff/time-tracking/reports/[id]/page.tsx'),
    reportDetailStatusBadges: detailHost('detail:staff:staff_time_report:status-badges', 'backend/staff/time-tracking/reports/[id]/page.tsx'),
    reportDetailFooter: detailHost('detail:staff:staff_time_report:footer', 'backend/staff/time-tracking/reports/[id]/page.tsx'),

    reportSheetBeforeLines: pageHost('staff.time_report.sheet:before-lines', 'lib/time-tracking-ui/ReportSheet.tsx'),
    reportSheetAfterTotals: pageHost('staff.time_report.sheet:after-totals', 'lib/time-tracking-ui/ReportSheet.tsx'),

    timesheetToolbar: pageHost('staff.timesheet:toolbar', 'backend/staff/time-tracking/timesheet/page.tsx'),
    timesheetPeriodFooter: pageHost('staff.timesheet:period-footer', 'lib/time-tracking-ui/TimesheetPeriodFooter.tsx'),
    timesheetDayCellActions: pageHost('staff.timesheet:day-cell-actions', 'lib/time-tracking-ui/TimesheetCalendar.tsx'),

    taskBoardToolbar: pageHost('staff.time_task.board:toolbar', 'lib/time-tracking-ui/KanbanBoard.tsx'),
    taskBoardColumnHeader: pageHost('staff.time_task.board:column-header', 'lib/time-tracking-ui/KanbanColumn.tsx'),
    taskBoardCardBadges: pageHost('staff.time_task.board:card-badges', 'lib/time-tracking-ui/KanbanCard.tsx'),
    taskBoardCardFooter: pageHost('staff.time_task.board:card-footer', 'lib/time-tracking-ui/KanbanCard.tsx'),

    myWorkBeforeSections: pageHost('staff.my_work:before-sections', 'backend/staff/time-tracking/page.tsx'),
    myWorkAfterSections: pageHost('staff.my_work:after-sections', 'backend/staff/time-tracking/page.tsx'),

    timeTrackingSettingsSections: pageHost('staff.time_tracking.settings:sections', 'backend/staff/time-tracking/settings/page.tsx'),

    timerBarActions: pageHost('staff.timesheets.timer-bar:actions', 'lib/timesheets-ui/TimerBar.tsx'),

    timeRoundingRegistry: registryHost(
      'staff.time_tracking.rounding',
      'lib/time-tracking/rounding.ts',
      'staff.time_tracking.rounding.v1',
      'staff.time_tracking.rounding.unit',
    ),
    timeRateRegistry: registryHost(
      'staff.time_tracking.rate',
      'lib/time-tracking/cost.ts',
      'staff.time_tracking.rate.v1',
      'staff.time_tracking.rate.entry_override_then_project',
    ),
    timeBillabilityRegistry: registryHost(
      'staff.time_tracking.billability',
      'lib/time-tracking/billability.ts',
      'staff.time_tracking.billability.v1',
      'staff.time_tracking.billability.project_then_tenant',
    ),
    reportExportFormatRegistry: registryHost(
      'staff.time_tracking.report_export_format',
      'lib/timesheets-reports/reportExportFormats.ts',
      'staff.time_tracking.report_export_format.v1',
      'pdf',
    ),
    reportGroupingRegistry: registryHost(
      'staff.time_tracking.report_grouping',
      'lib/timesheets-reports/reportGroupings.ts',
      'staff.time_tracking.report_grouping.v1',
      'project_task',
    ),
    timeEntrySourceRegistry: registryHost(
      'staff.time_tracking.time_entry_source',
      'lib/time-tracking/timeEntrySources.ts',
      'staff.time_tracking.time_entry_source.v1',
      'manual',
    ),
    overlapPolicyRegistry: registryHost(
      'staff.time_tracking.overlap_policy',
      'lib/time-tracking/overlap.ts',
      'staff.time_tracking.overlap_policy.v1',
      'staff.time_tracking.overlap.warn_when_enabled',
    ),
    projectCodeGeneratorRegistry: registryHost(
      'staff.time_tracking.project_code_generator',
      'lib/time-tracking/projectCode.ts',
      'staff.time_tracking.project_code_generator.v1',
      'staff.time_tracking.project_code.initials',
    ),
    capacityProviderRegistry: registryHost(
      'staff.time_tracking.capacity_provider',
      'lib/time-tracking/capacity.ts',
      'staff.time_tracking.capacity_provider.v1',
      'staff.time_tracking.capacity.flat_daily_hours',
    ),
    reportApprovalPolicyRegistry: registryHost(
      'staff.time_tracking.report_approval_policy',
      'lib/timesheets-reports/reportApprovalPolicies.ts',
      'staff.time_tracking.report_approval_policy.v1',
      'staff.time_tracking.report_approval.acl_only',
    ),
    /**
     * EP-42. The one registry whose scope contract is `tenant` rather than
     * `tenant+organization`: time-tracking settings are tenant-global by spec §10,
     * stored through `ModuleConfigService` with `organization_id` null, and a
     * contributed key inherits that scope rather than choosing its own.
     */
    settingKeyRegistry: injectionExtensionHost({
      family: 'specialized-registry',
      spotId: 'staff.time_tracking.setting_key',
      supported: ['registry-contribution'],
      contextContract: 'staff.time_tracking.setting_key.v1',
      scopeContract: 'tenant',
      runtimeContract: 'rounding.unitMinutes',
      source: 'lib/time-tracking/settingKeys.ts',
    }),

    timeEntryDialogComponent: componentExtensionHost({
      componentId: 'staff.time_entry_dialog',
      propsContract: 'staff.time_entry_dialog.props.v1',
      source: 'lib/time-tracking-ui/TimeEntryDialog.tsx',
    }),
    timerBarComponent: componentExtensionHost({
      componentId: 'staff.timer_bar',
      propsContract: 'staff.timer_bar.props.v1',
      source: 'lib/timesheets-ui/TimerBar.tsx',
    }),
    kanbanCardComponent: componentExtensionHost({
      componentId: 'staff.kanban_card',
      propsContract: 'staff.kanban_card.props.v1',
      source: 'lib/time-tracking-ui/KanbanCard.tsx',
    }),
    kanbanColumnComponent: componentExtensionHost({
      componentId: 'staff.kanban_column',
      propsContract: 'staff.kanban_column.props.v1',
      source: 'lib/time-tracking-ui/KanbanColumn.tsx',
    }),
    timesheetGridComponent: componentExtensionHost({
      componentId: 'staff.timesheet_grid',
      propsContract: 'staff.timesheet_grid.props.v1',
      source: 'backend/staff/time-tracking/timesheet/GridView.tsx',
    }),
    timesheetListComponent: componentExtensionHost({
      componentId: 'staff.timesheet_list',
      propsContract: 'staff.timesheet_list.props.v1',
      source: 'lib/timesheets-ui/ListView.tsx',
    }),
    timesheetCalendarComponent: componentExtensionHost({
      componentId: 'staff.timesheet_calendar',
      propsContract: 'staff.timesheet_calendar.props.v1',
      source: 'lib/time-tracking-ui/TimesheetCalendar.tsx',
    }),
    reportSheetComponent: componentExtensionHost({
      componentId: 'staff.report_sheet',
      propsContract: 'staff.report_sheet.props.v1',
      source: 'lib/time-tracking-ui/ReportSheet.tsx',
    }),
    projectCardComponent: componentExtensionHost({
      componentId: 'staff.project_card',
      propsContract: 'staff.project_card.props.v1',
      source: 'lib/timesheets-projects-ui/ProjectCard.tsx',
    }),
    entriesSummaryFooterComponent: componentExtensionHost({
      componentId: 'staff.entries_summary_footer',
      propsContract: 'staff.entries_summary_footer.props.v1',
      source: 'lib/time-tracking-ui/TimeEntriesSummaryFooter.tsx',
    }),
  },
})

export default extensionPoints
