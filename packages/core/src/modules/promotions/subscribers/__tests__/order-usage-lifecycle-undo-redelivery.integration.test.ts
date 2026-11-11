/**
 * Sales order delete -> promotion/code usage revert -> undo -> reinstate, under redelivery
 * and real PostgreSQL concurrency, including the blocked-reinstatement refusal (#9183
 * scenario 5, promotions half; inherited #8268 blocker). The credit half lives in
 * `customer_groups/subscribers/__tests__/order-credit-lifecycle-undo-redelivery.pg.test.ts`.
 *
 * Sales emits `sales.order.deleted` after `sales.orders.delete` commits (a hard delete) and
 * `sales.order.confirmed` after the delete's undo recreates the order. The real subscribers
 * under test, `order-deleted-usage-revert.ts` (-> `handleOrderUsageRevert`) and
 * `order-confirmed-usage-reinstate.ts`, guard redelivery and races with:
 * - one `pg_advisory_xact_lock('promotions_usage_lifecycle:<orderId>')` around each whole
 *   check-then-act pass;
 * - stale-event fences on the order's CURRENT row (a delete revert skips an order that
 *   exists again; a reinstate skips an order that is gone or cancelled);
 * - `reinstateUsage`/`reinstateCodeUse` touching only rows still marked `revertedAt`;
 * - when a reinstatement is refused (a single-use code redeemed by another order in the
 *   meantime), cancelling the order through `sales.orders.update` with a
 *   `beforeTransactionalWrite` fence: inside the sales transaction, after the order row is
 *   locked, the fence takes the same lifecycle lock and re-checks that the order status is
 *   unchanged and that reverted usage remains, rolling the cancel back otherwise.
 *
 * What is REAL: both subscriber handlers (their default exports, as the event dispatcher
 * calls them, with a bare `{ resolve }` context), `PromotionUsageService` and
 * `PromotionCodeService` (the fixtures' usage is written through their real `registerUsage`
 * and `useCode`), the real `CommandBus` the refusal dispatches through, the real promotions
 * and dictionaries tables, and real PostgreSQL with independent pooled connections.
 *
 * What is a STAND-IN, and why:
 * - `sales_orders`: a table with the columns the subscribers read (`id`, `tenant_id`,
 *   `organization_id`, `status`). Promotions reaches sales only through raw
 *   `select … from sales_orders` and the `sales.orders.update` command (cross-module rule),
 *   so "the row exists with this status, or it does not" is all the sales side shows it.
 *   Precedent: `customer_groups/subscribers/__tests__/order-credit-lifecycle-race.pg.test.ts`.
 * - `sales.orders.update`: a command registered under the real id that keeps the real
 *   handler's transaction contract (`sales/commands/documents.ts#updateOrderCommand`): one
 *   `withAtomicFlush({ transaction: true })`, row-lock the order, call
 *   `ctx.beforeTransactionalWrite(em, input)`, resolve `statusEntryId` through the real
 *   dictionary, write the status, and only after commit emit `sales.order.cancelled`
 *   (recorded here for the test to deliver). The real handler would add the sales entity
 *   graph, totals and notes, none of which the fence reads or the subscribers observe.
 * Event delivery is driven by the test (calling handlers, possibly twice or concurrently),
 * which is what lets each interleaving be pinned instead of left to dispatcher timing.
 *
 * Runs in the `test:pg-integration` CI job (`OM_PG_INTEGRATION=1`, own disposable Postgres
 * container), or against a throwaway database named by `OM_PROMOTIONS_PG_URL`.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import {
  CommandBus,
  registerCommand,
  type CommandExecuteResult,
  type CommandExecutionOptions,
  type CommandHandler,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Dictionary, DictionaryEntry } from '../../../dictionaries/data/entities'
import {
  Benefit,
  Code,
  CodeReservation,
  CodeUsage,
  GeneratedCode,
  Promotion,
  PromotionUsage,
  Rule,
  RuleGroup,
} from '../../data/entities'
import { PromotionUsageService } from '../../lib/promotion-usage-service'
import { PromotionCodeService } from '../../lib/code-service'
import handleOrderDeleted from '../order-deleted-usage-revert'
import handleOrderCancelled from '../order-cancelled-usage-revert'
import handleOrderConfirmed from '../order-confirmed-usage-reinstate'

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

const EXPLICIT_URL = process.env.OM_PROMOTIONS_PG_URL ?? ''
const describeWithPostgres = Boolean(EXPLICIT_URL) || process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CURRENCY = 'USD'
const POLL_INTERVAL_MS = 20
const WAIT_TIMEOUT_MS = 10_000

type OrderEventPayload = {
  id: string
  orderId: string
  orderNumber: string
  tenantId: string
  organizationId: string
  previousStatus?: string | null
  status?: string
}

type PromotedOrder = {
  tenantId: string
  organizationId: string
  orderId: string
  promotionId: string
  codeId: string
}

type Pause = { reached: Promise<void>; release: () => void }

class PauseRegistry {
  private readonly armed = new Map<string, Array<{ signalReached: () => void; released: Promise<void>; release: () => void }>>()
  private readonly issued: Array<() => void> = []

  arm(name: string): Pause {
    let signalReached: () => void = () => undefined
    let release: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = this.armed.get(name) ?? []
    queue.push({ signalReached, released, release })
    this.armed.set(name, queue)
    this.issued.push(release)
    return { reached, release }
  }

  async pass(name: string): Promise<void> {
    const next = this.armed.get(name)?.shift()
    if (!next) return
    next.signalReached()
    await next.released
  }

  releaseAll(): void {
    for (const release of this.issued) release()
    this.issued.length = 0
    this.armed.clear()
  }
}

class PausableCommandBus extends CommandBus {
  constructor(private readonly pauses: PauseRegistry) {
    super()
  }

  override async execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    options: CommandExecutionOptions<TInput>,
  ): Promise<CommandExecuteResult<TResult>> {
    await this.pauses.pass(`before:${commandId}`)
    return super.execute<TInput, TResult>(commandId, options)
  }
}

function isCancelledStatus(status: string | null | undefined): boolean {
  return status === 'canceled' || status === 'cancelled'
}

const orderUpdateInputSchema = z.object({ id: z.string().uuid(), statusEntryId: z.string().uuid().optional() })

describeWithPostgres('sales order delete -> promotion usage revert -> undo -> reinstate under redelivery (#9183 scenario 5, promotions)', () => {
  jest.setTimeout(120_000)
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM
  let container: AwilixContainer
  const pauses = new PauseRegistry()
  const cancelledEvents: OrderEventPayload[] = []

  // Keeps `updateOrderCommand`'s own transaction contract; see the header comment.
  const salesOrdersUpdateStandIn: CommandHandler<unknown, { orderId: string }> = {
    id: 'sales.orders.update',
    isUndoable: false,
    async execute(rawInput, ctx) {
      const input = orderUpdateInputSchema.parse(rawInput)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let order: SalesOrderStandIn | null = null
      let previousStatus: string | null = null
      await withAtomicFlush(
        em,
        [
          async () => {
            order = await em.findOne(SalesOrderStandIn, { id: input.id }, { lockMode: LockMode.PESSIMISTIC_WRITE })
            if (!order) throw new CrudHttpError(404, { error: '[internal] Sales order not found' })
            await ctx.beforeTransactionalWrite?.(em, input)
            await pauses.pass('inside:sales.orders.update')
            previousStatus = order.status
            if (input.statusEntryId && !isCancelledStatus(previousStatus)) {
              const entry = await em.findOne(DictionaryEntry, { id: input.statusEntryId, tenantId: order.tenantId })
              if (!entry) throw new CrudHttpError(400, { error: '[internal] unknown status entry' })
              order.status = entry.normalizedValue
            }
          },
        ],
        { transaction: true, label: 'sales.orders.update' },
      )
      const updated = order as SalesOrderStandIn | null
      if (updated && updated.status !== previousStatus && isCancelledStatus(updated.status)) {
        cancelledEvents.push({
          id: updated.id,
          orderId: updated.id,
          orderNumber: `SO-${updated.id.slice(0, 8)}`,
          tenantId: updated.tenantId,
          organizationId: updated.organizationId,
          previousStatus,
          status: updated.status,
        })
      }
      return { orderId: input.id }
    },
  }

  beforeAll(async () => {
    let url = EXPLICIT_URL
    if (!url) {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16')
        .withEnvironment({ POSTGRES_USER: 'promotions_test', POSTGRES_PASSWORD: 'promotions_test', POSTGRES_DB: 'promotions_test' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .withStartupTimeout(60_000)
        .start()
      url = `postgres://promotions_test:promotions_test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/promotions_test`
    }
    orm = await MikroORM.init({
      clientUrl: url,
      contextName: 'promotions-usage-lifecycle-undo',
      entities: [
        Promotion,
        RuleGroup,
        Rule,
        Benefit,
        Code,
        GeneratedCode,
        CodeReservation,
        CodeUsage,
        PromotionUsage,
        Dictionary,
        DictionaryEntry,
        SalesOrderStandIn,
      ],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 16 },
    })
    await orm.schema.refresh()
    registerCommand(salesOrdersUpdateStandIn)
    container = createContainer()
    container.register({
      em: asValue(orm.em),
      commandBus: asValue(new PausableCommandBus(pauses)),
      promotionUsageService: asValue(new PromotionUsageService()),
    })
    container.register({ promotionCodeService: asValue(new PromotionCodeService(container)) })
  }, 120_000)

  afterEach(() => {
    pauses.releaseAll()
    cancelledEvents.length = 0
  })

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  // What the event dispatcher hands a subscriber: a bare resolver over the request container.
  function subscriberCtx() {
    return { resolve: <T,>(name: string): T => container.resolve<T>(name) }
  }

  function usageService(): PromotionUsageService {
    return container.resolve<PromotionUsageService>('promotionUsageService')
  }

  function codeService(): PromotionCodeService {
    return container.resolve<PromotionCodeService>('promotionCodeService')
  }

  // One order that redeemed a static code (single-use unless told otherwise) for a
  // cart-level discount, recorded through the real `registerUsage` + `useCode`, as
  // checkout's submit leaves it.
  async function seedPromotedOrder(codeLimit: { usage: 'single' } | { usage: 'multiple'; usageAmount: number } = { usage: 'single' }): Promise<PromotedOrder> {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const em = orm.em.fork()
    const now = new Date()
    const statuses = em.create(Dictionary, {
      tenantId,
      organizationId,
      key: 'sales.order_status',
      name: 'Order statuses',
      isSystem: true,
      isActive: true,
      managerVisibility: 'default',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(statuses)
    await em.flush()
    const promotion = em.create(Promotion, { tenantId, organizationId, name: 'Ten off', order: 0, active: true })
    const code = em.create(Code, { tenantId, organizationId, name: 'Launch code', type: 'static', code: `LAUNCH${randomUUID().slice(0, 6).toUpperCase()}`, ...codeLimit })
    em.persist([
      em.create(DictionaryEntry, { tenantId, organizationId, dictionary: statuses, value: 'confirmed', normalizedValue: 'confirmed', label: 'Confirmed' }),
      em.create(DictionaryEntry, { tenantId, organizationId, dictionary: statuses, value: 'canceled', normalizedValue: 'canceled', label: 'Canceled' }),
      promotion,
      code,
    ])
    await em.flush()
    const fixture = { tenantId, organizationId, orderId: randomUUID(), promotionId: promotion.id, codeId: code.id }
    await placeOrderUsingCode(fixture, fixture.orderId)
    return fixture
  }

  async function placeOrderUsingCode(fixture: PromotedOrder, orderId: string): Promise<void> {
    const em = orm.em.fork()
    em.persist(em.create(SalesOrderStandIn, { id: orderId, tenantId: fixture.tenantId, organizationId: fixture.organizationId, status: 'confirmed' }))
    await em.flush()
    const scope = { tenantId: fixture.tenantId, organizationId: fixture.organizationId }
    const customerId = randomUUID()
    await usageService().registerUsage(
      orm.em.fork(),
      {
        orderId,
        orderType: 'order',
        customerId,
        currency: CURRENCY,
        appliedPromotions: [
          {
            promotionId: fixture.promotionId,
            promotionName: 'Ten off',
            effects: [{ type: 'CART_DISCOUNT', appliesTo: 'order', currency: CURRENCY, label: { en: 'Ten off' }, amountNet: '-10.00', amountGross: '-12.30', basis: 'gross' }],
          },
        ],
      },
      scope,
    )
    const code = await orm.em.fork().findOneOrFail(Code, { id: fixture.codeId })
    await codeService().useCode(
      orm.em.fork(),
      { codeId: fixture.codeId, codeString: code.code ?? '', cartId: randomUUID(), orderId, customerId, type: 'static' },
      scope,
    )
  }

  function eventPayload(fixture: PromotedOrder, orderId: string, extra: Partial<OrderEventPayload> = {}): OrderEventPayload {
    return { id: orderId, orderId, orderNumber: `SO-${orderId.slice(0, 8)}`, tenantId: fixture.tenantId, organizationId: fixture.organizationId, ...extra }
  }

  async function deleteOrder(fixture: PromotedOrder): Promise<OrderEventPayload> {
    await orm.em.fork().nativeDelete(SalesOrderStandIn, { id: fixture.orderId })
    return eventPayload(fixture, fixture.orderId)
  }

  async function undoDelete(fixture: PromotedOrder): Promise<OrderEventPayload> {
    const em = orm.em.fork()
    em.persist(em.create(SalesOrderStandIn, { id: fixture.orderId, tenantId: fixture.tenantId, organizationId: fixture.organizationId, status: 'confirmed' }))
    await em.flush()
    return eventPayload(fixture, fixture.orderId, { previousStatus: null, status: 'confirmed' })
  }

  async function cancelOrder(fixture: PromotedOrder, orderId: string): Promise<OrderEventPayload> {
    await orm.em.fork().nativeUpdate(SalesOrderStandIn, { id: orderId }, { status: 'canceled' })
    return eventPayload(fixture, orderId, { previousStatus: 'confirmed', status: 'canceled' })
  }

  type UsageState = { promotionUsageLive: boolean; codeUsageLive: boolean }

  async function usageOf(fixture: PromotedOrder, orderId: string): Promise<UsageState> {
    const em = orm.em.fork()
    const promotionUsage = await em.findOneOrFail(PromotionUsage, { orderId, promotionId: fixture.promotionId })
    const codeUsage = await em.findOneOrFail(CodeUsage, { orderId, codeId: fixture.codeId })
    return { promotionUsageLive: promotionUsage.revertedAt == null, codeUsageLive: codeUsage.revertedAt == null }
  }

  async function codeCounter(fixture: PromotedOrder): Promise<{ used: number; active: boolean }> {
    const code = await orm.em.fork().findOneOrFail(Code, { id: fixture.codeId })
    return { used: code.used, active: code.active }
  }

  async function orderStatus(orderId: string): Promise<string | null> {
    const order = await orm.em.fork().findOne(SalesOrderStandIn, { id: orderId })
    return order?.status ?? null
  }

  async function holdRowLock(table: 'promotion_code_usages', id: string): Promise<{ holderPid: number; release: () => Promise<void> }> {
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
      [`promotions_usage_lifecycle:${orderId}`],
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

  // Cancel A, let order B redeem the freed single-use code, revive A: A's code use can no
  // longer be reinstated without overflowing the code's cap.
  async function seedRevivalWithClaimedCode(): Promise<{ fixture: PromotedOrder; otherOrderId: string; confirmed: OrderEventPayload }> {
    const fixture = await seedPromotedOrder()
    await handleOrderDeleted(await deleteOrder(fixture), subscriberCtx())
    const otherOrderId = randomUUID()
    await placeOrderUsingCode(fixture, otherOrderId)
    const confirmed = await undoDelete(fixture)
    return { fixture, otherOrderId, confirmed }
  }

  test('in order: delete reverts promotion and code usage, undo reinstates both', async () => {
    const fixture = await seedPromotedOrder()
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })

    await handleOrderDeleted(await deleteOrder(fixture), subscriberCtx())
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: false, codeUsageLive: false })
    expect(await codeCounter(fixture)).toEqual({ used: 0, active: true })

    await handleOrderConfirmed(await undoDelete(fixture), subscriberCtx())
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })
  })

  test('a delete redelivered after the undo restored the order does not revert the reinstated usage', async () => {
    const fixture = await seedPromotedOrder()
    const deleted = await deleteOrder(fixture)
    await handleOrderDeleted(deleted, subscriberCtx())
    await handleOrderConfirmed(await undoDelete(fixture), subscriberCtx())

    await handleOrderDeleted(deleted, subscriberCtx())

    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })
  })

  test('duplicate confirmations, sequential and concurrent, reinstate the code use exactly once', async () => {
    // A code with headroom: a second reinstatement would be counted, not refused at the cap.
    const fixture = await seedPromotedOrder({ usage: 'multiple', usageAmount: 5 })
    await handleOrderDeleted(await deleteOrder(fixture), subscriberCtx())
    const confirmed = await undoDelete(fixture)

    await handleOrderConfirmed(confirmed, subscriberCtx())
    await handleOrderConfirmed(confirmed, subscriberCtx())
    await Promise.all([handleOrderConfirmed(confirmed, subscriberCtx()), handleOrderConfirmed(confirmed, subscriberCtx())])

    expect(await codeCounter(fixture)).toEqual({ used: 1, active: true })
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await orderStatus(fixture.orderId)).toBe('confirmed')
  })

  test('a confirmation redelivered after the order was deleted again does not re-register usage', async () => {
    const fixture = await seedPromotedOrder()
    await handleOrderDeleted(await deleteOrder(fixture), subscriberCtx())
    const confirmed = await undoDelete(fixture)
    await handleOrderConfirmed(confirmed, subscriberCtx())
    await handleOrderDeleted(await deleteOrder(fixture), subscriberCtx())

    await handleOrderConfirmed(confirmed, subscriberCtx())

    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: false, codeUsageLive: false })
    expect(await codeCounter(fixture)).toEqual({ used: 0, active: true })
  })

  test('a revert still running when the undo lands makes the reinstate wait, and the reinstate then restores the usage', async () => {
    const fixture = await seedPromotedOrder()
    const deleted = await deleteOrder(fixture)
    const codeUsageRow = await orm.em.fork().findOneOrFail(CodeUsage, { orderId: fixture.orderId })

    // `revertCodeUse` row-locks the code-usage row; holding it parks the revert handler inside
    // its lifecycle-locked transaction, after it already reverted the promotion usage.
    const codeUsageLock = await holdRowLock('promotion_code_usages', codeUsageRow.id)
    const revert = track(handleOrderDeleted(deleted, subscriberCtx()))
    let reinstate: ReturnType<typeof track> | null = null
    try {
      await pollUntil('the revert to block on the code usage', async () => revert.settled() || (await countSessionsBlockedBy(codeUsageLock.holderPid)) >= 1)
      expect(revert.settled()).toBe(false)

      reinstate = track(handleOrderConfirmed(await undoDelete(fixture), subscriberCtx()))
      const pendingReinstate = reinstate
      await pollUntil('the reinstate to wait on the lifecycle lock', async () => pendingReinstate.settled() || (await countLifecycleLockWaiters(fixture.orderId)) >= 1)
      expect(reinstate.settled()).toBe(false)
    } finally {
      await codeUsageLock.release()
      await Promise.allSettled([revert.done, reinstate?.done])
    }
    await revert.done
    if (!reinstate) throw new Error('[internal] the reinstate was never started')
    await reinstate.done

    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })
  })

  test('a refused reinstatement cancels the revived order through the fenced sales.orders.update', async () => {
    const { fixture, otherOrderId, confirmed } = await seedRevivalWithClaimedCode()

    await handleOrderConfirmed(confirmed, subscriberCtx())

    expect(await orderStatus(fixture.orderId)).toBe('canceled')
    expect(cancelledEvents.map((event) => event.orderId)).toEqual([fixture.orderId])
    // The order's own promotion usage was reinstated in the same pass; the cancellation it
    // triggered reverts it again, so nothing stays counted for the cancelled order.
    await handleOrderCancelled(cancelledEvents[0], subscriberCtx())
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: false, codeUsageLive: false })
    expect(await usageOf(fixture, otherOrderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })
  })

  test('the refusal rolls back when the code use became reinstatable before the cancel could commit', async () => {
    const { fixture, otherOrderId, confirmed } = await seedRevivalWithClaimedCode()

    // The refusal has decided to cancel and is about to dispatch it.
    const refusalAboutToCancel = pauses.arm('before:sales.orders.update')
    const refusal = handleOrderConfirmed(confirmed, subscriberCtx())
    await refusalAboutToCancel.reached

    // Meanwhile the other order is cancelled (freeing the code) and a redelivered
    // confirmation reinstates this order's use: it is fully backed again.
    await handleOrderCancelled(await cancelOrder(fixture, otherOrderId), subscriberCtx())
    await handleOrderConfirmed(confirmed, subscriberCtx())
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })

    refusalAboutToCancel.release()
    await refusal

    expect(await orderStatus(fixture.orderId)).toBe('confirmed')
    expect(cancelledEvents).toEqual([])
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: true })
    expect(await codeCounter(fixture)).toEqual({ used: 1, active: false })
  })

  test('the refusal rolls back when the order status changed before the cancel could commit', async () => {
    const { fixture, confirmed } = await seedRevivalWithClaimedCode()

    const refusalAboutToCancel = pauses.arm('before:sales.orders.update')
    const refusal = handleOrderConfirmed(confirmed, subscriberCtx())
    await refusalAboutToCancel.reached
    // Staff put the revived order on hold in the meantime.
    await orm.em.fork().nativeUpdate(SalesOrderStandIn, { id: fixture.orderId }, { status: 'on_hold' })

    refusalAboutToCancel.release()
    await refusal

    expect(await orderStatus(fixture.orderId)).toBe('on_hold')
    expect(cancelledEvents).toEqual([])
  })

  test('a confirmation redelivered while the refusal cancel is in flight waits on the fence and then skips the cancelled order', async () => {
    const { fixture, confirmed } = await seedRevivalWithClaimedCode()

    // The cancel holds the order row and, through the fence, the lifecycle lock.
    const cancelInFlight = pauses.arm('inside:sales.orders.update')
    const refusal = track(handleOrderConfirmed(confirmed, subscriberCtx()))
    let redelivery: ReturnType<typeof track> | null = null
    try {
      await cancelInFlight.reached
      redelivery = track(handleOrderConfirmed(confirmed, subscriberCtx()))
      const pendingRedelivery = redelivery
      await pollUntil('the redelivery to wait on the lifecycle lock', async () => pendingRedelivery.settled() || (await countLifecycleLockWaiters(fixture.orderId)) >= 1)
      expect(redelivery.settled()).toBe(false)
    } finally {
      cancelInFlight.release()
      await Promise.allSettled([refusal.done, redelivery?.done])
    }
    await refusal.done
    if (!redelivery) throw new Error('[internal] the redelivery was never started')
    await redelivery.done

    expect(await orderStatus(fixture.orderId)).toBe('canceled')
    expect(cancelledEvents.map((event) => event.orderId)).toEqual([fixture.orderId])
    expect(await usageOf(fixture, fixture.orderId)).toEqual({ promotionUsageLive: true, codeUsageLive: false })
  })
})
