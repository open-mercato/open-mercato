/** @jest-environment node */

import { HostnameNormalizationError, normalizeHostname, tryNormalizeHostname } from '../hostname'

describe('normalizeHostname', () => {
  it('lowercases the input', () => {
    expect(normalizeHostname('Shop.Acme.com')).toBe('shop.acme.com')
  })

  it('strips a trailing dot (DNS root marker)', () => {
    expect(normalizeHostname('shop.acme.com.')).toBe('shop.acme.com')
  })

  it('strips http(s) protocol, path, query, and fragment defensively', () => {
    expect(normalizeHostname('https://shop.acme.com/path')).toBe('shop.acme.com')
    expect(normalizeHostname('http://shop.acme.com?x=1')).toBe('shop.acme.com')
    expect(normalizeHostname('https://shop.acme.com#frag')).toBe('shop.acme.com')
  })

  it('strips an explicit port', () => {
    expect(normalizeHostname('shop.acme.com:8080')).toBe('shop.acme.com')
  })

  it('converts IDN (Unicode) to Punycode (ASCII)', () => {
    expect(normalizeHostname('shop.café.com')).toBe('shop.xn--caf-dma.com')
  })

  it('treats Unicode and existing Punycode forms as identical when re-fed', () => {
    const a = normalizeHostname('shop.café.com')
    const b = normalizeHostname('shop.xn--caf-dma.com')
    expect(a).toBe(b)
  })

  it('rejects empty input', () => {
    expect(() => normalizeHostname('')).toThrow(HostnameNormalizationError)
    expect(() => normalizeHostname('   ')).toThrow(HostnameNormalizationError)
  })

  it('rejects single-label hostnames', () => {
    expect(() => normalizeHostname('localhost')).toThrow(/two labels/)
  })

  it('rejects hostnames longer than 253 chars', () => {
    const longLabel = 'a'.repeat(60)
    const longHost = `${longLabel}.${longLabel}.${longLabel}.${longLabel}.${longLabel}.com` // > 253 chars
    expect(() => normalizeHostname(longHost)).toThrow(HostnameNormalizationError)
  })

  it('rejects IPv4-address literals (TLD must not be all-numeric)', () => {
    expect(() => normalizeHostname('127.0.0.1')).toThrow(/IP address/)
    expect(() => normalizeHostname('127.0.0.1:5001')).toThrow(/IP address/)
    expect(() => normalizeHostname('10.20.30.40')).toThrow(HostnameNormalizationError)
  })

  it('rejects malformed labels', () => {
    expect(() => normalizeHostname('-shop.acme.com')).toThrow(HostnameNormalizationError)
    expect(() => normalizeHostname('shop.acme-.com')).toThrow(HostnameNormalizationError)
    expect(() => normalizeHostname('shop..acme.com')).toThrow(HostnameNormalizationError)
  })

  it('throws HostnameNormalizationError on non-string input', () => {
    expect(() => normalizeHostname(undefined as unknown as string)).toThrow(HostnameNormalizationError)
    expect(() => normalizeHostname(123 as unknown as string)).toThrow(HostnameNormalizationError)
  })
})

describe('tryNormalizeHostname', () => {
  it('returns the canonical form on success', () => {
    expect(tryNormalizeHostname('Shop.Acme.com')).toBe('shop.acme.com')
  })

  it('returns null on invalid input instead of throwing', () => {
    expect(tryNormalizeHostname('')).toBeNull()
    expect(tryNormalizeHostname('localhost')).toBeNull()
    expect(tryNormalizeHostname('-bad')).toBeNull()
    expect(tryNormalizeHostname('127.0.0.1')).toBeNull()
    expect(tryNormalizeHostname('127.0.0.1:5001')).toBeNull()
  })
})
