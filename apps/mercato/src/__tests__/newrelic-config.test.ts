/** @jest-environment node */
// Regression for issue #2666 — the New Relic agent config must not ship credential
// or signing-secret request headers (most importantly `x-api-key`, the canonical
// staff/API bearer credential) onto transaction traces or forwarded logs.
import path from 'path'

type NewRelicConfig = {
  sensitiveRequestHeaders: string[]
  config: {
    application_logging: { forwarding: { enabled: boolean } }
    allow_all_headers?: boolean
    attributes?: { include?: string[]; exclude?: string[] }
  }
}

function loadConfig(): NewRelicConfig {
  let loadedConfig: NewRelicConfig | undefined
  jest.isolateModules(() => {
    loadedConfig = jest.requireActual<NewRelicConfig>(path.resolve(__dirname, '../../../../newrelic.js'))
  })
  return loadedConfig!
}

const newrelicConfig = loadConfig()

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

describe('newrelic.js privacy defaults', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { NEW_RELIC_LICENSE_KEY: 'test-license-key' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('keeps request parameter capture at the agent default with only a license key', () => {
    expect(loadConfig().config.attributes?.include ?? []).toEqual([])
  })

  it.each([undefined, '', 'false', '0', '1', 'yes', 'TRUE'])(
    'does not forward application logs with NEW_RELIC_FORWARD_LOGS=%s',
    (value) => {
      if (value !== undefined) process.env.NEW_RELIC_FORWARD_LOGS = value
      expect(loadConfig().config.application_logging.forwarding.enabled).toBe(false)
    },
  )

  it('forwards application logs only after explicit opt-in', () => {
    process.env.NEW_RELIC_FORWARD_LOGS = 'true'
    const { config, sensitiveRequestHeaders } = loadConfig()
    expect(config.application_logging.forwarding.enabled).toBe(true)
    expect(config.attributes?.include ?? []).toEqual([])
    for (const header of sensitiveRequestHeaders) {
      expect(config.attributes?.exclude).toContain(`request.headers.${header}`)
    }
  })
})
