/**
 * Sales order delete -> credit release -> undo -> reinstate, under redelivery and real
 * PostgreSQL concurrency (#9183 scenario 5, customer_groups half; inherited #8268 blocker).
 * The promotions half lives in
 * `promotions/subscribers/__tests__/order-usage-lifecycle-undo-redelivery.integration.test.ts`.
 *
 * Sales emits `sales.order.deleted` after `sales.orders.delete` commits (a hard delete,
 * `em.remove`), and its undo (`undoOrderGraph` -> `restoreOrderGraph`) recreates the row and
 * emits `sales.order.confirmed`. Both events are `persistent`, so either can arrive late,
 * twice, or interleaved with the other. The real subscribers under test,
 * `order-deleted-credit-release.ts` (-> `handleOrderCreditRelease`) and
 * `order-confirmed-credit-reinstate.ts`, guard that with:
 * - one `pg_advisory_xact_lock('customer_groups_credit_lifecycle:<orderId>')` around each
 *   whole check-then-act pass, so a release and a reinstate for the same order never
 *   interleave;
 * - stale-event fences reading the order's CURRENT row (a delete release skips an order that
 *   exists again; a reinstate skips an order that is gone or cancelled);
 * - the deterministic reinstate key `reinstate:<reserve key>`, so a duplicate confirmation
 *   reserves once.
 *
 * What is REAL: both subscriber handlers (their default exports, as the event dispatcher
 * calls them), `CustomerCreditService` (`reserveCredit`, `linkCreditReservationToOrder`,
 * `releaseCredit`, `getAccountExposure`) with its real customer-group terms resolution, and
 * real PostgreSQL with independent pooled connections. The fixture reservation itself is
 * written through the real `reserveCredit` + `linkCreditReservationToOrder`, exactly as
 * checkout's submit does.
 *
 * What is a STAND-IN, and why: `sales_orders`, as a table with the columns the subscribers
 * read (`id`, `tenant_id`, `organization_id`, `status`). They reach sales only through raw
 * `select … from sales_orders`, never the sales ORM (cross-module rule), so the sales side's
 * whole observable effect on them is "the row exists with this status, or it does not".
 * Driving `sales/commands/documents.ts` itself would add its full entity graph without
 * changing what these subscribers can observe. Precedent:
 * `order-credit-lifecycle-race.pg.test.ts`. Event delivery is driven by the test (calling
 * the handlers, possibly twice or concurrently), which is what lets each interleaving be
 * pinned instead of left to dispatcher timing.
 *
 * Gated on OM_CUSTOMER_GROUPS_PG_URL (the `test:pg-concurrency` CI job), a throwaway
 * database: the suite refreshes its own schema.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Entity, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import {
  CustomerCreditAccount,
  CustomerCreditLedgerEntry,
  CustomerGroup,
  CustomerGroupMembership,
  CustomerGroupTerms,
  CustomerPurchaseApproval,
} from '../../data/entities'
import { createCustomerCreditService } from '../../services/customerCreditService'
import handleOrderDeleted from '../order-deleted-credit-release'
import handleOrderConfirmed from '../order-confirmed-credit-reinstate'

@Entity({ tableName: 'sales_orders' })
class SalesOrderStandIn {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  status!: string
}

const PG_URL = process.env.OM_CUSTOMER_GROUPS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const CURRENCY = 'USD'
const ORDER_AMOUNT = '100.00'
const POLL_INTERVAL_MS = 20
const WAIT_TIMEOUT_MS = 10_000

type OnAccountOrder = {
  tenantId: string
  organizationId: string
  orderId: string
  orderNumber: string
  accountId: string
  reserveKey: string
}

type OrderEventPayload = {
  id: string
  orderId: string
  orderNumber: string
  tenantId: string
  organizationId: string
  previousStatus?: string | null
  status?: string
}

type LedgerLine = { entryType: string; amount: number; idempotencyKey: string; linkedOrderId: string | null }

type HeldRowLock = { holderPid: number; release: () => Promise<void> }

maybe('sales order delete -> credit release -> undo -> reinstate under redelivery (#9183 scenario 5, credit)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      contextName: 'customer-groups-credit-lifecycle-undo',
      entities: [
        CustomerGroup,
        CustomerGroupMembership,
        CustomerGroupTerms,
        CustomerCreditAccount,
        CustomerCreditLedgerEntry,
        CustomerPurchaseApproval,
        SalesOrderStandIn,
      ],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 12 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  // What the event dispatcher hands a subscriber: a resolver over the request container.
  function subscriberCtx() {
    return {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return orm.em as unknown as T
        throw new Error(`[internal] not registered: ${name}`)
      },
    }
  }

  // An on-account order as checkout leaves it: a confirmed order row, and a credit
  // reservation made through `reserveCredit` and linked to the order.
  async function seedOnAccountOrder(): Promise<OnAccountOrder> {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const orderId = randomUUID()
    const customerId = randomUUID()
    const em = orm.em.fork()
    const group = em.create(CustomerGroup, {
      tenantId,
      code: 'on-account',
      name: 'On-account buyers',
      kind: 'b2b',
      priority: 0,
      isDefault: true,
      isActive: true,
    })
    em.persist(group)
    await em.flush()
    const account = em.create(CustomerCreditAccount, {
      tenantId,
      organizationId,
      customerId,
      currencyCode: CURRENCY,
      creditLimit: '1000.00',
    })
    em.persist([
      em.create(CustomerGroupTerms, { tenantId, groupId: group.id, allowPurchaseOnAccount: true }),
      account,
      em.create(SalesOrderStandIn, { id: orderId, tenantId, organizationId, status: 'confirmed' }),
    ])
    await em.flush()

    const scope = { tenantId, organizationId }
    const reserveKey = `checkout:${randomUUID()}`
    const credit = createCustomerCreditService(orm.em.fork())
    const reserved = await credit.reserveCredit({
      scope,
      buyer: { customerId },
      currencyCode: CURRENCY,
      amount: ORDER_AMOUNT,
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: reserveKey,
    })
    if (!reserved.reserved) throw new Error(`[internal] fixture reservation refused: ${reserved.check.reason}`)
    await createCustomerCreditService(orm.em.fork()).linkCreditReservationToOrder({ scope, idempotencyKey: reserveKey, orderId })
    return { tenantId, organizationId, orderId, orderNumber: `SO-${orderId.slice(0, 8)}`, accountId: account.id, reserveKey }
  }

  function eventPayload(order: OnAccountOrder, extra: Partial<OrderEventPayload> = {}): OrderEventPayload {
    return {
      id: order.orderId,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      ...extra,
    }
  }

  // `sales.orders.delete` committed: the row is gone; `sales.order.deleted` is queued.
  async function deleteOrder(order: OnAccountOrder): Promise<OrderEventPayload> {
    await orm.em.fork().nativeDelete(SalesOrderStandIn, { id: order.orderId })
    return eventPayload(order)
  }

  // The delete's undo committed: the row is back as confirmed; `restoreOrderGraph` queues
  // `sales.order.confirmed` with `previousStatus: null` (a from-scratch recreate).
  async function undoDelete(order: OnAccountOrder): Promise<OrderEventPayload> {
    const em = orm.em.fork()
    em.persist(em.create(SalesOrderStandIn, { id: order.orderId, tenantId: order.tenantId, organizationId: order.organizationId, status: 'confirmed' }))
    await em.flush()
    return eventPayload(order, { previousStatus: null, status: 'confirmed' })
  }

  async function exposure(order: OnAccountOrder): Promise<number> {
    const view = await createCustomerCreditService(orm.em.fork()).getAccountExposure({
      creditAccountId: order.accountId,
      scope: { tenantId: order.tenantId, organizationId: order.organizationId },
    })
    return Number(view.exposure)
  }

  async function ledger(order: OnAccountOrder): Promise<LedgerLine[]> {
    const entries = await orm.em.fork().find(
      CustomerCreditLedgerEntry,
      { tenantId: order.tenantId, creditAccountId: order.accountId },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    )
    return entries.map((entry) => ({
      entryType: entry.entryType,
      amount: Number(entry.amount),
      idempotencyKey: entry.idempotencyKey,
      linkedOrderId: entry.linkedOrderId ?? null,
    }))
  }

  async function holdRowLock(table: 'customer_credit_accounts', id: string): Promise<HeldRowLock> {
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

  async function pollUntil(description: string, condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`[internal] timed out waiting for ${description}`)
  }

  async function countSessionsBlockedBy(holderPid: number): Promise<number> {
    const rows = await orm.em.fork().execute<Array<{ waiting: number }>>(
      'select count(*)::int as waiting from pg_stat_activity where ?::int = any(pg_blocking_pids(pid))',
      [holderPid],
    )
    return rows[0]?.waiting ?? 0
  }

  async function countLifecycleLockWaiters(orderId: string): Promise<number> {
    const rows = await orm.em.fork().execute<Array<{ waiting: number }>>(
      `select count(*)::int as waiting from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'
         and position(? in query) > 0`,
      [`customer_groups_credit_lifecycle:${orderId}`],
    )
    return rows[0]?.waiting ?? 0
  }

  function track(promise: Promise<void>): { settled: () => boolean; done: Promise<void> } {
    let finished = false
    const done = promise.finally(() => {
      finished = true
    })
    return { settled: () => finished, done }
  }

  test('in order: delete releases the reservation, undo reinstates it once, linked to the restored order', async () => {
    const order = await seedOnAccountOrder()
    expect(await exposure(order)).toBe(100)

    await handleOrderDeleted(await deleteOrder(order), subscriberCtx())
    expect(await exposure(order)).toBe(0)

    await handleOrderConfirmed(await undoDelete(order), subscriberCtx())
    expect(await exposure(order)).toBe(100)
    expect(await ledger(order)).toEqual([
      { entryType: 'reserve', amount: 100, idempotencyKey: order.reserveKey, linkedOrderId: order.orderId },
      { entryType: 'release', amount: -100, idempotencyKey: `release:${order.reserveKey}`, linkedOrderId: null },
      { entryType: 'reserve', amount: 100, idempotencyKey: `reinstate:${order.reserveKey}`, linkedOrderId: order.orderId },
    ])
  })

  test('a delete redelivered after the undo restored the order does not release the reinstated reservation', async () => {
    const order = await seedOnAccountOrder()
    const deleted = await deleteOrder(order)
    await handleOrderDeleted(deleted, subscriberCtx())
    await handleOrderConfirmed(await undoDelete(order), subscriberCtx())
    const beforeRedelivery = await ledger(order)

    await handleOrderDeleted(deleted, subscriberCtx())

    expect(await exposure(order)).toBe(100)
    expect(await ledger(order)).toEqual(beforeRedelivery)
  })

  test('a delete first delivered only after the undo leaves the original reservation alone', async () => {
    const order = await seedOnAccountOrder()
    const deleted = await deleteOrder(order)
    await handleOrderConfirmed(await undoDelete(order), subscriberCtx())

    await handleOrderDeleted(deleted, subscriberCtx())

    expect(await exposure(order)).toBe(100)
    expect((await ledger(order)).map((line) => line.entryType)).toEqual(['reserve'])
  })

  test('duplicate confirmations, sequential and concurrent, reinstate the reservation exactly once', async () => {
    const order = await seedOnAccountOrder()
    await handleOrderDeleted(await deleteOrder(order), subscriberCtx())
    const confirmed = await undoDelete(order)

    await handleOrderConfirmed(confirmed, subscriberCtx())
    await handleOrderConfirmed(confirmed, subscriberCtx())
    await Promise.all([handleOrderConfirmed(confirmed, subscriberCtx()), handleOrderConfirmed(confirmed, subscriberCtx())])

    expect(await exposure(order)).toBe(100)
    expect((await ledger(order)).filter((line) => line.idempotencyKey === `reinstate:${order.reserveKey}`)).toHaveLength(1)
  })

  test('a confirmation redelivered after the order was deleted again does not re-reserve credit', async () => {
    const order = await seedOnAccountOrder()
    await handleOrderDeleted(await deleteOrder(order), subscriberCtx())
    const confirmed = await undoDelete(order)
    await handleOrderConfirmed(confirmed, subscriberCtx())
    await handleOrderDeleted(await deleteOrder(order), subscriberCtx())
    expect(await exposure(order)).toBe(0)

    await handleOrderConfirmed(confirmed, subscriberCtx())

    expect(await exposure(order)).toBe(0)
  })

  test('a release still running when the undo lands makes the reinstate wait, and the reinstate then restores the hold', async () => {
    const order = await seedOnAccountOrder()
    const deleted = await deleteOrder(order)

    // `releaseCredit` row-locks the credit account; holding it parks the release handler
    // inside its lifecycle-locked transaction, after it saw the order deleted.
    const accountLock = await holdRowLock('customer_credit_accounts', order.accountId)
    const release = track(handleOrderDeleted(deleted, subscriberCtx()))
    let reinstate: ReturnType<typeof track> | null = null
    try {
      await pollUntil('the release to block on the credit account', async () => release.settled() || (await countSessionsBlockedBy(accountLock.holderPid)) >= 1)
      expect(release.settled()).toBe(false)

      reinstate = track(handleOrderConfirmed(await undoDelete(order), subscriberCtx()))
      const pendingReinstate = reinstate
      await pollUntil('the reinstate to wait on the lifecycle lock', async () => pendingReinstate.settled() || (await countLifecycleLockWaiters(order.orderId)) >= 1)
      expect(reinstate.settled()).toBe(false)
    } finally {
      await accountLock.release()
      await Promise.allSettled([release.done, reinstate?.done])
    }
    await release.done
    if (!reinstate) throw new Error('[internal] the reinstate was never started')
    await reinstate.done

    expect(await exposure(order)).toBe(100)
    expect((await ledger(order)).map((line) => [line.entryType, line.idempotencyKey])).toEqual([
      ['reserve', order.reserveKey],
      ['release', `release:${order.reserveKey}`],
      ['reserve', `reinstate:${order.reserveKey}`],
    ])
  })

  // KNOWN DEFECT, reported on #9183 (tests only here, no fix). Both credit lifecycle handlers
  // read `sales_orders` through `tx.getConnection().execute(...)`, which runs on a SECOND
  // pooled connection, not the transaction holding the lifecycle lock (backend pids differ).
  // A handler therefore holds one connection while waiting for another: with as many
  // concurrent deliveries as pool connections, every one of them can be parked waiting for
  // a second connection that never frees up, the #8414 starvation shape. The promotions
  // reinstate handler was moved off this pattern ("read on the lock transaction's own
  // connection"); these two were not. Same standard as
  // `availability/lib/__tests__/reservationCommands.pool-exhaustion.integration.test.ts`: a
  // pool of exactly the concurrency, every delivery must still complete. `test.failing`
  // passes while the defect exists; flip it to `test` with the fix.
  const TIGHT_POOL = 3

  // Deterministic starvation: the test first holds every order's lifecycle lock from its own
  // pool, so each handler parks on `pg_advisory_xact_lock` while already holding its
  // transaction connection. Once all of them are parked the tight pool is full; only then
  // are the locks released, and each handler's next step needs a second connection.
  async function deliverWithLifecycleLocksPreheld(orderIds: string[], deliver: () => Promise<Array<PromiseSettledResult<void>>>): Promise<Array<PromiseSettledResult<void>>> {
    let signalAcquired: () => void = () => undefined
    let signalRelease: () => void = () => undefined
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve
    })
    const releaseRequested = new Promise<void>((resolve) => {
      signalRelease = resolve
    })
    const holding = orm.em.fork().transactional(async (trx) => {
      for (const orderId of orderIds) {
        await trx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`customer_groups_credit_lifecycle:${orderId}`])
      }
      signalAcquired()
      await releaseRequested
    })
    await Promise.race([acquired, holding])
    let delivered: Promise<Array<PromiseSettledResult<void>>> | null = null
    try {
      delivered = deliver()
      await pollUntil('every delivery to park on its lifecycle lock', async () => {
        const waiting = await Promise.all(orderIds.map((orderId) => countLifecycleLockWaiters(orderId)))
        return waiting.every((count) => count >= 1)
      })
    } finally {
      signalRelease()
      await holding
    }
    return delivered
  }

  async function withTightPool(work: (ctx: ReturnType<typeof subscriberCtx>) => Promise<void>): Promise<void> {
    const tight = await MikroORM.init({
      clientUrl: orm.config.get('clientUrl'),
      contextName: 'customer-groups-credit-lifecycle-tight-pool',
      entities: orm.config.get('entities'),
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: TIGHT_POOL },
      driverOptions: { connectionTimeoutMillis: 1_500 },
    })
    try {
      await work({
        resolve: <T,>(name: string): T => {
          if (name === 'em') return tight.em as unknown as T
          throw new Error(`[internal] not registered: ${name}`)
        },
      })
    } finally {
      await tight.close(true)
    }
  }

  async function seedOnAccountOrders(count: number): Promise<OnAccountOrder[]> {
    const orders: OnAccountOrder[] = []
    for (let index = 0; index < count; index += 1) orders.push(await seedOnAccountOrder())
    return orders
  }

  test.failing(`${TIGHT_POOL} concurrent delete releases for different orders all complete on a pool of ${TIGHT_POOL} connections`, async () => {
    const orders = await seedOnAccountOrders(TIGHT_POOL)
    const deletions = await Promise.all(orders.map((order) => deleteOrder(order)))

    await withTightPool(async (ctx) => {
      const outcomes = await deliverWithLifecycleLocksPreheld(
        orders.map((order) => order.orderId),
        () => Promise.allSettled(deletions.map((payload) => handleOrderDeleted(payload, ctx))),
      )
      expect(outcomes.map((outcome) => outcome.status)).toEqual(orders.map(() => 'fulfilled'))
    })

    for (const order of orders) expect(await exposure(order)).toBe(0)
  })

  test.failing(`${TIGHT_POOL} concurrent reinstates for different orders all complete on a pool of ${TIGHT_POOL} connections`, async () => {
    const orders = await seedOnAccountOrders(TIGHT_POOL)
    const confirmations: OrderEventPayload[] = []
    for (const order of orders) {
      await handleOrderDeleted(await deleteOrder(order), subscriberCtx())
      confirmations.push(await undoDelete(order))
    }

    await withTightPool(async (ctx) => {
      const outcomes = await deliverWithLifecycleLocksPreheld(
        orders.map((order) => order.orderId),
        () => Promise.allSettled(confirmations.map((payload) => handleOrderConfirmed(payload, ctx))),
      )
      expect(outcomes.map((outcome) => outcome.status)).toEqual(orders.map(() => 'fulfilled'))
    })

    for (const order of orders) expect(await exposure(order)).toBe(100)
  })
})
