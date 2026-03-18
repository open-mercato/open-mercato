import { z } from 'zod'
import { isValidIso639 } from '@open-mercato/shared/lib/i18n/iso639'

const bodySchema = z.object({
  locales: z.array(
    z.string().min(2).max(10).refine(isValidIso639, { message: 'Invalid ISO 639-1 language code' }),
  ).min(1).max(50),
})

describe('locales API body schema', () => {
  it('accepts valid locales', () => {
    const result = bodySchema.safeParse({ locales: ['en', 'fr'] })
    expect(result.success).toBe(true)
  })

  it('accepts single locale', () => {
    const result = bodySchema.safeParse({ locales: ['en'] })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ISO 639-1 code', () => {
    const result = bodySchema.safeParse({ locales: ['xx'] })
    expect(result.success).toBe(false)
  })

  it('rejects when any locale is invalid (mixed valid/invalid)', () => {
    const result = bodySchema.safeParse({ locales: ['en', 'xyz'] })
    expect(result.success).toBe(false)
  })

  it('rejects empty array', () => {
    const result = bodySchema.safeParse({ locales: [] })
    expect(result.success).toBe(false)
  })

  it('rejects missing locales field', () => {
    const result = bodySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects code shorter than 2 chars', () => {
    const result = bodySchema.safeParse({ locales: ['e'] })
    expect(result.success).toBe(false)
  })

  it('rejects code longer than 10 chars', () => {
    const result = bodySchema.safeParse({ locales: ['abcdefghijk'] })
    expect(result.success).toBe(false)
  })

  it('accepts up to 50 locales', () => {
    // Use first 50 valid ISO codes
    const validCodes = ['aa', 'ab', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay',
      'az', 'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br',
      'bs', 'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy',
      'da', 'de', 'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et',
      'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd']
    const result = bodySchema.safeParse({ locales: validCodes })
    expect(result.success).toBe(true)
  })

  it('rejects more than 50 locales', () => {
    const codes = Array.from({ length: 51 }, (_, i) => `l${String(i).padStart(2, '0')}`)
    const result = bodySchema.safeParse({ locales: codes })
    expect(result.success).toBe(false)
  })
})
