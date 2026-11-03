import { businessMillisBetween } from '../lib/businessHours'
import {
  buildBusinessHoursFormValue,
  businessHoursEndTimeToMinutes,
  businessHoursTimeToMinutes,
  createBusinessHoursIntervalRow,
  formatBusinessHoursEndTimeForInput,
  formatBusinessHoursTime,
  normalizeBusinessHoursEndTime,
  serializeBusinessHoursRecord,
  validateBusinessHoursValue,
  type BusinessHoursFormValue,
} from '../lib/businessHoursForm'

const MESSAGES = { error: { window: 'window-error', holiday: 'holiday-error' } }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function roundTrip(record: Record<string, unknown> | null): Record<string, unknown> | null {
  return serializeBusinessHoursRecord(buildBusinessHoursFormValue(record))
}

function nextUtcWeekday(targetUtcDay: number): Date {
  const base = new Date(Date.UTC(2031, 0, 1))
  const offset = (targetUtcDay - base.getUTCDay() + 7) % 7
  return new Date(base.getTime() + offset * DAY_MS)
}

function formValueWithInterval(start: string, end: string): { value: BusinessHoursFormValue; intervalKey: string } {
  const value = buildBusinessHoursFormValue(null)
  const interval = createBusinessHoursIntervalRow(start, end)
  value.days[0] = { ...value.days[0], enabled: true, intervals: [interval] }
  return { value, intervalKey: interval.key }
}

describe('businessHoursTimeToMinutes / formatBusinessHoursTime', () => {
  it('parses padded and unpadded times, including the 24:00 end-of-day marker', () => {
    expect(businessHoursTimeToMinutes('9:00')).toBe(9 * 60)
    expect(businessHoursTimeToMinutes('09:00')).toBe(9 * 60)
    expect(businessHoursTimeToMinutes('09:00:00')).toBe(9 * 60)
    expect(businessHoursTimeToMinutes('23:59')).toBe(23 * 60 + 59)
    expect(businessHoursTimeToMinutes('24:00')).toBe(24 * 60)
  })

  it('rejects out-of-range and malformed times', () => {
    expect(businessHoursTimeToMinutes('24:01')).toBeNull()
    expect(businessHoursTimeToMinutes('25:00')).toBeNull()
    expect(businessHoursTimeToMinutes('9:60')).toBeNull()
    expect(businessHoursTimeToMinutes('09:00:30')).toBeNull()
    expect(businessHoursTimeToMinutes('')).toBeNull()
    expect(businessHoursTimeToMinutes('nonsense')).toBeNull()
  })

  it('formats minutes back to HH:MM and keeps 1440 as 24:00', () => {
    expect(formatBusinessHoursTime(9 * 60)).toBe('09:00')
    expect(formatBusinessHoursTime(9 * 60 + 1)).toBe('09:01')
    expect(formatBusinessHoursTime(24 * 60)).toBe('24:00')
  })
})

