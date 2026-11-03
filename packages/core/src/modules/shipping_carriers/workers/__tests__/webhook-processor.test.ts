import { LockMode } from '@mikro-orm/core'
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

const makeShipment = (unifiedStatus: string) => ({
  id: 'shipment-1',
  providerKey: 'mock_carrier',
  unifiedStatus,
  carrierStatus: null as string | null,
  lastWebhookAt: null as Date | null,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
})

const makeTransactionalEm = () => {
  const tx = { flush: jest.fn().mockResolvedValue(undefined) }
  const em = {
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (run: (txEm: unknown) => Promise<unknown>) => run(tx)),
  }
  return { em, tx }
}

const mockPreAndLockedReads = (preRead: unknown, lockedRead: unknown) => {
  findOneWithDecryption.mockImplementation(async (emArg: object) => ('transactional' in emArg ? preRead : lockedRead))
}

const runWebhook = (em: unknown, carrierStatus: string) => handler(
  {
    payload: {
      providerKey: 'mock_carrier',
      shipmentId: 'shipment-1',
      scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
      event: {
        eventType: `shipment.${carrierStatus}`,
        idempotencyKey: `evt-${carrierStatus}`,
        data: { status: carrierStatus },
      },
    },
  } as any,
  {
    resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`Unknown dependency: ${name}`)
    },
  } as any,
)

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
  it.each([
    ['picked_up', 'delivered'],
    ['label_created', 'delivered'],
    ['label_created', 'out_for_delivery'],
    ['in_transit', 'delivered'],
  ])('applies a %s -> %s webhook and reports the previous unified status', async (stored, carrierStatus) => {
    const shipment = {
      id: 'shipment-1',
      providerKey: 'mock_carrier',
      unifiedStatus: stored,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    findOneWithDecryption.mockResolvedValue(shipment)
    getShippingAdapter.mockReturnValue({
      mapStatus: jest.fn((status: string) => status),
    })
    claimWebhookProcessing.mockResolvedValue(true)
    const em: Record<string, jest.Mock> = { flush: jest.fn().mockResolvedValue(undefined) }
    em.transactional = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(em))

    await handler(
      {
        payload: {
          providerKey: 'mock_carrier',
          shipmentId: 'shipment-1',
          scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
          event: {
            eventType: `shipment.${carrierStatus}`,
            idempotencyKey: `evt-${stored}-${carrierStatus}`,
            data: { status: carrierStatus },
          },
        },
      } as any,
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown dependency: ${name}`)
        },
      } as any,
    )

    expect(shipment.unifiedStatus).toBe(carrierStatus)
    expect(em.flush).toHaveBeenCalled()
    expect(emitShippingEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.status_changed',
      expect.objectContaining({ shipmentId: 'shipment-1', previousStatus: stored, newStatus: carrierStatus }),
      expect.anything(),
    )
    expect(releaseWebhookClaim).not.toHaveBeenCalled()
  })

  describe('locked read-decide-write', () => {
    beforeEach(() => {
      getShippingAdapter.mockReturnValue({
        mapStatus: jest.fn((status: string) => (status === 'DELIVERED_TO_RECIPIENT' ? 'delivered' : status)),
      })
      claimWebhookProcessing.mockResolvedValue(true)
    })

    it('locks the row on the transaction em and writes only the locked instance', async () => {
      const preRead = makeShipment('picked_up')
      const locked = makeShipment('picked_up')
      mockPreAndLockedReads(preRead, locked)
      const { em, tx } = makeTransactionalEm()

      await runWebhook(em, 'DELIVERED_TO_RECIPIENT')

      expect(em.transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
      expect(findOneWithDecryption).toHaveBeenLastCalledWith(
        tx,
        expect.anything(),
        { id: 'shipment-1', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )
      expect(tx.flush).toHaveBeenCalledTimes(1)
      expect(locked.unifiedStatus).toBe('delivered')
      expect(locked.carrierStatus).toBe('DELIVERED_TO_RECIPIENT')
      expect(locked.lastWebhookAt).toBeInstanceOf(Date)
      expect(preRead).toEqual(makeShipment('picked_up'))
      const expectedPayload = expect.objectContaining({
        previousStatus: 'picked_up',
        newStatus: 'delivered',
        carrierStatus: 'DELIVERED_TO_RECIPIENT',
      })
      expect(emitShippingEvent).toHaveBeenCalledWith('shipping_carriers.shipment.status_changed', expectedPayload, expect.anything())
      expect(emitShippingEvent).toHaveBeenCalledWith('shipping_carriers.shipment.delivered', expectedPayload, expect.anything())
      expect(tx.flush.mock.invocationCallOrder[0]).toBeLessThan(emitShippingEvent.mock.invocationCallOrder[0])
      expect(releaseWebhookClaim).not.toHaveBeenCalled()
    })

    it('refuses the status when the locked row is already terminal, even if the pre-read was not', async () => {
      const preRead = makeShipment('in_transit')
      const locked = makeShipment('delivered')
      mockPreAndLockedReads(preRead, locked)
      const { em, tx } = makeTransactionalEm()

      await runWebhook(em, 'out_for_delivery')

      expect(locked.unifiedStatus).toBe('delivered')
      expect(locked.carrierStatus).toBeNull()
      expect(locked.lastWebhookAt).toBeNull()
      expect(preRead.unifiedStatus).toBe('in_transit')
      expect(tx.flush).not.toHaveBeenCalled()
      expect(emitShippingEvent).not.toHaveBeenCalled()
      expect(releaseWebhookClaim).not.toHaveBeenCalled()
    })

    it('reports the locked status as previousStatus when it differs from the pre-read', async () => {
      const preRead = makeShipment('label_created')
      const locked = makeShipment('in_transit')
      mockPreAndLockedReads(preRead, locked)
      const { em } = makeTransactionalEm()

      await runWebhook(em, 'delivered')

      expect(locked.unifiedStatus).toBe('delivered')
      expect(emitShippingEvent).toHaveBeenCalledWith(
        'shipping_carriers.shipment.status_changed',
        expect.objectContaining({ previousStatus: 'in_transit', newStatus: 'delivered', carrierStatus: 'delivered' }),
        expect.anything(),
      )
      expect(emitShippingEvent).toHaveBeenCalledWith(
        'shipping_carriers.shipment.delivered',
        expect.objectContaining({ previousStatus: 'in_transit', newStatus: 'delivered' }),
        expect.anything(),
      )
    })

    it('writes nothing and emits nothing when the locked read finds no row', async () => {
      const preRead = makeShipment('label_created')
      mockPreAndLockedReads(preRead, null)
      const { em, tx } = makeTransactionalEm()

      await runWebhook(em, 'delivered')

      expect(tx.flush).not.toHaveBeenCalled()
      expect(preRead).toEqual(makeShipment('label_created'))
      expect(emitShippingEvent).not.toHaveBeenCalled()
      expect(releaseWebhookClaim).not.toHaveBeenCalled()
    })

    it('releases the claim and emits nothing when the transaction fails', async () => {
      const preRead = makeShipment('in_transit')
      const locked = makeShipment('in_transit')
      mockPreAndLockedReads(preRead, locked)
      const { em, tx } = makeTransactionalEm()
      tx.flush.mockRejectedValueOnce(new Error('deadlock detected'))

      await expect(runWebhook(em, 'delivered')).rejects.toThrow('deadlock detected')

      expect(emitShippingEvent).not.toHaveBeenCalled()
      expect(releaseWebhookClaim).toHaveBeenCalledWith(
        em,
        'evt-delivered',
        'mock_carrier',
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )
      expect(preRead.unifiedStatus).toBe('in_transit')
    })

    it('keeps the claim when an emit fails after the commit', async () => {
      const preRead = makeShipment('in_transit')
      const locked = makeShipment('in_transit')
      mockPreAndLockedReads(preRead, locked)
      const { em, tx } = makeTransactionalEm()
      emitShippingEvent.mockRejectedValueOnce(new Error('bus down'))

      await expect(runWebhook(em, 'delivered')).rejects.toThrow('bus down')

      expect(tx.flush).toHaveBeenCalledTimes(1)
      expect(releaseWebhookClaim).not.toHaveBeenCalled()
    })
  })
  it('still processes a job queued with the legacy { name, payload } envelope', async () => {
    const shipment = {
      id: 'shipment-1',
      providerKey: 'mock_carrier',
      unifiedStatus: 'in_transit',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    findOneWithDecryption.mockResolvedValue(shipment)
    getShippingAdapter.mockImplementation((key: string) => (key === 'mock_carrier' ? { mapStatus: jest.fn((status: string) => status) } : undefined))
    claimWebhookProcessing.mockResolvedValue(true)
    const em: Record<string, jest.Mock> = { flush: jest.fn().mockResolvedValue(undefined) }
    em.transactional = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(em))

    await handler(
      {
        payload: {
          name: 'shipping-carrier-webhook',
          payload: {
            providerKey: 'mock_carrier',
            shipmentId: 'shipment-1',
            scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
            event: { eventType: 'shipment.delivered', idempotencyKey: 'evt-legacy', data: { status: 'delivered' } },
          },
        },
      } as any,
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown dependency: ${name}`)
        },
      } as any,
    )

    expect(claimWebhookProcessing).toHaveBeenCalledWith(
      expect.anything(),
      'evt-legacy',
      'mock_carrier',
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      'shipment.delivered',
    )
    expect(emitShippingEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.delivered',
      expect.objectContaining({ shipmentId: 'shipment-1', previousStatus: 'in_transit', newStatus: 'delivered' }),
      expect.anything(),
    )
  })
  it('emits status events with the trusted tenant and organization scope so scoped subscribers run', async () => {
    const shipment = {
      id: 'shipment-1',
      providerKey: 'mock_carrier',
      unifiedStatus: 'label_created',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    findOneWithDecryption.mockResolvedValue(shipment)
    getShippingAdapter.mockReturnValue({ mapStatus: jest.fn((status: string) => status) })
    claimWebhookProcessing.mockResolvedValue(true)
    const em: Record<string, jest.Mock> = { flush: jest.fn().mockResolvedValue(undefined) }
    em.transactional = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(em))

    await handler(
      {
        payload: {
          providerKey: 'mock_carrier',
          shipmentId: 'shipment-1',
          scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
          event: { eventType: 'shipment.delivered', idempotencyKey: 'evt-scope', data: { status: 'delivered' } },
        },
      } as any,
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown dependency: ${name}`)
        },
      } as any,
    )

    expect(emitShippingEvent).toHaveBeenCalledTimes(2)
    for (const [, , options] of emitShippingEvent.mock.calls) {
      expect(options).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    }
  })
})
