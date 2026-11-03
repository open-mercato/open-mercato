/**
 * @jest-environment node
 */
import { todayIso } from '../timesheetPeriod'
import { todayIsoDate as dialogTodayIsoDate } from '../timeEntryDialogState'
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

// 2026-07-20 12:00 UTC is already 21 July in Kiritimati (UTC+14) and still 20 July in Los Angeles.
const NOW = new Date('2026-07-20T12:00:00.000Z')

describe('time tracking "today" follows the configured display zone', () => {
  afterEach(() => {
    mockTimeZone = null
  })

  it.each([
    ['Pacific/Kiritimati', '2026-07-21'],
    ['America/Los_Angeles', '2026-07-20'],
  ])('answers the %s calendar day from every consolidated helper', (zone, expected) => {
    mockTimeZone = zone
    expect(todayIso(NOW)).toBe(expected)
    expect(dialogTodayIsoDate(NOW)).toBe(expected)
    expect(drawerTodayIsoDate(NOW)).toBe(expected)
  })

  it('falls back to the runtime calendar day when no zone is configured', () => {
    const local = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`
    expect(todayIso(NOW)).toBe(local)
    expect(dialogTodayIsoDate(NOW)).toBe(local)
    expect(drawerTodayIsoDate(NOW)).toBe(local)
  })
})
