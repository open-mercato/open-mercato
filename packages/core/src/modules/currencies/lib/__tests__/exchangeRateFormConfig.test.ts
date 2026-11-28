import { describe, it, expect, afterEach } from '@jest/globals'
import {
  buildExchangeRatePayload,
  exchangeRateGroups,
  formatDateOnlyUtc,
  formatRateForDisplay,
  validateExchangeRateForm,
} from '../exchangeRateFormConfig'

const t = (key: string) => key

const baseValues = {
  fromCurrencyCode: 'idr',
  toCurrencyCode: 'usd',
  date: '2026-10-08T10:30',
  source: 'Manual',
  isActive: true,
}

describe('exchange rate form config', () => {
  it('keeps the rate as an exact decimal string', () => {
    const values = { ...baseValues, rate: '0.000056123456789012345678901' }
    const validated = validateExchangeRateForm(values, t)
    const payload = buildExchangeRatePayload(values, validated)
    expect(payload.rate).toBe('0.000056123456789012345678901')
    expect(payload.fromCurrencyCode).toBe('IDR')
  })

  it('rejects a zero or malformed rate', () => {
    expect(() => validateExchangeRateForm({ ...baseValues, rate: '0' }, t)).toThrow()
    expect(() => validateExchangeRateForm({ ...baseValues, rate: 'abc' }, t)).toThrow()
  })

  it('does not send metadata from the form, so provider metadata is kept', () => {
    const values = { ...baseValues, rate: '1', metadata: '{ "tableNo": "195/C" }' }
    const payload = buildExchangeRatePayload(values, validateExchangeRateForm(values, t))
    expect(payload).not.toHaveProperty('metadata')
  })

  it('shows provider metadata read-only only when it exists', () => {
    const fieldIds = (metadata?: Record<string, unknown> | null) =>
      exchangeRateGroups(t, async () => [], metadata).flatMap((group) => (group.fields ?? []).map((field) => (typeof field === 'string' ? field : field.id)))
    expect(fieldIds(null)).not.toContain('metadataDetails')
    expect(fieldIds({})).not.toContain('metadataDetails')
    expect(fieldIds({ tableNo: '195/C' })).toContain('metadataDetails')
    expect(fieldIds({ tableNo: '195/C' })).not.toContain('metadata')
  })
})

describe('formatRateForDisplay', () => {
  it('shows at most 17 significant digits', () => {
    expect(formatRateForDisplay('0.25188916876574307304785894206549118387909319899244', 'en')).toBe('0.25188916876574307')
    expect(formatRateForDisplay('0.000056123456789012345678', 'en')).toBe('0.000056123456789012346')
    expect(formatRateForDisplay('4.25', 'en')).toBe('4.25')
  })

  it('uses the locale decimal separator', () => {
    expect(formatRateForDisplay('4.2537125', 'pl')).toBe('4,2537125')
    expect(formatRateForDisplay('4.2537125', 'en')).toBe('4.2537125')
  })

  it('returns a malformed rate unchanged instead of throwing', () => {
    expect(formatRateForDisplay('NaN', 'en')).toBe('NaN')
  })
})

describe('exchange rate form dates', () => {
  const originalTZ = process.env.TZ
  const rateValues = { ...baseValues, rate: '1.2345' }

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  it('normalizes a date-only value to UTC midnight regardless of the local timezone', () => {
    process.env.TZ = 'Europe/Warsaw'
    const values = { ...rateValues, date: '2026-10-30' }
    const payload = buildExchangeRatePayload(values, validateExchangeRateForm(values, t))
    expect(payload.date).toBe('2026-10-30T00:00:00.000Z')
  })

  it('normalizes a legacy datetime value to UTC midnight of the same day', () => {
    process.env.TZ = 'Europe/Warsaw'
    const values = { ...rateValues, date: '2026-10-30T11:00' }
    const payload = buildExchangeRatePayload(values, validateExchangeRateForm(values, t))
    expect(payload.date).toBe('2026-10-30T00:00:00.000Z')
  })

  it('throws on an invalid date', () => {
    expect(() => validateExchangeRateForm({ ...rateValues, date: 'not-a-date' }, t)).toThrow()
  })

  it('formats a stored UTC-midnight date as the same calendar day west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(formatDateOnlyUtc(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15')
    expect(formatDateOnlyUtc(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01-05')
  })

  it('keeps the stored UTC day unchanged through an edit/save round trip west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles'
    const stored = '2026-10-30T00:00:00.000Z'
    const values = { ...rateValues, date: formatDateOnlyUtc(new Date(stored)) }
    const payload = buildExchangeRatePayload(values, validateExchangeRateForm(values, t))
    expect(payload.date).toBe(stored)
  })
})
