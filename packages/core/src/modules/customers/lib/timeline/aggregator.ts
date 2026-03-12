// Re-export from shared — this module's aggregator is now generic
import { aggregateTimeline as genericAggregate } from '@open-mercato/shared/modules/timeline/aggregator'
import type { TimelineEntry, TimelineEntryKind } from './types'

export type AggregateOptions = {
  limit: number
  before: string | null
  types: Set<TimelineEntryKind> | null
}

export function aggregateTimeline(
  sources: TimelineEntry[][],
  options: AggregateOptions,
): { items: TimelineEntry[]; nextCursor: string | null } {
  return genericAggregate(sources, options) as { items: TimelineEntry[]; nextCursor: string | null }
}
