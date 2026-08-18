import type { CalendarItem } from '../types'

export function buildCalendarItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'item-1',
    title: 'Quarterly review',
    interactionType: 'meeting',
    category: 'meeting',
    status: 'planned',
    start: new Date(2026, 7, 10, 12, 0, 0),
    end: new Date(2026, 7, 10, 13, 0, 0),
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
    raw: { id: 'item-1', interactionType: 'meeting', status: 'planned' },
    ...overrides,
  }
}
