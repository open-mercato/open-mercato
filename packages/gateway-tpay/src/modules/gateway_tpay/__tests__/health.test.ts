import { tpayHealthCheck } from '../lib/health'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const SECRET = 'super-secret-value'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('tpayHealthCheck', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    reportError.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('is healthy when the token request succeeds', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token-value' }))
    const result = await tpayHealthCheck.check({
      clientId: 'id',
      clientSecret: SECRET,
      environment: 'sandbox',
      notificationUrl: 'https://shop.example.com/notify',
      notificationSecurityCode: 'notification-code',
    })
    expect(result.status).toBe('healthy')
    expect(result.details).toEqual({
      environment: 'sandbox',
      notificationUrlConfigured: true,
      notificationsReady: true,
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain('notification-code')
    expect(JSON.stringify(result)).not.toContain('token-value')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([[undefined], ['   ']])(
    'is degraded when the credentials work but the notification security code is missing (%j)',
    async (notificationSecurityCode) => {
      fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token-value' }))
      const result = await tpayHealthCheck.check({
        clientId: 'id',
        clientSecret: SECRET,
        environment: 'sandbox',
        notificationSecurityCode,
      })
      expect(result.status).toBe('degraded')
      expect(result.message).toBe(
        'Tpay connection works, but payment notifications are rejected until the notification security code is set.',
      )
      expect(result.details).toEqual({
        environment: 'sandbox',
        notificationUrlConfigured: false,
        notificationsReady: false,
      })
      expect(JSON.stringify(result)).not.toContain(SECRET)
    },
  )

  it.each([
    [{ clientSecret: SECRET }],
    [{ clientId: 'id' }],
    [{ clientId: '  ', clientSecret: SECRET }],
  ])('is unhealthy without network when required fields are missing (%j)', async (credentials) => {
    const result = await tpayHealthCheck.check(credentials)
    expect(result.status).toBe('unhealthy')
    expect(result.details.reason).toBe('missing_credentials')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is unhealthy without network for an unsupported environment', async () => {
    const result = await tpayHealthCheck.check({ clientId: 'id', clientSecret: SECRET, environment: 'staging' })
    expect(result.details.reason).toBe('invalid_environment')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is unhealthy without network for an invalid notification URL', async () => {
    const result = await tpayHealthCheck.check({
      clientId: 'id',
      clientSecret: SECRET,
      environment: 'production',
      notificationUrl: 'http://shop.example.com/notify',
    })
    expect(result.status).toBe('unhealthy')
    expect(result.details.reason).toBe('invalid_notification_url')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports authentication failures without leaking provider output', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: SECRET }, 401))
    const result = await tpayHealthCheck.check({ clientId: 'id', clientSecret: SECRET, environment: 'production' })
    expect(result.status).toBe('unhealthy')
    expect(result.details).toEqual({
      reason: 'authentication_failed',
      environment: 'production',
      notificationUrlConfigured: false,
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(reportError).toHaveBeenCalledWith(
      expect.anything(),
      { module: 'gateway_tpay', code: 'gateway_tpay.health_check_failed' },
    )
  })

  it('catches network errors and reports them', async () => {
    fetchMock.mockRejectedValue(new Error(SECRET))
    const result = await tpayHealthCheck.check({ clientId: 'id', clientSecret: SECRET })
    expect(result.status).toBe('unhealthy')
    expect(result.details.reason).toBe('provider_unavailable')
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(reportError).toHaveBeenCalledTimes(1)
  })
})
