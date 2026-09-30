import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { calendarInteractionPayloadSchema } from '@open-mercato/core/modules/customers/components/calendar/types'
import { mapInteractionToCalendarItem } from '@open-mercato/core/modules/customers/lib/calendar/mapItem'
import { expandOccurrences, parseRecurrenceRule } from '@open-mercato/core/modules/customers/lib/calendar/recurrence'
import { isCalendarTimezone } from '@open-mercato/core/modules/customers/lib/calendar/timezone'
import type { VisitAvailabilityInput, VisitAvailabilitySubject } from './visitAvailability'

type Row = Record<string, unknown>
const MAX_BOOKING_RECORDS = 1000
const MAX_SERIES_DAYS = 36600
const fields = ['id', 'tenant_id', 'organization_id', 'deleted_at', 'status', 'interaction_type', 'scheduled_at', 'occurred_at', 'duration_minutes', 'timezone', 'all_day', 'participants', 'owner_user_id', 'linked_entities', 'recurrence_rule', 'recurrence_end']

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function dateValue(raw: unknown): unknown {
  return raw instanceof Date ? raw.toISOString() : raw
}

function arrayValue(raw: unknown): unknown[] {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (parsed === null || parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error('[internal] Invalid booking subjects')
  return parsed
}

function assignedTo(row: Row, subject: VisitAvailabilitySubject): boolean {
  if (subject.type === 'staff') {
    return value(row, 'ownerUserId', 'owner_user_id') === subject.id || arrayValue(row.participants).some((participant) =>
      typeof participant === 'object' && participant !== null && 'userId' in participant && participant.userId === subject.id)
  }
  return arrayValue(value(row, 'linkedEntities', 'linked_entities')).some((link) =>
    typeof link === 'object' && link !== null && 'type' in link && link.type === 'resource' && 'id' in link && link.id === subject.id)
}

export async function bookedVisitSubjects(args: {
  queryEngine: QueryEngine
  scope: { tenantId: string; organizationId: string }
  input: VisitAvailabilityInput
  subjects: VisitAvailabilitySubject[]
}): Promise<Set<string>> {
  const { queryEngine, scope, input, subjects } = args
  const start = new Date(input.startAt)
  const end = new Date(input.endAt)
  const allDayUpperBound = new Date(end.getTime() + 2 * 86400000).toISOString()
  const booked = new Set<string>()
  let scanned = 0
  for (let page = 1; page <= MAX_BOOKING_RECORDS / 100; page += 1) {
    const result = await queryEngine.query<Row>('customers:customer_interaction', {
      tenantId: scope.tenantId, organizationId: scope.organizationId,
      filters: { deleted_at: null, status: { $ne: 'canceled' },
        $or: [{ scheduled_at: { $lt: input.endAt } }, { occurred_at: { $lt: input.endAt } },
          { all_day: true, scheduled_at: { $lt: allDayUpperBound } }, { all_day: true, occurred_at: { $lt: allDayUpperBound } }],
        ...(input.excludeInteractionId ? { id: { $ne: input.excludeInteractionId } } : {}),
      },
      fields, sort: [{ field: 'id' }], page: { page, pageSize: 100 },
    })
    if (!Number.isFinite(result.total) || result.total > MAX_BOOKING_RECORDS || result.items.length > 100) throw new Error('[internal] Booking result limit')
    for (const row of result.items) {
      if (row.id === input.excludeInteractionId || value(row, 'deletedAt', 'deleted_at') || row.status === 'canceled') continue
      if (typeof value(row, 'tenantId', 'tenant_id') === 'string' && value(row, 'tenantId', 'tenant_id') !== scope.tenantId) continue
      if (typeof value(row, 'organizationId', 'organization_id') === 'string' && value(row, 'organizationId', 'organization_id') !== scope.organizationId) continue
      const assigned = subjects.filter((subject) => assignedTo(row, subject))
      if (!assigned.length) continue
      const payload = calendarInteractionPayloadSchema.parse({
        id: row.id, interactionType: value(row, 'interactionType', 'interaction_type'), status: row.status,
        scheduledAt: dateValue(value(row, 'scheduledAt', 'scheduled_at')),
        occurredAt: dateValue(value(row, 'occurredAt', 'occurred_at')),
        durationMinutes: value(row, 'durationMinutes', 'duration_minutes'), timezone: row.timezone,
        allDay: value(row, 'allDay', 'all_day'), recurrenceRule: value(row, 'recurrenceRule', 'recurrence_rule'),
        recurrenceEnd: dateValue(value(row, 'recurrenceEnd', 'recurrence_end')),
      })
      if (payload.timezone && !isCalendarTimezone(payload.timezone)) throw new Error('[internal] Invalid booking timezone')
      if (payload.recurrenceRule && !parseRecurrenceRule(payload.recurrenceRule)) throw new Error('[internal] Unsupported booking recurrence')
      if (payload.recurrenceEnd && Number.isNaN(new Date(payload.recurrenceEnd).getTime())) throw new Error('[internal] Invalid booking recurrence end')
      const item = mapInteractionToCalendarItem(payload, {})
      if (!item || item.end <= item.start) throw new Error('[internal] Invalid booking interval')
      if (payload.recurrenceRule && (end.getTime() - item.start.getTime()) / 86400000 > MAX_SERIES_DAYS) throw new Error('[internal] Booking recurrence limit')
      const occurrences = expandOccurrences(item, { from: start, to: end })
      if (occurrences.some((occurrence) => occurrence.start < end && occurrence.end > start)) {
        assigned.forEach((subject) => booked.add(`${subject.type}:${subject.id}`))
      } else if (occurrences.length >= 100) throw new Error('[internal] Booking occurrence limit')
    }
    scanned += result.items.length
    if (scanned >= result.total) return booked
    if (result.items.length === 0) throw new Error('[internal] Incomplete booking page')
  }
  throw new Error('[internal] Booking result limit')
}
