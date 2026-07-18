import { describe, it, expect } from '@jest/globals'
import { MetadataStorage } from '@mikro-orm/core'
import { StockItem, StockBatch, StockMovement, MaterialReservation } from '../entities'

function metaFor(entityClass: { name: string }) {
  const map = MetadataStorage.getMetadata(entityClass.name) as Record<string, any>
  const key = Object.keys(map).find((k) => map[k]?.class === entityClass || map[k]?.className === entityClass.name)
  return key ? map[key] : Object.values(map)[0]
}

function expectStandardColumns(entityClass: { name: string }) {
  const meta = metaFor(entityClass)
  const props = Object.keys(meta.properties)
  expect(props).toEqual(expect.arrayContaining(['id', 'tenantId', 'organizationId', 'createdAt']))
}

describe('StockItem entity', () => {
  it('maps to production_stock_items table', () => {
    const meta = metaFor(StockItem)
    expect(meta.tableName).toBe('production_stock_items')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(StockItem)
  })

  it('has key columns from spec (product/variant/uom/on_hand/reserved)', () => {
    const meta = metaFor(StockItem)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining(['productId', 'variantId', 'uom', 'onHand', 'reserved']))
  })

  it('has a unique constraint on tenant/org/product/variant', () => {
    const meta = metaFor(StockItem)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['tenantId', 'organizationId', 'productId', 'variantId']))
  })
})

describe('StockBatch entity', () => {
  it('maps to production_stock_batches table', () => {
    const meta = metaFor(StockBatch)
    expect(meta.tableName).toBe('production_stock_batches')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(StockBatch)
  })

  it('has key columns from spec (stock_item_id/batch_number/on_hand/expires_at)', () => {
    const meta = metaFor(StockBatch)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining(['stockItemId', 'batchNumber', 'onHand', 'expiresAt']))
  })

  it('has a unique constraint on stock_item_id/batch_number', () => {
    const meta = metaFor(StockBatch)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['stockItemId', 'batchNumber']))
  })
})

describe('StockMovement entity (append-only, decision h)', () => {
  it('maps to production_stock_movements table', () => {
    const meta = metaFor(StockMovement)
    expect(meta.tableName).toBe('production_stock_movements')
  })

  it('has key columns from spec', () => {
    const meta = metaFor(StockMovement)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'id',
      'tenantId',
      'organizationId',
      'movementType',
      'productId',
      'variantId',
      'batchId',
      'qty',
      'uom',
      'reasonEntryId',
      'sourceType',
      'sourceId',
      'reversesMovementId',
      'createdAt',
    ]))
  })

  it('is append-only: no updatedAt/deletedAt columns (never mutated/soft-deleted)', () => {
    const meta = metaFor(StockMovement)
    const props = Object.keys(meta.properties)
    expect(props).not.toEqual(expect.arrayContaining(['updatedAt']))
    expect(props).not.toEqual(expect.arrayContaining(['deletedAt']))
  })

  it('has a unique constraint on reverses_movement_id (blocks double storno)', () => {
    const meta = metaFor(StockMovement)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['reversesMovementId']))
  })
})

describe('MaterialReservation entity', () => {
  it('maps to production_material_reservations table', () => {
    const meta = metaFor(MaterialReservation)
    expect(meta.tableName).toBe('production_material_reservations')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(MaterialReservation)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(MaterialReservation)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'orderId',
      'orderMaterialId',
      'stockItemId',
      'batchId',
      'qty',
      'uom',
      'status',
    ]))
  })
})
