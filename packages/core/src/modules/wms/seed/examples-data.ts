import type { InventoryStrategy, WarehouseLocationType } from '../data/entities'

export const WMS_EXAMPLES_SEED_ID = 'wms-examples-v1'

export type WmsSeedScope = {
  tenantId: string
  organizationId: string
}

export type LocationSeed = {
  code: string
  type: WarehouseLocationType
  parentCode?: string
  capacityUnits?: number
}

export type ZoneSeed = {
  code: string
  name: string
  priority: number
}

export type WarehouseSeed = {
  code: string
  name: string
  isPrimary?: boolean
  addressLine1: string
  city: string
  postalCode: string
  country: string
  timezone: string
  zones: ZoneSeed[]
  locations: LocationSeed[]
}

export type ProductSeed = {
  title: string
  handle: string
  sku: string
  description: string
  unit: string
  variants: Array<{ name: string; sku: string; isDefault?: boolean }>
}

export type ProfileSeed = {
  productSku: string
  defaultUom: string
  defaultStrategy: InventoryStrategy
  trackLot?: boolean
  trackExpiration?: boolean
  reorderPoint?: number
  safetyStock?: number
}

export type StockSeed = {
  warehouseCode: string
  locationCode: string
  variantSku: string
  quantity: number
  lotNumber?: string
  expiresInDays?: number
  bestBeforeInDays?: number
  optionalCatalog?: boolean
}

export const WAREHOUSE_SEEDS: WarehouseSeed[] = [
  {
    code: 'DEMO-NYC',
    name: 'New York Fulfillment Center',
    isPrimary: true,
    addressLine1: '450 West 33rd Street',
    city: 'New York',
    postalCode: '10001',
    country: 'United States',
    timezone: 'America/New_York',
    zones: [
      { code: 'RCV', name: 'Receiving', priority: 10 },
      { code: 'PICK', name: 'Pick Face', priority: 20 },
      { code: 'BULK', name: 'Bulk Storage', priority: 30 },
      { code: 'SHIP', name: 'Shipping', priority: 40 },
    ],
    locations: [
      { code: 'NYC-RCV-DOCK', type: 'dock' },
      { code: 'NYC-STG-IN', type: 'staging' },
      { code: 'NYC-A01', type: 'aisle' },
      { code: 'NYC-A01-R1', type: 'rack', parentCode: 'NYC-A01' },
      { code: 'NYC-A01-R1-B01', type: 'bin', parentCode: 'NYC-A01-R1', capacityUnits: 200 },
      { code: 'NYC-A01-R1-B02', type: 'bin', parentCode: 'NYC-A01-R1', capacityUnits: 200 },
      { code: 'NYC-A01-R2', type: 'rack', parentCode: 'NYC-A01' },
      { code: 'NYC-A01-R2-B01', type: 'bin', parentCode: 'NYC-A01-R2', capacityUnits: 150 },
      { code: 'NYC-BULK-01', type: 'aisle' },
      { code: 'NYC-BULK-01-B01', type: 'bin', parentCode: 'NYC-BULK-01', capacityUnits: 1000 },
      { code: 'NYC-SHIP-DOCK', type: 'dock' },
    ],
  },
  {
    code: 'DEMO-LAX',
    name: 'Los Angeles West Coast Hub',
    addressLine1: '2200 Pacific Coast Highway',
    city: 'Los Angeles',
    postalCode: '90731',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    zones: [
      { code: 'RCV', name: 'Receiving', priority: 10 },
      { code: 'PICK', name: 'Pick Face', priority: 20 },
      { code: 'SHIP', name: 'Shipping', priority: 30 },
    ],
    locations: [
      { code: 'LAX-RCV-DOCK', type: 'dock' },
      { code: 'LAX-A01', type: 'aisle' },
      { code: 'LAX-A01-R1', type: 'rack', parentCode: 'LAX-A01' },
      { code: 'LAX-A01-R1-B01', type: 'bin', parentCode: 'LAX-A01-R1', capacityUnits: 180 },
      { code: 'LAX-A01-R1-B02', type: 'bin', parentCode: 'LAX-A01-R1', capacityUnits: 180 },
      { code: 'LAX-SHIP-DOCK', type: 'dock' },
    ],
  },
  {
    code: 'DEMO-BER',
    name: 'Berlin EU Distribution Center',
    addressLine1: 'Westhafenstrasse 1',
    city: 'Berlin',
    postalCode: '13353',
    country: 'Germany',
    timezone: 'Europe/Berlin',
    zones: [
      { code: 'RCV', name: 'Receiving', priority: 10 },
      { code: 'PICK', name: 'Pick Face', priority: 20 },
      { code: 'COLD', name: 'Temperature-Controlled', priority: 25 },
      { code: 'SHIP', name: 'Shipping', priority: 40 },
    ],
    locations: [
      { code: 'BER-RCV-DOCK', type: 'dock' },
      { code: 'BER-A01', type: 'aisle' },
      { code: 'BER-A01-R1', type: 'rack', parentCode: 'BER-A01' },
      { code: 'BER-A01-R1-B01', type: 'bin', parentCode: 'BER-A01-R1', capacityUnits: 160 },
      { code: 'BER-A01-R1-B02', type: 'bin', parentCode: 'BER-A01-R1', capacityUnits: 160 },
      { code: 'BER-COLD-01', type: 'aisle' },
      { code: 'BER-COLD-01-B01', type: 'bin', parentCode: 'BER-COLD-01', capacityUnits: 120 },
      { code: 'BER-SHIP-DOCK', type: 'dock' },
    ],
  },
]

