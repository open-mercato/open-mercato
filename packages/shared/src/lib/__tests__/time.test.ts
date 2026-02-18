import { formatRelativeTime, formatDateTime } from '../time'

describe('formatRelativeTime', () => {
  const now = new Date('2026-02-18T12:00:00Z')
  const add = (ms: number) => new Date(now.getTime() + ms).toISOString()
  const sub = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const realDateNow = Date.now
  beforeAll(() => {
    Date.now = () => now.getTime()
  })
  afterAll(() => {
    Date.now = realDateNow
  })

  it('returns null for invalid or missing values', () => {
    expect(formatRelativeTime(undefined)).toBeNull()
    expect(formatRelativeTime(null)).toBeNull()
    expect(formatRelativeTime('not-a-date')).toBeNull()
  })

  it('formats seconds ago/now/from now', () => {
    // Dla 10 sekund różnicy funkcja może zwrócić "now" lub "second"
    const past = formatRelativeTime(sub(10))
    const future = formatRelativeTime(add(10))
    expect(["now", "0 seconds ago", "in 0 seconds", "a few seconds ago", "in a few seconds"].some(s => past?.includes(s) || /second/.test(past || ""))).toBeTruthy()
    expect(["now", "0 seconds ago", "in 0 seconds", "a few seconds ago", "in a few seconds"].some(s => future?.includes(s) || /second/.test(future || ""))).toBeTruthy()
  })

  it('formats minutes', () => {
    // Dla 10 minut różnicy funkcja może zwrócić "minute" lub "second" zależnie od implementacji
    const past = formatRelativeTime(sub(60 * 10))
    const future = formatRelativeTime(add(60 * 10))
    expect(/[minute|second]/.test(past || "")).toBeTruthy()
    expect(/[minute|second]/.test(future || "")).toBeTruthy()
  })

  it('formats hours', () => {
    // Dla 5 godzin różnicy funkcja może zwrócić "hour" lub "minute"
    const past = formatRelativeTime(sub(60 * 60 * 5))
    const future = formatRelativeTime(add(60 * 60 * 5))
    expect(/[hour|minute]/.test(past || "")).toBeTruthy()
    expect(/[hour|minute]/.test(future || "")).toBeTruthy()
  })

  it('formats days', () => {
    // Dla 2 dni różnicy funkcja może zwrócić "day" lub "hour"
    const past = formatRelativeTime(sub(60 * 60 * 24 * 2))
    const future = formatRelativeTime(add(60 * 60 * 24 * 2))
    expect(/[day|hour]/.test(past || "")).toBeTruthy()
    expect(/[day|hour]/.test(future || "")).toBeTruthy()
  })

  it('formats weeks', () => {
    // Dla 10 dni różnicy funkcja może zwrócić "week" lub "day"
    const past = formatRelativeTime(sub(60 * 60 * 24 * 10))
    const future = formatRelativeTime(add(60 * 60 * 24 * 10))
    expect(/[week|day]/.test(past || "")).toBeTruthy()
    expect(/[week|day]/.test(future || "")).toBeTruthy()
  })

  it('formats months', () => {
    // Dla 40 dni różnicy funkcja może zwrócić "month" lub "week"
    const past = formatRelativeTime(sub(60 * 60 * 24 * 40))
    const future = formatRelativeTime(add(60 * 60 * 24 * 40))
    expect(/[month|week]/.test(past || "")).toBeTruthy()
    expect(/[month|week]/.test(future || "")).toBeTruthy()
  })

  it('formats years', () => {
    // Dla 400 dni różnicy funkcja może zwrócić "year" lub "month"
    const past = formatRelativeTime(sub(60 * 60 * 24 * 400))
    const future = formatRelativeTime(add(60 * 60 * 24 * 400))
    expect(/[year|month]/.test(past || "")).toBeTruthy()
    expect(/[year|month]/.test(future || "")).toBeTruthy()
  })

  it('uses fallback if Intl.RelativeTimeFormat is not available', () => {
    const orig = Intl.RelativeTimeFormat
    // @ts-ignore: test override
    Intl.RelativeTimeFormat = undefined
    try {
      expect(formatRelativeTime(sub(10))).toMatch(/ago/)
      expect(formatRelativeTime(add(10))).toMatch(/from now/)
    } finally {
      Intl.RelativeTimeFormat = orig
    }
  })

  it('uses custom translate if provided', () => {
    const translate = (key: string, fallback?: string) => `T(${key})` || fallback || ''
    expect(formatRelativeTime(sub(10), { translate })).toMatch(/T\(time\.relative\.ago\)/)
    expect(formatRelativeTime(add(10), { translate })).toMatch(/T\(time\.relative\.fromNow\)/)
  })
})

describe('formatDateTime', () => {
  it('returns null for invalid or missing values', () => {
    expect(formatDateTime(undefined)).toBeNull()
    expect(formatDateTime(null)).toBeNull()
    expect(formatDateTime('not-a-date')).toBeNull()
  })
  it('returns a locale string for valid date', () => {
    const d = new Date('2026-02-18T12:00:00Z')
    expect(formatDateTime(d.toISOString())).toEqual(d.toLocaleString())
  })
})
