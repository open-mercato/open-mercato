import { formatRelativeTime, formatDateTime, toDateInputValue } from '../time'

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
    // 10 seconds difference — force English locale to avoid system-locale variance
    const past = formatRelativeTime(sub(10_000), { locale: 'en' })
    const future = formatRelativeTime(add(10_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/second/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/second/.test(future!)).toBeTruthy()
  })

  it('formats minutes', () => {
    const past = formatRelativeTime(sub(600_000), { locale: 'en' })
    const future = formatRelativeTime(add(600_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/minute|second/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/minute|second/.test(future!)).toBeTruthy()
  })

  it('formats hours', () => {
    const past = formatRelativeTime(sub(18_000_000), { locale: 'en' })
    const future = formatRelativeTime(add(18_000_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/hour|minute/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/hour|minute/.test(future!)).toBeTruthy()
  })

  it('formats days', () => {
    const past = formatRelativeTime(sub(172_800_000), { locale: 'en' })
    const future = formatRelativeTime(add(172_800_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/day|hour/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/day|hour/.test(future!)).toBeTruthy()
  })

  it('formats weeks', () => {
    const past = formatRelativeTime(sub(864_000_000), { locale: 'en' })
    const future = formatRelativeTime(add(864_000_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/week|day/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/week|day/.test(future!)).toBeTruthy()
  })

  it('formats months', () => {
    const past = formatRelativeTime(sub(3_456_000_000), { locale: 'en' })
    const future = formatRelativeTime(add(3_456_000_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/month|week/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/month|week/.test(future!)).toBeTruthy()
  })

  it('formats years', () => {
    const past = formatRelativeTime(sub(34_560_000_000), { locale: 'en' })
    const future = formatRelativeTime(add(34_560_000_000), { locale: 'en' })
    expect(past).toBeTruthy()
    expect(/year|month/.test(past!)).toBeTruthy()
    expect(future).toBeTruthy()
    expect(/year|month/.test(future!)).toBeTruthy()
  })

it('uses fallback if Intl.RelativeTimeFormat is not available', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat')
  Object.defineProperty(Intl, 'RelativeTimeFormat', { value: undefined, configurable: true })
  try {
    expect(formatRelativeTime(sub(3_600_000))).toMatch(/ago/)
    expect(formatRelativeTime(add(3_600_000))).toMatch(/from now/)
  } finally {
    Object.defineProperty(Intl, 'RelativeTimeFormat', descriptor!)
  }
})

it('uses custom translate if provided', () => {
  const translate = (key: string, fallback?: string) => `T(${key})`
  expect(formatRelativeTime(sub(3_600_000), { translate })).toMatch(/T\(time\.relative\.ago\)/)
  expect(formatRelativeTime(add(3_600_000), { translate })).toMatch(/T\(time\.relative\.fromNow\)/)
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

describe('toDateInputValue', () => {
  it('returns null for missing or invalid values', () => {
    expect(toDateInputValue(undefined)).toBeNull()
    expect(toDateInputValue(null)).toBeNull()
    expect(toDateInputValue('')).toBeNull()
    expect(toDateInputValue('   ')).toBeNull()
    expect(toDateInputValue('not-a-date')).toBeNull()
    expect(toDateInputValue(new Date('not-a-date'))).toBeNull()
  })

  it('passes through a plain YYYY-MM-DD string unchanged', () => {
    expect(toDateInputValue('2026-04-10')).toBe('2026-04-10')
  })

  it('slices the date portion of an ISO 8601 string', () => {
    expect(toDateInputValue('2026-04-10T23:00:00.000Z')).toBe('2026-04-10')
    expect(toDateInputValue('2026-04-10T00:00:00+02:00')).toBe('2026-04-10')
  })

  it('formats a Date instance as the UTC calendar day', () => {
    const date = new Date('2026-04-10T00:00:00.000Z')
    expect(toDateInputValue(date)).toBe('2026-04-10')
  })
})