describe('build -> serialize round-trip', () => {
  it('preserves timezone, week, holidays, and unknown extra top-level keys', () => {
    const record = {
      timezone: 'Europe/Warsaw',
      week: {
        mon: [{ start: '09:00', end: '17:00' }],
        fri: [
          { start: '08:30', end: '12:00' },
          { start: '13:00', end: '17:30' },
        ],
      },
      holidays: ['2031-12-24', '2031-12-25'],
      vendorNote: 'keep-me',
      nested: { flag: true, level: 2 },
    }
    expect(roundTrip(record)).toEqual(record)
  })

  it('normalizes unpadded times like 9:00 to 09:00 and stays accepted by the SLA parser', () => {
    const record = { week: { mon: [{ start: '9:00', end: '17:00' }] } }
    const built = buildBusinessHoursFormValue(record)
    const mondayRow = built.days.find((day) => day.weekday === 'mon')
    expect(mondayRow?.enabled).toBe(true)
    expect(mondayRow?.intervals.map((interval) => ({ start: interval.start, end: interval.end }))).toEqual([
      { start: '09:00', end: '17:00' },
    ])

    const serialized = serializeBusinessHoursRecord(built)
    expect(serialized).toEqual({ week: { mon: [{ start: '09:00', end: '17:00' }] } })

    const monday = nextUtcWeekday(1)
    const elapsed = businessMillisBetween(
      new Date(monday.getTime() + 8 * HOUR_MS),
      new Date(monday.getTime() + 18 * HOUR_MS),
      serialized,
    )
    expect(elapsed).toBe(8 * HOUR_MS)
  })

  it('keeps the 24:00 end-of-day window through the round-trip and the SLA parser counts the full day', () => {
    const record = { week: { sat: [{ start: '00:00', end: '24:00' }] } }
    expect(roundTrip(record)).toEqual(record)

    const saturday = nextUtcWeekday(6)
    const sunday = new Date(saturday.getTime() + DAY_MS)
    expect(businessMillisBetween(saturday, sunday, roundTrip(record))).toBe(DAY_MS)
  })

  it('drops malformed interval rows with the same tolerance as the SLA parser', () => {
    const record = {
      week: {
        mon: [
          'junk',
          42,
          { start: '25:00', end: '26:00' },
          { start: '10:00', end: '09:00' },
          { start: '11:00', end: '11:00' },
          { start: '9:61', end: '12:00' },
          { start: '09:00:30', end: '10:00' },
          { start: '9:00', end: '17:00' },
        ],
        tue: 'not-an-array',
      },
    }
    const serialized = roundTrip(record)
    expect(serialized).toEqual({ week: { mon: [{ start: '09:00', end: '17:00' }] } })

    const monday = nextUtcWeekday(1)
    const windowStart = new Date(monday.getTime() + 8 * HOUR_MS)
    const windowEnd = new Date(monday.getTime() + 18 * HOUR_MS)
    const directElapsed = businessMillisBetween(windowStart, windowEnd, record)
    const roundTrippedElapsed = businessMillisBetween(windowStart, windowEnd, serialized)
    expect(directElapsed).toBe(8 * HOUR_MS)
    expect(roundTrippedElapsed).toBe(directElapsed)
  })

  it('sorts out-of-order intervals by start time', () => {
    const record = {
      week: {
        wed: [
          { start: '13:00', end: '17:00' },
          { start: '08:00', end: '12:00' },
        ],
      },
    }
    expect(roundTrip(record)).toEqual({
      week: {
        wed: [
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '17:00' },
        ],
      },
    })
  })

  it('drops malformed holidays on build and dedupes them on serialize', () => {
    const built = buildBusinessHoursFormValue({ holidays: ['2031-12-24', '24-12-2031', 'soon', 42] })
    expect(built.holidays.map((row) => row.date)).toEqual(['2031-12-24'])

    built.holidays = [...built.holidays, { key: 'dup-row', date: '2031-12-24' }]
    expect(serializeBusinessHoursRecord(built)).toEqual({ holidays: ['2031-12-24'] })
  })

  it('serializes an empty form to null and keeps extras standalone', () => {
    expect(roundTrip(null)).toBeNull()
    expect(roundTrip({})).toBeNull()
    expect(roundTrip({ customFlag: true })).toEqual({ customFlag: true })
  })

  it('omits disabled days and blank interval rows from serialization', () => {
    const value = buildBusinessHoursFormValue({ week: { mon: [{ start: '09:00', end: '17:00' }] } })
    const monday = value.days.find((day) => day.weekday === 'mon')!
    value.days = value.days.map((day) => (day.weekday === 'mon' ? { ...monday, enabled: false } : day))
    expect(serializeBusinessHoursRecord(value)).toBeNull()

    const blankRow = formValueWithInterval('', '')
    expect(serializeBusinessHoursRecord(blankRow.value)).toBeNull()
  })
})

