/** @jest-environment node */
// Regression for issue #2666 — the New Relic agent config must not ship credential
// or signing-secret request headers (most importantly `x-api-key`, the canonical
// staff/API bearer credential) onto transaction traces or forwarded logs.
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const newrelicConfig = require(path.resolve(__dirname, '../../../../newrelic.js')) as {
  sensitiveRequestHeaders: string[]
  config: {
    allow_all_headers?: boolean
    attributes?: { include?: string[]; exclude?: string[] }
  }
}

describe('newrelic.js header capture policy', () => {
  it('does not enable allow_all_headers (fails closed for unknown custom headers)', () => {
    // The leak in #2666 was `allow_all_headers: true`, which captures every inbound
    // header — including credential headers the platform reads (x-api-key, x-sudo-token,
    // webhook signatures). Keeping it disabled means future custom auth headers are not
    // captured by default, so they cannot silently leak.
    expect(newrelicConfig.config.allow_all_headers).not.toBe(true)
  })

  it('excludes every known credential/secret-bearing request header', () => {
    const exclude = newrelicConfig.config.attributes?.exclude ?? []
    const requiredSensitiveHeaders = [
      'cookie',
      'authorization',
      'x-api-key',
      'x-sudo-token',
      'x-domain-check-secret',
      'x-domain-resolve-secret',
      'x-force-host-secret',
      'x-webhook-signature',
      'svix-signature',
    ]
    for (const header of requiredSensitiveHeaders) {
      expect(newrelicConfig.sensitiveRequestHeaders).toContain(header)
      expect(exclude).toContain(`request.headers.${header}`)
    }
  })
})
