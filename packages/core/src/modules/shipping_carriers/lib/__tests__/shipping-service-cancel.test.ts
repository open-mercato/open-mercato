import Chance from 'chance'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import { CarrierShipment } from '../../data/entities'
import { CarrierShipmentNotFoundError, createShippingCarrierService } from '../shipping-service'
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
  verifyWebhook: jest.fn(),
  mapStatus: jest.fn(),
})

const makeCredentialsService = () => ({
  resolve: jest.fn().mockResolvedValue({}),
})

const makeEm = () => {
  const tx = { flush: jest.fn().mockResolvedValue(undefined) }
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (run: (txEm: EntityManager) => Promise<void>) => run(tx as unknown as EntityManager)),
    tx,
  }
}

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
    mockFindOne.mockResolvedValue(shipment as CarrierShipment)
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
    mockFindOne.mockResolvedValue(shipment as CarrierShipment)
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

describe('ShippingCarrierService.cancelShipment event scope', () => {
  const mockEmitEvent = emitShippingEvent as jest.MockedFunction<typeof emitShippingEvent>

  afterEach(() => jest.clearAllMocks())

  it('emits the cancelled event with the trusted tenant and organization scope', async () => {
    const scope = makeScope()
    const shipment = makeShipment({ unifiedStatus: 'label_created', ...scope })
    mockFindOne.mockResolvedValue(shipment as CarrierShipment)
    mockGetAdapter.mockReturnValueOnce(makeAdapter() as any)

    const service = createShippingCarrierService({
      em: makeEm() as any,
      integrationCredentialsService: makeCredentialsService() as any,
    })

    await service.cancelShipment({ ...makeCancelInput(), ...scope })

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'shipping_carriers.shipment.cancelled',
      expect.objectContaining({ shipmentId: shipment.id }),
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })
})

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('ShippingCarrierService.cancelShipment concurrent updates', () => {
  const mockEmitEvent = emitShippingEvent as jest.MockedFunction<typeof emitShippingEvent>

  afterEach(() => jest.resetAllMocks())

  function makeHarness() {
    const scope = makeScope()
    const input = { ...makeCancelInput(), ...scope }
    const initial = makeShipment({ id: input.shipmentId, ...scope }) as CarrierShipment
    const current = { ...initial } as CarrierShipment
    const em = makeEm()
    const adapter = makeAdapter()
    mockFindOne.mockResolvedValueOnce(initial).mockImplementation(async () => current)
    mockGetAdapter.mockReturnValue(adapter)
    const service = createShippingCarrierService({
      em: em as unknown as EntityManager,
      integrationCredentialsService: makeCredentialsService() as unknown as CredentialsService,
    })
    return { scope, input, initial, current, em, adapter, service }
  }

  it.each(['delivered', 'returned', 'in_transit', 'cancelled'])(
    'preserves %s committed while the carrier cancellation is in flight',
    async (status) => {
      const { input, initial, current, em, adapter, service } = makeHarness()
      const started = deferred<void>()
      const carrierResponse = deferred<{ status: 'cancelled' }>()
      adapter.cancelShipment.mockImplementation(async () => {
        started.resolve()
        return carrierResponse.promise
      })

      const cancellation = service.cancelShipment(input)
      await started.promise
      expect(em.transactional).not.toHaveBeenCalled()
      current.unifiedStatus = status
      carrierResponse.resolve({ status: 'cancelled' })

      await expect(cancellation).rejects.toThrow(new ShipmentCancelNotAllowedError(status))
      expect(current.unifiedStatus).toBe(status)
      expect(initial.unifiedStatus).toBe('label_created')
      expect(em.tx.flush).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
      expect(mockEmitEvent).not.toHaveBeenCalled()
    },
  )

  it('cancels the fresh scoped row and emits only after the transaction commits', async () => {
    const { scope, input, initial, current, em, service } = makeHarness()
    current.unifiedStatus = 'picked_up'
    const flushed = deferred<void>()
    const commit = deferred<void>()
    em.transactional.mockImplementation(async (run) => {
      await run(em.tx as unknown as EntityManager)
      flushed.resolve()
      await commit.promise
    })

    const cancellation = service.cancelShipment(input)
    await Promise.race([
      flushed.promise,
      cancellation.then(() => { throw new Error('Cancellation completed before the locked transaction') }),
    ])

    expect(em.transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
    expect(mockFindOne).toHaveBeenLastCalledWith(
      em.tx,
      CarrierShipment,
      { id: input.shipmentId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    expect(current.unifiedStatus).toBe('cancelled')
    expect(initial.unifiedStatus).toBe('label_created')
    expect(em.tx.flush).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()

    commit.resolve()
    await expect(cancellation).resolves.toEqual({ status: 'cancelled' })
    expect(mockEmitEvent).toHaveBeenCalledTimes(1)
  })

  it('refuses a shipment deleted while the carrier call was in flight', async () => {
    const { input, em, service } = makeHarness()
    mockFindOne.mockResolvedValueOnce(null)

    await expect(service.cancelShipment(input)).rejects.toBeInstanceOf(CarrierShipmentNotFoundError)
    expect(em.tx.flush).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('emits no cancelled event when the transaction fails to commit', async () => {
    const { input, em, service } = makeHarness()
    em.transactional.mockImplementation(async (run) => {
      await run(em.tx as unknown as EntityManager)
      throw new Error('commit failed')
    })

    await expect(service.cancelShipment(input)).rejects.toThrow('commit failed')
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })
})
