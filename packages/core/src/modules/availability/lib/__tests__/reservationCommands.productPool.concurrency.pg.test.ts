/**
 * Cross-variant product-level safety-stock pool under real concurrency (#9183 scenario 3,
 * inherited #8268 blocker). A product-level `wms_product_inventory_profiles` row
 * (`catalog_variant_id IS NULL`) is ONE shared budget for every variant of that product:
 * `sum(variant sellable) - pool safety stock`. Concurrent `availability.reserve` calls on
 * DIFFERENT variants of that product never touch the same `wms_inventory_balances` row, so
 * the per-variant `FOR UPDATE` lock alone would let each of them read the shared budget
 * before any of the others commits and jointly over-sell it. The guard under test is
 * `WmsReservationService.reserveLinesForCheckout`'s lock set: it widens the
 * `lockCandidateBalances` `SELECT … FOR UPDATE` to the line variants UNION every active
 * variant of each pooled product (`loadActiveVariantIdsByProduct`), id-ordered, so every
 * reservation that draws on the same pool serializes on the same rows.
 *
 * What is REAL here:
 * - the registered `availability.reserve` command handler (`commands/reservations.ts`),
 *   invoked with a real `CommandRuntimeContext` and an awilix container — the same
 *   `execute(input, ctx)` entry point the command bus calls;
 * - `reserveAvailability` (`lib/reservationCommands.ts`), its transaction, CAS and replay;
 * - `WmsReservationService` (gate, pool roll-up, allocator, `reserveInTransaction`);
 * - `PolicyResolutionService` from `createPolicyResolutionService` — it resolves
 *   `is_stock_managed = true` from the product-level profile row exactly as production;
 * - the PostgreSQL schema for every table touched (`wms_*`, `availability_*`, and the real
 *   `catalog_*` tables the pool path reads `catalog_product_variants` from through raw SQL),
 *   created from the entity metadata, with N independent pooled connections.
 *
 * What is ABSENT (not stubbed, deliberately unregistered): `dataEngine` and the event bus.
 * `WmsReservationService.emitSideEffects` returns early without a `dataEngine`, and
 * `emitAvailabilityEvent` logs "Event bus not available". Both run AFTER the reservation
 * transaction commits (A19), so neither can influence the locking behaviour proved here.
 *
 * Gated on OM_AVAILABILITY_PG_URL (the `test:pg-concurrency` CI job), a throwaway database:
 * the suite refreshes its own schema. Never point it at a development or shared database.
 *
 *   docker run -d --rm --name om-availability-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54375:5432 postgres:18-alpine
 *   OM_AVAILABILITY_PG_URL=postgres://postgres:postgres@127.0.0.1:54375/om \
 *     yarn workspace @open-mercato/core test:pg-concurrency
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CatalogOffer,
  CatalogOptionSchemaTemplate,
  CatalogPriceHistoryEntry,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductUnitConversion,
  CatalogProductVariant,
  CatalogProductVariantRelation,
} from '../../../catalog/data/entities'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
} from '../../../wms/data/entities'
import { AvailabilityPolicy, AvailabilityReservation } from '../../data/entities'
import { WmsReservationService } from '../../../wms/lib/wmsReservationService'
import { createPolicyResolutionService } from '../policyResolution'
import { reserveAvailabilityCommand } from '../../commands/reservations'
import type { ReserveAvailabilityResult } from '../reservationCommands'

const PG_URL = process.env.OM_AVAILABILITY_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const MAX_PARALLEL = 24

type PooledProductFixture = {
  productId: string
  variantIds: string[]
}

maybe('availability.reserve across variants sharing one product-level safety-stock pool (#9183 scenario 3)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let container: AwilixContainer

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      contextName: 'availability-product-pool',
      entities: [
        Warehouse,
        WarehouseLocation,
        InventoryLot,
        InventoryBalance,
        InventoryReservation,
        InventoryMovement,
        ProductInventoryProfile,
        AvailabilityPolicy,
        AvailabilityReservation,
        CatalogOptionSchemaTemplate,
        CatalogProduct,
        CatalogProductUnitConversion,
        CatalogProductCategory,
        CatalogProductCategoryAssignment,
        CatalogProductTag,
        CatalogProductTagAssignment,
        CatalogOffer,
        CatalogProductVariant,
        CatalogProductVariantRelation,
        CatalogPriceKind,
        CatalogProductPrice,
        CatalogPriceHistoryEntry,
      ],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: MAX_PARALLEL * 2 + 4 },
    })
    await orm.schema.refresh()
    container = createContainer()
    container.register({
      em: asValue(orm.em),
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

  async function seedPooledProduct(input: {
    variantCount: number
    onHandPerVariant: number
    poolSafetyStock: number
  }): Promise<PooledProductFixture> {
    const em = orm.em.fork()
    const suffix = randomUUID().slice(0, 8)
    const product = em.create(CatalogProduct, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      title: `Pooled product ${suffix}`,
      sku: `POOL-${suffix}`,
      productType: 'configurable',
      isConfigurable: true,
      isActive: true,
    })
    em.persist(product)
    const variants = Array.from({ length: input.variantCount }, (_unused, index) => {
      const variant = em.create(CatalogProductVariant, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        product,
        name: `Variant ${index}`,
        sku: `POOL-${suffix}-${index}`,
        isDefault: index === 0,
        isActive: true,
      })
      em.persist(variant)
      return variant
    })
    const warehouse = em.create(Warehouse, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      name: `Pool WH ${suffix}`,
      code: `WH-${suffix}`,
      isActive: true,
      isPrimary: false,
    })
    em.persist(warehouse)
    const location = em.create(WarehouseLocation, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      warehouse,
      code: `BIN-${suffix}`,
      type: 'bin',
      isActive: true,
    })
    em.persist(location)
    await em.flush()
    for (const variant of variants) {
      em.persist(
        em.create(InventoryBalance, {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          warehouse,
          location,
          catalogVariantId: variant.id,
          quantityOnHand: String(input.onHandPerVariant),
          quantityReserved: '0',
          quantityAllocated: '0',
        }),
      )
    }
    em.persist(
      em.create(ProductInventoryProfile, {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        catalogProductId: product.id,
        catalogVariantId: null,
        defaultUom: 'unit',
        defaultStrategy: 'fifo',
        safetyStock: String(input.poolSafetyStock),
      }),
    )
    await em.flush()
    return { productId: product.id, variantIds: variants.map((variant) => variant.id) }
  }

  async function reservedByVariant(variantIds: string[]): Promise<Map<string, number>> {
    const balances = await orm.em.fork().find(InventoryBalance, { catalogVariantId: { $in: variantIds } })
    const totals = new Map<string, number>()
    for (const balance of balances) {
      totals.set(balance.catalogVariantId, (totals.get(balance.catalogVariantId) ?? 0) + Number(balance.quantityReserved))
    }
    return totals
  }

  async function reserveOne(fixture: PooledProductFixture, variantId: string, attempt: number): Promise<ReserveAvailabilityResult> {
    return reserveAvailabilityCommand.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        items: [{ catalogProductId: fixture.productId, catalogVariantId: variantId, quantity: 1 }],
        sourceType: 'checkout',
        sourceId: randomUUID(),
        idempotencyKey: `pool-${fixture.productId}-${attempt}`,
      },
      callerCtx(),
    )
  }

  async function assertActiveHoldCount(fixture: PooledProductFixture, expected: number): Promise<void> {
    const holds = await orm.em.fork().find(InventoryReservation, {
      catalogVariantId: { $in: fixture.variantIds },
      status: 'active',
      sourceType: 'checkout',
    })
    expect(holds.reduce((sum, hold) => sum + Number(hold.quantity), 0)).toBe(expected)
  }

  test('one concurrent reserve per variant: the shared pool admits exactly its budget, never one per variant', async () => {
    // 8 variants x 2 on hand = 16 per-variant sellable; pool safety stock 13 => product budget 3.
    // Each variant's OWN sellable (2) admits its single request, so only the shared pool can
    // refuse — and every one of the 8 requests races on a different balance row.
    const fixture = await seedPooledProduct({ variantCount: 8, onHandPerVariant: 2, poolSafetyStock: 13 })

    const results = await Promise.all(
      fixture.variantIds.map((variantId, index) => reserveOne(fixture, variantId, index)),
    )

    const reserved = results.filter((result) => result.reserved)
    const refused = results.filter((result) => !result.reserved)
    expect(reserved).toHaveLength(3)
    expect(refused).toHaveLength(5)
    for (const refusal of refused) {
      expect(refusal.shortfall).toEqual([
        expect.objectContaining({ catalogProductId: fixture.productId, requested: 1, available: 0 }),
      ])
    }

    const reservedTotals = await reservedByVariant(fixture.variantIds)
    const pooledTotal = Array.from(reservedTotals.values()).reduce((sum, value) => sum + value, 0)
    expect(pooledTotal).toBe(3)
    for (const value of reservedTotals.values()) expect(value).toBeLessThanOrEqual(1)
    await assertActiveHoldCount(fixture, 3)
    const holdRows = await orm.em.fork().find(AvailabilityReservation, {
      idempotencyKey: { $like: `pool-${fixture.productId}-%` },
      status: 'active',
    })
    expect(holdRows).toHaveLength(3)
  })

  test(`${MAX_PARALLEL} concurrent reserves over 6 variants: the pool budget holds and no variant exceeds its own sellable`, async () => {
    // 6 variants x 2 on hand = 12 per-variant sellable; pool safety stock 7 => product budget 5.
    // 4 requests per variant (24 total) contend both on the same rows (same variant) and on the
    // shared pool (different variants), so both lock paths are exercised at once.
    const fixture = await seedPooledProduct({ variantCount: 6, onHandPerVariant: 2, poolSafetyStock: 7 })
    const attempts = Array.from({ length: MAX_PARALLEL }, (_unused, index) =>
      reserveOne(fixture, fixture.variantIds[index % fixture.variantIds.length], index),
    )

    const results = await Promise.all(attempts)

    const reserved = results.filter((result) => result.reserved)
    expect(reserved).toHaveLength(5)
    for (const refusal of results.filter((result) => !result.reserved)) {
      expect(refusal.shortfall).toHaveLength(1)
      expect(refusal.shortfall[0].available).toBe(0)
    }
    const reservedTotals = await reservedByVariant(fixture.variantIds)
    const pooledTotal = Array.from(reservedTotals.values()).reduce((sum, value) => sum + value, 0)
    expect(pooledTotal).toBe(5)
    for (const value of reservedTotals.values()) expect(value).toBeLessThanOrEqual(2)
    await assertActiveHoldCount(fixture, 5)
  })

  test('the pool lock is product-scoped: a different pooled product reserves in parallel without being starved', async () => {
    const first = await seedPooledProduct({ variantCount: 4, onHandPerVariant: 1, poolSafetyStock: 2 })
    const second = await seedPooledProduct({ variantCount: 4, onHandPerVariant: 1, poolSafetyStock: 2 })

    const results = await Promise.all([
      ...first.variantIds.map((variantId, index) => reserveOne(first, variantId, index)),
      ...second.variantIds.map((variantId, index) => reserveOne(second, variantId, index)),
    ])

    const firstReserved = results.slice(0, 4).filter((result) => result.reserved)
    const secondReserved = results.slice(4).filter((result) => result.reserved)
    expect(firstReserved).toHaveLength(2)
    expect(secondReserved).toHaveLength(2)
    await assertActiveHoldCount(first, 2)
    await assertActiveHoldCount(second, 2)
  })
})
