/* eslint-disable @typescript-eslint/no-require-imports */
import {
  buildExtensionHeader,
  parseExtensionHeaders,
  getExtensionHeaderValue,
} from '../extension-headers'

describe('buildExtensionHeader', () => {
  it('builds correct header name', () => {
    expect(buildExtensionHeader('record-locks', 'token')).toBe('x-om-ext-record-locks-token')
  })

  it('handles single-word module', () => {
    expect(buildExtensionHeader('loyalty', 'points')).toBe('x-om-ext-loyalty-points')
  })
})

describe('parseExtensionHeaders', () => {
  it('parses extension headers from mixed headers (snake_case module IDs)', () => {
    const result = parseExtensionHeaders({
      'content-type': 'application/json',
      'x-om-ext-record_locks-token': 'abc123',
      'x-om-ext-business_rules-override': 'skip-credit-check',
      'authorization': 'Bearer xyz',
    })

    expect(result).toEqual({
      'record_locks': { 'token': 'abc123' },
      'business_rules': { 'override': 'skip-credit-check' },
    })
  })

  it('returns empty for no extension headers', () => {
    const result = parseExtensionHeaders({
      'content-type': 'application/json',
    })
    expect(result).toEqual({})
  })

  it('handles array header values', () => {
    const result = parseExtensionHeaders({
      'x-om-ext-test-key': ['value1', 'value2'],
    })
    expect(result).toEqual({
      test: { key: 'value1' },
    })
  })
})

describe('getExtensionHeaderValue', () => {
  it('retrieves a specific extension header value', () => {
    const headers = {
      'x-om-ext-record-locks-token': 'abc123',
    }
    expect(getExtensionHeaderValue(headers, 'record-locks', 'token')).toBe('abc123')
  })

  it('returns undefined for missing header', () => {
    const headers = {
      'content-type': 'application/json',
    }
    expect(getExtensionHeaderValue(headers, 'record-locks', 'token')).toBeUndefined()
  })
})
