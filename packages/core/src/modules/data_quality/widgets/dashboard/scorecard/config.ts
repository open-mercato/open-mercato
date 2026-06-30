export type DataQualityScorecardSettings = {
  targetEntityType: string
  severityThreshold: 'info' | 'warning' | 'error' | 'critical'
}

export const DEFAULT_SETTINGS: DataQualityScorecardSettings = {
  targetEntityType: 'all',
  severityThreshold: 'warning',
}

export function hydrateScorecardSettings(raw: unknown): DataQualityScorecardSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<DataQualityScorecardSettings>
  const targetEntityType =
    typeof input.targetEntityType === 'string' && input.targetEntityType.length > 0
      ? input.targetEntityType
      : DEFAULT_SETTINGS.targetEntityType
  const validThresholds = ['info', 'warning', 'error', 'critical'] as const
  const severityThreshold = validThresholds.includes(input.severityThreshold as any)
    ? (input.severityThreshold as DataQualityScorecardSettings['severityThreshold'])
    : DEFAULT_SETTINGS.severityThreshold
  return { targetEntityType, severityThreshold }
}
