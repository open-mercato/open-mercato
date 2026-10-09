import { channelMailjetHealthCheck } from '../health'

describe('channelMailjetHealthCheck', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('performs a bounded authenticated profile probe', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    const result = await channelMailjetHealthCheck.check(
      { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result.status).toBe('healthy')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mailjet.com/v3/REST/myprofile',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from('public-key:private-key').toString('base64')}`,
        }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('reports rejected credentials as unhealthy', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 }))

    const result = await channelMailjetHealthCheck.check(
      { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: expect.objectContaining({ status: 401 }),
    }))
  })

  it('rejects incomplete credentials without calling the provider', async () => {
    global.fetch = jest.fn()

    const result = await channelMailjetHealthCheck.check(
      { apiKey: 'public-key', fromAddress: 'from@example.com' },
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

    const result = await channelMailjetHealthCheck.check(
      { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: { reason: 'request_failed' },
    }))
  })
})
