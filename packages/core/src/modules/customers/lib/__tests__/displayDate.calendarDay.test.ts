/** @jest-environment jsdom */

import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { formatCalendarDay, formatCalendarDayParts } from '../displayDate'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
const EXPECTED_CLOSE = '2026-07-01T00:00:00.000Z'

describe('calendar-day display of date-only values stored as UTC midnight', () => {
  afterEach(() => setClientDateLocaleSettings(null))

  it.each(['America/New_York', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'])('keeps the stored day under %s', (timeZone) => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone }, env: noEnv }))
    expect(formatCalendarDay(EXPECTED_CLOSE, 'en-US')).toBe('Jul 1, 2026')
    expect(formatCalendarDayParts(EXPECTED_CLOSE, { month: 'short', day: '2-digit' }, 'en-US')).toBe('Jul 01')
  })

  it('uses the configured date pattern', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'America/New_York', dateFormat: 'dd.MM.yyyy' }, env: noEnv }))
    expect(formatCalendarDay(EXPECTED_CLOSE, 'en-US')).toBe('01.07.2026')
  })

  it('returns null for empty or invalid values', () => {
    expect(formatCalendarDay(null)).toBeNull()
    expect(formatCalendarDay('not a date')).toBeNull()
    expect(formatCalendarDayParts(undefined, { day: 'numeric' })).toBeNull()
  })
})
