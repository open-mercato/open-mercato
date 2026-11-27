import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { calendarInteractionPayloadSchema, type CalendarInteractionPayload } from './interactionPayload'
import { projectCalendarInteractionTiming } from './interactionTiming'
import { expandOccurrencesWithLimit, type CalendarRange } from './recurrence'
import { calendarDayEndInstant, calendarInstantToWallTime, defaultCalendarTimezone, isCalendarTimezone } from './timezone'

const PAGE_LIMIT = 100
export const MAX_WINDOW_ITEMS = 500
const MAX_SCOPED_PAGES = MAX_WINDOW_ITEMS / PAGE_LIMIT
const DAY_MS = 24 * 60 * 60 * 1000
const APPOINTMENT_CHUNK_MS = 31 * DAY_MS
const MAX_APPOINTMENT_CHUNKS = 12
const MAX_APPOINTMENT_OCCURRENCES = 500

type ScopedInteractionFilter = {
  userId: string
  organizationId: string
  timezone: string
}

type FetchInteractionWindowOptions = {
  recurrenceMasters?: boolean
  scope?: ScopedInteractionFilter
}

type CandidatePage = { payloads: CalendarInteractionPayload[]; truncated: boolean }

export async function fetchInteractionWindow(
  window: CalendarRange,
  signal?: AbortSignal,
  options: FetchInteractionWindowOptions = {},
): Promise<CandidatePage> {
  const { scope, recurrenceMasters } = options
  const collected: CalendarInteractionPayload[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let pageCount = 0
  do {
    const params = new URLSearchParams({
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      limit: String(PAGE_LIMIT),
    })
    if (recurrenceMasters) params.set('recurrenceMasters', 'true')
    if (scope) {
      params.set('organizationId', scope.organizationId)
      params.set('actorUserId', scope.userId)
      params.set('overlap', 'true')
      params.set('overlapTimezone', scope.timezone)
      params.set('excludeStatus', 'canceled')
    }
    if (cursor) params.set('cursor', cursor)
    const call = await apiCall<{ items?: unknown[]; nextCursor?: string }>(
      `/api/customers/interactions?${params.toString()}`,
      { signal },
    )
    if (!call.ok || signal?.aborted) throw new Error(`[internal] calendar interactions fetch failed (${call.status})`)
    const pageItems = call.result?.items
    if (scope && !Array.isArray(pageItems)) throw new Error('[internal] invalid calendar interactions response')
    for (const rawItem of Array.isArray(pageItems) ? pageItems : []) {
      const parsed = calendarInteractionPayloadSchema.safeParse(rawItem)
      if (parsed.success) collected.push(parsed.data)
      else if (scope) throw new Error('[internal] invalid calendar interaction')
    }

    pageCount += 1
    cursor = typeof call.result?.nextCursor === 'string' ? call.result.nextCursor : undefined
    if (cursor) {
      if (collected.length >= MAX_WINDOW_ITEMS || cursors.has(cursor) || (scope && pageCount >= MAX_SCOPED_PAGES)) {
        return { payloads: collected.slice(0, MAX_WINDOW_ITEMS), truncated: true }
      }
      cursors.add(cursor)
    }
  } while (cursor)
  return { payloads: collected.slice(0, MAX_WINDOW_ITEMS), truncated: collected.length > MAX_WINDOW_ITEMS }
}

export function mergeInteractionPayloads(
  windowPayloads: CalendarInteractionPayload[],
  recurringPayloads: CalendarInteractionPayload[],
): CandidatePage {
  const windowById = new Map(windowPayloads.map((payload) => [payload.id, payload]))
  const byId = new Map<string, CalendarInteractionPayload>()
  for (const payload of recurringPayloads) {
    byId.set(payload.id, windowById.get(payload.id) ?? payload)
  }
  for (const payload of windowPayloads) {
    if (!byId.has(payload.id)) byId.set(payload.id, payload)
  }
  const payloads = Array.from(byId.values())
  return {
    payloads: payloads.slice(0, MAX_WINDOW_ITEMS),
    truncated: payloads.length > MAX_WINDOW_ITEMS,
  }
}

export async function fetchCalendarCandidates(
  window: CalendarRange,
  signal?: AbortSignal,
  scope?: ScopedInteractionFilter,
): Promise<CandidatePage> {
  const [windowResult, recurringResult] = await Promise.all([
    fetchInteractionWindow(window, signal, { scope }),
    fetchInteractionWindow(window, signal, { scope, recurrenceMasters: true }),
  ])
  const merged = mergeInteractionPayloads(windowResult.payloads, recurringResult.payloads)
  return {
    payloads: merged.payloads,
    truncated: windowResult.truncated || recurringResult.truncated || merged.truncated,
  }
}

type ScopedCalendarAppointment = { id: string; title: string; start: Date; end: Date; allDay: boolean }
type ScopedCalendarAppointments = { items: ScopedCalendarAppointment[]; truncated: boolean }

function chronologicalAppointments(items: Map<string, ScopedCalendarAppointment>): ScopedCalendarAppointment[] {
  return Array.from(items.values()).sort((left, right) =>
    left.start.getTime() - right.start.getTime() || left.id.localeCompare(right.id))
}

export async function fetchScopedCalendarAppointments({
  userId,
  organizationId,
  from,
  to,
  signal,
}: {
  userId: string
  organizationId: string
  from: Date
  to: Date
  signal: AbortSignal
}): Promise<ScopedCalendarAppointments | null> {
  const fromTime = from.getTime()
  const toTime = to.getTime()
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime || signal.aborted) return null

  const timezone = defaultCalendarTimezone()
  const scope = { userId, organizationId, timezone }
  const items = new Map<string, ScopedCalendarAppointment>()
  let truncated = false
  let chunkStart = fromTime
  try {
    for (let chunk = 0; chunk < MAX_APPOINTMENT_CHUNKS && chunkStart < toTime; chunk += 1) {
      const chunkEnd = Math.min(toTime, chunkStart + APPOINTMENT_CHUNK_MS)
      const range = { from: new Date(chunkStart), to: new Date(chunkEnd) }
      const candidates = await fetchCalendarCandidates(range, signal, scope)
      truncated ||= candidates.truncated
      for (const payload of candidates.payloads) {
        if (payload.status === 'canceled' || (!payload.scheduledAt && payload.status !== 'planned')) continue
        const timing = projectCalendarInteractionTiming(payload)
        if (!timing || timing.start >= timing.end) continue

        const legacyAllDay = timing.allDay && !isCalendarTimezone(payload.timezone)
        // All-day Calendar ends are inclusive, and legacy series reuse the anchor day's length.
        const expansionFrom = timing.allDay ? new Date(chunkStart - (legacyAllDay ? DAY_MS : 1)) : range.from
        const expansion = expandOccurrencesWithLimit({ ...timing, id: payload.id, raw: payload }, { from: expansionFrom, to: range.to })
        truncated ||= expansion.truncated
        for (const occurrence of expansion.items) {
          const legacyEnd = legacyAllDay
            ? calendarDayEndInstant(calendarInstantToWallTime(occurrence.start, timezone).date, timezone)
            : null
          const end = occurrence.allDay ? new Date((legacyEnd ?? occurrence.end).getTime() + 1) : occurrence.end
          if (occurrence.start >= range.to || end <= range.from || items.has(occurrence.id)) continue
          if (items.size >= MAX_APPOINTMENT_OCCURRENCES) return { items: chronologicalAppointments(items), truncated: true }
          items.set(occurrence.id, {
            id: occurrence.id,
            title: payload.title ?? '',
            start: occurrence.start,
            end,
            allDay: occurrence.allDay,
          })
        }
      }
      chunkStart = chunkEnd
    }
    return { items: chronologicalAppointments(items), truncated: truncated || chunkStart < toTime }
  } catch {
    return null
  }
}
