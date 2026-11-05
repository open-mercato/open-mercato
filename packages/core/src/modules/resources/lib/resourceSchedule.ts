import type { ScheduleItem } from '@open-mercato/ui/backend/schedule'
import { parseAvailabilityRuleWindow, type AvailabilityRepeat } from '@open-mercato/core/modules/planner/lib/availabilitySchedule'

export type ResourceAvailabilityRule = {
  id: string
  rrule: string
  createdAt?: string | Date | null
  kind?: 'availability' | 'unavailability'
  note?: string | null
  exdates?: string[]
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

function toFullDayWindow(value: Date): { start: Date; end: Date } {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

export function buildAvailabilityTitle(
  repeat: AvailabilityRepeat,
  mode: 'availability' | 'unavailability',
  translate: (key: string, fallback?: string) => string,
): string {
  if (repeat === 'weekly') {
    return translate(
      `resources.resources.${mode}.title.weekly`,
      DEFAULT_TITLE_MAP[mode].weekly,
    )
  }
  if (repeat === 'daily') {
    return translate(
      `resources.resources.${mode}.title.daily`,
      DEFAULT_TITLE_MAP[mode].daily,
    )
  }
  return translate(
    `resources.resources.${mode}.title.once`,
    DEFAULT_TITLE_MAP[mode].once,
  )
}

export function buildResourceScheduleItems(params: {
  availabilityRules: ResourceAvailabilityRule[]
  isAvailableByDefault: boolean
  translate: (key: string, fallback?: string) => string
}): ScheduleItem[] {
  const overrideExdates = Array.from(new Set(
    params.availabilityRules
      .map((rule) => parseAvailabilityRuleWindow(rule))
      .filter((window) => window.repeat === 'once')
      .map((window) => toFullDayWindow(window.startAt).start.toISOString()),
  ))
  const availabilityLinkLabel = params.translate('resources.resources.schedule.actions.details', 'Details')
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
  return availabilityItems
}
