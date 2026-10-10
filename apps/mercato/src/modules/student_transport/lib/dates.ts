/**
 * Trip days are calendar days in the operator's zone, not instants: a run on
 * 2026-10-12 belongs to that date for every reader, so the date is stored as a
 * `date` column and compared as a string.
 */
export function toTripDateString(value: string | Date | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  if (typeof value === 'string') return value.slice(0, 10)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export function todayTripDate(): string {
  return toTripDateString(new Date())
}

export type Direction = 'two_way' | 'one_way_pickup' | 'one_way_drop'

/** The legs a subscription rides: a one-way subscription only has one. */
export function legsForDirection(direction: Direction): Array<'pickup' | 'dropoff'> {
  if (direction === 'one_way_pickup') return ['pickup']
  if (direction === 'one_way_drop') return ['dropoff']
  return ['pickup', 'dropoff']
}
