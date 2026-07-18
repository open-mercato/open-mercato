import { describe, it, expect } from '@jest/globals'
import { MetadataStorage } from '@mikro-orm/core'
import {
  WorkCenter,
  ProductionBom,
  ProductionBomItem,
  Routing,
  RoutingOperation,
  ProductPlanningParams,
  ProductionOrder,
  ProductionOrderOperation,
  ProductionOrderMaterial,
} from '../entities'
import { E } from '../../../../../generated/entities.ids.generated'
import { extensions } from '../extensions'

function metaFor(entityClass: { name: string }) {
  const map = MetadataStorage.getMetadata(entityClass.name) as Record<string, any>
  const key = Object.keys(map).find((k) => map[k]?.class === entityClass || map[k]?.className === entityClass.name)
  return key ? map[key] : Object.values(map)[0]
}

function expectStandardColumns(entityClass: { name: string }) {
  const meta = metaFor(entityClass)
  const props = Object.keys(meta.properties)
  expect(props).toEqual(expect.arrayContaining(['id', 'tenantId', 'organizationId', 'createdAt', 'updatedAt', 'deletedAt']))
}

describe('WorkCenter entity', () => {
  it('should be constructible', () => {
    const wc = new WorkCenter()
    expect(wc).toBeInstanceOf(WorkCenter)
  })

  it('maps to production_work_centers table', () => {
    const meta = metaFor(WorkCenter)
    expect(meta.tableName).toBe('production_work_centers')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(WorkCenter)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(WorkCenter)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'name',
      'kind',
      'costRatePerHour',
      'parallelStations',
      'efficiencyFactor',
      'availabilityRuleSetId',
      'isActive',
    ]))
  })
})

describe('ProductionBom entity', () => {
  it('maps to production_boms table', () => {
    const meta = metaFor(ProductionBom)
    expect(meta.tableName).toBe('production_boms')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductionBom)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(ProductionBom)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'productId',
      'variantId',
      'version',
      'status',
      'validFrom',
      'validTo',
      'name',
    ]))
  })

  it('has a unique constraint on tenant/org/product/variant/version', () => {
    const meta = metaFor(ProductionBom)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['tenantId', 'organizationId', 'productId', 'variantId', 'version']))
  })
})

describe('ProductionBomItem entity', () => {
  it('maps to production_bom_items table', () => {
    const meta = metaFor(ProductionBomItem)
    expect(meta.tableName).toBe('production_bom_items')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductionBomItem)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(ProductionBomItem)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'bomId',
      'componentProductId',
      'componentVariantId',
      'qtyPerUnit',
      'uom',
      'scrapFactor',
      'isPhantom',
      'operationSequence',
    ]))
  })
})

describe('Routing entity', () => {
  it('maps to production_routings table', () => {
    const meta = metaFor(Routing)
    expect(meta.tableName).toBe('production_routings')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(Routing)
  })

  it('has a unique constraint on tenant/org/product/variant/version', () => {
    const meta = metaFor(Routing)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['tenantId', 'organizationId', 'productId', 'variantId', 'version']))
  })
})

describe('RoutingOperation entity', () => {
  it('maps to production_routing_operations table', () => {
    const meta = metaFor(RoutingOperation)
    expect(meta.tableName).toBe('production_routing_operations')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(RoutingOperation)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(RoutingOperation)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'routingId',
      'sequence',
      'name',
      'workCenterId',
      'setupTimeMinutes',
      'runTimePerUnitSeconds',
      'isReportingPoint',
    ]))
  })
})

describe('ProductPlanningParams entity', () => {
  it('maps to production_planning_params table', () => {
    const meta = metaFor(ProductPlanningParams)
    expect(meta.tableName).toBe('production_planning_params')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductPlanningParams)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(ProductPlanningParams)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'productId',
      'variantId',
      'procurement',
      'leadTimeDays',
      'minLot',
      'lotMultiple',
      'safetyStock',
      'backflush',
    ]))
  })

  it('has a unique constraint scoped per tenant/org/product/variant', () => {
    const meta = metaFor(ProductPlanningParams)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['tenantId', 'organizationId', 'productId', 'variantId']))
  })
})

describe('ProductionOrder entity', () => {
  it('maps to production_orders table', () => {
    const meta = metaFor(ProductionOrder)
    expect(meta.tableName).toBe('production_orders')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductionOrder)
  })

  it('has key columns from spec', () => {
    const meta = metaFor(ProductionOrder)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'number',
      'productId',
      'variantId',
      'qtyPlanned',
      'uom',
      'dueDate',
      'priority',
      'status',
      'sourceType',
      'sourceId',
      'bomVersionId',
      'routingVersionId',
      'releasedAt',
      'qtyCompleted',
      'qtyScrapped',
    ]))
  })

  it('has a unique constraint on tenant/org/number', () => {
    const meta = metaFor(ProductionOrder)
    expect(meta.uniques.length).toBeGreaterThan(0)
    const properties = meta.uniques.flatMap((u: any) => u.properties)
    expect(properties).toEqual(expect.arrayContaining(['tenantId', 'organizationId', 'number']))
  })
})

describe('ProductionOrderOperation entity', () => {
  it('maps to production_order_operations table', () => {
    const meta = metaFor(ProductionOrderOperation)
    expect(meta.tableName).toBe('production_order_operations')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductionOrderOperation)
  })

  it('has key columns from spec, incl. the traceability-only sourceOperationId', () => {
    const meta = metaFor(ProductionOrderOperation)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'orderId',
      'sequence',
      'name',
      'workCenterId',
      'setupTimeMinutes',
      'runTimePerUnitSeconds',
      'isReportingPoint',
      'status',
      'qtyGood',
      'qtyScrap',
      'sourceOperationId',
    ]))
  })
})

describe('ProductionOrderMaterial entity', () => {
  it('maps to production_order_materials table', () => {
    const meta = metaFor(ProductionOrderMaterial)
    expect(meta.tableName).toBe('production_order_materials')
  })

  it('has standard tenant/org/audit columns', () => {
    expectStandardColumns(ProductionOrderMaterial)
  })

  it('has key columns from spec, incl. the traceability-only sourceBomItemId', () => {
    const meta = metaFor(ProductionOrderMaterial)
    const props = Object.keys(meta.properties)
    expect(props).toEqual(expect.arrayContaining([
      'orderId',
      'operationSequence',
      'componentProductId',
      'componentVariantId',
      'qtyRequired',
      'uom',
      'scrapFactor',
      'qtyIssued',
      'sourceBomItemId',
    ]))
  })
})

describe('production:work_center entity extension link', () => {
  it('references the generated entity id (production:work_center, not the table name)', () => {
    // Entity ids derive from toSnake(className), not the table name: WorkCenter -> 'production:work_center'.
    // Locks against the regression fixed in review (extensions.ts previously used 'production:production_work_center').
    expect(E.production.work_center).toBe('production:work_center')
    const link = extensions.find((e) => e.base === 'planner:planner_availability_rule_set')
    expect(link?.extension).toBe('production:work_center')
    expect(link?.extension).toBe(E.production.work_center)
  })
})

