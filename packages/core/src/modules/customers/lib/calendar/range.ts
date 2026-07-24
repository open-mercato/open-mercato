import { addDays } from 'date-fns/addDays'
import { addMonths } from 'date-fns/addMonths'
import { addWeeks } from 'date-fns/addWeeks'
import { endOfDay } from 'date-fns/endOfDay'
import { endOfMonth } from 'date-fns/endOfMonth'
import { endOfWeek } from 'date-fns/endOfWeek'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfMonth } from 'date-fns/startOfMonth'
import { startOfWeek } from 'date-fns/startOfWeek'
import type { CalendarRange, CalendarView } from '../../components/calendar/types'

const MONDAY_WEEK = { weekStartsOn: 1 as const }

export function getVisibleRange(view: CalendarView, anchor: Date, agendaHorizonDays: number): CalendarRange {
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: endOfDay(anchor) }
    case 'week':
      return { from: startOfWeek(anchor, MONDAY_WEEK), to: endOfWeek(anchor, MONDAY_WEEK) }
    case 'month':
      return {
        from: startOfWeek(startOfMonth(anchor), MONDAY_WEEK),
        to: endOfWeek(endOfMonth(anchor), MONDAY_WEEK),
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
