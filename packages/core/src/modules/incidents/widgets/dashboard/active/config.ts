export type IncidentActiveSettings = Record<string, never>

export const DEFAULT_SETTINGS: IncidentActiveSettings = {}

export function hydrateIncidentActiveSettings(_raw: unknown): IncidentActiveSettings {
  return { ...DEFAULT_SETTINGS }
}
