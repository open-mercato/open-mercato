export type TimeReportingSettings = {
  /**
   * @deprecated Since the shared staff timesheet preference landed, the widget's
   * last-used project is owned by `GET/PUT /api/staff/timesheets/my-preferences`
   * so the dashboard widget and the timesheets-page `TimerBar` share one memory.
   *
   * Retained and still dual-written for at least one minor version: the widget
   * reads it as a fallback when the shared preference is null, and writes it
   * alongside the shared store on every successful start, so a rollback does not
   * lose a member's default. See `UPGRADE_NOTES.md`.
   */
  lastProjectId: string | null
}

export const DEFAULT_SETTINGS: TimeReportingSettings = {
  lastProjectId: null,
}

export function hydrateSettings(raw: unknown): TimeReportingSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    lastProjectId: typeof obj.lastProjectId === 'string' ? obj.lastProjectId : null,
  }
}
