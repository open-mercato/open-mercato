export type RoundingUnitMinutes = 0 | 5 | 10 | 15

export type RoundingDirection = 'up' | 'nearest'

export type RoundingSettings = {
  unitMinutes: RoundingUnitMinutes
  direction: RoundingDirection
}

export const DEFAULT_ROUNDING_SETTINGS: RoundingSettings = {
  unitMinutes: 0,
  direction: 'up',
}

export function roundMinutes(raw: number, settings: RoundingSettings): number {
  if (!Number.isFinite(raw)) return 0
  const unit = settings?.unitMinutes ?? 0
  if (!unit) return Math.round(raw)

  const sign = raw < 0 ? -1 : 1
  const magnitude = Math.abs(raw) / unit
  const units = settings.direction === 'nearest' ? Math.round(magnitude) : Math.ceil(magnitude)
  return sign * units * unit
}
