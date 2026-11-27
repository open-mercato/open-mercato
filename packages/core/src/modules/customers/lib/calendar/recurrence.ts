import { expandOccurrencesWithLimit } from '@open-mercato/core/helpers/calendar/recurrence'
import type { CalendarItem, CalendarRange } from '../../components/calendar/types'

export { parseRecurrenceRule, type ParsedRecurrenceRule } from '@open-mercato/core/helpers/calendar/recurrence'

export function expandOccurrences(item: CalendarItem, range: CalendarRange): CalendarItem[] {
  return expandOccurrencesWithLimit(item, range).items
}
