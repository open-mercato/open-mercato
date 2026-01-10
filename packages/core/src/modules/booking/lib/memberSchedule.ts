import type { ScheduleItem } from '@open-mercato/ui/backend/schedule'
import type { BookingEventStatus } from '../data/entities'
import { parseAvailabilityRuleWindow } from './resourceSchedule'

const DEFAULT_TITLE_MAP = {
  weekly: 'Weekly availability',
  daily: 'Daily availability',
  once: 'Availability',
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function buildMemberScheduleItems(params: {
  availabilityRules: Array<{
    id: string
    rrule: string
    createdAt?: string | null
    kind?: 'availability' | 'unavailability'
    note?: string | null
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
  const availabilityItems = params.availabilityRules.map((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    const isUnavailable = rule.kind === 'unavailability'
    const titleKey = isUnavailable
      ? 'booking.teamMembers.availability.unavailable.title'
      : `booking.teamMembers.availability.title.${window.repeat}`
    const fallback = isUnavailable ? 'Unavailable' : DEFAULT_TITLE_MAP[window.repeat]
    const baseTitle = params.translate(titleKey, fallback)
    const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
    return {
      id: rule.id,
      kind: isUnavailable ? 'exception' as const : 'availability' as const,
      title,
      startsAt: window.startAt,
      endsAt: window.endAt,
      metadata: { rule },
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
