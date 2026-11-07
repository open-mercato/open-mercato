import { validateExchangeRateForm, buildExchangeRatePayload } from '../exchangeRateFormConfig'

const t = (key: string) => key

const baseValues = {
  fromCurrencyCode: 'usd',
  toCurrencyCode: 'eur',
  rate: '1.2345',
  source: 'manual-entry',
}

describe('validateExchangeRateForm date normalization', () => {
  const originalTZ = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  it('normalizes a date-only value to UTC midnight regardless of the local timezone', () => {
    process.env.TZ = 'Europe/Warsaw'

    const validated = validateExchangeRateForm({ ...baseValues, date: '2026-10-30' }, t)
    const payload = buildExchangeRatePayload(baseValues, validated)

    expect(payload.date).toBe('2026-10-30T00:00:00.000Z')
  })

  it('normalizes a legacy datetime value to UTC midnight of the same day', () => {
    process.env.TZ = 'Europe/Warsaw'

    const validated = validateExchangeRateForm({ ...baseValues, date: '2026-10-30T11:00' }, t)
    const payload = buildExchangeRatePayload(baseValues, validated)

    expect(payload.date).toBe('2026-10-30T00:00:00.000Z')
  })

  it('throws on an invalid date', () => {
    expect(() => validateExchangeRateForm({ ...baseValues, date: 'not-a-date' }, t)).toThrow()
  })
})
