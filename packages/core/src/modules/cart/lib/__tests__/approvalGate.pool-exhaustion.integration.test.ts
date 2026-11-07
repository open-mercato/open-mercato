import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as customerGroupsEntities from '@open-mercato/core/modules/customer_groups/data/entities'
import { resolveCartRequiresApproval } from '../approvalGate'
import type { CartForApprovalGate } from '../approvalGate'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

/**
 * BLOCKER regression (TC-CART-CONC-05, CI-reproduced): `resolveCartRequiresApproval` used
 * to always resolve `customerGroupsService` from the DI container, which is bound to the
 * per-REQUEST root `em` (`customer_groups/di.ts`) — a different pooled Postgres connection
 * than a caller's own forked, transaction-bound `em`. Called while `cart.lines.add` already
 * holds a long-lived `pg_advisory_xact_lock` on its own connection, this forced EVERY
 * concurrent caller's "winner" to request a SECOND pooled connection while every OTHER
 * caller is blocked waiting on the same lock (holding ITS OWN connection hostage) — with a
 * small pool this deadlocks outright: the winner's second-connection request can never be
 * satisfied, because no connection ever frees (the blocked callers only release theirs once
 * the winner's transaction commits, which the winner itself can never do).
 *
 * Reproduced here with a real Postgres (via testcontainers, not a mocked EntityManager) and
 * a pool sized to exactly the number of concurrent callers, so there is categorically no
 * spare connection for a second query — the same shape 20-concurrent-`lines.add` has against
 * a real deployment's pool, just scaled down for a fast, deterministic test.
 */
describeWithPostgres('cart approval-gate recompute under per-cart lock contention (BLOCKER TC-CART-CONC-05)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  const CONCURRENCY = 4

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] approval-gate pool test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'cart_test', POSTGRES_PASSWORD: 'cart_test', POSTGRES_DB: 'cart_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      contextName: 'cart-approval-gate',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'cart_test',
      password: 'cart_test',
      dbName: 'cart_test',
      entities: [...Object.values(customerGroupsEntities)],
      // Exactly `CONCURRENCY` connections — zero spare for any second query. The old,
      // container-resolved-service path needed a second connection per concurrent caller;
      // this pool size makes that unavailable by construction.
      pool: { min: 0, max: CONCURRENCY },
      driverOptions: { connectionTimeoutMillis: 1_500 },
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

  /**
   * Seeds a default `CustomerGroup` with `approvalRequiredAbove` terms so `resolveTerms`
   * does real, non-trivial work (membership lookup → default-group fallback → terms read)
   * rather than short-circuiting on an absent service — proving the full call chain
   * actually executes under contention, not just that the function returns.
   */
  async function seedDefaultGroupWithApprovalThreshold(tenantId: string): Promise<void> {
    const em = database().em.fork()
    const group = em.create(customerGroupsEntities.CustomerGroup, {
      tenantId,
      code: `default-${tenantId}`,
      name: 'Default',
      kind: 'b2c',
      priority: 0,
      isDefault: true,
    })
    em.persist(group)
    await em.flush()
    em.persist(em.create(customerGroupsEntities.CustomerGroupTerms, {
      tenantId,
      groupId: group.id,
      approvalRequiredAbove: '100.00',
      termsCurrencyCode: 'USD',
    }))
    await em.flush()
  }

  function makeCart(tenantId: string): CartForApprovalGate {
    return {
      tenantId,
      organizationId: randomUUID(),
      customerId: null,
      customerIds: [],
      currencyCode: 'USD',
    }
  }

  /** A per-cart lock key distinct per test, so a stuck connection from one test can never
   * block another's lock acquisition. */
  function lockKeyFor(cartId: string): string {
    return `cart:lines:${cartId}`
  }

  it('the FIX (passing the transactional em) lets every concurrent lock-holder recompute the gate with zero spare connections', async () => {
    const tenantId = randomUUID()
    await seedDefaultGroupWithApprovalThreshold(tenantId)
    const cartId = randomUUID()

    const run = async (): Promise<boolean> => {
      const em = database().em.fork()
      await em.begin()
      try {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
        // The fix: pass THIS transaction's own `em` — no second connection is ever
        // requested, so this never contends with the other concurrent lock-holders'
        // own, already-fully-consumed connections.
        const requiresApproval = await resolveCartRequiresApproval(
          { resolve: () => { throw new Error('[internal] container must not be used when options.em is supplied') } },
          makeCart(tenantId),
          150,
          { em },
        )
        await em.commit()
        return requiresApproval
      } catch (err) {
        await em.rollback()
        throw err
      }
    }

    const results = await Promise.all(Array.from({ length: CONCURRENCY }, run))
    expect(results).toEqual(Array.from({ length: CONCURRENCY }, () => true))
  }, 20_000)

  it('the OLD behavior (container-bound root em) exhausts the pool and at least one concurrent caller fails', async () => {
    const tenantId = randomUUID()
    await seedDefaultGroupWithApprovalThreshold(tenantId)
    const cartId = randomUUID()

    const run = async (): Promise<boolean> => {
      // A genuinely SEPARATE root `em`, same shape as a fresh per-request root em bound to
      // `customerGroupsService` in a real DI container (`customer_groups/di.ts`) — NOT the
      // same connection as the transactional `em` below, reproducing the exact "second
      // connection" the BLOCKER names.
      const rootEm = database().em.fork()
      // Bind the real service to the SEPARATE root em, mirroring `customer_groups/di.ts`'s
      // own `asFunction((cradle) => createCustomerGroupsService(cradle.em, ...))`.
      const { createCustomerGroupsService } = await import('@open-mercato/core/modules/customer_groups/services/customerGroupsService')
      const service = createCustomerGroupsService(rootEm)
      const container = {
        resolve: <T = unknown>(name: string): T => {
          if (name === 'customerGroupsService') return service as unknown as T
          if (name === 'baseCurrencyService') return null as unknown as T
          throw new Error(`[internal] unexpected DI token ${name}`)
        },
      }

      const em = database().em.fork()
      await em.begin()
      try {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
        // The old path: no `options.em` — resolves the container-bound service, which
        // queries through `rootEm`, a DIFFERENT connection than the one this transaction
        // already holds.
        const requiresApproval = await resolveCartRequiresApproval(container, makeCart(tenantId), 150)
        await em.commit()
        return requiresApproval
      } catch (err) {
        await em.rollback().catch(() => undefined)
        throw err
      }
    }

    const outcomes = await Promise.allSettled(Array.from({ length: CONCURRENCY }, run))
    // Exactly the symptom TC-CART-CONC-05 observed at the HTTP layer: with the pool fully
    // consumed by concurrent lock-holders, at least one caller cannot obtain its second
    // connection and fails — the deadlock the fix (above) closes.
    expect(outcomes.some((outcome) => outcome.status === 'rejected')).toBe(true)
  }, 20_000)
})
