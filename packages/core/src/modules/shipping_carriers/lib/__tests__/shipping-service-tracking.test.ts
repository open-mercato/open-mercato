import Chance from 'chance'
import { LockMode } from '@mikro-orm/core'
import { createShippingCarrierService } from '../shipping-service'
import { CarrierShipment } from '../../data/entities'

const chance = new Chance()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../adapter-registry', () => ({
  getShippingAdapter: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitShippingEvent: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getShippingAdapter } from '../adapter-registry'
import { emitShippingEvent } from '../../events'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockGetAdapter = getShippingAdapter as jest.MockedFunction<typeof getShippingAdapter>
const mockEmitEvent = emitShippingEvent as jest.MockedFunction<typeof emitShippingEvent>

const makeScope = () => ({
  organizationId: chance.guid(),
  tenantId: chance.guid(),
})

const makeShipment = (overrides: Record<string, unknown> = {}) => ({
  id: chance.guid(),
  carrierShipmentId: chance.guid(),
  trackingNumber: chance.string(),
  unifiedStatus: 'label_created',
  trackingEvents: null as unknown,
  lastPolledAt: null as unknown,
  organizationId: chance.guid(),
  tenantId: chance.guid(),
  ...overrides,
})

const makeTracking = (status = 'in_transit') => ({
  trackingNumber: chance.string(),
  status,
  events: [{ status, occurredAt: new Date('2026-01-01').toISOString(), location: chance.city() }],
})

const makeAdapter = (tracking = makeTracking()) => ({
  calculateRates: jest.fn(),
  createShipment: jest.fn(),
  getTracking: jest.fn().mockResolvedValue(tracking),
  cancelShipment: jest.fn(),
})

const makeCredentialsService = () => ({
  resolve: jest.fn().mockResolvedValue({}),
})

const makeEm = () => {
  const em: Record<string, jest.Mock> = {
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.transactional = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(em))
  return em
}

const makeTransactionalEm = () => {
  const tx = { flush: jest.fn().mockResolvedValue(undefined) }
  const em = {
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (run: (txEm: unknown) => Promise<unknown>) => run(tx)),
  }
  return { em, tx }
}

const mockPreAndLockedReads = (preRead: unknown, lockedRead: unknown) => {
  mockFindOne.mockImplementation(async (emArg) => (emArg && 'transactional' in emArg ? preRead : lockedRead) as any)
}

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  providerKey: chance.word(),
  shipmentId: chance.guid(),
  ...overrides,
})

