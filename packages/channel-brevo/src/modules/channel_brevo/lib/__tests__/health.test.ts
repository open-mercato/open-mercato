import { channelBrevoHealthCheck } from '../health'

describe('channelBrevoHealthCheck', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('performs a bounded provider API probe', async () => {
    const readBody = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: readBody } as unknown as Response)

    const result = await channelBrevoHealthCheck.check(
      { apiKey: 'brevo_test', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual({
      status: 'healthy',
      message: 'Brevo API credentials are valid',
      details: { endpoint: 'account' },
    })
    expect(readBody).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/account',
      expect.objectContaining({
        headers: expect.objectContaining({ 'api-key': 'brevo_test' }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('reports rejected credentials as unhealthy', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 }))

    const result = await channelBrevoHealthCheck.check(
      { apiKey: 'brevo_bad', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: expect.objectContaining({ status: 401 }),
    }))
  })

  it('rejects incomplete credentials without calling the provider', async () => {
    global.fetch = jest.fn()

    const result = await channelBrevoHealthCheck.check(
      { apiKey: '', fromAddress: 'not-an-email' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: { reason: 'invalid_credentials' },
    }))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports provider network failures as unhealthy', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'))

    const result = await channelBrevoHealthCheck.check(
      { apiKey: 'brevo_test', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: { reason: 'request_failed' },
    }))
  })
})
