/**
 * Confirmed-first conversion under real PostgreSQL (#9183 scenario 4, inherited #8268
 * blocker). A checkout holds stock as `sourceType: 'checkout'` rows (`availability.reserve`).
 * When the order is placed, two independent writers turn that into an order hold, in either
 * order or concurrently:
 * - `availability.commit` converts the checkout rows in place
 *   (`WmsReservationService.convertInTransaction`);
 * - the `sales.order.confirmed` subscriber (`wms/subscribers/sales-order-confirmed-reserve.ts`
 *   -> `reserveInventoryForConfirmedOrder`) reserves whatever the order still lacks as
 *   `sourceType: 'order'` rows through `wms.inventory.reserve`.
 * The invariant: the order ends up holding exactly its quantity, no checkout row stays
 * active, and `wms_inventory_balances.quantity_reserved` equals the active rows' sum.
 *
 * Guards under test, all in production code: `convertInTransaction` row-locks the checkout
 * row and every active order row of the same order/variant, counts the automation's own
 * rows as covering (releasing or shrinking the checkout hold instead of converting all of
 * it), and rebuilds the converted row's idempotency key to the one `wms.inventory.reserve`
 * derives, so a late automation reserve for the same quantity replays it instead of
 * double-holding (`wms_inventory_reservations_idempotency_unique_idx`).
 *
 * What is REAL here: the registered `availability.reserve`/`availability.commit` handlers,
 * the registered `wms.inventory.reserve` handler dispatched through the real `CommandBus`,
 * the `sales.order.confirmed` subscriber handler, `WmsReservationService`, the real
 * `PolicyResolutionService`, and real wms/availability tables with independent pooled
 * connections.
 *
 * What is STUBBED, and why: `queryEngine`, as a sales read model that answers the order
 * row and its lines. WMS reads sales orders only through the query engine (never the sales
 * ORM, cross-module rule), so this stub is the whole sales surface the subscriber sees; it
 * holds no stock state. Absent: `dataEngine`, the event bus, `featureTogglesService` (the
 * automation then defaults to enabled), all of which act outside the reservation
 * transactions. Checkout's own `submit.ts` is not driven: it only dispatches
 * `availability.commit`, which is driven directly here.
 *
 * Gated on OM_AVAILABILITY_PG_URL (the `test:pg-concurrency` CI job), a throwaway database:
 * the suite refreshes its own schema.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import {
  CommandBus,
  type CommandExecuteResult,
  type CommandExecutionOptions,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  Asn,
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  PutawayTask,
  ReceivingLine,
  SalesOrderWarehouseAssignment,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../../../wms/data/entities'
import { WmsReservationService } from '../../../wms/lib/wmsReservationService'
import handleSalesOrderConfirmed from '../../../wms/subscribers/sales-order-confirmed-reserve'
import '../../../wms/commands/inventory-actions'
import { AvailabilityPolicy, AvailabilityReservation } from '../../data/entities'
import { createPolicyResolutionService } from '../policyResolution'
import { commitAvailabilityCommand, reserveAvailabilityCommand } from '../../commands/reservations'
import type { CommitAvailabilityResult } from '../reservationCommands'

const PG_URL = process.env.OM_AVAILABILITY_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const POLL_INTERVAL_MS = 20
const WAIT_TIMEOUT_MS = 10_000

type SalesOrderFixture = { id: string; orderNumber: string; variantId: string; quantity: number }

type Pause = { reached: Promise<void>; release: () => void }

class PausableCommandBus extends CommandBus {
  private readonly pauses = new Map<string, Array<{ signalReached: () => void; released: Promise<void> }>>()

  pauseBefore(commandId: string): Pause {
    let signalReached: () => void = () => undefined
    let release: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = this.pauses.get(commandId) ?? []
    queue.push({ signalReached, released })
    this.pauses.set(commandId, queue)
    return { reached, release }
  }

  override async execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    options: CommandExecutionOptions<TInput>,
  ): Promise<CommandExecuteResult<TResult>> {
    const pause = this.pauses.get(commandId)?.shift()
    if (pause) {
      pause.signalReached()
      await pause.released
    }
    return super.execute<TInput, TResult>(commandId, options)
  }
}

maybe('confirmed-first conversion: availability.commit vs the sales.order.confirmed reserve automation (#9183 scenario 4)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let container: AwilixContainer
  let commandBus: PausableCommandBus
  const salesOrders = new Map<string, SalesOrderFixture>()

  const salesReadModel: QueryEngine = {
    async query<T>(entity: Parameters<QueryEngine['query']>[0], options?: Parameters<QueryEngine['query']>[1]): Promise<QueryResult<T>> {
      const filters = (options?.filters ?? {}) as Record<string, { $eq?: string } | undefined>
      const rows: Array<Record<string, unknown>> = []
      if (entity === E.sales.sales_order) {
        const order = salesOrders.get(filters.id?.$eq ?? '')
        if (order) {
          rows.push({ id: order.id, order_number: order.orderNumber, status: 'confirmed', tenant_id: TENANT_ID, organization_id: ORG_ID })
        }
      } else if (entity === E.sales.sales_order_line) {
        const order = salesOrders.get(filters.order_id?.$eq ?? '')
        if (order) {
          rows.push({ id: `${order.id}-line-1`, kind: 'product', product_variant_id: order.variantId, quantity: String(order.quantity), line_number: 1 })
        }
      }
      return { items: rows as unknown as T[], page: 1, pageSize: rows.length, total: rows.length }
    },
  }

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      contextName: 'availability-confirmed-first',
      entities: [
        Warehouse,
        WarehouseZone,
        WarehouseLocation,
        ProductInventoryProfile,
        InventoryLot,
        InventoryBalance,
        InventoryReservation,
        SalesOrderWarehouseAssignment,
        InventoryMovement,
        Asn,
        ReceivingLine,
        PutawayTask,
        AvailabilityPolicy,
        AvailabilityReservation,
      ],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 20 },
    })
    await orm.schema.refresh()
    commandBus = new PausableCommandBus()
    container = createContainer()
    container.register({
      em: asValue(orm.em),
      commandBus: asValue(commandBus),
      queryEngine: asValue(salesReadModel),
      wmsReservationService: asValue(new WmsReservationService()),
      ProductInventoryProfile: asValue(ProductInventoryProfile),
      AvailabilityPolicy: asValue(AvailabilityPolicy),
    })
    container.register({ policyResolutionService: asValue(createPolicyResolutionService(container)) })
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function callerCtx(): CommandRuntimeContext {
    return {
      container,
      auth: { sub: 'checkout-system', tenantId: TENANT_ID, orgId: ORG_ID },
      organizationScope: null,
      selectedOrganizationId: ORG_ID,
      organizationIds: [ORG_ID],
    }
  }

  type CheckoutFixture = {
    productId: string
    variantId: string
    orderId: string
    idempotencyKey: string
    checkoutRowId: string
  }

  // One primary warehouse with `onHand` units of a stock-managed variant, then a real
  // `availability.reserve` checkout hold of `quantity`, and a confirmed sales order for the
  // same quantity in the read model.
  async function seedCheckoutHold(input: { onHand: number; quantity: number }): Promise<CheckoutFixture> {
    const em = orm.em.fork()
    const suffix = randomUUID().slice(0, 8)
    const productId = randomUUID()
    const variantId = randomUUID()
    const warehouse = em.create(Warehouse, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      name: `Confirmed-first WH ${suffix}`,
      code: `WH-${suffix}`,
      isActive: true,
      isPrimary: false,
    })
    const location = em.create(WarehouseLocation, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      warehouse,
      code: `BIN-${suffix}`,
      type: 'bin',
      isActive: true,
    })
    em.persist([warehouse, location])
    await em.flush()
    em.persist(
      em.create(InventoryBalance, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        warehouse,
        location,
        catalogVariantId: variantId,
        quantityOnHand: String(input.onHand),
        quantityReserved: '0',
        quantityAllocated: '0',
      }),
    )
    em.persist(
      em.create(ProductInventoryProfile, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'unit',
        defaultStrategy: 'fifo',
      }),
    )
    await em.flush()

    const idempotencyKey = `confirmed-first-${suffix}`
    const reserved = await reserveAvailabilityCommand.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        items: [{ catalogProductId: productId, catalogVariantId: variantId, quantity: input.quantity }],
        sourceType: 'checkout',
        sourceId: randomUUID(),
        idempotencyKey,
      },
      callerCtx(),
    )
    if (!reserved.reserved) throw new Error('[internal] the checkout hold fixture could not reserve stock')
    const hold = await orm.em.fork().findOneOrFail(AvailabilityReservation, { idempotencyKey })
    if (hold.wmsReservationIds.length !== 1) throw new Error('[internal] expected a single checkout wms row')

    const orderId = randomUUID()
    salesOrders.set(orderId, { id: orderId, orderNumber: `SO-${suffix}`, variantId, quantity: input.quantity })
    return { productId, variantId, orderId, idempotencyKey, checkoutRowId: hold.wmsReservationIds[0] }
  }

  async function commit(fixture: CheckoutFixture): Promise<CommitAvailabilityResult> {
    return commitAvailabilityCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, idempotencyKey: fixture.idempotencyKey, orderId: fixture.orderId },
      callerCtx(),
    )
  }

  async function runOrderConfirmedAutomation(fixture: CheckoutFixture): Promise<void> {
    await handleSalesOrderConfirmed(
      { orderId: fixture.orderId, tenantId: TENANT_ID, organizationId: ORG_ID },
      { resolve: <T,>(name: string): T => container.resolve<T>(name) },
    )
  }

  type HoldState = { orderHeld: number; checkoutHeld: number; quantityReserved: number; holdStatus: string }

  async function readHoldState(fixture: CheckoutFixture): Promise<HoldState> {
    const em = orm.em.fork()
    const active = await em.find(InventoryReservation, { catalogVariantId: fixture.variantId, status: 'active' })
    const sum = (rows: InventoryReservation[]) => rows.reduce((total, row) => total + Number(row.quantity), 0)
    const balance = await em.findOneOrFail(InventoryBalance, { catalogVariantId: fixture.variantId })
    const hold = await em.findOneOrFail(AvailabilityReservation, { idempotencyKey: fixture.idempotencyKey })
    return {
      orderHeld: sum(active.filter((row) => row.sourceType === 'order' && row.sourceId === fixture.orderId)),
      checkoutHeld: sum(active.filter((row) => row.sourceType === 'checkout')),
      quantityReserved: Number(balance.quantityReserved),
      holdStatus: hold.status,
    }
  }

  type HeldRowLock = { holderPid: number; release: () => Promise<void> }

  // Holds `SELECT ... FOR UPDATE` on one row in its own transaction until `release()`.
  async function holdRowLock(table: 'wms_inventory_reservations', id: string): Promise<HeldRowLock> {
    let signalAcquired: (holderPid: number) => void = () => undefined
    let signalRelease: () => void = () => undefined
    const acquired = new Promise<number>((resolve) => {
      signalAcquired = resolve
    })
    const releaseRequested = new Promise<void>((resolve) => {
      signalRelease = resolve
    })
    const holding = orm.em.fork().transactional(async (trx) => {
      await trx.execute(`select id from ${table} where id = ? for update`, [id])
      const [backend] = await trx.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
      signalAcquired(backend.pid)
      await releaseRequested
    })
    const holderPid = await Promise.race([acquired, holding.then(() => -1)])
    if (holderPid < 0) throw new Error('[internal] the row-lock holder finished before acquiring the lock')
    return {
      holderPid,
      release: async () => {
        signalRelease()
        await holding
      },
    }
  }

  // Polls until some session is blocked by the holder's backend (`pg_blocking_pids`), or
  // until `unlessSettled()` (so the caller can assert the call did not just finish instead).
  // Matching on the blocker rather than on query text: a long ORM query is truncated in
  // `pg_stat_activity.query` at `track_activity_query_size`.
  async function waitUntilBlockedBy(held: HeldRowLock, unlessSettled: () => boolean): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (unlessSettled()) return
      const rows = await orm.em.fork().execute<Array<{ waiting: number }>>(
        'select count(*)::int as waiting from pg_stat_activity where ?::int = any(pg_blocking_pids(pid))',
        [held.holderPid],
      )
      if ((rows[0]?.waiting ?? 0) >= 1) return
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`[internal] timed out waiting for a session blocked by backend ${held.holderPid}`)
  }

  test('confirmed first, stock for both: the order rows fully cover the hold and commit releases the checkout rows', async () => {
    const fixture = await seedCheckoutHold({ onHand: 4, quantity: 2 })

    await runOrderConfirmedAutomation(fixture)
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 2, quantityReserved: 4, holdStatus: 'active' })

    expect((await commit(fixture)).status).toBe('committed')
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 0, quantityReserved: 2, holdStatus: 'committed' })
    const checkoutRow = await orm.em.fork().findOneOrFail(InventoryReservation, { id: fixture.checkoutRowId })
    expect(checkoutRow.status).toBe('released')
  })

  test('confirmed first, partial cover: commit shrinks the checkout hold to the uncovered part and converts it', async () => {
    // 3 on hand, 2 held for checkout: the automation can add only 1 order unit.
    const fixture = await seedCheckoutHold({ onHand: 3, quantity: 2 })

    await runOrderConfirmedAutomation(fixture)
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 1, checkoutHeld: 2, quantityReserved: 3, holdStatus: 'active' })

    expect((await commit(fixture)).status).toBe('committed')
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 0, quantityReserved: 2, holdStatus: 'committed' })
    const converted = await orm.em.fork().findOneOrFail(InventoryReservation, { id: fixture.checkoutRowId })
    expect(converted).toMatchObject({ status: 'active', sourceType: 'order', sourceId: fixture.orderId, quantity: '1.0000' })
  })

  test('commit first: the automation finds the converted hold and reserves nothing more', async () => {
    const fixture = await seedCheckoutHold({ onHand: 4, quantity: 2 })

    expect((await commit(fixture)).status).toBe('committed')
    await runOrderConfirmedAutomation(fixture)

    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 0, quantityReserved: 2, holdStatus: 'committed' })
  })

  test('commit waiting on the checkout row while the automation commits its order rows still counts them as covering', async () => {
    const fixture = await seedCheckoutHold({ onHand: 4, quantity: 2 })

    // `convertInTransaction` row-locks the checkout row first; holding it parks the commit
    // inside its transaction, after its own `active -> committed` CAS on the hold.
    const checkoutRowLock = await holdRowLock('wms_inventory_reservations', fixture.checkoutRowId)
    let committed = false
    const commitCall = commit(fixture).finally(() => {
      committed = true
    })
    await waitUntilBlockedBy(checkoutRowLock, () => committed)
    expect(committed).toBe(false)

    await runOrderConfirmedAutomation(fixture)
    expect((await readHoldState(fixture)).orderHeld).toBe(2)

    await checkoutRowLock.release()
    expect((await commitCall).status).toBe('committed')
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 0, quantityReserved: 2, holdStatus: 'committed' })
  })

  test('an automation acting on a pre-commit read replays the converted row instead of reserving the order twice', async () => {
    const fixture = await seedCheckoutHold({ onHand: 4, quantity: 2 })

    // The automation has read "nothing reserved for this order yet" and is about to reserve 2.
    const automationAboutToReserve = commandBus.pauseBefore('wms.inventory.reserve')
    const automation = runOrderConfirmedAutomation(fixture)
    await automationAboutToReserve.reached

    expect((await commit(fixture)).status).toBe('committed')

    automationAboutToReserve.release()
    await automation
    expect(await readHoldState(fixture)).toEqual({ orderHeld: 2, checkoutHeld: 0, quantityReserved: 2, holdStatus: 'committed' })
  })
})
