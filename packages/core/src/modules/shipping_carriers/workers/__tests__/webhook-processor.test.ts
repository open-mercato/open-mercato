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

  function runJob(event: Record<string, unknown>, em: Record<string, unknown>) {
    return handler(
      {
        payload: {
          providerKey: 'inpost',
          shipmentId: 'shipment-1',
          scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
          event,
        },
      } as any,
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown dependency: ${name}`)
        },
      } as any,
    )
  }

  it('releases the claim and leaves the shipment untouched when the transition is rejected', async () => {
    const shipment = {
      id: 'shipment-1',
      providerKey: 'inpost',
      unifiedStatus: 'delivered',
      carrierStatus: 'delivered',
      lastWebhookAt: null,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    findOneWithDecryption.mockResolvedValue(shipment)
    getShippingAdapter.mockReturnValue({ mapStatus: jest.fn(() => 'in_transit') })
    claimWebhookProcessing.mockResolvedValue(true)
    const em = { flush: jest.fn() }

    await runJob({ eventType: 'in_transit', idempotencyKey: '42:shipment_status_changed:taken_by_courier:ts', data: { status: 'taken_by_courier' } }, em)

    expect(releaseWebhookClaim).toHaveBeenCalledWith(
      em,
      '42:shipment_status_changed:taken_by_courier:ts',
      'inpost',
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(shipment.unifiedStatus).toBe('delivered')
    expect(shipment.carrierStatus).toBe('delivered')
    expect(shipment.lastWebhookAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitShippingEvent).not.toHaveBeenCalled()
  })

  it('maps the raw carrier status from event data once and applies the transition', async () => {
    const shipment = {
      id: 'shipment-1',
      providerKey: 'inpost',
      unifiedStatus: 'label_created',
      carrierStatus: 'confirmed',
      lastWebhookAt: null as Date | null,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    findOneWithDecryption.mockResolvedValue(shipment)
    const mapStatus = jest.fn((status: string) => (status === 'taken_by_courier' ? 'in_transit' : 'unknown'))
    getShippingAdapter.mockReturnValue({ mapStatus })
    claimWebhookProcessing.mockResolvedValue(true)
    const em = { flush: jest.fn() }

    await runJob({ eventType: 'in_transit', idempotencyKey: 'k', data: { status: 'taken_by_courier' } }, em)

    expect(mapStatus).toHaveBeenCalledTimes(1)
    expect(mapStatus).toHaveBeenCalledWith('taken_by_courier')
    expect(shipment.unifiedStatus).toBe('in_transit')
    expect(shipment.carrierStatus).toBe('taken_by_courier')
    expect(shipment.lastWebhookAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(releaseWebhookClaim).not.toHaveBeenCalled()
    expect(emitShippingEvent).toHaveBeenCalledWith('shipping_carriers.shipment.status_changed', expect.objectContaining({ newStatus: 'in_transit' }))
  })
})
