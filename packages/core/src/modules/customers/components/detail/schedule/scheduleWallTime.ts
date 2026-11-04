import {
  calendarInstantToWallTime,
  calendarRecurrenceWallTimeToInstant,
  defaultCalendarTimezone,
} from '../../../lib/calendar/timezone'

/**
 * The schedule dialog edits an activity's date and time on the wall clock of the configured
 * display zone (user override → tenant → runtime), the same zone the activity cards render in and
 * the calendar editor uses. Reading or writing the device clock instead would show an activity at
 * one time on its card and another in the dialog, and saving would move it.
 */
export function scheduleTimeZone(): string {
  return defaultCalendarTimezone()
}

/** The `yyyy-MM-dd` / `HH:mm` wall clock of `instant` in `timeZone`. */
export function toScheduleWallTime(instant: Date, timeZone: string = scheduleTimeZone()): { date: string; time: string } {
  return calendarInstantToWallTime(instant, timeZone)
}

/**
 * The instant a wall-clock date and time name in `timeZone`. A time skipped by a DST change is
 * moved past the gap rather than rejected, so the save always has a moment to store.
 */
export function scheduleWallTimeToInstant(date: string, time: string, timeZone: string = scheduleTimeZone()): Date | null {
  return calendarRecurrenceWallTimeToInstant(date, time, timeZone)
}

/** Minutes east of UTC that `timeZone` observes at the given wall-clock date and time. */
export function scheduleOffsetMinutes(date: string, time: string, timeZone: string = scheduleTimeZone()): number | null {
  const instant = scheduleWallTimeToInstant(date, time, timeZone)
  if (!instant) return null
  const wall = toScheduleWallTime(instant, timeZone)
  return Math.round((new Date(`${wall.date}T${wall.time}:00Z`).getTime() - instant.getTime()) / 60_000)
}
