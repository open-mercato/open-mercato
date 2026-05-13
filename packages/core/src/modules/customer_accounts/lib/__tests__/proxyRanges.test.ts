/** @jest-environment node */

import { detectProxy, isInKnownProxyRange, resetProxyRangeCacheForTests } from '../proxyRanges'

describe('isInKnownProxyRange', () => {
  beforeEach(() => {
    delete process.env.KNOWN_PROXY_IP_RANGES
    resetProxyRangeCacheForTests()
  })

  it('matches a Cloudflare IP from the default list', () => {
    expect(isInKnownProxyRange('104.16.0.1')).toBe(true) // 104.16.0.0/13
    expect(isInKnownProxyRange('172.64.1.2')).toBe(true) // 172.64.0.0/13
  })

  it('does not match an unrelated IP', () => {
    expect(isInKnownProxyRange('203.0.113.5')).toBe(false) // TEST-NET-3
    expect(isInKnownProxyRange('8.8.8.8')).toBe(false)
  })

  it('returns false for malformed input', () => {
    expect(isInKnownProxyRange('not.an.ip')).toBe(false)
    expect(isInKnownProxyRange('999.999.999.999')).toBe(false)
    expect(isInKnownProxyRange('')).toBe(false)
  })

  it('honors a custom KNOWN_PROXY_IP_RANGES override', () => {
    process.env.KNOWN_PROXY_IP_RANGES = '10.0.0.0/8,192.168.0.0/16'
    resetProxyRangeCacheForTests()
    expect(isInKnownProxyRange('10.5.5.5')).toBe(true)
    expect(isInKnownProxyRange('192.168.1.1')).toBe(true)
    expect(isInKnownProxyRange('104.16.0.1')).toBe(false) // Cloudflare default no longer applies
  })
})

describe('detectProxy', () => {
  beforeEach(() => {
    delete process.env.KNOWN_PROXY_IP_RANGES
    resetProxyRangeCacheForTests()
  })

  it('returns "cloudflare" for default-list IPs (no override)', () => {
    expect(detectProxy('104.16.0.1')).toBe('cloudflare')
  })

  it('returns null when not in any range', () => {
    expect(detectProxy('203.0.113.5')).toBeNull()
  })

  it('returns "unknown" when the user supplied a custom list', () => {
    process.env.KNOWN_PROXY_IP_RANGES = '10.0.0.0/8'
    resetProxyRangeCacheForTests()
    expect(detectProxy('10.1.2.3')).toBe('unknown')
  })
})
