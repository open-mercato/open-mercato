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

  // Patterns are formatted on a wall-clock Date shifted into the zone, so date-fns alone would print
  // the RUNTIME offset (America/New_York in jest) next to Tokyo's clock time.
  it('prints the configured zone offset and the real epoch for zone and epoch tokens', () => {
    const tokyo = (dateTimeFormat: string) => formatDisplayDateTime('2026-07-01T00:00:00Z', 'en-US', settings({ timeZone: 'Asia/Tokyo', dateTimeFormat }))
    expect(tokyo('yyyy-MM-dd HH:mm XXX')).toBe('2026-07-01 09:00 +09:00')
    expect(tokyo('HH:mm X')).toBe('09:00 +09')
    expect(tokyo('HH:mm xx')).toBe('09:00 +0900')
    expect(tokyo('HH:mm O')).toBe('09:00 GMT+9')
    expect(tokyo('HH:mm OOOO')).toBe('09:00 GMT+09:00')
    expect(tokyo('t')).toBe(String(Date.UTC(2026, 6, 1) / 1000))
    expect(tokyo('T')).toBe(String(Date.UTC(2026, 6, 1)))
    expect(tokyo("HH:mm 'XXX' XXX")).toBe('09:00 XXX +09:00')
    expect(formatDisplayDateTime('2026-07-01T00:00:00Z', 'en-US', settings({ timeZone: 'UTC', dateTimeFormat: 'HH:mm XXX' }))).toBe('00:00 Z')
    expect(formatDisplayDateTime('2026-07-01T00:00:00Z', 'en-US', settings({ timeZone: 'Asia/Kolkata', dateTimeFormat: 'HH:mm XXX' }))).toBe('05:30 +05:30')
    expect(formatDisplayDateTime('2026-01-15T12:00:00Z', 'en-US', settings({ timeZone: 'America/Los_Angeles', dateTimeFormat: 'HH:mm xxx' }))).toBe('04:00 -08:00')
  })

  it('renders the zone inside the long localized time tokens for the configured zone', () => {
    const tokyo = (dateTimeFormat: string, locale?: string) =>
      formatDisplayDateTime('2026-07-01T00:00:00Z', 'en-US', settings({ timeZone: 'Asia/Tokyo', dateTimeFormat, locale: locale ?? null }))
    expect(tokyo('ppp')).toBe('9:00:00 AM GMT+9')
    expect(tokyo('pppp')).toBe('9:00:00 AM Japan Standard Time')
    expect(tokyo('PPPppp')).toBe("July 1st, 2026 at 9:00:00 AM GMT+9")
    expect(tokyo("'ppp' p")).toBe('ppp 9:00 AM')
    expect(tokyo('ppp', 'pl-PL')).toBe('09:00:00 GMT+9')
  })

  it('applies a pinned time-only pattern clock to Intl timestamps', () => {
    const at = '2026-07-01T13:05:00Z'
    expect(formatDisplayDateTime(at, 'en-US', settings({ timeZone: 'UTC', timeFormat: 'HH:mm' }))).toBe('Jul 1, 2026, 13:05')
    expect(formatDisplayTime(at, 'en-US', settings({ timeZone: 'UTC', timeFormat: 'HH:mm' }))).toBe('13:05')
    expect(formatDisplayDateTime(at, 'de-DE', settings({ timeZone: 'UTC', timeFormat: 'h:mm a' }))).toMatch(/1:05\s?PM/)
  })

  it('keeps a zone-less wall time on its clock reading instead of shifting it', () => {
    expect(formatDisplayDateTime('2026-07-01 10:00', 'en-US', settings({ timeZone: 'Asia/Tokyo', dateTimeFormat: 'yyyy-MM-dd HH:mm' }))).toBe(
      '2026-07-01 10:00',
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

  it('renders month names of a pattern in the configured formatting locale', () => {
    expect(formatDisplayDate(INSTANT, 'en-US', settings({ timeZone: 'UTC', locale: 'pl-PL', dateFormat: 'd MMM yyyy' }))).toBe('31 gru 2026')
    expect(formatDisplayDate(INSTANT, 'pl', settings({ timeZone: 'UTC', dateFormat: 'd MMM yyyy' }))).toBe('31 gru 2026')
    expect(formatDisplayDate(INSTANT, 'en-US', settings({ timeZone: 'UTC', dateFormat: 'd MMM yyyy' }))).toBe('31 Dec 2026')
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

  it('uses the clock of a pinned time pattern, like the tables do', () => {
    const afternoon = new Date(2026, 4, 9, 13, 30)
    const pinned = settings({ timeFormat: 'HH:mm' })
    expect(formatLocalDisplayValue(afternoon, { withTime: true, locale: enUS, settings: pinned })).toBe('May 9, 2026, 13:30')
    expect(formatLocalDisplayValue(afternoon, { withTime: true, locale: enUS, settings: settings({ timeFormat: 'h:mm a' }) })).toBe(
      'May 9, 2026, 1:30 PM',
    )
    expect(formatLocalDisplayValue(afternoon, { locale: enUS, settings: pinned })).toBe('May 9, 2026')
  })
})

describe('Intl fallback', () => {
  it('keeps the display zone and clock when the configured locale cannot be used', () => {
    const broken = { ...settings({ timeZone: 'Asia/Tokyo', timeFormat: 'HH:mm' }), locale: 'not a locale!' }
    expect(formatDisplayDateTime(INSTANT, 'en-US', broken)).toBe('Jan 1, 2027, 08:30')
    expect(formatDisplayDate(INSTANT, 'en-US', broken)).toBe('Jan 1, 2027')
  })
})

describe('zone helpers', () => {
  it('names today in the given zone', () => {
    const now = new Date('2026-12-31T23:30:00.000Z')
    expect(todayInZone('UTC', now)).toBe('2026-12-31')
    expect(todayInZone('Europe/Warsaw', now)).toBe('2027-01-01')
  })

  it('keeps years 0–99 instead of reading them as 1900–1999', () => {
    const instant = new Date(Date.UTC(2000, 5, 15, 10, 30))
    instant.setUTCFullYear(50)
    const wall = toZonedWallClock(instant, 'UTC')
    expect(wall.getFullYear()).toBe(50)
    expect([wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([5, 15, 10, 30])
    expect(formatDisplayDateTime(instant, 'en-US', settings({ timeZone: 'UTC', dateTimeFormat: "yyyy-MM-dd HH:mm XXX" }))).toBe(
      '0050-06-15 10:30 Z',
    )
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
