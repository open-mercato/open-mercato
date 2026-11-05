/**
 * Pure logic contract tests for DateTimePicker internal utilities.
 *
 * These functions are defined inline here to document and verify the
 * timezone contract described in SPEC-034 § Timezone Contract.
 * They mirror the module-private `extractTime` and `applyTimeToDate`
 * in DateTimePicker.tsx — if the production implementation changes,
 * update these tests to match.
 */

function extractTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function applyTimeToDate(base: Date, time: string): Date {
  const parts = time.split(':')
  const hour = parseInt(parts[0] ?? '0', 10)
  const minute = parseInt(parts[1] ?? '0', 10)
  const next = new Date(base)
  next.setHours(isNaN(hour) ? 0 : hour)
  next.setMinutes(isNaN(minute) ? 0 : minute)
  next.setSeconds(0)
  next.setMilliseconds(0)
  return next
}

describe('extractTime', () => {
  it('pads single-digit hour and minute with leading zero', () => {
    const date = new Date(2026, 1, 22, 9, 5)
    expect(extractTime(date)).toBe('09:05')
  })

  it('returns 00:00 for midnight', () => {
    const date = new Date(2026, 1, 22, 0, 0)
    expect(extractTime(date)).toBe('00:00')
  })

  it('returns 23:59 for end of day', () => {
    const date = new Date(2026, 1, 22, 23, 59)
    expect(extractTime(date)).toBe('23:59')
  })

  it('pads both components for mid-day times', () => {
    const date = new Date(2026, 1, 22, 14, 30)
    expect(extractTime(date)).toBe('14:30')
  })
})

describe('applyTimeToDate', () => {
  it('sets hour and minute on the base date', () => {
    const base = new Date(2026, 1, 22, 0, 0, 0)
    const result = applyTimeToDate(base, '14:30')
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
  })

  it('zeroes seconds and milliseconds', () => {
    const base = new Date(2026, 1, 22, 10, 45, 30, 500)
    const result = applyTimeToDate(base, '10:45')
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
  })

  it('preserves the date portion (year, month, day)', () => {
    const base = new Date(2026, 1, 22, 0, 0)
    const result = applyTimeToDate(base, '09:15')
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(22)
  })

  it('does not mutate the base date (immutability)', () => {
    const base = new Date(2026, 1, 22, 8, 0)
    const originalTime = base.getTime()
    applyTimeToDate(base, '14:30')
    expect(base.getTime()).toBe(originalTime)
  })

  it('handles NaN hour by defaulting to 0', () => {
    const base = new Date(2026, 1, 22, 0, 0)
    const result = applyTimeToDate(base, 'XX:30')
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(30)
  })

  it('handles NaN minute by defaulting to 0', () => {
    const base = new Date(2026, 1, 22, 0, 0)
    const result = applyTimeToDate(base, '14:YY')
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(0)
  })
})

describe('extractTime + applyTimeToDate composition', () => {
  it('day selection preserves existing time (round-trip)', () => {
    const original = new Date(2026, 1, 22, 14, 30, 0, 0)
    const newDay = new Date(2026, 2, 5, 0, 0)
    const currentTime = extractTime(original)
    const result = applyTimeToDate(newDay, currentTime)
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
    expect(result.getDate()).toBe(5)
    expect(result.getMonth()).toBe(2)
  })
})

describe('SPEC-034 Timezone Contract — ISO round-trip', () => {
  it('Date → toISOString → new Date round-trip preserves local hour and minute', () => {
    // Simulate CrudForm: DateTimePicker emits a Date, CrudForm serializes via toISOString,
    // then re-reads it via new Date(isoString). The local hour:minute must be preserved.
    const local = new Date(2026, 1, 22, 14, 30, 0, 0) // Feb 22, 2026 14:30 local
    const iso = local.toISOString()
    const restored = new Date(iso)
    expect(restored.getHours()).toBe(local.getHours())
    expect(restored.getMinutes()).toBe(local.getMinutes())
  })

  it('applyTimeToDate after round-trip preserves date and time', () => {
    const original = new Date(2026, 1, 22, 9, 15, 0, 0)
    const iso = original.toISOString()
    const restored = new Date(iso)
    expect(extractTime(restored)).toBe(extractTime(original))
  })
})
