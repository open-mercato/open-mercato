export type TimeReportingSettings = {
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
