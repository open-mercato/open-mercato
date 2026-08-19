export type WarrantyClaimsQueueSettings = {
  showStatusBreakdown: boolean
}

export const DEFAULT_SETTINGS: WarrantyClaimsQueueSettings = {
  showStatusBreakdown: true,
}

export function hydrateWarrantyClaimsQueueSettings(raw: unknown): WarrantyClaimsQueueSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<WarrantyClaimsQueueSettings>
  return {
    showStatusBreakdown: input.showStatusBreakdown === false ? false : DEFAULT_SETTINGS.showStatusBreakdown,
  }
}