export const PRODUCT_SEEDS: ProductSeed[] = [
  {
    title: 'Ceramic Pour-Over Mug',
    handle: 'ceramic-pour-over-mug',
    sku: 'HOME-MUG-POUR',
    description:
      '12 oz stoneware pour-over mug with a matte glaze and drip-free spout. Everyday warehouse demo stock.',
    unit: 'pc',
    variants: [
      { name: 'Slate Grey', sku: 'HOME-MUG-SLATE', isDefault: true },
      { name: 'Clay White', sku: 'HOME-MUG-CLAY' },
    ],
  },
  {
    title: 'Organic Matcha Tea Tin',
    handle: 'organic-matcha-tea-tin',
    sku: 'FOOD-MATCHA-TIN',
    description:
      'Ceremonial-grade organic matcha packed in a resealable tin. Tracked by lot and expiry for FEFO demos.',
    unit: 'pc',
    variants: [{ name: '30 g Tin', sku: 'FOOD-MATCHA-30G', isDefault: true }],
  },
  {
    title: 'Noise-Cancel Wireless Earbuds',
    handle: 'noise-cancel-wireless-earbuds',
    sku: 'ELEC-EARBUDS-NC',
    description: 'Compact ANC earbuds with USB-C charging case. Useful for multi-location stock demos.',
    unit: 'pc',
    variants: [
      { name: 'Graphite', sku: 'ELEC-EARBUDS-GRAPHITE', isDefault: true },
      { name: 'Pearl', sku: 'ELEC-EARBUDS-PEARL' },
    ],
  },
]

export const PROFILE_SEEDS: ProfileSeed[] = [
  {
    productSku: 'ATLAS-RUNNER',
    defaultUom: 'pair',
    defaultStrategy: 'fifo',
    reorderPoint: 24,
    safetyStock: 12,
  },
  {
    productSku: 'AURORA-WRAP',
    defaultUom: 'pc',
    defaultStrategy: 'fifo',
    reorderPoint: 10,
    safetyStock: 4,
  },
  {
    productSku: 'HOME-MUG-POUR',
    defaultUom: 'pc',
    defaultStrategy: 'fifo',
    reorderPoint: 20,
    safetyStock: 8,
  },
  {
    productSku: 'FOOD-MATCHA-TIN',
    defaultUom: 'pc',
    defaultStrategy: 'fefo',
    trackLot: true,
    trackExpiration: true,
    reorderPoint: 15,
    safetyStock: 6,
  },
  {
    productSku: 'ELEC-EARBUDS-NC',
    defaultUom: 'pc',
    defaultStrategy: 'fifo',
    reorderPoint: 12,
    safetyStock: 5,
  },
]

