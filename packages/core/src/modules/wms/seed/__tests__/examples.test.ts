/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../../data/entities'
import { addUtcDays, startOfUtcDay } from '../../lib/expiry'
import {
  movementIdempotencyKey,
  orderLocationSeeds,
  PRODUCT_SEEDS,
  STOCK_SEEDS,
  WAREHOUSE_SEEDS,
} from '../examples-data'
import { seedWmsExamples } from '../examples'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

type MemoryRow = Record<string, unknown> & { id: string }

function idOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: string }).id
  }
  return value
}

function matchesWhere(row: MemoryRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected === null) return actual == null
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return (expected.$in as unknown[]).includes(idOf(actual))
    }
    return idOf(actual) === idOf(expected)
  })
}

function createMemoryEm(): EntityManager & { rows: Map<string, MemoryRow[]> } {
  const rows = new Map<string, MemoryRow[]>()
  const em = {
    rows,
    create(Entity: { name: string; prototype: object }, data: Record<string, unknown>) {
      return Object.assign(Object.create(Entity.prototype), data)
    },
    persist(entity: MemoryRow & { constructor: { name: string } }) {
      const key = entity.constructor.name
      const list = rows.get(key) ?? []
      if (!list.includes(entity)) list.push(entity)
      rows.set(key, list)
      return em
    },
    async flush() {
      return undefined
    },
    async find(Entity: { name: string }, where: Record<string, unknown> = {}) {
      return (rows.get(Entity.name) ?? []).filter((row) => matchesWhere(row, where))
    },
    async findOne(Entity: { name: string }, where: Record<string, unknown> = {}) {
      return (rows.get(Entity.name) ?? []).find((row) => matchesWhere(row, where)) ?? null
    },
  }
  return em as unknown as EntityManager & { rows: Map<string, MemoryRow[]> }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const NOW = new Date('2026-08-17T12:00:00.000Z')

describe('WMS example seed data', () => {
  it('orders location seeds so every parent exists before its children', () => {
    for (const warehouse of WAREHOUSE_SEEDS) {
      const ordered = orderLocationSeeds(warehouse.locations)
      const seen = new Set<string>()
      for (const location of ordered) {
        if (location.parentCode) {
          expect(seen.has(location.parentCode)).toBe(true)
        }
        seen.add(location.code)
      }
    }
  })

  it('rejects location seeds with a missing parent', () => {
    expect(() =>
      orderLocationSeeds([
        { code: 'CHILD', type: 'bin', parentCode: 'MISSING' },
      ]),
    ).toThrow(/missing parent/)
  })

  it('points every stock row at a known warehouse, location, and product or optional catalog variant', () => {
    const warehouseCodes = new Set(WAREHOUSE_SEEDS.map((seed) => seed.code))
    const locationsByWarehouse = new Map(
      WAREHOUSE_SEEDS.map((seed) => [seed.code, new Set(seed.locations.map((location) => location.code))]),
    )
    const ownedVariantSkus = new Set(PRODUCT_SEEDS.flatMap((seed) => seed.variants.map((variant) => variant.sku)))

    for (const stock of STOCK_SEEDS) {
      expect(warehouseCodes.has(stock.warehouseCode)).toBe(true)
      expect(locationsByWarehouse.get(stock.warehouseCode)?.has(stock.locationCode)).toBe(true)
      if (!stock.optionalCatalog) {
        expect(ownedVariantSkus.has(stock.variantSku)).toBe(true)
      }
    }
  })
})

describe('seedWmsExamples', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockResolvedValue({ id: 'user-admin' } as never)
  })

  it('creates the walkthrough warehouses, WMS products, and opening receipts', async () => {
    const em = createMemoryEm()

    const result = await seedWmsExamples(em, SCOPE, { performedBy: 'user-admin', now: NOW })

    expect(result.warehousesCreated).toBe(3)
    expect(result.productsCreated).toBe(3)
    expect(result.stockRowsCreated).toBeGreaterThan(0)
    expect(result.catalogVariantsMissing.sort()).toEqual(
      ['ATLAS-RUN-GLACIER-10', 'ATLAS-RUN-NAVY-8', 'AURORA-CELESTIAL-L', 'AURORA-ROSE-M'].sort(),
    )

    const warehouses = em.rows.get(Warehouse.name) ?? []
    expect(warehouses.map((row) => row.code).sort()).toEqual(['DEMO-BER', 'DEMO-LAX', 'DEMO-NYC'])
    expect(warehouses.find((row) => row.code === 'DEMO-NYC')?.isPrimary).toBe(true)
    expect(warehouses.filter((row) => row.isPrimary)).toHaveLength(1)

    const products = em.rows.get(CatalogProduct.name) ?? []
    expect(products.find((row) => row.sku === 'HOME-MUG-POUR')).toEqual(expect.objectContaining({
      productType: 'configurable',
      isConfigurable: true,
    }))
    expect(products.find((row) => row.sku === 'ELEC-EARBUDS-NC')).toEqual(expect.objectContaining({
      productType: 'configurable',
      isConfigurable: true,
    }))
    expect(products.find((row) => row.sku === 'FOOD-MATCHA-TIN')).toEqual(expect.objectContaining({
      productType: 'simple',
      isConfigurable: false,
    }))

    const movements = em.rows.get(InventoryMovement.name) ?? []
    expect(movements.every((row) => row.type === 'receipt')).toBe(true)
    expect(movements.every((row) => row.reasonCode === 'example_seed')).toBe(true)

    const matchaNear = (em.rows.get(InventoryLot.name) ?? []).find((row) => row.lotNumber === 'MATCHA-BER-NEAR')
    expect(matchaNear?.expiresAt).toEqual(addUtcDays(startOfUtcDay(NOW), 14))
  })

  it('is idempotent and does not overwrite existing balances', async () => {
    const em = createMemoryEm()
    const first = await seedWmsExamples(em, SCOPE, { performedBy: 'user-admin', now: NOW })
    const second = await seedWmsExamples(em, SCOPE, { performedBy: 'user-admin', now: NOW })

    expect(first.warehousesCreated).toBe(3)
    expect(second.warehousesCreated).toBe(0)
    expect(second.stockRowsCreated).toBe(0)
    expect(second.productsCreated).toBe(0)
    expect((em.rows.get(Warehouse.name) ?? []).length).toBe(3)
    expect((em.rows.get(InventoryMovement.name) ?? []).length).toBe(first.stockRowsCreated)
  })

  it('stocks catalog fashion variants when they already exist', async () => {
    const em = createMemoryEm()
    const product = em.create(CatalogProduct, {
      id: 'atlas-product',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      sku: 'ATLAS-RUNNER',
      title: 'Atlas Runner Sneaker',
      deletedAt: null,
    }) as CatalogProduct & MemoryRow
    em.persist(product)
    const variant = em.create(CatalogProductVariant, {
      id: 'atlas-navy',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      product,
      sku: 'ATLAS-RUN-NAVY-8',
      name: 'Midnight Navy · US 8',
      deletedAt: null,
    }) as CatalogProductVariant & MemoryRow
    em.persist(variant)

    const result = await seedWmsExamples(em, SCOPE, { performedBy: 'user-admin', now: NOW })

    expect(result.catalogVariantsMissing).not.toContain('ATLAS-RUN-NAVY-8')
    const navyStock = (em.rows.get(InventoryBalance.name) ?? []).filter((row) => row.catalogVariantId === 'atlas-navy')
    expect(navyStock.length).toBeGreaterThan(0)
  })

  it('does not mark a demo warehouse primary when the org already has one', async () => {
    const em = createMemoryEm()
    const existing = em.create(Warehouse, {
      id: 'existing-primary',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      code: 'MAIN',
      name: 'Existing Primary',
      isPrimary: true,
      isActive: true,
      deletedAt: null,
    }) as Warehouse & MemoryRow
    em.persist(existing)

    await seedWmsExamples(em, SCOPE, { performedBy: 'user-admin', now: NOW })

    const primaries = (em.rows.get(Warehouse.name) ?? []).filter((row) => row.isPrimary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]?.id).toBe('existing-primary')
  })

  it('skips opening stock when no user is available to stamp movements', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const em = createMemoryEm()

    const result = await seedWmsExamples(em, SCOPE, { now: NOW })

    expect(result.warehousesCreated).toBe(3)
    expect(result.stockRowsCreated).toBe(0)
    expect(em.rows.get(InventoryMovement.name) ?? []).toHaveLength(0)
    expect(em.rows.get(WarehouseLocation.name)?.length).toBeGreaterThan(0)
    expect(em.rows.get(WarehouseZone.name)?.length).toBeGreaterThan(0)
    expect(em.rows.get(ProductInventoryProfile.name)?.length).toBeGreaterThan(0)
  })
})

describe('movementIdempotencyKey', () => {
  it('includes lot number when present', () => {
    expect(
      movementIdempotencyKey({
        warehouseCode: 'DEMO-NYC',
        locationCode: 'NYC-A01-R1-B01',
        variantSku: 'FOOD-MATCHA-30G',
        quantity: 1,
        lotNumber: 'MATCHA-NYC-A',
      }),
    ).toBe('wms-examples-v1:DEMO-NYC:NYC-A01-R1-B01:FOOD-MATCHA-30G:MATCHA-NYC-A')
  })
})
