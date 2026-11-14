import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as customerGroupsEntities from '@open-mercato/core/modules/customer_groups/data/entities'
import * as currenciesEntities from '@open-mercato/core/modules/currencies/data/entities'
import { BaseCurrencyService } from '@open-mercato/core/modules/currencies/services/baseCurrencyService'
import { resolveCartRequiresApproval } from '../approvalGate'
import type { CartForApprovalGate } from '../approvalGate'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

/**
 * BLOCKER regression follow-up (TC-CART-CONC-05's second, un-closed call site): the first
 * pool-exhaustion fix (`approvalGate.pool-exhaustion.integration.test.ts`) threads the
 * caller's transactional `em` into `customerGroupsService`, but `resolveTerms`'s own D-R5-37
 * base-currency fallback (`applyTermsCurrencyFallback`, `customerGroupsService.ts`) still
 * read `baseCurrencyService` off the DI container — bound to a SEPARATE, request-root `em`
 * — whenever every group in the chain left `termsCurrencyCode` `null` (the common/default
 * case, not a rare one: `tenantDefaultTerms()` defaults it to `null`, only an explicit
 * per-group override changes that). Called while already holding a per-cart
 * `pg_advisory_xact_lock`, that is the EXACT same "needs a second pooled connection while
 * every other concurrent caller is blocked holding its own" deadlock shape the first fix
 * closed for `customerGroupsService` itself — just one call deeper.
 *
 * This suite's fixture deliberately seeds `CustomerGroupTerms` WITHOUT an explicit
 * `termsCurrencyCode` (unlike the first pool-exhaustion suite's fixture, which sets it to
 * `'USD'` and therefore never reaches `applyTermsCurrencyFallback`'s `baseCurrencyService`
 * read at all) — so the fallback path actually executes under lock contention here.
 */
describeWithPostgres('cart approval-gate base-currency fallback under per-cart lock contention (BLOCKER follow-up)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  const CONCURRENCY = 4

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] base-currency fallback pool test ORM is not initialized')
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
      contextName: 'cart-approval-gate-base-currency',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'cart_test',
      password: 'cart_test',
      dbName: 'cart_test',
      entities: [...Object.values(customerGroupsEntities), ...Object.values(currenciesEntities)],
      // Exactly `CONCURRENCY` connections — zero spare for any second query, same
      // construction as the first pool-exhaustion suite.
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

  /** Deliberately omits `termsCurrencyCode` so it stays `null` after the group-chain pass —
   * the fixture gap the order flagged in the original suite. */
  async function seedDefaultGroupWithoutCurrencyOverride(tenantId: string): Promise<void> {
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
    }))
    await em.flush()
  }

  async function seedOrgBaseCurrency(tenantId: string, organizationId: string, code: string): Promise<void> {
    const em = database().em.fork()
    em.persist(em.create(currenciesEntities.Currency, {
      tenantId,
      organizationId,
      code,
      name: code,
      isBase: true,
    }))
    await em.flush()
  }

  function makeCart(tenantId: string, organizationId: string): CartForApprovalGate {
    return {
      tenantId,
      organizationId,
      customerId: null,
      customerIds: [],
      currencyCode: 'USD',
    }
  }

  function lockKeyFor(cartId: string): string {
    return `cart:lines:${cartId}`
  }

  it('the FIX (threading the transactional em into baseCurrencyServiceFactory too) lets every concurrent lock-holder resolve the fallback with zero spare connections', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    await seedDefaultGroupWithoutCurrencyOverride(tenantId)
    // The org's base currency differs from the cart's own ('USD') so a successful fallback
    // resolution is observable: `computeRequiresApproval` returns `true` on the resulting
    // currency mismatch regardless of `goodsGrossAmount`, proving the fallback actually ran
    // (not silently skipped) rather than just that the call didn't throw.
    await seedOrgBaseCurrency(tenantId, organizationId, 'EUR')
    const cartId = randomUUID()

    const container = {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'baseCurrencyServiceFactory') {
          return ((em: EntityManager) => new BaseCurrencyService(em)) as unknown as T
        }
        throw new Error(`[internal] container must not resolve a connection-bound token (${name}) when options.em is supplied`)
      },
    }

    const run = async (): Promise<boolean> => {
      const em = database().em.fork()
      await em.begin()
      try {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
        // The fix: the base-currency fallback's own query runs on THIS transaction's own
        // `em` (via `baseCurrencyServiceFactory`), never a second pooled connection.
        const requiresApproval = await resolveCartRequiresApproval(
          container,
          makeCart(tenantId, organizationId),
          1,
          { em },
        )
        await em.commit()
        return requiresApproval
      } catch (err) {
        await em.rollback().catch(() => undefined)
        throw err
      }
    }

    const results = await Promise.all(Array.from({ length: CONCURRENCY }, run))
    expect(results).toEqual(Array.from({ length: CONCURRENCY }, () => true))
  }, 20_000)

  it('the OLD behavior (container-bound root em for baseCurrencyService) exhausts the pool and at least one concurrent caller fails', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    await seedDefaultGroupWithoutCurrencyOverride(tenantId)
    await seedOrgBaseCurrency(tenantId, organizationId, 'EUR')
    const cartId = randomUUID()

    const run = async (): Promise<boolean> => {
      // A genuinely SEPARATE root `em`, same shape as a fresh per-request root em bound to
      // `baseCurrencyService` in a real DI container (`currencies/di.ts`'s own
      // `baseCurrencyService: { resolve: (c) => new BaseCurrencyService(c.resolve('em')) }`)
      // — NOT the same connection as the transactional `em` below.
      const rootEm = database().em.fork()
      const { createCustomerGroupsService } = await import(
        '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
      )

      const em = database().em.fork()
      await em.begin()
      try {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
        // The old path: `customerGroupsService` already bound to THIS transaction's own
        // `em` (the first fix), but `baseCurrencyService` still bound to the SEPARATE root
        // em — the exact residual gap this suite's fix closes.
        const service = createCustomerGroupsService(em, new BaseCurrencyService(rootEm))
        const terms = await service.resolveTerms({
          customerId: null,
          customerIds: [],
          tenantId,
          organizationId,
        })
        await em.commit()
        return terms.termsCurrencyCode === 'EUR'
      } catch (err) {
        await em.rollback().catch(() => undefined)
        throw err
      }
    }

    const outcomes = await Promise.allSettled(Array.from({ length: CONCURRENCY }, run))
    // `BaseCurrencyService.resolveBaseCurrency()` catches its own connection failure and
    // degrades to `{ status: 'unavailable' }` rather than throwing (its own documented
    // resilience contract, `baseCurrencyService.ts`) — so under the OLD binding, pool
    // exhaustion never surfaces as a rejected promise here. It surfaces as a SILENT
    // correctness failure instead: at least one concurrent caller can't get its second
    // connection in time and falls back to `termsCurrencyCode: null` instead of the
    // seeded base currency — exactly the symptom TC-CART-CONC-05 reproduces one call
    // deeper, just degraded instead of crashed.
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    const resolvedCount = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value === true,
    ).length
    expect(resolvedCount).toBeLessThan(CONCURRENCY)
  }, 20_000)
})
