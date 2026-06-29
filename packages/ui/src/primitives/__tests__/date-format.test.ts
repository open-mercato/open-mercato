import {
  deriveDateDisplayFormat,
  formatWithPublicDateFormat,
  normalizeDateFormatPattern,
  resolvePublicDateFormat,
  resolvePublicDateTimeFormat,
} from '../date-format'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('date display format helpers', () => {
  it('derives a system-style fallback from the locale family', () => {
    expect(deriveDateDisplayFormat('en')).toBe('MMM d, yyyy')
    expect(deriveDateDisplayFormat('pl')).toBe('d MMM yyyy')
  })

  it('normalizes legacy uppercase tokens for date-fns', () => {
    expect(normalizeDateFormatPattern('YYYY-MM-DD HH:mm')).toBe('yyyy-MM-dd HH:mm')
  })

  it('treats system-like env values as unset', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'system'
    expect(resolvePublicDateFormat('en')).toBe('MMM d, yyyy')
  })

  it('uses OM-prefixed env formats before legacy env formats', () => {
    process.env.NEXT_PUBLIC_DATE_FORMAT = 'YYYY/MM/DD'
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'

    expect(resolvePublicDateFormat('en')).toBe('dd.MM.yyyy')
    expect(resolvePublicDateTimeFormat('en')).toBe('dd.MM.yyyy HH:mm')
  })

  it('formats with normalized date-fns patterns', () => {
    const value = formatWithPublicDateFormat(new Date(2026, 4, 9, 10, 30), 'yyyy-MM-dd HH:mm')
    expect(value).toBe('2026-05-09 10:30')
  })
})
