export const TIMELINE_FILTERS = ['all', 'comments', 'status_changes', 'customer_visible'] as const

export type TimelineFilterId = (typeof TIMELINE_FILTERS)[number]

export type TimelineFilterableEvent = {
  kind: string
  visibility: string
}

export function isTimelineFilterId(value: string): value is TimelineFilterId {
  return (TIMELINE_FILTERS as readonly string[]).includes(value)
}

export function filterTimelineEvents<TEvent extends TimelineFilterableEvent>(
  events: TEvent[],
  filter: TimelineFilterId,
): TEvent[] {
  if (filter === 'comments') return events.filter((event) => event.kind === 'comment')
  if (filter === 'status_changes') return events.filter((event) => event.kind === 'status_changed')
  if (filter === 'customer_visible') return events.filter((event) => event.visibility === 'customer')
  return events
}
