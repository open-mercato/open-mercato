import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StartedTestContainer } from 'testcontainers'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import { CarrierShipment, CarrierWebhookProcessedEvent } from '../../data/entities'
import { emitShippingEvent } from '../../events'
import webhookHandler from '../../workers/webhook-processor'
import { getShippingAdapter } from '../adapter-registry'
import { createShippingCarrierService } from '../shipping-service'
import { ShipmentCancelNotAllowedError } from '../status-sync'

jest.mock('../adapter-registry', () => ({ getShippingAdapter: jest.fn() }))
jest.mock('../../events', () => ({ emitShippingEvent: jest.fn().mockResolvedValue(undefined) }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const postgresSuite = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

postgresSuite('shipment cancellation versus delivery against PostgreSQL (#7402)', () => {
  let orm: MikroORM
  let container: StartedTestContainer | undefined
  const scope = { organizationId: randomUUID(), tenantId: randomUUID() }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    container = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'shipping_cancel', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'postgres' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      clientUrl: `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/shipping_cancel`,
      entities: [CarrierShipment, CarrierWebhookProcessedEvent],
      metadataProvider: ReflectMetadataProvider,
      pool: { min: 0, max: 5 },
    })
    await orm.schema.refresh()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await container?.stop()
    }
  })

  afterEach(() => jest.clearAllMocks())

  async function setup() {
    const fixtureEm = orm.em.fork()
    const shipment = fixtureEm.create(CarrierShipment, {
      orderId: randomUUID(),
      providerKey: 'mock_carrier',
      carrierShipmentId: randomUUID(),
      trackingNumber: randomUUID(),
      unifiedStatus: 'label_created',
      ...scope,
    })
    await fixtureEm.persist(shipment).flush()
    const adapter = {
      calculateRates: jest.fn(),
      createShipment: jest.fn(),
      getTracking: jest.fn(),
      cancelShipment: jest.fn().mockResolvedValue({ status: 'cancelled' }),
      verifyWebhook: jest.fn(),
      mapStatus: jest.fn().mockReturnValue('delivered'),
    }
    jest.mocked(getShippingAdapter).mockReturnValue(adapter)
    const service = createShippingCarrierService({
      em: orm.em.fork(),
      integrationCredentialsService: { resolve: jest.fn().mockResolvedValue({}) } as unknown as CredentialsService,
    })
    const input = { shipmentId: shipment.id, providerKey: shipment.providerKey, ...scope }
    const deliver = async () => {
      const webhookEm = orm.em.fork()
      await webhookHandler({
        payload: {
          shipmentId: shipment.id,
          providerKey: shipment.providerKey,
          scope,
          event: { eventType: 'shipment.delivered', idempotencyKey: randomUUID(), data: { status: 'delivered' } },
        },
      } as Parameters<typeof webhookHandler>[0], {
        resolve: <Dependency>(name: string) => {
          if (name === 'em') return webhookEm as unknown as Dependency
          throw new Error(`[internal] Unexpected dependency: ${name}`)
        },
      } as Parameters<typeof webhookHandler>[1])
    }
    const read = () => findOneWithDecryption(orm.em.fork(), CarrierShipment, { id: shipment.id, ...scope }, undefined, scope)
    return { shipment, adapter, service, input, deliver, read }
  }

  it('keeps delivery committed by the webhook while the carrier cancellation waits', async () => {
    const { adapter, service, input, deliver, read } = await setup()
    const started = deferred()
    const response = deferred()
    adapter.cancelShipment.mockImplementation(async () => {
      started.resolve()
      await response.promise
      return { status: 'cancelled' }
    })

    const cancellation = service.cancelShipment(input)
    const outcome = cancellation.then(() => null, (error: unknown) => error)
    try {
      await started.promise
      await deliver()
      expect((await read())?.unifiedStatus).toBe('delivered')
    } finally {
      response.resolve()
      await outcome
    }

    expect(await outcome).toBeInstanceOf(ShipmentCancelNotAllowedError)
    const stored = await read()
    expect(stored?.unifiedStatus).toBe('delivered')
    expect(stored?.carrierStatus).toBe('delivered')
    expect(jest.mocked(emitShippingEvent).mock.calls.map(([event]) => event)).toEqual([
      'shipping_carriers.shipment.status_changed',
      'shipping_carriers.shipment.delivered',
    ])
  })

  it('keeps cancellation when a delivery webhook runs after it commits', async () => {
    const { service, input, deliver, read } = await setup()

    await expect(service.cancelShipment(input)).resolves.toEqual({ status: 'cancelled' })
    await deliver()

    expect((await read())?.unifiedStatus).toBe('cancelled')
    expect(jest.mocked(emitShippingEvent).mock.calls.map(([event]) => event)).toEqual([
      'shipping_carriers.shipment.cancelled',
    ])
  })

  it('waits for an in-progress delivery row lock before deciding whether to cancel', async () => {
    const { shipment, adapter, service, input, read } = await setup()
    const started = deferred()
    const response = deferred()
    const deliveryLocked = deferred()
    const deliveryCommit = deferred()
    adapter.cancelShipment.mockImplementation(async () => {
      started.resolve()
      await response.promise
      return { status: 'cancelled' }
    })
    const cancellation = service.cancelShipment(input)
    const outcome = cancellation.then(() => null, (error: unknown) => error)
    await started.promise
    const delivery = orm.em.fork().transactional(async (tx) => {
      const locked = await findOneWithDecryption(
        tx,
        CarrierShipment,
        { id: shipment.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        scope,
      )
      if (!locked) throw new Error('[internal] Missing shipment fixture')
      locked.unifiedStatus = 'delivered'
      await tx.flush()
      deliveryLocked.resolve()
      await deliveryCommit.promise
    })
    try {
      await Promise.race([deliveryLocked.promise, delivery])
      response.resolve()
      let waiting = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await orm.em.getConnection().execute<Array<{ waiting: boolean }>>(
          "select exists (select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%carrier_shipments%') as waiting",
        )
        if (rows[0]?.waiting) {
          waiting = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(waiting).toBe(true)
      expect(emitShippingEvent).not.toHaveBeenCalled()
    } finally {
      response.resolve()
      deliveryCommit.resolve()
      await delivery
      await outcome
    }

    expect(await outcome).toBeInstanceOf(ShipmentCancelNotAllowedError)
    expect((await read())?.unifiedStatus).toBe('delivered')
    expect(emitShippingEvent).not.toHaveBeenCalled()
  })
})
