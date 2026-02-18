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
    expect(formatRelativeTime(sub(10))).toMatch(/second/)
    expect(formatRelativeTime(add(10))).toMatch(/second/)
  })

  it('formats minutes', () => {
    expect(formatRelativeTime(sub(60 * 10))).toMatch(/minute/)
    expect(formatRelativeTime(add(60 * 10))).toMatch(/minute/)
  })

  it('formats hours', () => {
    expect(formatRelativeTime(sub(60 * 60 * 5))).toMatch(/hour/)
    expect(formatRelativeTime(add(60 * 60 * 5))).toMatch(/hour/)
  })

  it('formats days', () => {
    expect(formatRelativeTime(sub(60 * 60 * 24 * 2))).toMatch(/day/)
    expect(formatRelativeTime(add(60 * 60 * 24 * 2))).toMatch(/day/)
  })

  it('formats weeks', () => {
    expect(formatRelativeTime(sub(60 * 60 * 24 * 10))).toMatch(/week/)
    expect(formatRelativeTime(add(60 * 60 * 24 * 10))).toMatch(/week/)
  })

  it('formats months', () => {
    expect(formatRelativeTime(sub(60 * 60 * 24 * 40))).toMatch(/month/)
    expect(formatRelativeTime(add(60 * 60 * 24 * 40))).toMatch(/month/)
  })

  it('formats years', () => {
    expect(formatRelativeTime(sub(60 * 60 * 24 * 400))).toMatch(/year/)
    expect(formatRelativeTime(add(60 * 60 * 24 * 400))).toMatch(/year/)
  })

  it('uses fallback if Intl.RelativeTimeFormat is not available', () => {
    const orig = Intl.RelativeTimeFormat
    // @ts-ignore
    Intl.RelativeTimeFormat = undefined
    expect(formatRelativeTime(sub(10))).toMatch(/ago/)
    expect(formatRelativeTime(add(10))).toMatch(/from now/)
    Intl.RelativeTimeFormat = orig
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
