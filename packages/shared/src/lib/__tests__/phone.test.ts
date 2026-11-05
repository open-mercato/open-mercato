import { extractPhoneDigits, isValidPhoneNumber, validatePhoneNumber } from '../phone'

describe('phone helpers', () => {
  it('extracts digits from formatted phone strings', () => {
    expect(extractPhoneDigits('+48 (123) 456-789')).toBe('48123456789')
  })

  it('accepts empty values and normalizes valid international numbers', () => {
    expect(validatePhoneNumber('')).toEqual({
      valid: true,
      normalized: null,
      digits: '',
      reason: null,
    })
    expect(validatePhoneNumber('  +48 123 456 789  ')).toEqual({
      valid: true,
      normalized: '+48 123 456 789',
      digits: '48123456789',
      reason: null,
    })
  })

  it('rejects numbers without a country code prefix', () => {
    expect(validatePhoneNumber('123 456 789')).toEqual({
      valid: false,
      normalized: '123 456 789',
      digits: '123456789',
      reason: 'missing_country_code',
    })
    expect(isValidPhoneNumber('123 456 789')).toBe(false)
  })
})
