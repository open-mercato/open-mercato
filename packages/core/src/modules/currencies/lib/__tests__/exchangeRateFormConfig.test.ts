import { describe, it, expect } from '@jest/globals'
import {
  buildExchangeRatePayload,
  formatRateForDisplay,
  metadataToFormValue,
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

  it('parses metadata JSON objects and treats blank as null', () => {
    const withMetadata = validateExchangeRateForm({ ...baseValues, rate: '1', metadata: '{ "tableNo": "195/C" }' }, t)
    expect(withMetadata.metadata).toEqual({ tableNo: '195/C' })
    expect(validateExchangeRateForm({ ...baseValues, rate: '1', metadata: '  ' }, t).metadata).toBeNull()
  })

  it('rejects metadata that is not a JSON object', () => {
    expect(() => validateExchangeRateForm({ ...baseValues, rate: '1', metadata: '[1]' }, t)).toThrow()
    expect(() => validateExchangeRateForm({ ...baseValues, rate: '1', metadata: '{ broken' }, t)).toThrow()
  })

  it('renders metadata for the form', () => {
    expect(metadataToFormValue(null)).toBe('')
    expect(metadataToFormValue({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('formatRateForDisplay', () => {
  it('shows at most 17 significant digits', () => {
    expect(formatRateForDisplay('0.25188916876574307304785894206549118387909319899244')).toBe('0.25188916876574307')
    expect(formatRateForDisplay('0.000056123456789012345678')).toBe('0.000056123456789012346')
    expect(formatRateForDisplay('4.25')).toBe('4.25')
  })

  it('returns a malformed rate unchanged instead of throwing', () => {
    expect(formatRateForDisplay('NaN')).toBe('NaN')
  })
})
