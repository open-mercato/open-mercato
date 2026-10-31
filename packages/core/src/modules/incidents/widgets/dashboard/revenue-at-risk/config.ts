export type IncidentRevenueAtRiskSettings = Record<string, never>

export const DEFAULT_SETTINGS: IncidentRevenueAtRiskSettings = {}

export function hydrateIncidentRevenueAtRiskSettings(_raw: unknown): IncidentRevenueAtRiskSettings {
  return { ...DEFAULT_SETTINGS }
}
