import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../data/entities'
import { addUtcDays, startOfUtcDay } from '../lib/expiry'
import {
  movementIdempotencyKey,
  orderLocationSeeds,
  PRODUCT_SEEDS,
  PROFILE_SEEDS,
  STOCK_SEEDS,
  WAREHOUSE_SEEDS,
  WMS_EXAMPLES_SEED_ID,
  type StockSeed,
  type WmsSeedScope,
} from './examples-data'

const logger = createLogger('wms')
const DEMO_META = { demoSeed: WMS_EXAMPLES_SEED_ID }

export type SeedWmsExamplesOptions = {
  performedBy?: string
  now?: Date
}

export type SeedWmsExamplesResult = {
  warehousesCreated: number
  zonesCreated: number
  locationsCreated: number
  productsCreated: number
  variantsCreated: number
  profilesCreated: number
  lotsCreated: number
  stockRowsCreated: number
  catalogVariantsMissing: string[]
}

type ProductEntry = {
  productId: string
  variants: Map<string, { id: string; sku: string }>
}

function qty(value: number): string {
  return value.toFixed(4)
}

async function resolvePerformedBy(
  em: EntityManager,
  scope: WmsSeedScope,
  explicit?: string,
): Promise<string | null> {
  if (explicit) return explicit
  const byTenant = await findOneWithDecryption(
    em,
    User,
    { tenantId: scope.tenantId, deletedAt: null },
    { orderBy: { createdAt: 'ASC' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (byTenant) return byTenant.id
  const byOrg = await findOneWithDecryption(
    em,
    User,
    { organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { createdAt: 'ASC' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return byOrg?.id ?? null
}

async function ensureWarehouses(
  em: EntityManager,
  scope: WmsSeedScope,
  now: Date,
): Promise<{
  warehouses: Map<string, { warehouse: Warehouse; locations: Map<string, WarehouseLocation> }>
  warehousesCreated: number
  zonesCreated: number
  locationsCreated: number
}> {
  const existingWarehouses = await em.find(Warehouse, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  const warehouseByCode = new Map(existingWarehouses.map((warehouse) => [warehouse.code, warehouse]))
  let hasPrimary = existingWarehouses.some((warehouse) => warehouse.isPrimary)
  let warehousesCreated = 0
  let zonesCreated = 0
  let locationsCreated = 0
  const result = new Map<string, { warehouse: Warehouse; locations: Map<string, WarehouseLocation> }>()

  for (const seed of WAREHOUSE_SEEDS) {
    let warehouse = warehouseByCode.get(seed.code)
    if (!warehouse) {
      const makePrimary = seed.isPrimary === true && !hasPrimary
      warehouse = em.create(Warehouse, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        code: seed.code,
        name: seed.name,
        isActive: true,
        isPrimary: makePrimary,
        addressLine1: seed.addressLine1,
        city: seed.city,
        postalCode: seed.postalCode,
        country: seed.country,
        timezone: seed.timezone,
        metadata: { ...DEMO_META },
        createdAt: now,
        updatedAt: now,
      })
      em.persist(warehouse)
      warehouseByCode.set(seed.code, warehouse)
      warehousesCreated += 1
      if (makePrimary) {
        hasPrimary = true
      }
    }
    result.set(seed.code, { warehouse, locations: new Map() })
  }
  await em.flush()

  for (const seed of WAREHOUSE_SEEDS) {
    const entry = result.get(seed.code)
    if (!entry) continue
    const warehouseId = entry.warehouse.id

    const existingZones = await em.find(WarehouseZone, {
      warehouse: warehouseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const zoneByCode = new Map(existingZones.map((zone) => [zone.code, zone]))
    for (const zoneSeed of seed.zones) {
      if (zoneByCode.has(zoneSeed.code)) continue
      const zone = em.create(WarehouseZone, {
        id: randomUUID(),
        warehouse: entry.warehouse,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        code: zoneSeed.code,
        name: zoneSeed.name,
        priority: zoneSeed.priority,
        metadata: { ...DEMO_META },
        createdAt: now,
        updatedAt: now,
      })
      em.persist(zone)
      zonesCreated += 1
    }
    await em.flush()

    const existingLocations = await em.find(WarehouseLocation, {
      warehouse: warehouseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const locationByCode = new Map(existingLocations.map((location) => [location.code, location]))
    for (const locationSeed of orderLocationSeeds(seed.locations)) {
      const existing = locationByCode.get(locationSeed.code)
      if (existing) continue
      const parent = locationSeed.parentCode ? locationByCode.get(locationSeed.parentCode) ?? null : null
      const location = em.create(WarehouseLocation, {
        id: randomUUID(),
        warehouse: entry.warehouse,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        code: locationSeed.code,
        type: locationSeed.type,
        parent: parent ?? undefined,
        isActive: true,
        capacityUnits: locationSeed.capacityUnits != null ? qty(locationSeed.capacityUnits) : null,
        metadata: { ...DEMO_META },
        createdAt: now,
        updatedAt: now,
      })
      em.persist(location)
      locationByCode.set(locationSeed.code, location)
      locationsCreated += 1
    }
    await em.flush()
    entry.locations = locationByCode
  }

  return { warehouses: result, warehousesCreated, zonesCreated, locationsCreated }
}

async function ensureDemoProducts(
  em: EntityManager,
  scope: WmsSeedScope,
  now: Date,
): Promise<{ products: Map<string, ProductEntry>; productsCreated: number; variantsCreated: number }> {
  const products = new Map<string, ProductEntry>()
  let productsCreated = 0
  let variantsCreated = 0

  for (const seed of PRODUCT_SEEDS) {
    let product = await em.findOne(CatalogProduct, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sku: seed.sku,
      deletedAt: null,
    })
    if (!product) {
      const configurable = seed.variants.length > 1
      product = em.create(CatalogProduct, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        title: seed.title,
        description: seed.description,
        sku: seed.sku,
        handle: seed.handle,
        productType: configurable ? 'configurable' : 'simple',
        defaultUnit: seed.unit,
        defaultSalesUnit: seed.unit,
        primaryCurrencyCode: 'USD',
        isConfigurable: configurable,
        isActive: true,
        metadata: { ...DEMO_META },
        createdAt: now,
        updatedAt: now,
      })
      em.persist(product)
      productsCreated += 1
      await em.flush()
    }

    const variantMap = new Map<string, { id: string; sku: string }>()
    for (const variantSeed of seed.variants) {
      let variant = await em.findOne(CatalogProductVariant, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        sku: variantSeed.sku,
        deletedAt: null,
      })
      if (!variant) {
        variant = em.create(CatalogProductVariant, {
          id: randomUUID(),
          product,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          name: variantSeed.name,
          sku: variantSeed.sku,
          isDefault: variantSeed.isDefault === true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        em.persist(variant)
        variantsCreated += 1
        await em.flush()
      }
      variantMap.set(variantSeed.sku, { id: variant.id, sku: variant.sku ?? variantSeed.sku })
    }
    products.set(seed.sku, { productId: product.id, variants: variantMap })
  }

  for (const sku of ['ATLAS-RUNNER', 'AURORA-WRAP']) {
    const product = await em.findOne(CatalogProduct, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sku,
      deletedAt: null,
    })
    if (!product) continue
    const variants = await em.find(CatalogProductVariant, {
      product: product.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const variantMap = new Map(
      variants
        .filter((variant): variant is CatalogProductVariant & { sku: string } => Boolean(variant.sku))
        .map((variant) => [variant.sku, { id: variant.id, sku: variant.sku }]),
    )
    products.set(sku, { productId: product.id, variants: variantMap })
  }

  return { products, productsCreated, variantsCreated }
}

async function ensureProfiles(
  em: EntityManager,
  scope: WmsSeedScope,
  products: Map<string, ProductEntry>,
  now: Date,
): Promise<number> {
  let created = 0
  for (const seed of PROFILE_SEEDS) {
    const entry = products.get(seed.productSku)
    if (!entry) continue
    const existing = await em.findOne(ProductInventoryProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      catalogProductId: entry.productId,
      catalogVariantId: null,
      deletedAt: null,
    })
    if (existing) continue
    const profile = em.create(ProductInventoryProfile, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      catalogProductId: entry.productId,
      catalogVariantId: null,
      defaultUom: seed.defaultUom,
      defaultStrategy: seed.defaultStrategy,
      trackLot: seed.trackLot === true,
      trackSerial: false,
      trackExpiration: seed.trackExpiration === true,
      reorderPoint: qty(seed.reorderPoint ?? 0),
      safetyStock: qty(seed.safetyStock ?? 0),
      metadata: { ...DEMO_META },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(profile)
    created += 1
  }
  await em.flush()
  return created
}

function findVariant(
  products: Map<string, ProductEntry>,
  variantSku: string,
): { id: string; sku: string } | null {
  for (const entry of products.values()) {
    const variant = entry.variants.get(variantSku)
    if (variant) return variant
  }
  return null
}

async function ensureOpeningStock(
  em: EntityManager,
  scope: WmsSeedScope,
  warehouses: Map<string, { warehouse: Warehouse; locations: Map<string, WarehouseLocation> }>,
  products: Map<string, ProductEntry>,
  performedBy: string,
  now: Date,
): Promise<{ stockRowsCreated: number; lotsCreated: number; catalogVariantsMissing: string[] }> {
  let stockRowsCreated = 0
  let lotsCreated = 0
  const catalogVariantsMissing: string[] = []
  const missingSeen = new Set<string>()
  const today = startOfUtcDay(now)

  for (const seed of STOCK_SEEDS) {
    const warehouseEntry = warehouses.get(seed.warehouseCode)
    const location = warehouseEntry?.locations.get(seed.locationCode)
    const variant = findVariant(products, seed.variantSku)
    if (!warehouseEntry || !location) continue
    if (!variant) {
      if (seed.optionalCatalog && !missingSeen.has(seed.variantSku)) {
        missingSeen.add(seed.variantSku)
        catalogVariantsMissing.push(seed.variantSku)
      }
      continue
    }

    const idempotencyKey = movementIdempotencyKey(seed)
    const existingMovement = await em.findOne(InventoryMovement, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      idempotencyKey,
      deletedAt: null,
    })
    if (existingMovement) continue

    let lot: InventoryLot | null = null
    if (seed.lotNumber) {
      lot = await em.findOne(InventoryLot, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variant.id,
        lotNumber: seed.lotNumber,
        deletedAt: null,
      })
      if (!lot) {
        lot = em.create(InventoryLot, {
          id: randomUUID(),
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          catalogVariantId: variant.id,
          sku: variant.sku,
          lotNumber: seed.lotNumber,
          bestBeforeAt: seed.bestBeforeInDays != null ? addUtcDays(today, seed.bestBeforeInDays) : null,
          expiresAt: seed.expiresInDays != null ? addUtcDays(today, seed.expiresInDays) : null,
          status: 'available',
          metadata: { ...DEMO_META },
          createdAt: now,
          updatedAt: now,
        })
        em.persist(lot)
        await em.flush()
        lotsCreated += 1
      }
    }

    const existingBalance = await em.findOne(InventoryBalance, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      warehouse: warehouseEntry.warehouse.id,
      location: location.id,
      catalogVariantId: variant.id,
      lot: lot ? lot.id : null,
      deletedAt: null,
    })
    if (existingBalance) continue

    const balance = em.create(InventoryBalance, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      warehouse: warehouseEntry.warehouse,
      location,
      catalogVariantId: variant.id,
      lot: lot ?? undefined,
      serialNumber: null,
      quantityOnHand: qty(seed.quantity),
      quantityReserved: qty(0),
      quantityAllocated: qty(0),
      metadata: { ...DEMO_META },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(balance)

    const movement = em.create(InventoryMovement, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      warehouse: warehouseEntry.warehouse,
      locationFrom: null,
      locationTo: location,
      catalogVariantId: variant.id,
      lot: lot ?? undefined,
      serialNumber: null,
      quantity: qty(seed.quantity),
      type: 'receipt',
      referenceType: 'manual',
      referenceId: randomUUID(),
      performedBy,
      performedAt: now,
      receivedAt: now,
      reason: 'Example opening balance',
      reasonCode: 'example_seed',
      idempotencyKey,
      metadata: { ...DEMO_META },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(movement)
    stockRowsCreated += 1
  }

  await em.flush()
  return { stockRowsCreated, lotsCreated, catalogVariantsMissing }
}

export async function seedWmsExamples(
  em: EntityManager,
  scope: WmsSeedScope,
  options: SeedWmsExamplesOptions = {},
): Promise<SeedWmsExamplesResult> {
  const now = options.now ?? new Date()
  const performedBy = await resolvePerformedBy(em, scope, options.performedBy)
  const { warehouses, warehousesCreated, zonesCreated, locationsCreated } = await ensureWarehouses(em, scope, now)
  const { products, productsCreated, variantsCreated } = await ensureDemoProducts(em, scope, now)
  const profilesCreated = await ensureProfiles(em, scope, products, now)

  let lotsCreated = 0
  let stockRowsCreated = 0
  let catalogVariantsMissing: string[] = []
  if (performedBy) {
    const stock = await ensureOpeningStock(em, scope, warehouses, products, performedBy, now)
    lotsCreated = stock.lotsCreated
    stockRowsCreated = stock.stockRowsCreated
    catalogVariantsMissing = stock.catalogVariantsMissing
  } else {
    logger.warn('wms.seedExamples skipped opening stock; no user found to stamp movements', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }

  const result: SeedWmsExamplesResult = {
    warehousesCreated,
    zonesCreated,
    locationsCreated,
    productsCreated,
    variantsCreated,
    profilesCreated,
    lotsCreated,
    stockRowsCreated,
    catalogVariantsMissing,
  }
  logger.info('wms.seedExamples completed', result)
  return result
}

export type { StockSeed, WmsSeedScope }
