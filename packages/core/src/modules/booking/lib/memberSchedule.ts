import type { ScheduleItem } from '@open-mercato/ui/backend/schedule'
import type { BookingEventStatus } from '../data/entities'
import { parseAvailabilityRuleWindow } from './resourceSchedule'

const DEFAULT_TITLE_MAP = {
  weekly: 'Weekly availability',
  daily: 'Daily availability',
  once: 'Availability',
}

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function toFullDayWindow(value: Date): { start: Date; end: Date } {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

export function buildMemberScheduleItems(params: {
  availabilityRules: Array<{
    id: string
    rrule: string
    createdAt?: string | null
    kind?: 'availability' | 'unavailability'
    note?: string | null
    exdates?: string[]
  }>
  bookedEvents: Array<{
    id: string
    title: string
    startsAt: string | Date
    endsAt: string | Date
    status?: BookingEventStatus | null
  }>
  translate: (key: string, fallback?: string) => string
}): ScheduleItem[] {
  const overrideExdates = Array.from(new Set(
    params.availabilityRules
      .map((rule) => parseAvailabilityRuleWindow(rule))
      .filter((window) => window.repeat === 'once')
      .map((window) => toFullDayWindow(window.startAt).start.toISOString()),
  ))
  const availabilityItems = params.availabilityRules.map((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    const isUnavailable = rule.kind === 'unavailability'
    const titleKey = isUnavailable
      ? 'booking.teamMembers.availability.unavailable.title'
      : `booking.teamMembers.availability.title.${window.repeat}`
    const fallback = isUnavailable ? 'Unavailable' : DEFAULT_TITLE_MAP[window.repeat]
    const baseTitle = params.translate(titleKey, fallback)
    const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
    const windowTime = window.repeat === 'once' ? toFullDayWindow(window.startAt) : { start: window.startAt, end: window.endAt }
    const exdates = window.repeat === 'once'
      ? rule.exdates ?? []
      : [...(rule.exdates ?? []), ...overrideExdates]
    return {
      id: rule.id,
      kind: isUnavailable ? 'exception' as const : 'availability' as const,
      title,
      startsAt: windowTime.start,
      endsAt: windowTime.end,
      metadata: { rule: { ...rule, exdates } },
    }
  })
  const eventItems = params.bookedEvents
    .map((event) => {
      const start = toDate(event.startsAt)
      const end = toDate(event.endsAt)
      if (!start || !end) return null
      return {
        id: `event:${event.id}`,
        kind: 'event' as const,
        title: event.title,
        startsAt: start,
        endsAt: end,
        status: (event.status ?? undefined) as BookingEventStatus | undefined,
        metadata: { event },
      }
    })
    .filter((item): item is ScheduleItem => item !== null)
  return [...availabilityItems, ...eventItems]
}
