import { readRateLimitConfig } from '../config'

describe('readRateLimitConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults to enabled when no env is set', () => {
    delete process.env.RATE_LIMIT_ENABLED
    delete process.env.OM_INTEGRATION_TEST
    expect(readRateLimitConfig().enabled).toBe(true)
  })

  it('defaults to direct mode when proxy depth is not configured', () => {
    delete process.env.RATE_LIMIT_TRUST_PROXY_DEPTH

    expect(readRateLimitConfig().trustProxyDepth).toBe(0)
  })

  it.each(['-1', '1.5', 'not-a-number'])('falls back to direct mode for invalid proxy depth %s', (value) => {
    process.env.RATE_LIMIT_TRUST_PROXY_DEPTH = value

    expect(readRateLimitConfig().trustProxyDepth).toBe(0)
  })

  it('honors RATE_LIMIT_ENABLED=false', () => {
    process.env.RATE_LIMIT_ENABLED = 'false'
    delete process.env.OM_INTEGRATION_TEST
    expect(readRateLimitConfig().enabled).toBe(false)
  })

  it('forces enabled=false under OM_INTEGRATION_TEST=true even when RATE_LIMIT_ENABLED=true', () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.OM_INTEGRATION_TEST = 'true'
    expect(readRateLimitConfig().enabled).toBe(false)
  })

  it('ignores OM_INTEGRATION_TEST=false', () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.OM_INTEGRATION_TEST = 'false'
    expect(readRateLimitConfig().enabled).toBe(true)
  })
})
