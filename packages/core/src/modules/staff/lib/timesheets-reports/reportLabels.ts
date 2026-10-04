/**
 * The three fallback labels a report sheet needs when a line has nothing to name
 * itself with. They live here rather than in a route because the close command,
 * the preview, the sheet and the exports must all use the same ones — a freeze
 * record labelled "No task" and a PDF labelled "Unassigned" would be the same
 * line reading differently in two places a client can compare.
 */

export type ReportLabelTranslate = (key: string, fallback: string) => string

export type ReportSheetLabels = {
  unassignedTask: string
  unassignedPerson: string
  nonbillableGroup: string
}

export function reportSheetLabels(translate: ReportLabelTranslate): ReportSheetLabels {
  return {
    unassignedTask: translate('staff.time_tracking.reports.sheet.noTask', 'No task'),
    unassignedPerson: translate('staff.time_tracking.reports.sheet.noPerson', 'Unassigned'),
    nonbillableGroup: translate('staff.time_tracking.reports.sheet.nonbillable', 'Non-billable time'),
  }
}
