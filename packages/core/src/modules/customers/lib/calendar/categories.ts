import type { CalendarCategory, CalendarItem } from '../../components/calendar/types'

export const CATEGORY_BY_TYPE: Record<string, CalendarCategory> = {
  meeting: 'meeting',
  call: 'meeting',
  'video-call': 'meeting',
  event: 'event',
  webinar: 'event',
  task: 'task',
  todo: 'task',
  deadline: 'task',
}

export function categoryOf(interactionType: string): CalendarCategory {
  return CATEGORY_BY_TYPE[interactionType] ?? 'other'
}

export function countByCategory(items: CalendarItem[]): { all: number; meetings: number; events: number } {
  let meetings = 0
  let events = 0
  for (const item of items) {
    if (item.category === 'meeting') meetings += 1
    else if (item.category === 'event') events += 1
  }
  return { all: items.length, meetings, events }
}
