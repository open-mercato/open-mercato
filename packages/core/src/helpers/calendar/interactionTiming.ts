import { addMinutes } from 'date-fns/addMinutes'
import { endOfDay } from 'date-fns/endOfDay'
import { startOfDay } from 'date-fns/startOfDay'
import type { CalendarInteractionPayload } from './interactionPayload'
import { calendarDayEndInstant, calendarDayStartInstant, calendarInstantToWallTime, isCalendarTimezone } from './timezone'

const DEFAULT_DURATION_MINUTES = 30

export function projectCalendarInteractionTiming(payload: CalendarInteractionPayload) {
  const effectiveStartRaw = payload.occurredAt ?? payload.scheduledAt ?? null
  if (!effectiveStartRaw) return null
  const parsedStart = new Date(effectiveStartRaw)
  if (Number.isNaN(parsedStart.getTime())) return null

  const allDay = payload.allDay === true
  const durationMinutes = payload.durationMinutes ?? DEFAULT_DURATION_MINUTES
  const eventDate = allDay && isCalendarTimezone(payload.timezone) ? calendarInstantToWallTime(parsedStart, payload.timezone).date : null
  const start = eventDate ? calendarDayStartInstant(eventDate, payload.timezone as string) : allDay ? startOfDay(parsedStart) : parsedStart
  const end = eventDate ? calendarDayEndInstant(eventDate, payload.timezone as string) : allDay ? endOfDay(parsedStart) : addMinutes(parsedStart, durationMinutes)

  if (!start || !end) return null

  return { start, end, allDay }
}
