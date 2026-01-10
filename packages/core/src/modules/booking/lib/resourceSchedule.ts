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
  createdAt?: string | Date | null
  kind?: 'availability' | 'unavailability'
  note?: string | null
  exdates?: string[]
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

export function parseAvailabilityRuleWindow(rule: ResourceAvailabilityRule): AvailabilityRuleWindow {
  const dtStartMatch = rule.rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.rrule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  const countMatch = rule.rrule.match(/COUNT=(\d+)/)
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
    const parsed = rule.createdAt instanceof Date ? rule.createdAt : new Date(rule.createdAt)
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
  const repeat: AvailabilityRepeat =
    freq === 'WEEKLY'
      ? 'weekly'
      : freq === 'DAILY' && countMatch?.[1] === '1'
        ? 'once'
        : freq === 'DAILY'
          ? 'daily'
          : 'once'
  return { startAt: start, endAt: end, repeat }
}

export function buildAvailabilityTitle(
  repeat: AvailabilityRepeat,
  mode: 'availability' | 'unavailability',
  translate: (key: string, fallback?: string) => string,
): string {
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
  const overrideExdates = Array.from(new Set(
    params.availabilityRules
      .map((rule) => parseAvailabilityRuleWindow(rule))
      .filter((window) => window.repeat === 'once')
      .map((window) => toFullDayWindow(window.startAt).start.toISOString()),
  ))
  const availabilityLinkLabel = params.translate('booking.resources.schedule.actions.details', 'Details')
  const availabilityItems = params.availabilityRules.map((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    const isUnavailable = rule.kind === 'unavailability'
    const mode = isUnavailable ? 'unavailability' : (params.isAvailableByDefault ? 'unavailability' : 'availability')
    const availabilityKind: ScheduleItem['kind'] = isUnavailable ? 'exception' : (params.isAvailableByDefault ? 'exception' : 'availability')
    const baseTitle = buildAvailabilityTitle(window.repeat, mode, params.translate)
    const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
    const windowTime = window.repeat === 'once' ? toFullDayWindow(window.startAt) : { start: window.startAt, end: window.endAt }
    const exdates = window.repeat === 'once'
      ? rule.exdates ?? []
      : [...(rule.exdates ?? []), ...overrideExdates]
    return {
      id: rule.id,
      kind: availabilityKind,
      title,
      linkLabel: availabilityLinkLabel,
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
        status: event.status ?? undefined,
        metadata: { event },
      }
    })
    .filter((item): item is ScheduleItem => item !== null)
  return [...availabilityItems, ...eventItems]
}
