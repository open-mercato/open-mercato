import { DEFAULT_QUOTE_VALID_FOR_DAYS, normalizeQuoteValidityDays, resolveDefaultValidForDays } from '../quoteValidity'
import { quoteSendSchema, quoteValiditySettingsSchema, salesSettingsUpsertSchema } from '../../data/validators'

const quoteId = '11111111-1111-4111-8111-111111111111'

describe('quote validity defaults (#8140)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-04T12:00:00Z')) })
  afterEach(() => jest.useRealTimers())

  it.each([null, undefined, '', 'invalid', '2026-11-03T12:00:00Z', '2026-11-04T12:00:00Z'])(
    'uses the configured fallback for unusable validUntil %s', (value) => {
      expect(resolveDefaultValidForDays(value, 30)).toBe(30)
    },
  )
  it('preserves rounding up and the cap for future quote dates', () => {
    expect(resolveDefaultValidForDays('2026-11-05T12:00:01Z', 30)).toBe(2)
    expect(resolveDefaultValidForDays('2028-11-04T12:00:00Z', 30)).toBe(365)
  })
  it.each([0, -1, 366, 1.5, NaN, null, undefined, '30'])(
    'rejects an unusable stored fallback %s', (value) => expect(normalizeQuoteValidityDays(value)).toBe(DEFAULT_QUOTE_VALID_FOR_DAYS),
  )
  it.each([1, 14, 30, 365])('supports a configured %s days', (days) => {
    expect(normalizeQuoteValidityDays(days)).toBe(days)
    expect(quoteValiditySettingsSchema.parse({ defaultQuoteValidityDays: days }).defaultQuoteValidityDays).toBe(days)
  })
  it.each([0, -1, 366, 1.5, null, 'invalid'])('rejects invalid settings %s', (days) => {
    expect(quoteValiditySettingsSchema.safeParse({ defaultQuoteValidityDays: days }).success).toBe(false)
  })
  it('retains the public send schema default and required numbering formats', () => {
    expect(quoteSendSchema.parse({ quoteId }).validForDays).toBe(DEFAULT_QUOTE_VALID_FOR_DAYS)
    expect(salesSettingsUpsertSchema.safeParse({ tenantId: quoteId, organizationId: quoteId }).success).toBe(false)
  })
})
