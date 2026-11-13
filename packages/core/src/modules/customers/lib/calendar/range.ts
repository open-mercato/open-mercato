import { addDays } from 'date-fns/addDays'
import { addMonths } from 'date-fns/addMonths'
import { addWeeks } from 'date-fns/addWeeks'
import { endOfDay } from 'date-fns/endOfDay'
import { endOfMonth } from 'date-fns/endOfMonth'
import { endOfWeek } from 'date-fns/endOfWeek'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfMonth } from 'date-fns/startOfMonth'
import { startOfWeek } from 'date-fns/startOfWeek'
import type { FirstDayOfWeek } from '@open-mercato/shared/lib/date-locale/types'
import { resolveWeekStartsOn } from '@open-mercato/ui/primitives/date-locale-settings'
import type { CalendarRange, CalendarView } from '../../components/calendar/types'

export function getVisibleRange(
  view: CalendarView,
  anchor: Date,
  agendaHorizonDays: number,
  weekStartsOn: FirstDayOfWeek = resolveWeekStartsOn(),
): CalendarRange {
  const week = { weekStartsOn }
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: endOfDay(anchor) }
    case 'week':
      return { from: startOfWeek(anchor, week), to: endOfWeek(anchor, week) }
    case 'month':
      return {
        from: startOfWeek(startOfMonth(anchor), week),
        to: endOfWeek(endOfMonth(anchor), week),
      }
    case 'agenda':
      return { from: startOfDay(anchor), to: endOfDay(addDays(anchor, agendaHorizonDays)) }
  }
}

export function getFetchWindow(range: CalendarRange): CalendarRange {
  return { from: addDays(range.from, -1), to: range.to }
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, direction)
    case 'week':
      return addWeeks(anchor, direction)
    case 'month':
      return addMonths(anchor, direction)
    case 'agenda':
      return addDays(anchor, direction * 7)
  }
}