describe('validateBusinessHoursValue', () => {
  it('fails closed while the advanced raw JSON is dirty', () => {
    const value = { ...buildBusinessHoursFormValue(null), raw: '{ not json', rawDirty: true }
    expect(validateBusinessHoursValue(value, MESSAGES)).toEqual({ ok: false, reason: 'json' })
  })

  it('rejects windows whose end is not after their start', () => {
    for (const [start, end] of [
      ['17:00', '09:00'],
      ['09:00', '09:00'],
    ] as const) {
      const { value, intervalKey } = formValueWithInterval(start, end)
      const result = validateBusinessHoursValue(value, MESSAGES)
      expect(result).toEqual({ ok: false, reason: 'rows', rowErrors: { [intervalKey]: 'window-error' } })
    }
  })

  it('rejects a 24:00 start and unparsable times', () => {
    for (const [start, end] of [
      ['24:00', '24:00'],
      ['', '17:00'],
      ['09:00', 'nope'],
    ] as const) {
      const { value, intervalKey } = formValueWithInterval(start, end)
      const result = validateBusinessHoursValue(value, MESSAGES)
      expect(result.ok).toBe(false)
      if (!result.ok && result.reason === 'rows') {
        expect(result.rowErrors[intervalKey]).toBe('window-error')
      } else {
        throw new Error(`[internal] expected rows validation failure for ${start}-${end}`)
      }
    }
  })

  it('flags holiday rows that are not ISO dates', () => {
    const value = buildBusinessHoursFormValue(null)
    value.holidays = [{ key: 'bad-holiday', date: 'not-a-date' }]
    expect(validateBusinessHoursValue(value, MESSAGES)).toEqual({
      ok: false,
      reason: 'rows',
      rowErrors: { 'bad-holiday': 'holiday-error' },
    })
  })

  it('treats an end-of-day window as editable in the time inputs (24:00 <-> 00:00)', () => {
    expect(businessHoursEndTimeToMinutes('00:00')).toBe(24 * 60)
    expect(businessHoursEndTimeToMinutes('24:00')).toBe(24 * 60)
    expect(businessHoursEndTimeToMinutes('17:00')).toBe(17 * 60)
    expect(formatBusinessHoursEndTimeForInput(24 * 60)).toBe('00:00')
    expect(formatBusinessHoursEndTimeForInput(17 * 60)).toBe('17:00')
    expect(normalizeBusinessHoursEndTime('00:00')).toBe('24:00')
    expect(normalizeBusinessHoursEndTime('24:00')).toBe('24:00')
    expect(normalizeBusinessHoursEndTime('17:00')).toBe('17:00')
    expect(normalizeBusinessHoursEndTime('')).toBe('')

    const loaded = buildBusinessHoursFormValue({ week: { mon: [{ start: '09:00', end: '24:00' }] } })
    expect(loaded.days[0].intervals[0].end).toBe('00:00')
    loaded.days[0] = { ...loaded.days[0], enabled: true }
    expect(serializeBusinessHoursRecord(loaded)).toEqual({
      week: { mon: [{ start: '09:00', end: '24:00' }] },
    })

    const fullDay = formValueWithInterval('00:00', '00:00')
    const result = validateBusinessHoursValue(fullDay.value, MESSAGES)
    expect(result).toEqual({
      ok: true,
      value: { week: { mon: [{ start: '00:00', end: '24:00' }] } },
    })
  })

  it('ignores intervals on disabled days and serializes valid values', () => {
    const disabled = formValueWithInterval('17:00', '09:00')
    disabled.value.days[0] = { ...disabled.value.days[0], enabled: false }
    expect(validateBusinessHoursValue(disabled.value, MESSAGES)).toEqual({ ok: true, value: null })

    const valid = formValueWithInterval('9:00', '24:00')
    valid.value.timezone = ' Europe/Warsaw '
    const result = validateBusinessHoursValue(valid.value, MESSAGES)
    expect(result).toEqual({
      ok: true,
      value: {
        timezone: 'Europe/Warsaw',
        week: { mon: [{ start: '9:00', end: '24:00' }] },
      },
    })
  })
})
