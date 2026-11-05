export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100 * 10) / 10
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}
