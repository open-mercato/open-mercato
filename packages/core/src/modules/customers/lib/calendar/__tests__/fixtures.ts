import type { CalendarInteractionPayload, CalendarItem } from '../../../components/calendar/types'

export function makePayload(
  overrides: Partial<CalendarInteractionPayload> & { id: string },
): CalendarInteractionPayload {
  return {
    interactionType: 'meeting',
    title: 'Fixture interaction',
    status: 'planned',
    scheduledAt: '2026-06-01T10:00:00.000Z',
    occurredAt: null,
    durationMinutes: 30,
    allDay: false,
    location: null,
    participants: [],
    recurrenceRule: null,
    recurrenceEnd: null,
    appearanceIcon: null,
    appearanceColor: null,
    ownerUserId: null,
    entityId: null,
    dealId: null,
    updatedAt: '2026-06-01T09:00:00.000Z',
    ...overrides,
  }
}

export function makeCalendarItem(
  overrides: Partial<CalendarItem> & { id: string; start: Date; end: Date },
): CalendarItem {
  return {
    title: 'Fixture item',
    interactionType: 'meeting',
    category: 'meeting',
    status: 'planned',
    allDay: false,
    location: null,
    platform: null,
    locationKind: null,
    participants: [],
    ownerUserId: null,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: null,
    raw: makePayload({ id: overrides.id }),
    ...overrides,
  }
}
