export const REPORTS_PATH = '/backend/staff/time-tracking/reports'

export function reportDetailHref(reportId: string): string {
  return `${REPORTS_PATH}/${encodeURIComponent(reportId)}`
}