describe('ShippingCarrierService.getTracking is read-only', () => {
  afterEach(() => jest.resetAllMocks())

  it('does not flush, mutate the shipment, or emit events on a read', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('in_transit')) as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const tracking = await service.getTracking({ ...makeInput(), ...scope })

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
    expect(shipment.unifiedStatus).toBe('label_created')
    expect(shipment.trackingEvents).toBeNull()
    expect(shipment.lastPolledAt).toBeNull()
    expect(tracking.status).toBe('in_transit')
  })

  it('requires tracking-number lookup to resolve a scoped shipment before calling the adapter', async () => {
    const scope = makeScope()
    const providerKey = chance.word()
    const trackingNumber = chance.string()
    const adapter = makeAdapter(makeTracking('delivered'))
    mockFindOne.mockResolvedValueOnce(null as any)
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.getTracking({
      providerKey,
      trackingNumber,
      ...scope,
    })).rejects.toThrow('Shipment not found')

    expect(mockFindOne).toHaveBeenCalledWith(
      em,
      CarrierShipment,
      {
        providerKey,
        trackingNumber,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    expect(adapter.getTracking).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('uses the scoped shipment row for tracking-number lookups', async () => {
    const scope = makeScope()
    const providerKey = chance.word()
    const shipment = makeShipment({ providerKey, ...scope })
    const tracking = makeTracking('delivered')
    const adapter = makeAdapter(tracking)
    mockFindOne.mockResolvedValueOnce(shipment as any)
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const result = await service.getTracking({
      providerKey,
      trackingNumber: shipment.trackingNumber,
      ...scope,
    })

    expect(result).toBe(tracking)
    expect(adapter.getTracking).toHaveBeenCalledWith({
      shipmentId: shipment.carrierShipmentId,
      trackingNumber: shipment.trackingNumber,
      credentials: {},
    })
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('ShippingCarrierService.refreshTracking is the guarded write path', () => {
  afterEach(() => jest.resetAllMocks())

  it('persists polling metadata, advances a valid status, and emits status_changed', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValue(shipment as any)
    const tracking = makeTracking('in_transit')
    mockGetAdapter.mockReturnValueOnce(makeAdapter(tracking) as any)

    const { em, tx } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const result = await service.refreshTracking({ ...makeInput(), ...scope })

    expect(tx.flush).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(shipment.unifiedStatus).toBe('in_transit')
    expect(shipment.trackingEvents).toBe(tracking.events)
    expect(shipment.lastPolledAt).toBeInstanceOf(Date)
    expect(mockEmitEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.status_changed',
      expect.objectContaining({ shipmentId: shipment.id, previousStatus: 'label_created', newStatus: 'in_transit' }),
      expect.anything(),
    )
    expect(result.status).toBe('in_transit')
  })

  it('emits the terminal event in addition to status_changed when the status is terminal', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'out_for_delivery', ...scope })
    mockFindOne.mockResolvedValue(shipment as any)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const service = createShippingCarrierService({
      em: makeTransactionalEm().em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(mockEmitEvent).toHaveBeenCalledTimes(2)
    expect(mockEmitEvent).toHaveBeenCalledWith('shipping_carriers.shipment.status_changed', expect.anything(), expect.anything())
    expect(mockEmitEvent).toHaveBeenCalledWith('shipping_carriers.shipment.delivered', expect.anything(), expect.anything())
  })

  it('does not emit or regress the status on an invalid transition, but still records the poll', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'delivered', ...scope })
    mockFindOne.mockResolvedValue(shipment as any)
    const tracking = makeTracking('in_transit')
    mockGetAdapter.mockReturnValueOnce(makeAdapter(tracking) as any)

    const { em, tx } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(shipment.unifiedStatus).toBe('delivered')
    expect(shipment.lastPolledAt).toBeInstanceOf(Date)
    expect(shipment.trackingEvents).toBe(tracking.events)
    expect(tx.flush).toHaveBeenCalledTimes(1)
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['label_created', 'delivered', 'shipping_carriers.shipment.delivered'],
    ['label_created', 'returned', 'shipping_carriers.shipment.returned'],
    ['picked_up', 'delivered', 'shipping_carriers.shipment.delivered'],
  ])('applies a polled %s -> %s jump and emits the terminal event', async (stored, polled, terminalEvent) => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: stored, ...scope })
    mockFindOne.mockResolvedValue(shipment as any)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking(polled)) as any)

    const { em } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(shipment.unifiedStatus).toBe(polled)
    expect(mockEmitEvent).toHaveBeenCalledTimes(2)
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.status_changed',
      expect.objectContaining({ shipmentId: shipment.id, previousStatus: stored, newStatus: polled }),
      expect.anything(),
    )
    expect(mockEmitEvent).toHaveBeenCalledWith(
      terminalEvent,
      expect.objectContaining({ shipmentId: shipment.id, previousStatus: stored, newStatus: polled }),
      expect.anything(),
    )
  })

  it('reads the shipment under a row lock on the transaction em before deciding', async () => {
    const scope = makeScope()
    const preRead = makeShipment({ unifiedStatus: 'label_created', ...scope })
    const locked = makeShipment({ id: preRead.id, unifiedStatus: 'label_created', ...scope })
    mockPreAndLockedReads(preRead, locked)
    const adapter = makeAdapter(makeTracking('in_transit'))
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const { em, tx } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(em.transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
    expect(mockFindOne).toHaveBeenLastCalledWith(
      tx,
      CarrierShipment,
      { id: preRead.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    expect(adapter.getTracking.mock.invocationCallOrder[0]).toBeLessThan(em.transactional.mock.invocationCallOrder[0])
    expect(locked.unifiedStatus).toBe('in_transit')
    expect(preRead.unifiedStatus).toBe('label_created')
    expect(preRead.trackingEvents).toBeNull()
    expect(preRead.lastPolledAt).toBeNull()
  })

  it('refuses the polled status when the locked row already moved to a terminal status', async () => {
    const scope = makeScope()
    const preRead = makeShipment({ unifiedStatus: 'in_transit', ...scope })
    const locked = makeShipment({ id: preRead.id, unifiedStatus: 'delivered', ...scope })
    mockPreAndLockedReads(preRead, locked)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('out_for_delivery')) as any)

    const service = createShippingCarrierService({
      em: makeTransactionalEm().em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(locked.unifiedStatus).toBe('delivered')
    expect(preRead.unifiedStatus).toBe('in_transit')
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('reports the locked status as previousStatus when it differs from the pre-read', async () => {
    const scope = makeScope()
    const preRead = makeShipment({ unifiedStatus: 'label_created', ...scope })
    const locked = makeShipment({ id: preRead.id, unifiedStatus: 'in_transit', ...scope })
    mockPreAndLockedReads(preRead, locked)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const service = createShippingCarrierService({
      em: makeTransactionalEm().em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(locked.unifiedStatus).toBe('delivered')
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.status_changed',
      expect.objectContaining({ previousStatus: 'in_transit', newStatus: 'delivered' }),
      expect.anything(),
    )
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.delivered',
      expect.objectContaining({ previousStatus: 'in_transit', newStatus: 'delivered' }),
      expect.anything(),
    )
  })

  it('writes nothing and emits nothing when the row disappears before the lock, but returns tracking', async () => {
    const scope = makeScope()
    const preRead = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockPreAndLockedReads(preRead, null)
    const tracking = makeTracking('delivered')
    mockGetAdapter.mockReturnValueOnce(makeAdapter(tracking) as any)

    const { em, tx } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const result = await service.refreshTracking({ ...makeInput(), ...scope })

    expect(result).toBe(tracking)
    expect(tx.flush).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(preRead.unifiedStatus).toBe('label_created')
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('emits nothing when the locked transaction fails', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValue(shipment as any)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const { em, tx } = makeTransactionalEm()
    tx.flush.mockRejectedValueOnce(new Error('serialization failure'))
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.refreshTracking({ ...makeInput(), ...scope })).rejects.toThrow('serialization failure')
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('emits status events with the trusted tenant and organization scope so scoped subscribers run', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockPreAndLockedReads(shipment, { ...shipment })
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const { em } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(mockEmitEvent).toHaveBeenCalledTimes(2)
    for (const [, , options] of mockEmitEvent.mock.calls) {
      expect(options).toEqual({ tenantId: scope.tenantId, organizationId: scope.organizationId })
    }
  })

  it('throws when the shipment cannot be found', async () => {
    const scope = makeScope()
    mockFindOne.mockResolvedValueOnce(null as any)

    const { em } = makeTransactionalEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.refreshTracking({ ...makeInput(), ...scope })).rejects.toThrow('Shipment not found')
    expect(em.transactional).not.toHaveBeenCalled()
  })
})
