import { DEFAULT_QUOTE_VALID_FOR_DAYS, normalizeQuoteValidityDays, resolveDefaultValidForDays } from '../quoteValidity'
import { quoteSendSchema, quoteValiditySettingsSchema, salesSettingsUpsertSchema } from '../../data/validators'

const quoteId = '11111111-1111-4111-8111-111111111111'
const clockNow = Date.now()
const millisecondsPerDay = 24 * 60 * 60 * 1000

describe('quote validity defaults (#8140)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(clockNow) })
  afterEach(() => jest.useRealTimers())

  it.each([null, undefined, '', 'invalid', new Date(clockNow - millisecondsPerDay).toISOString(), new Date(clockNow).toISOString()])(
    'uses the configured fallback for unusable validUntil %s', (value) => {
      expect(resolveDefaultValidForDays(value, 30)).toBe(30)
    },
  )
  it('preserves rounding up and the cap for future quote dates', () => {
    expect(resolveDefaultValidForDays(new Date(clockNow + millisecondsPerDay + 1000).toISOString(), 30)).toBe(2)
    expect(resolveDefaultValidForDays(new Date(clockNow + 366 * millisecondsPerDay).toISOString(), 30)).toBe(365)
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
