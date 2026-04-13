import handler from '../webhook-processor'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitShippingEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/adapter-registry', () => ({
  getShippingAdapter: jest.fn(),
}))

jest.mock('../../lib/webhook-utils', () => ({
  claimWebhookProcessing: jest.fn(),
  releaseWebhookClaim: jest.fn(),
}))

const { findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
}
const { emitShippingEvent } = jest.requireMock('../../events') as {
  emitShippingEvent: jest.Mock
}
const { getShippingAdapter } = jest.requireMock('../../lib/adapter-registry') as {
  getShippingAdapter: jest.Mock
}
const { claimWebhookProcessing, releaseWebhookClaim } = jest.requireMock('../../lib/webhook-utils') as {
  claimWebhookProcessing: jest.Mock
  releaseWebhookClaim: jest.Mock
}

describe('shipping webhook processor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('skips duplicate webhook events after idempotency claim fails', async () => {
    findOneWithDecryption.mockResolvedValue({
      id: 'shipment-1',
      providerKey: 'mock_carrier',
      unifiedStatus: 'in_transit',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    getShippingAdapter.mockReturnValue({
      mapStatus: jest.fn(() => 'delivered'),
    })
    claimWebhookProcessing.mockResolvedValue(false)

    await handler(
      {
        payload: {
          providerKey: 'mock_carrier',
          shipmentId: 'shipment-1',
          scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
          event: {
            eventType: 'shipment.delivered',
            idempotencyKey: 'evt-1',
            data: { status: 'delivered' },
          },
        },
      } as any,
      {
        resolve: (name: string) => {
          if (name === 'em') {
            return { flush: jest.fn() }
          }
          throw new Error(`Unknown dependency: ${name}`)
        },
      } as any,
    )

    expect(claimWebhookProcessing).toHaveBeenCalledWith(
      expect.anything(),
      'evt-1',
      'mock_carrier',
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      'shipment.delivered',
    )
    expect(emitShippingEvent).not.toHaveBeenCalled()
    expect(releaseWebhookClaim).not.toHaveBeenCalled()
  })
})
