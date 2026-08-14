export type CostEntry = {
  isBillable: boolean
  roundedMinutes: number
  rateOverrideAmount?: number | null
}

export type CostProject = {
  hourlyRate?: number | null
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  const magnitude = Math.abs(value)
  const shifted = Number(`${magnitude}e2`)
  if (!Number.isFinite(shifted)) return sign * (Math.round(magnitude * 100) / 100)
  const rounded = Math.round(shifted)
  const restored = Number(`${rounded}e-2`)
  if (!Number.isFinite(restored)) return sign * (rounded / 100)
  return sign * restored
}

function toCents(amount: number): number {
  return Math.round(round2(amount) * 100)
}

export function applicableRate(
  entry: Pick<CostEntry, 'rateOverrideAmount'> | null | undefined,
  project: CostProject | null | undefined,
): number | null {
  const override = entry?.rateOverrideAmount
  if (override !== null && override !== undefined && Number.isFinite(override)) return override
  const projectRate = project?.hourlyRate
  if (projectRate !== null && projectRate !== undefined && Number.isFinite(projectRate)) return projectRate
  return null
}

export function entryAmount(entry: CostEntry, project: CostProject | null | undefined): number | null {
  if (!entry?.isBillable) return null
  const rate = applicableRate(entry, project)
  if (rate === null) return null
  const minutes = Number.isFinite(entry.roundedMinutes) ? entry.roundedMinutes : 0
  return round2((minutes / 60) * rate)
}

export function sumAmounts(amounts: readonly (number | null | undefined)[]): number {
  let cents = 0
  for (const amount of amounts) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) continue
    cents += toCents(amount)
  }
  return round2(cents / 100)
}
