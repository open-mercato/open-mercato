import { channelResendHealthCheck } from '../health'

describe('channelResendHealthCheck', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('performs a bounded provider API probe', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    const result = await channelResendHealthCheck.check(
      { apiKey: 're_test', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result.status).toBe('healthy')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/domains?limit=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('reports rejected credentials as unhealthy', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 }))

    const result = await channelResendHealthCheck.check(
      { apiKey: 're_bad', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      details: expect.objectContaining({ status: 401 }),
    }))
  })
})
