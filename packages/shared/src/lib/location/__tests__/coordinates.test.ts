import {
  normalizeCoordinateInput,
  validateCoordinateInput,
} from '../coordinates'

describe('normalizeCoordinateInput', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeCoordinateInput(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(normalizeCoordinateInput('')).toBeUndefined()
  })

  it('returns undefined for whitespace-only input', () => {
    expect(normalizeCoordinateInput('   ')).toBeUndefined()
  })

  it('parses a decimal value', () => {
    expect(normalizeCoordinateInput('52.5')).toBe(52.5)
  })

  it('parses a negative value with surrounding whitespace', () => {
    expect(normalizeCoordinateInput(' -13.37 ')).toBe(-13.37)
  })

  it('parses an integer value', () => {
    expect(normalizeCoordinateInput('21')).toBe(21)
  })

  it('normalizes comma decimal separators', () => {
    expect(normalizeCoordinateInput('52,5')).toBe(52.5)
  })

  it('returns undefined for non-numeric input', () => {
    expect(normalizeCoordinateInput('abc')).toBeUndefined()
  })

  it('returns undefined for trailing junk after a number', () => {
    expect(normalizeCoordinateInput('52.5abc')).toBeUndefined()
  })

  it('returns undefined for multiple separators', () => {
    expect(normalizeCoordinateInput('52,5,5')).toBeUndefined()
  })
})

describe('validateCoordinateInput', () => {
  it('reports empty for undefined, empty, and whitespace values', () => {
    expect(validateCoordinateInput('latitude', undefined)).toEqual({ status: 'empty' })
    expect(validateCoordinateInput('latitude', '')).toEqual({ status: 'empty' })
    expect(validateCoordinateInput('longitude', '  ')).toEqual({ status: 'empty' })
  })

  it('accepts valid latitude values including boundaries', () => {
    expect(validateCoordinateInput('latitude', '52.5')).toEqual({ status: 'valid', value: 52.5 })
    expect(validateCoordinateInput('latitude', '-90')).toEqual({ status: 'valid', value: -90 })
    expect(validateCoordinateInput('latitude', '90')).toEqual({ status: 'valid', value: 90 })
  })

  it('accepts valid longitude values including boundaries', () => {
    expect(validateCoordinateInput('longitude', '-180')).toEqual({ status: 'valid', value: -180 })
    expect(validateCoordinateInput('longitude', '180')).toEqual({ status: 'valid', value: 180 })
  })

  it('accepts comma decimal separators', () => {
    expect(validateCoordinateInput('latitude', '52,5')).toEqual({ status: 'valid', value: 52.5 })
  })

  it('flags latitude outside -90..90 as out of range', () => {
    expect(validateCoordinateInput('latitude', '-91')).toEqual({ status: 'outOfRange', min: -90, max: 90 })
    expect(validateCoordinateInput('latitude', '90.1')).toEqual({ status: 'outOfRange', min: -90, max: 90 })
  })

  it('flags longitude outside -180..180 as out of range', () => {
    expect(validateCoordinateInput('longitude', '200')).toEqual({ status: 'outOfRange', min: -180, max: 180 })
    expect(validateCoordinateInput('longitude', '-180.5')).toEqual({ status: 'outOfRange', min: -180, max: 180 })
  })

  it('flags non-numeric input as invalid', () => {
    expect(validateCoordinateInput('latitude', 'abc')).toEqual({ status: 'invalid' })
    expect(validateCoordinateInput('longitude', '12.3.4')).toEqual({ status: 'invalid' })
  })
})
