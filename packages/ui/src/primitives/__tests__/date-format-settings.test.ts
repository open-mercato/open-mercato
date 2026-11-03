import { enUS } from 'date-fns/locale/en-US'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import type { DateLocaleSettingsInput } from '@open-mercato/shared/lib/date-locale/types'
import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayTime,
  formatLocalDisplayValue,
  todayInZone,
  toZonedWallClock,
} from '../date-format'
import { getActiveDateLocaleSettings, setClientDateLocaleSettings } from '../date-locale-store'
import { resolveDisplayTimeZone, resolveWeekStartsOn } from '../date-locale-settings'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
const settings = (tenant: DateLocaleSettingsInput) => resolveDateLocaleSettings({ tenant, env: noEnv })

const INSTANT = '2026-12-31T23:30:00.000Z'

describe('settings-aware display helpers', () => {
  afterEach(() => setClientDateLocaleSettings(null))

  it('renders an instant in the configured timezone', () => {
    expect(formatDisplayDate(INSTANT, 'en-US', settings({ timeZone: 'UTC' }))).toBe('Dec 31, 2026')
    expect(formatDisplayDate(INSTANT, 'en-US', settings({ timeZone: 'Europe/Warsaw' }))).toBe('Jan 1, 2027')
  })

  it('applies the timezone on the pattern path too', () => {
    expect(formatDisplayDateTime(INSTANT, 'en-US', settings({ timeZone: 'Asia/Tokyo', dateTimeFormat: 'yyyy-MM-dd HH:mm' }))).toBe(
      '2027-01-01 08:30',
    )
  })

  it('never moves a bare calendar day between zones', () => {
    expect(formatDisplayDate('2026-07-01', 'en-US', settings({ timeZone: 'Pacific/Kiritimati' }))).toBe('Jul 1, 2026')
    expect(formatDisplayDate('2026-07-01', 'en-US', settings({ timeZone: 'Pacific/Pago_Pago', dateFormat: 'dd.MM.yyyy' }))).toBe(
      '01.07.2026',
    )
  })

  it('uses the configured formatting locale over the app locale', () => {
    expect(formatDisplayDate(INSTANT, 'en-US', settings({ timeZone: 'UTC', locale: 'en-GB' }))).toBe('31 Dec 2026')
  })

  it('formats a time with the configured pattern or the locale clock', () => {
    expect(formatDisplayTime(INSTANT, 'en-US', settings({ timeZone: 'UTC', timeFormat: 'HH:mm' }))).toBe('23:30')
    expect(formatDisplayTime(INSTANT, 'en-US', settings({ timeZone: 'UTC' }))).toBe('11:30 PM')
  })

  it('reads the client settings when none are passed', () => {
    setClientDateLocaleSettings(settings({ dateFormat: 'dd/MM/yyyy', timeZone: 'UTC' }))
    expect(getActiveDateLocaleSettings().dateFormat).toBe('dd/MM/yyyy')
    expect(formatDisplayDate(INSTANT)).toBe('31/12/2026')
  })
})

describe('formatLocalDisplayValue', () => {
  const picked = new Date(2026, 4, 9, 10, 30)

  it('keeps a picked value on its wall clock regardless of the configured zone', () => {
    expect(formatLocalDisplayValue(picked, { settings: settings({ timeZone: 'Asia/Tokyo', dateFormat: 'dd.MM.yyyy' }) })).toBe('09.05.2026')
  })

  it('lets an explicit field format win over the settings', () => {
    expect(formatLocalDisplayValue(picked, { explicitFormat: 'yyyy/MM/dd', settings: settings({ dateFormat: 'dd.MM.yyyy' }) })).toBe(
      '2026/05/09',
    )
  })

  it('falls back to Intl when nothing is configured', () => {
    expect(formatLocalDisplayValue(picked, { withTime: true, locale: enUS, settings: settings({}) })).toBe('May 9, 2026, 10:30 AM')
  })
})

describe('zone helpers', () => {
  it('names today in the given zone', () => {
    const now = new Date('2026-12-31T23:30:00.000Z')
    expect(todayInZone('UTC', now)).toBe('2026-12-31')
    expect(todayInZone('Europe/Warsaw', now)).toBe('2027-01-01')
  })

  it('returns the original date for an unknown zone', () => {
    const date = new Date(INSTANT)
    expect(toZonedWallClock(date, 'Mars/Olympus')).toBe(date)
  })

  it('resolves the display zone from settings, then the runtime', () => {
    expect(resolveDisplayTimeZone({ timeZone: 'Asia/Seoul' })).toBe('Asia/Seoul')
    expect(resolveDisplayTimeZone({ timeZone: null })).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('resolves the week start from settings, then the formatting locale, then Monday', () => {
    expect(resolveWeekStartsOn({ firstDayOfWeek: 6, locale: 'en-US' })).toBe(6)
    expect(resolveWeekStartsOn({ firstDayOfWeek: null, locale: 'en-US' })).toBe(0)
    expect(resolveWeekStartsOn({ firstDayOfWeek: null, locale: 'en-GB' })).toBe(1)
    expect(resolveWeekStartsOn({ firstDayOfWeek: null, locale: null })).toBe(1)
  })
})
