import Chance from 'chance'
import { createShippingCarrierService } from '../shipping-service'

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

const makeEm = () => ({
  flush: jest.fn().mockResolvedValue(undefined),
})

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  providerKey: chance.word(),
  shipmentId: chance.guid(),
  ...overrides,
})

describe('ShippingCarrierService.getTracking is read-only', () => {
  afterEach(() => jest.clearAllMocks())

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

  it('still returns provider tracking when no shipment row exists (tracking-number lookup)', async () => {
    const scope = makeScope()
    // No shipmentId, so the service never queries the shipment row.
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const tracking = await service.getTracking({
      providerKey: chance.word(),
      trackingNumber: chance.string(),
      ...scope,
    })

    expect(em.flush).not.toHaveBeenCalled()
    expect(tracking.status).toBe('delivered')
  })
})

describe('ShippingCarrierService.refreshTracking is the guarded write path', () => {
  afterEach(() => jest.clearAllMocks())

  it('persists polling metadata, advances a valid status, and emits status_changed', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    const tracking = makeTracking('in_transit')
    mockGetAdapter.mockReturnValueOnce(makeAdapter(tracking) as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const result = await service.refreshTracking({ ...makeInput(), ...scope })

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(shipment.unifiedStatus).toBe('in_transit')
    expect(shipment.trackingEvents).toBe(tracking.events)
    expect(shipment.lastPolledAt).toBeInstanceOf(Date)
    expect(mockEmitEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.status_changed',
      expect.objectContaining({ shipmentId: shipment.id, previousStatus: 'label_created', newStatus: 'in_transit' }),
    )
    expect(result.status).toBe('in_transit')
  })

  it('emits the terminal event in addition to status_changed when the status is terminal', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'out_for_delivery', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    mockGetAdapter.mockReturnValueOnce(makeAdapter(makeTracking('delivered')) as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(mockEmitEvent).toHaveBeenCalledTimes(2)
    expect(mockEmitEvent).toHaveBeenCalledWith('shipping_carriers.shipment.status_changed', expect.anything())
    expect(mockEmitEvent).toHaveBeenCalledWith('shipping_carriers.shipment.delivered', expect.anything())
  })

  it('does not emit or regress the status on an invalid transition, but still records the poll', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'delivered', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    const tracking = makeTracking('in_transit')
    mockGetAdapter.mockReturnValueOnce(makeAdapter(tracking) as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.refreshTracking({ ...makeInput(), ...scope })

    expect(shipment.unifiedStatus).toBe('delivered')
    expect(shipment.lastPolledAt).toBeInstanceOf(Date)
    expect(shipment.trackingEvents).toBe(tracking.events)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('throws when the shipment cannot be found', async () => {
    const scope = makeScope()
    mockFindOne.mockResolvedValueOnce(null as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.refreshTracking({ ...makeInput(), ...scope })).rejects.toThrow('Shipment not found')
  })
})
