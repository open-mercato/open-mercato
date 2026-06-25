import { isSameDay } from 'date-fns/isSameDay'

export const DRAG_SNAP_MINUTES = 15
export const MIN_DRAG_DURATION_MINUTES = 30
const MINUTES_PER_DAY = 24 * 60

export function isWeekendDay(date: Date): boolean {
  const weekday = date.getDay()
  return weekday === 0 || weekday === 6
}

export function applyWeekendVisibility(
  days: Date[],
  showWeekends: boolean,
  keepWeekendDate?: Date | null,
): Date[] {
  if (showWeekends) return days
  const workingDays = days.filter(
    (day) => !isWeekendDay(day) || (keepWeekendDate != null && isSameDay(day, keepWeekendDate)),
  )
  return workingDays.length > 0 ? workingDays : days
}

function clampMinutes(value: number): number {
  if (value < 0) return 0
  if (value > MINUTES_PER_DAY) return MINUTES_PER_DAY
  return value
}

export function offsetYToMinutes(
  offsetY: number,
  hourHeightPx: number,
  snapMinutes: number = DRAG_SNAP_MINUTES,
): number {
  if (hourHeightPx <= 0) return 0
  const rawMinutes = (offsetY / hourHeightPx) * 60
  const snapped = Math.round(rawMinutes / snapMinutes) * snapMinutes
  return clampMinutes(snapped)
}

export type DragRange = { start: Date; end: Date }

export function buildDragRange(dayStart: Date, startMinutes: number, endMinutes: number): DragRange {
  let lower = clampMinutes(Math.min(startMinutes, endMinutes))
  let upper = clampMinutes(Math.max(startMinutes, endMinutes))
  if (upper - lower < MIN_DRAG_DURATION_MINUTES) upper = lower + MIN_DRAG_DURATION_MINUTES
  if (upper > MINUTES_PER_DAY) {
    upper = MINUTES_PER_DAY
    lower = Math.max(0, upper - MIN_DRAG_DURATION_MINUTES)
  }
  const start = new Date(dayStart)
  start.setHours(0, 0, 0, 0)
  start.setMinutes(lower)
  const end = new Date(dayStart)
  end.setHours(0, 0, 0, 0)
  end.setMinutes(upper)
  return { start, end }
}