export const STOCK_SEEDS: StockSeed[] = [
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R1-B01', variantSku: 'ATLAS-RUN-NAVY-8', quantity: 86, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R1-B02', variantSku: 'ATLAS-RUN-NAVY-8', quantity: 34, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-BULK-01-B01', variantSku: 'ATLAS-RUN-NAVY-8', quantity: 120, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R2-B01', variantSku: 'ATLAS-RUN-GLACIER-10', quantity: 18, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R1-B02', variantSku: 'AURORA-ROSE-M', quantity: 42, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R2-B01', variantSku: 'AURORA-CELESTIAL-L', quantity: 7, optionalCatalog: true },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R1-B01', variantSku: 'HOME-MUG-SLATE', quantity: 64 },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R1-B02', variantSku: 'HOME-MUG-CLAY', quantity: 51 },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-A01-R2-B01', variantSku: 'ELEC-EARBUDS-GRAPHITE', quantity: 28 },
  { warehouseCode: 'DEMO-NYC', locationCode: 'NYC-STG-IN', variantSku: 'ELEC-EARBUDS-PEARL', quantity: 12 },
  {
    warehouseCode: 'DEMO-NYC',
    locationCode: 'NYC-A01-R1-B01',
    variantSku: 'FOOD-MATCHA-30G',
    quantity: 24,
    lotNumber: 'MATCHA-NYC-A',
    expiresInDays: 90,
    bestBeforeInDays: 60,
  },
  {
    warehouseCode: 'DEMO-NYC',
    locationCode: 'NYC-A01-R1-B02',
    variantSku: 'FOOD-MATCHA-30G',
    quantity: 16,
    lotNumber: 'MATCHA-NYC-B',
    expiresInDays: 210,
    bestBeforeInDays: 180,
  },
  { warehouseCode: 'DEMO-LAX', locationCode: 'LAX-A01-R1-B01', variantSku: 'ATLAS-RUN-NAVY-8', quantity: 55, optionalCatalog: true },
  { warehouseCode: 'DEMO-LAX', locationCode: 'LAX-A01-R1-B02', variantSku: 'AURORA-ROSE-M', quantity: 22, optionalCatalog: true },
  { warehouseCode: 'DEMO-LAX', locationCode: 'LAX-A01-R1-B01', variantSku: 'HOME-MUG-SLATE', quantity: 40 },
  { warehouseCode: 'DEMO-LAX', locationCode: 'LAX-A01-R1-B02', variantSku: 'ELEC-EARBUDS-GRAPHITE', quantity: 19 },
  {
    warehouseCode: 'DEMO-LAX',
    locationCode: 'LAX-A01-R1-B01',
    variantSku: 'FOOD-MATCHA-30G',
    quantity: 30,
    lotNumber: 'MATCHA-LAX-A',
    expiresInDays: 45,
    bestBeforeInDays: 15,
  },
  { warehouseCode: 'DEMO-BER', locationCode: 'BER-A01-R1-B01', variantSku: 'ATLAS-RUN-GLACIER-10', quantity: 72, optionalCatalog: true },
  { warehouseCode: 'DEMO-BER', locationCode: 'BER-A01-R1-B02', variantSku: 'AURORA-CELESTIAL-L', quantity: 31, optionalCatalog: true },
  { warehouseCode: 'DEMO-BER', locationCode: 'BER-A01-R1-B01', variantSku: 'HOME-MUG-CLAY', quantity: 38 },
  { warehouseCode: 'DEMO-BER', locationCode: 'BER-A01-R1-B02', variantSku: 'ELEC-EARBUDS-PEARL', quantity: 15 },
  {
    warehouseCode: 'DEMO-BER',
    locationCode: 'BER-COLD-01-B01',
    variantSku: 'FOOD-MATCHA-30G',
    quantity: 20,
    lotNumber: 'MATCHA-BER-NEAR',
    expiresInDays: 14,
    bestBeforeInDays: -16,
  },
  {
    warehouseCode: 'DEMO-BER',
    locationCode: 'BER-COLD-01-B01',
    variantSku: 'FOOD-MATCHA-30G',
    quantity: 45,
    lotNumber: 'MATCHA-BER-FAR',
    expiresInDays: 365,
    bestBeforeInDays: 335,
  },
]

export function orderLocationSeeds(locations: LocationSeed[]): LocationSeed[] {
  const remaining = [...locations]
  const ordered: LocationSeed[] = []
  const placed = new Set<string>()

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((location) => !location.parentCode || placed.has(location.parentCode))
    if (nextIndex < 0) {
      const unresolved = remaining.map((location) => location.code).join(', ')
      throw new Error(`[internal] WMS example location seeds have a missing parent: ${unresolved}`)
    }
    const next = remaining.splice(nextIndex, 1)[0]!
    ordered.push(next)
    placed.add(next.code)
  }

  return ordered
}

export function movementIdempotencyKey(seed: StockSeed): string {
  return `${WMS_EXAMPLES_SEED_ID}:${seed.warehouseCode}:${seed.locationCode}:${seed.variantSku}:${seed.lotNumber ?? 'nolot'}`
}
