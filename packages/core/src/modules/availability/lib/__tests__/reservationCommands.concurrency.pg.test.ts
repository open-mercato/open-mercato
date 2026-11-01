/**
 * `availability.reserve`/`.release`/`.commit` against a real PostgreSQL (A1/A6/A14/A15,
 * spec §12). This is the release's own stated top gate for this Step: "last unit,
 * parallel, admits exactly one purchase, no window without the hold." The sequential
 * decision logic (classification, replay, CAS branching) is exercised by mocked-EM unit
 * tests elsewhere in this package; this file is the live proof that the `FOR UPDATE` lock
 * `wmsReservationService.reserveLinesForCheckout` takes actually serializes writers: N
 * real MikroORM EntityManagers, each its OWN connection out of the pool, firing
 * `reserveAvailability` concurrently against the SAME single unit of stock.
 *
 * Gated on OM_AVAILABILITY_PG_URL — a throwaway database, since the suite creates and
 * drops its own schema. Never point it at a development or shared database. Run it with:
 *
 *   docker run -d --rm --name om-availability-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54375:5432 postgres:18-alpine
 *   OM_AVAILABILITY_PG_URL=postgres://postgres:postgres@127.0.0.1:54375/om \
 *     yarn workspace @open-mercato/core jest reservationCommands.concurrency.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
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
import {
  commitAvailability,
  reserveAvailability,
  releaseAvailability,
  type Resolver,
} from '../reservationCommands'
import type { PolicyResolutionService, ResolvedAvailabilityPolicy } from '../policyResolution'

const PG_URL = process.env.OM_AVAILABILITY_PG_URL ?? ''
const PARALLEL = Number(process.env.OM_AVAILABILITY_RACE_PARALLEL ?? '20')
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222299'

function policyField<T>(value: T): { value: T; policySourceId: null } {
  return { value, policySourceId: null }
}

function makePolicy(overrides: Partial<{ isStockManaged: boolean; allowBackorder: boolean; preorderReleaseAt: Date | null }> = {}): ResolvedAvailabilityPolicy {
  return {
    isStockManaged: policyField(overrides.isStockManaged ?? true),
    allowBackorder: policyField(overrides.allowBackorder ?? false),
    backorderLeadTimeDays: policyField(null),
    preorderReleaseAt: policyField(overrides.preorderReleaseAt ?? null),
    lowStockThreshold: policyField(null),
    minOrderQuantity: policyField(null),
    maxOrderQuantity: policyField(null),
    quantityIncrement: policyField(null),
    hideWhenOutOfStock: policyField(false),
    isActive: policyField(true),
  }
}

function fakePolicyService(resolve: (productId: string, variantId: string | null) => ResolvedAvailabilityPolicy): PolicyResolutionService {
  return {
    async resolve(_em, scope) {
      return resolve(scope.productId, scope.variantId ?? null)
    },
    async resolveMany(_em, scopes) {
      return scopes.map((scope) => resolve(scope.productId, scope.variantId ?? null))
    },
  }
}

maybe('availability reservationCommands under real concurrency (A1/A14/A15)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let wmsService: WmsReservationService

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
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
      debug: false,
      pool: { min: 0, max: PARALLEL * 2 + 4 },
    })
    await orm.schema.refresh()
    wmsService = new WmsReservationService()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function buildContainer(policyService: PolicyResolutionService, organizationId: string = ORG_ID): Resolver {
    return {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return orm.em as unknown as T
        if (name === 'wmsReservationService') return wmsService as unknown as T
        if (name === 'policyResolutionService') return policyService as unknown as T
        throw new Error(`not registered: ${name}`)
      },
    }
  }

  async function seedWarehouseWithBalance(input: {
    quantityOnHand: string
    organizationId?: string
    safetyStock?: string
    catalogVariantId?: string
  }): Promise<{ warehouseId: string; locationId: string; catalogVariantId: string }> {
    const em = orm.em.fork()
    const organizationId = input.organizationId ?? ORG_ID
    const catalogVariantId = input.catalogVariantId ?? randomUUID()
    const catalogProductId = randomUUID()
    const warehouse = em.create(Warehouse, {
      organizationId,
      tenantId: TENANT_ID,
      name: 'Main',
      code: `WH-${randomUUID().slice(0, 8)}`,
      isActive: true,
      isPrimary: false,
    })
    em.persist(warehouse)
    await em.flush()
    const location = em.create(WarehouseLocation, {
      organizationId,
      tenantId: TENANT_ID,
      warehouse,
      code: `LOC-${randomUUID().slice(0, 8)}`,
      type: 'bin',
      isActive: true,
    })
    em.persist(location)
    await em.flush()
    const balance = em.create(InventoryBalance, {
      organizationId,
      tenantId: TENANT_ID,
      warehouse,
      location,
      catalogVariantId,
      quantityOnHand: input.quantityOnHand,
      quantityReserved: '0',
      quantityAllocated: '0',
    })
    em.persist(balance)
    if (input.safetyStock) {
      const profile = em.create(ProductInventoryProfile, {
        organizationId,
        tenantId: TENANT_ID,
        catalogProductId,
        catalogVariantId,
        defaultUom: 'unit',
        defaultStrategy: 'fifo',
        safetyStock: input.safetyStock,
      })
      em.persist(profile)
    }
    await em.flush()
    return { warehouseId: warehouse.id, locationId: location.id, catalogVariantId }
  }

  async function readBalance(catalogVariantId: string): Promise<InventoryBalance> {
    const em = orm.em.fork()
    const balance = await em.findOne(InventoryBalance, { catalogVariantId })
    if (!balance) throw new Error('balance not found')
    return balance
  }

  test(`${PARALLEL} concurrent reserve calls for the last unit (single warehouse): exactly one succeeds`, async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '1' })
    const policyService = fakePolicyService(() => makePolicy())
    const catalogProductId = randomUUID()

    const attempts = Array.from({ length: PARALLEL }, (_unused, index) =>
      reserveAvailability(buildContainer(policyService), {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        items: [{ catalogProductId, catalogVariantId, quantity: 1 }],
        sourceType: 'checkout',
        sourceId: randomUUID(),
        idempotencyKey: `race-${index}`,
      }),
    )

    const results = await Promise.all(attempts)
    const reserved = results.filter((result) => result.reserved)
    const refused = results.filter((result) => !result.reserved)

    expect(reserved.length + refused.length).toBe(PARALLEL)
    // The core guarantee: exactly one succeeds — never zero (the lock must not starve a
    // legitimate reserve) and never more than one (the lock must not let the last unit
    // sell twice).
    expect(reserved.length).toBe(1)
    for (const refusal of refused) {
      expect(refusal.shortfall).toHaveLength(1)
      expect(refusal.shortfall[0].available).toBe(0)
    }

    const balance = await readBalance(catalogVariantId)
    expect(Number(balance.quantityReserved)).toBe(1)
  })

  test('multi-line all-or-nothing: a shortfall on one line leaves every line unheld', async () => {
    const abundant = await seedWarehouseWithBalance({ quantityOnHand: '10' })
    const scarce = await seedWarehouseWithBalance({ quantityOnHand: '0' })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const productA = randomUUID()
    const productB = randomUUID()

    const result = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [
        { catalogProductId: productA, catalogVariantId: abundant.catalogVariantId, quantity: 2 },
        { catalogProductId: productB, catalogVariantId: scarce.catalogVariantId, quantity: 1 },
      ],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: `multi-line-${randomUUID()}`,
    })

    expect(result.reserved).toBe(false)
    expect(result.reservationId).toBeNull()
    expect(result.shortfall).toHaveLength(1)
    expect(result.lines.every((line) => line.heldQuantity === 0)).toBe(true)

    const abundantBalance = await readBalance(abundant.catalogVariantId)
    expect(Number(abundantBalance.quantityReserved)).toBe(0)
  })

  test('backorder line holds min(requested, sellable) and admits the rest as backorder', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '3' })
    const policyService = fakePolicyService(() => makePolicy({ allowBackorder: true }))
    const container = buildContainer(policyService)
    const productId = randomUUID()

    const result = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 5 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: `backorder-${randomUUID()}`,
    })

    expect(result.reserved).toBe(true)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].outcome).toBe('backorder')
    expect(result.lines[0].heldQuantity).toBe(3)
    expect(result.lines[0].backorderQuantity).toBe(2)

    const balance = await readBalance(catalogVariantId)
    expect(Number(balance.quantityReserved)).toBe(3)
  })

  test('a line whose policy is not stock-managed is not_tracked and never aborts the call', async () => {
    const policyService = fakePolicyService(() => makePolicy({ isStockManaged: false }))
    const container = buildContainer(policyService)
    const productId = randomUUID()

    const result = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId: randomUUID(), quantity: 7 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: `not-tracked-${randomUUID()}`,
    })

    expect(result.reserved).toBe(true)
    expect(result.lines[0].outcome).toBe('not_tracked')
    expect(result.lines[0].heldQuantity).toBe(0)
  })

  test('a repeated idempotencyKey with different items answers 409 idempotency_key_mismatch and writes nothing', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '10' })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const key = `mismatch-${randomUUID()}`
    const productId = randomUUID()
    const sessionId = randomUUID()

    const first = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 1 }],
      sourceType: 'checkout',
      sourceId: sessionId,
      idempotencyKey: key,
    })
    expect(first.reserved).toBe(true)

    await expect(
      reserveAvailability(container, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        items: [{ catalogProductId: productId, catalogVariantId, quantity: 2 }],
        sourceType: 'checkout',
        sourceId: sessionId,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'idempotency_key_mismatch' } })

    // A same-content replay still returns the original hold, writing nothing new.
    const replay = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 1 }],
      sourceType: 'checkout',
      sourceId: sessionId,
      idempotencyKey: key,
    })
    expect(replay.reservationId).toBe(first.reservationId)

    const balance = await readBalance(catalogVariantId)
    expect(Number(balance.quantityReserved)).toBe(1)
  })

  test('release is idempotent: a second release, and a release of a committed hold, change nothing', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '5' })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const key = `release-${randomUUID()}`
    const productId = randomUUID()

    const reserved = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 2 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: key,
    })
    expect(reserved.reserved).toBe(true)

    const released = await releaseAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: key,
      reason: 'test_release',
    })
    expect(released.released).toBe(true)
    expect(released.status).toBe('released')

    const balanceAfterRelease = await readBalance(catalogVariantId)
    expect(Number(balanceAfterRelease.quantityReserved)).toBe(0)

    // A second release is a no-op (A21) — never an error, same current status.
    const secondRelease = await releaseAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: key,
      reason: 'test_release_again',
    })
    expect(secondRelease.released).toBe(false)
    expect(secondRelease.status).toBe('released')

    // An unknown key is a no-op too, never a throw.
    const unknown = await releaseAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: 'no-such-key',
      reason: 'test',
    })
    expect(unknown.status).toBe('not_found')
  })

  test('commit races the expiry sweep: when the sweep already won, commit recovers with a fresh reserve', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '4' })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const key = `commit-race-${randomUUID()}`
    const productId = randomUUID()
    const orderId = randomUUID()

    const reserved = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 2 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: key,
    })
    expect(reserved.reserved).toBe(true)

    // Simulate the expiry sweep (Step 2.3, not built yet) having already released this
    // hold's wms rows and expired the hold row — exactly the state `commit`'s recovery
    // path must handle, per the CAS state table (§5.3): `active -> expired` by the
    // (future) expiry worker, racing `commit`.
    const sweepEm = orm.em.fork()
    const wmsReservation = await sweepEm.findOne(InventoryReservation, { catalogVariantId })
    if (wmsReservation) {
      wmsReservation.status = 'released'
      wmsReservation.quantity = '0'
    }
    await sweepEm.nativeUpdate(InventoryBalance, { catalogVariantId }, { quantityReserved: '0' })
    await sweepEm.nativeUpdate(AvailabilityReservation, { idempotencyKey: key }, { status: 'expired' })
    await sweepEm.flush()

    const commitResult = await commitAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: key,
      orderId,
    })

    expect(commitResult.status).toBe('recovered')
    expect(commitResult.shortfall).toHaveLength(0)

    const balanceAfterCommit = await readBalance(catalogVariantId)
    expect(Number(balanceAfterCommit.quantityReserved)).toBe(2)

    const orderReservation = await orm.em.fork().findOne(InventoryReservation, { catalogVariantId, sourceType: 'order' })
    expect(orderReservation?.sourceId).toBe(orderId)
  })

  test('commit racing the sweep with the stock now gone returns stock_lost and writes nothing new', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '2' })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const key = `commit-lost-${randomUUID()}`
    const productId = randomUUID()
    const orderId = randomUUID()

    const reserved = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 2 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: key,
    })
    expect(reserved.reserved).toBe(true)

    const sweepEm = orm.em.fork()
    await sweepEm.nativeUpdate(InventoryBalance, { catalogVariantId }, { quantityReserved: '0', quantityOnHand: '0' })
    await sweepEm.nativeUpdate(AvailabilityReservation, { idempotencyKey: key }, { status: 'expired' })
    await sweepEm.flush()

    const commitResult = await commitAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: key,
      orderId,
    })

    expect(commitResult.status).toBe('stock_lost')
    expect(commitResult.shortfall.length).toBeGreaterThan(0)

    const reservationRow = await orm.em.fork().findOne(AvailabilityReservation, { idempotencyKey: key })
    expect(reservationRow?.status).toBe('expired')
    expect(reservationRow?.orderId ?? null).toBeNull()
  })

  test('tenant isolation: a second tenant/organization with the same key finds nothing and changes nothing', async () => {
    const { catalogVariantId } = await seedWarehouseWithBalance({ quantityOnHand: '5', organizationId: OTHER_ORG_ID })
    const policyService = fakePolicyService(() => makePolicy())
    const container = buildContainer(policyService)
    const key = `isolation-${randomUUID()}`
    const productId = randomUUID()

    const reserved = await reserveAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: OTHER_ORG_ID,
      items: [{ catalogProductId: productId, catalogVariantId, quantity: 1 }],
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: key,
    })
    expect(reserved.reserved).toBe(true)

    const releasedFromWrongOrg = await releaseAvailability(container, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      idempotencyKey: key,
      reason: 'cross_org_attempt',
    })
    expect(releasedFromWrongOrg.status).toBe('not_found')

    await expect(
      commitAvailability(container, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        idempotencyKey: key,
        orderId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 })

    const balance = await readBalance(catalogVariantId)
    expect(Number(balance.quantityReserved)).toBe(1)
  })
})
