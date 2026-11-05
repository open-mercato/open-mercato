import handler from '../inbound-process'

const mockProcessInbound = jest.fn()

jest.mock('../../lib/adapter-registry', () => ({
  getWebhookEndpointAdapter: jest.fn((key: string) => {
    if (key === 'test-provider') return { processInbound: mockProcessInbound }
    return null
  }),
}))

describe('webhooks inbound-process subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('calls adapter.processInbound with payload fields', async () => {
    mockProcessInbound.mockResolvedValue(undefined)

    await handler({
      providerKey: 'test-provider',
      eventType: 'shipment.update',
      payload: { trackingNumber: 'ABC123' },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(mockProcessInbound).toHaveBeenCalledWith({
      providerKey: 'test-provider',
      eventType: 'shipment.update',
      payload: { trackingNumber: 'ABC123' },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('re-throws when adapter.processInbound fails, so the queue can retry', async () => {
    const cause = new Error('Downstream failure')
    mockProcessInbound.mockRejectedValue(cause)

    await expect(
      handler({
        providerKey: 'test-provider',
        eventType: 'shipment.update',
        payload: { trackingNumber: 'ABC123' },
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    ).rejects.toThrow('Downstream failure')
  })

  it('throws when the adapter is not registered', async () => {
    await expect(
      handler({
        providerKey: 'unknown-provider',
        eventType: 'shipment.update',
        payload: { foo: 'bar' },
      }),
    ).rejects.toThrow('"unknown-provider" is not registered')
  })

  it('returns early when required payload fields are missing', async () => {
    await expect(handler({ tenantId: 'tenant-1' })).resolves.toBeUndefined()
    expect(mockProcessInbound).not.toHaveBeenCalled()
  })
})
