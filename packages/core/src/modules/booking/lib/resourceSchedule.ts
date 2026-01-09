import type { ScheduleItem } from '@open-mercato/ui/backend/schedule'
import type { BookingEventStatus } from '../data/entities'

type AvailabilityRepeat = 'once' | 'daily' | 'weekly'

export type AvailabilityRuleWindow = {
  startAt: Date
  endAt: Date
  repeat: AvailabilityRepeat
}

export type ResourceAvailabilityRule = {
  id: string
  rrule: string
  createdAt?: string | null
}

export type ResourceBookedEvent = {
  id: string
  title: string
  startsAt: string | Date
  endsAt: string | Date
  status?: BookingEventStatus | null
}

const DEFAULT_TITLE_MAP = {
  availability: {
    weekly: 'Weekly availability',
    daily: 'Daily availability',
    once: 'Availability',
  },
  unavailability: {
    weekly: 'Weekly unavailability',
    daily: 'Daily unavailability',
    once: 'Unavailability',
  },
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function parseAvailabilityRuleWindow(rule: ResourceAvailabilityRule): AvailabilityRuleWindow {
  const dtStartMatch = rule.rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.rrule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  let start = new Date()
  if (dtStartMatch?.[1]) {
    const raw = dtStartMatch[1].replace(/Z$/, '')
    const parts = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
    if (parts) {
      const [, year, month, day, hour, minute, second] = parts
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
      const parsed = new Date(iso)
      if (!Number.isNaN(parsed.getTime())) start = parsed
    }
  } else if (rule.createdAt) {
    const parsed = new Date(rule.createdAt)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  let durationMinutes = 60
  if (durationMatch) {
    const hours = durationMatch[1] ? Number(durationMatch[1]) : 0
    const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0
    durationMinutes = Math.max(1, hours * 60 + minutes)
  }
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const freq = freqMatch?.[1]
  const repeat: AvailabilityRepeat = freq === 'WEEKLY' ? 'weekly' : freq === 'DAILY' ? 'daily' : 'once'
  return { startAt: start, endAt: end, repeat }
}

export function buildAvailabilityTitle(
  repeat: AvailabilityRepeat,
  isAvailableByDefault: boolean,
  translate: (key: string, fallback?: string) => string,
): string {
  const mode = isAvailableByDefault ? 'unavailability' : 'availability'
  if (repeat === 'weekly') {
    return translate(
      `booking.resources.${mode}.title.weekly`,
      DEFAULT_TITLE_MAP[mode].weekly,
    )
  }
  if (repeat === 'daily') {
    return translate(
      `booking.resources.${mode}.title.daily`,
      DEFAULT_TITLE_MAP[mode].daily,
    )
  }
  return translate(
    `booking.resources.${mode}.title.once`,
    DEFAULT_TITLE_MAP[mode].once,
  )
}

export function buildResourceScheduleItems(params: {
  availabilityRules: ResourceAvailabilityRule[]
  bookedEvents: ResourceBookedEvent[]
  isAvailableByDefault: boolean
  translate: (key: string, fallback?: string) => string
}): ScheduleItem[] {
  const availabilityKind: ScheduleItem['kind'] = params.isAvailableByDefault ? 'exception' : 'availability'
  const availabilityItems = params.availabilityRules.map((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    return {
      id: rule.id,
      kind: availabilityKind,
      title: buildAvailabilityTitle(window.repeat, params.isAvailableByDefault, params.translate),
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
        status: event.status ?? undefined,
        metadata: { event },
      }
    })
    .filter((item): item is ScheduleItem => item !== null)
  return [...availabilityItems, ...eventItems]
}
