import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
} from '../../../wms/data/entities'
import { AvailabilityReservation } from '../../data/entities'
import { WmsReservationService } from '../../../wms/lib/wmsReservationService'
import { reserveAvailability, type Resolver } from '../reservationCommands'
import type { PolicyResolutionService, ResolvedAvailabilityPolicy } from '../policyResolution'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CONCURRENCY = 4

/**
 * #8414 regression (TC-CART-CONC-05's checkout-side analog): `reserveAvailability` used
 * to always fork a FRESH `container.resolve('em')` for its own `em.transactional()` work,
 * a SECOND pooled connection whenever checkout's `commands/submit.ts` was already holding
 * its own connection for the request. With `DB_POOL_MAX` sized to the request
 * concurrency (the QA-reported shape: 20 parallel checkout submits for the last unit in
 * stock against the default `DB_POOL_MAX=20`), the `FOR UPDATE` lock
 * `wmsReservationService.reserveLinesForCheckout` takes on the contended balance row then
 * serializes N concurrent callers' own forks against it — each blocked caller holding its
 * OWN connection hostage while waiting — leaving zero spare for the one caller that is
 * also mid-request on its OTHER (caller-held) connection. Reproduced here with a real
 * Postgres and a pool sized to exactly `CONCURRENCY`, so there is categorically no spare
 * connection for a second query, same shape as `approvalGate.pool-exhaustion.integration.test.ts`.
 */
describeWithPostgres('availability.reserve under per-line lock contention with a caller-held connection (BLOCKER #8414)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  let wmsService: WmsReservationService

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] availability pool test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'availability_test', POSTGRES_PASSWORD: 'availability_test', POSTGRES_DB: 'availability_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      contextName: 'availability-pool',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'availability_test',
      password: 'availability_test',
      dbName: 'availability_test',
      entities: [
        Warehouse,
        WarehouseLocation,
        InventoryLot,
        InventoryBalance,
        InventoryReservation,
        InventoryMovement,
        ProductInventoryProfile,
        AvailabilityReservation,
      ],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      // Exactly `CONCURRENCY` connections — zero spare for any second query. The old,
      // always-fork-a-fresh-em path needed a second connection per concurrent caller
      // already holding its own; this pool size makes that unavailable by construction.
      pool: { min: 0, max: CONCURRENCY },
      driverOptions: { connectionTimeoutMillis: 1_500 },
    })
    await orm.schema.create()
    wmsService = new WmsReservationService()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  function openPolicy(): ResolvedAvailabilityPolicy {
    const field = <T>(value: T) => ({ value, policySourceId: null })
    return {
      isStockManaged: field(true),
      allowBackorder: field(false),
      backorderLeadTimeDays: field(null),
      preorderReleaseAt: field(null),
      lowStockThreshold: field(null),
      minOrderQuantity: field(null),
      maxOrderQuantity: field(null),
      quantityIncrement: field(null),
      hideWhenOutOfStock: field(false),
      isActive: field(true),
    }
  }

  const policyService: PolicyResolutionService = {
    async resolve() {
      return openPolicy()
    },
    async resolveMany(_em, scopes) {
      return scopes.map(() => openPolicy())
    },
  }

  function buildContainer(): Resolver {
    return {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return database().em as unknown as T
        if (name === 'wmsReservationService') return wmsService as unknown as T
        if (name === 'policyResolutionService') return policyService as unknown as T
        throw new Error(`[internal] not registered: ${name}`)
      },
    }
  }

  /** One warehouse, one location, `quantity` units on hand for a fresh variant. */
  async function seedBalance(quantity: string): Promise<{ catalogVariantId: string }> {
    const em = database().em.fork()
    const catalogVariantId = randomUUID()
    const warehouse = em.create(Warehouse, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      name: 'Main',
      code: `WH-${randomUUID().slice(0, 8)}`,
      isActive: true,
      isPrimary: false,
    })
    em.persist(warehouse)
    await em.flush()
    const location = em.create(WarehouseLocation, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      warehouse,
      code: `LOC-${randomUUID().slice(0, 8)}`,
      type: 'bin',
      isActive: true,
    })
    em.persist(location)
    await em.flush()
    em.persist(em.create(InventoryBalance, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      warehouse,
      location,
      catalogVariantId,
      quantityOnHand: quantity,
      quantityReserved: '0',
      quantityAllocated: '0',
    }))
    await em.flush()
    return { catalogVariantId }
  }

  /** A per-request `em` already holding its own connection (an open transaction), exactly
   * the shape `commands/submit.ts`'s own forked `em` can carry into a nested
   * `availability.reserve` call. */
  async function withCallerHoldingAConnection<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const em = database().em.fork()
    await em.begin()
    try {
      const result = await fn(em)
      await em.commit()
      return result
    } catch (err) {
      await em.rollback().catch(() => undefined)
      throw err
    }
  }

  it('the FIX (threading the caller\'s own connection) lets every concurrent reserve run with zero spare connections', async () => {
    const { catalogVariantId } = await seedBalance(String(CONCURRENCY))
    const catalogProductId = randomUUID()

    const run = async (index: number): Promise<boolean> =>
      withCallerHoldingAConnection(async (em) => {
        const callerCtx = { container: buildContainer(), transactionalEm: em } as unknown as CommandRuntimeContext
        const result = await reserveAvailability(buildContainer(), {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          items: [{ catalogProductId, catalogVariantId, quantity: 1 }],
          sourceType: 'checkout',
          sourceId: randomUUID(),
          idempotencyKey: `fix-${index}`,
        }, callerCtx)
        return result.reserved
      })

    const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_unused, index) => run(index)))
    expect(results).toEqual(Array.from({ length: CONCURRENCY }, () => true))
  }, 20_000)

  it('the OLD behavior (always forking a fresh em) exhausts the pool and at least one concurrent caller fails', async () => {
    const { catalogVariantId } = await seedBalance(String(CONCURRENCY))
    const catalogProductId = randomUUID()

    const run = async (index: number): Promise<boolean> =>
      withCallerHoldingAConnection(async () => {
        // The old path: no `callerCtx` at all, so `reserveAvailability` always forks a
        // brand-new `em` off `container.resolve('em')` — a genuinely separate connection
        // from the one `withCallerHoldingAConnection` above is already holding open.
        const result = await reserveAvailability(buildContainer(), {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          items: [{ catalogProductId, catalogVariantId, quantity: 1 }],
          sourceType: 'checkout',
          sourceId: randomUUID(),
          idempotencyKey: `old-${index}`,
        })
        return result.reserved
      })

    const outcomes = await Promise.allSettled(Array.from({ length: CONCURRENCY }, (_unused, index) => run(index)))
    // Exactly the symptom #8414 reports at the HTTP layer: with the pool fully consumed
    // by concurrent callers each holding their own connection, at least one caller cannot
    // obtain its second connection and fails — the deadlock the fix (above) closes.
    expect(outcomes.some((outcome) => outcome.status === 'rejected')).toBe(true)
  }, 20_000)
})
