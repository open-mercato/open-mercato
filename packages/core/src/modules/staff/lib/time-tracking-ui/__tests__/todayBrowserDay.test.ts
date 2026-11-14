/**
 * @jest-environment node
 */
import { todayIso } from '../timesheetPeriod'
import {
  clockFromApiValue,
  combineDateAndClock,
  dateFromApiValue,
  todayIsoDate as dialogTodayIsoDate,
} from '../timeEntryDialogState'
import { todayIsoDate as drawerTodayIsoDate } from '../taskDrawerData'

let mockTimeZone: string | null = null

jest.mock('@open-mercato/ui/primitives/date-locale-store', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/ui/primitives/date-locale-store')>(
    '@open-mercato/ui/primitives/date-locale-store',
  )
  return {
    ...actual,
    getActiveDateLocaleSettings: () => ({ ...actual.getActiveDateLocaleSettings(), timeZone: mockTimeZone }),
  }
})

function browserDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function browserClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

// Time entries are typed as a browser-zone day plus clock, stored as an instant and read back in
// the browser zone. "Today" must use the same frame even when the configured zone is a day ahead
// or behind, or an entry for work just done is saved a day in the future.
describe('time tracking "today" stays in the browser zone that entries are stored in', () => {
  const instants = [
    new Date('2026-07-20T12:00:00.000Z'),
    new Date('2026-07-20T22:30:00.000Z'),
    new Date('2026-07-21T01:15:00.000Z'),
  ]

  afterEach(() => {
    mockTimeZone = null
  })

  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago', null])('ignores a configured %s zone', (zone) => {
    mockTimeZone = zone
    for (const now of instants) {
      expect(todayIso(now)).toBe(browserDay(now))
      expect(dialogTodayIsoDate(now)).toBe(browserDay(now))
      expect(drawerTodayIsoDate(now)).toBe(browserDay(now))
    }
  })

  it('round-trips the default day and the current clock without moving the entry', () => {
    mockTimeZone = 'Pacific/Kiritimati'
    for (const now of instants) {
      const date = dialogTodayIsoDate(now)
      const stored = combineDateAndClock(date, browserClock(now))
      expect(stored).not.toBeNull()
      const storedAt = new Date(stored!)
      expect(storedAt.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(now.getTime() - storedAt.getTime()).toBeLessThan(60_000)
      expect(browserDay(storedAt)).toBe(date)
      expect(dateFromApiValue(date)).toBe(date)
      expect(clockFromApiValue(stored)).toBe(browserClock(now))
    }
  })
})
