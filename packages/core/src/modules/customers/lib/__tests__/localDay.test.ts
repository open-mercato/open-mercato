/** @jest-environment jsdom */
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { USER_TIMEZONE, getUserTimeZone, isSameDay, toLocalZonedDate } from '../localDay'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }

function configureTimeZone(timeZone: string | null): void {
  setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone }, env: noEnv }))
}

afterEach(() => setClientDateLocaleSettings(null))

describe('getUserTimeZone', () => {
  it('resolves to a non-empty IANA zone the platform accepts', () => {
    expect(getUserTimeZone()).toEqual(expect.any(String))
    expect(getUserTimeZone().length).toBeGreaterThan(0)
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: getUserTimeZone() })).not.toThrow()
  })

  it('follows the configured display timezone', () => {
    configureTimeZone('Pacific/Kiritimati')
    expect(getUserTimeZone()).toBe('Pacific/Kiritimati')
  })

  it('falls back to the runtime zone when none is configured', () => {
    configureTimeZone(null)
    expect(getUserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('keeps the deprecated USER_TIMEZONE alias as a valid zone', () => {
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: USER_TIMEZONE })).not.toThrow()
  })
})

describe('isSameDay', () => {
  it('is true for two instants on the same calendar day', () => {
    expect(isSameDay(new Date(2026, 3, 10, 0, 0, 0), new Date(2026, 3, 10, 23, 59, 59))).toBe(true)
  })

  it('is false one millisecond across a local midnight', () => {
    expect(isSameDay(new Date(2026, 3, 10, 23, 59, 59, 999), new Date(2026, 3, 11, 0, 0, 0, 0))).toBe(false)
  })

  it('compares the day rather than the elapsed distance', () => {
    const lateEvening = new Date(2026, 3, 10, 23, 30)
    const earlyNextMorning = new Date(2026, 3, 11, 0, 30)
    expect(earlyNextMorning.getTime() - lateEvening.getTime()).toBe(60 * 60 * 1000)
    expect(isSameDay(lateEvening, earlyNextMorning)).toBe(false)
  })

  it('distinguishes the same day number in a different month or year', () => {
    expect(isSameDay(new Date(2026, 3, 10), new Date(2026, 4, 10))).toBe(false)
    expect(isSameDay(new Date(2026, 3, 10), new Date(2027, 3, 10))).toBe(false)
  })

  it('is false when either operand is an invalid date', () => {
    expect(isSameDay(new Date('nope'), new Date(2026, 3, 10))).toBe(false)
    expect(isSameDay(new Date('nope'), new Date('nope'))).toBe(false)
  })
})

describe('toLocalZonedDate', () => {
  it('accepts an ISO string and a Date and yields the same projection', () => {
    const iso = '2026-04-10T21:30:00.000Z'
    expect(toLocalZonedDate(iso).getTime()).toBe(toLocalZonedDate(new Date(iso)).getTime())
  })

  it('projects an instant onto the calendar day the reader would name', () => {
    // The projected wall-clock fields are what the day comparison reads, so they must
    // agree with what `Intl` renders for the same instant in getUserTimeZone() — this is
    // the property that keeps the day strip and the activity list on the same day for
    // late-evening activities near a UTC boundary (issue #1809 — E3).
    const instant = new Date('2026-04-10T21:30:00.000Z')
    const projected = toLocalZonedDate(instant)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: getUserTimeZone(),
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(instant)
    const partValue = (type: string) => Number(parts.find((part) => part.type === type)?.value)

    expect(projected.getFullYear()).toBe(partValue('year'))
    expect(projected.getMonth() + 1).toBe(partValue('month'))
    expect(projected.getDate()).toBe(partValue('day'))
  })
})

describe('toLocalZonedDate with a configured display timezone', () => {
  it('projects onto the configured zone rather than the runtime zone', () => {
    configureTimeZone('Pacific/Kiritimati')
    const projected = toLocalZonedDate('2026-04-10T21:30:00.000Z')
    expect([projected.getFullYear(), projected.getMonth() + 1, projected.getDate(), projected.getHours()]).toEqual([2026, 4, 11, 11])
  })
})
