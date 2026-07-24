export type IncidentMttaMttrSettings = Record<string, never>

export const DEFAULT_SETTINGS: IncidentMttaMttrSettings = {}

export function hydrateIncidentMttaMttrSettings(_raw: unknown): IncidentMttaMttrSettings {
  return { ...DEFAULT_SETTINGS }
}
