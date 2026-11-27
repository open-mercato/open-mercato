/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { LockMode, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { Code, CodeReservation, CodeUsage, GeneratedCode } from '../../data/entities'
import { PromotionCodeService, type PromotionCodeServiceContainer, type PromotionsCodeScope } from '../code-service'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'promotions_revert_lock_test'
const DATABASE_USER = 'promotions_revert_lock'
const DATABASE_PASSWORD = 'promotions_revert_lock'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type Seed = {
  scope: PromotionsCodeScope
  codeId: string
  cartId: string
  firstOrderId: string
  secondOrderId: string
  firstUsageId: string
  secondUsageId: string
}

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

const noDependencies: PromotionCodeServiceContainer = {
  resolve: <T>(name: string): T => {
    throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
  },
}

/**
 * Review 6019683556 finding 2: one cart, two orders, both using the same multi-use
 * static code. A cart-wide reversal (e.g. checkout compensation) and an order-only
 * reversal (e.g. an order-cancelled subscriber) overlap, each inside its own outer
 * transaction on its own connection — `withAtomicFlush` joins that transaction, so every
 * lock is held until the caller commits. Both must complete without PostgreSQL aborting
 * either as a deadlock victim, and each use must be reversed exactly once.
 */
describeWithPostgres('PromotionCodeService.revertCodeUse overlapping reversals on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const service = new PromotionCodeService(noDependencies)

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function gateAfterFirstCodeLock(target: EntityManager, gate: { reached: Deferred; release: Deferred }): EntityManager {
    let fired = false
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object)
        if (typeof value !== 'function') return value
        const bound = (value as (...args: unknown[]) => unknown).bind(object)
        if (property !== 'findOne') return bound
        return async (...args: unknown[]) => {
          const result = await bound(...args)
          const options = args[2] as { lockMode?: LockMode } | undefined
          if (!fired && args[0] === Code && options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
            fired = true
            gate.reached.resolve()
            await gate.release.promise
          }
          return result
        }
      },
    })
  }

  async function seedSharedCode(): Promise<Seed> {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const seed: Seed = {
      scope,
      codeId: randomUUID(),
      cartId: randomUUID(),
      firstOrderId: `order-${randomUUID()}`,
      secondOrderId: `order-${randomUUID()}`,
      firstUsageId: randomUUID(),
      secondUsageId: randomUUID(),
    }
    const em = rootEm()
    await em.execute(
      `insert into promotion_codes (id, organization_id, tenant_id, name, type, code, generated, used, usage, usage_amount, active, created_at, updated_at)
       values (?, ?, ?, 'Shared code', 'static', ?, 0, 2, 'multiple', 5, true, now(), now())`,
      [seed.codeId, scope.organizationId, scope.tenantId, `SHARED${seed.codeId.slice(0, 8).toUpperCase()}`],
    )
    for (const [usageId, orderId] of [[seed.firstUsageId, seed.firstOrderId], [seed.secondUsageId, seed.secondOrderId]]) {
      await em.execute(
        `insert into promotion_code_usages (id, code_id, cart_id, order_id, customer_id, organization_id, tenant_id, used_at)
         values (?, ?, ?, ?, 'customer-1', ?, ?, now())`,
        [usageId, seed.codeId, seed.cartId, orderId, scope.organizationId, scope.tenantId],
      )
    }
    return seed
  }

  async function readState(seed: Seed) {
    const em = rootEm()
    const [code] = await em.execute<Array<{ used: number; active: boolean }>>(
      'select used, active from promotion_codes where id = ?',
      [seed.codeId],
    )
    const usages = await em.execute<Array<{ id: string; reverted_at: Date | null }>>(
      'select id, reverted_at from promotion_code_usages where code_id = ? order by id',
      [seed.codeId],
    )
    return { used: code.used, active: code.active, reverted: usages.filter((row) => row.reverted_at !== null).length }
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= count) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] no transaction started waiting on a row lock within ${WAITER_TIMEOUT_MS}ms`)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: DATABASE_NAME, POSTGRES_USER: DATABASE_USER, POSTGRES_PASSWORD: DATABASE_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [Code, GeneratedCode, CodeReservation, CodeUsage],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it('serializes an order-only reversal behind a cart-wide one on the shared Code and reverts each use once', async () => {
    const seed = await seedSharedCode()
    const gate = { reached: createDeferred(), release: createDeferred() }

    const cartWide = rootEm().transactional((em) =>
      service.revertCodeUse(gateAfterFirstCodeLock(em as EntityManager, gate), { cartId: seed.cartId }, seed.scope),
    )
    await gate.reached.promise

    const orderOnly = rootEm().transactional((em) =>
      service.revertCodeUse(em as EntityManager, { orderId: seed.secondOrderId }, seed.scope),
    )
    await waitForLockWaiters(1)
    gate.release.resolve()

    const [cartWideResult, orderOnlyResult] = await Promise.all([cartWide, orderOnly])

    expect(cartWideResult).toEqual({ ok: true, revertedCount: 2 })
    expect(orderOnlyResult).toEqual({ ok: true, revertedCount: 0 })
    expect(await readState(seed)).toEqual({ used: 0, active: true, reverted: 2 })
  }, CASE_TIMEOUT_MS)

  it('completes overlapping cart-wide and order-only reversals started together without a deadlock', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const seed = await seedSharedCode()
      const results = await Promise.all([
        rootEm().transactional((em) => service.revertCodeUse(em as EntityManager, { cartId: seed.cartId }, seed.scope)),
        rootEm().transactional((em) => service.revertCodeUse(em as EntityManager, { orderId: seed.secondOrderId }, seed.scope)),
        rootEm().transactional((em) => service.revertCodeUse(em as EntityManager, { orderId: seed.firstOrderId }, seed.scope)),
      ])
      expect(results.reduce((total, result) => total + result.revertedCount, 0)).toBe(2)
      expect(await readState(seed)).toEqual({ used: 0, active: true, reverted: 2 })
    }
  }, CASE_TIMEOUT_MS)
})
