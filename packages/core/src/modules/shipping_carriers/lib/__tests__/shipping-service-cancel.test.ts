import Chance from 'chance'
import { createShippingCarrierService } from '../shipping-service'
import { ShipmentCancelNotAllowedError } from '../status-sync'

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

const makeScope = () => ({
  organizationId: chance.guid(),
  tenantId: chance.guid(),
})

const makeShipment = (overrides: Record<string, unknown> = {}) => ({
  id: chance.guid(),
  carrierShipmentId: chance.guid(),
  unifiedStatus: 'label_created',
  organizationId: chance.guid(),
  tenantId: chance.guid(),
  ...overrides,
})

const makeAdapter = (cancelResult = { status: 'cancelled' as const }) => ({
  calculateRates: jest.fn(),
  createShipment: jest.fn(),
  getTracking: jest.fn(),
  cancelShipment: jest.fn().mockResolvedValue(cancelResult),
})

const makeCredentialsService = () => ({
  resolve: jest.fn().mockResolvedValue({}),
})

const makeEm = () => ({
  flush: jest.fn().mockResolvedValue(undefined),
})

const makeCancelInput = (overrides: Record<string, unknown> = {}) => ({
  providerKey: chance.word(),
  shipmentId: chance.guid(),
  organizationId: chance.guid(),
  tenantId: chance.guid(),
  ...overrides,
})

describe('ShippingCarrierService.cancelShipment pre-condition guard', () => {
  afterEach(() => jest.clearAllMocks())

  it('throws ShipmentCancelNotAllowedError when shipment is in_transit', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'in_transit', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.cancelShipment({ ...makeCancelInput(), ...scope }))
      .rejects.toBeInstanceOf(ShipmentCancelNotAllowedError)
  })

  it('throws ShipmentCancelNotAllowedError when shipment is delivered', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'delivered', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.cancelShipment({ ...makeCancelInput(), ...scope }))
      .rejects.toBeInstanceOf(ShipmentCancelNotAllowedError)
  })

  it('throws ShipmentCancelNotAllowedError when shipment is already cancelled', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'cancelled', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.cancelShipment({ ...makeCancelInput(), ...scope }))
      .rejects.toBeInstanceOf(ShipmentCancelNotAllowedError)
  })

  it('throws ShipmentCancelNotAllowedError when shipment is returned', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'returned', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(service.cancelShipment({ ...makeCancelInput(), ...scope }))
      .rejects.toBeInstanceOf(ShipmentCancelNotAllowedError)
  })

  it('error message includes the current status', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'in_transit', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    const error = await service.cancelShipment({ ...makeCancelInput(), ...scope }).catch((e) => e)
    expect(error.message).toContain('in_transit')
  })

  it('calls the adapter when shipment is label_created', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    const adapter = makeAdapter()
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.cancelShipment({ ...makeCancelInput(), ...scope })

    expect(adapter.cancelShipment).toHaveBeenCalledTimes(1)
  })

  it('calls the adapter when shipment is picked_up', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'picked_up', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)
    const adapter = makeAdapter()
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.cancelShipment({ ...makeCancelInput(), ...scope })

    expect(adapter.cancelShipment).toHaveBeenCalledTimes(1)
  })
})

describe('ShippingCarrierService.cancelShipment adapter error propagation', () => {
  const mockEmitEvent = emitShippingEvent as jest.MockedFunction<typeof emitShippingEvent>

  afterEach(() => jest.clearAllMocks())

  it('re-throws when the adapter rejects (provider does not support cancel)', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const adapter = {
      ...makeAdapter(),
      cancelShipment: jest.fn().mockRejectedValue(
        new Error('Provider does not support shipment cancellation via API'),
      ),
    }
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await expect(
      service.cancelShipment({ ...makeCancelInput(), ...scope }),
    ).rejects.toThrow('Provider does not support shipment cancellation via API')
  })

  it('does not write status or emit event when the adapter rejects', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValueOnce(shipment as any)

    const adapter = {
      ...makeAdapter(),
      cancelShipment: jest.fn().mockRejectedValue(new Error('cancel not supported')),
    }
    mockGetAdapter.mockReturnValueOnce(adapter as any)

    const em = makeEm()
    const service = createShippingCarrierService({
      em: em as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.cancelShipment({ ...makeCancelInput(), ...scope }).catch(() => {})

    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
    expect(shipment.unifiedStatus).toBe('label_created')
  })
})
