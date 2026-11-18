/** @jest-environment node */
import { FakeEm, encryptionFindMock } from './support/fakeEm'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => encryptionFindMock())
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

import type { SearchBuildContext } from '@open-mercato/shared/modules/search'
import { Lease, Unit } from '../data/entities'
import { reindexBuildingUnits, reindexFloorUnits, reindexUnitLeases } from '../lib/searchReindex'
import { searchConfig } from '../search'
import unitLeasesSubscriber, { metadata as unitLeasesMetadata } from '../subscribers/search-reindex-unit-leases'
import buildingUnitsSubscriber, { metadata as buildingUnitsMetadata } from '../subscribers/search-reindex-building-units'
import floorUnitsSubscriber, { metadata as floorUnitsMetadata } from '../subscribers/search-reindex-floor-units'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function contextOf(em: FakeEm) {
  const emitEvent = jest.fn(async () => undefined)
  const ctx = {
    resolve: <T,>(name: string): T => {
      if (name === 'em') return em as unknown as T
      if (name === 'eventBus') return { emitEvent } as unknown as T
      throw new Error(`[internal] unexpected ${name}`)
    },
  }
  return { ctx, emitEvent }
}

function seed(): FakeEm {
  const em = new FakeEm()
  em.seed(Unit, { id: 'unit-1', ...scope, buildingId: 'building-1', floorId: 'floor-1', deletedAt: null } as never)
  em.seed(Unit, { id: 'unit-2', ...scope, buildingId: 'building-1', floorId: 'floor-2', deletedAt: null } as never)
  em.seed(Unit, { id: 'unit-gone', ...scope, buildingId: 'building-1', floorId: 'floor-1', deletedAt: new Date() } as never)
  em.seed(Unit, { id: 'unit-foreign', tenantId: 'tenant-1', organizationId: 'org-2', buildingId: 'building-1', floorId: 'floor-1', deletedAt: null } as never)
  em.seed(Lease, { id: 'lease-1', ...scope, unitId: 'unit-1', deletedAt: null } as never)
  em.seed(Lease, { id: 'lease-2', ...scope, unitId: 'unit-1', deletedAt: null } as never)
  em.seed(Lease, { id: 'lease-other', ...scope, unitId: 'unit-2', deletedAt: null } as never)
  return em
}

function upsertedIds(emitEvent: jest.Mock): Array<{ entityType: string; recordId: string }> {
  return emitEvent.mock.calls
    .filter(([event]) => event === 'query_index.upsert_one')
    .map(([, body]) => ({ entityType: (body as { entityType: string }).entityType, recordId: (body as { recordId: string }).recordId }))
}

describe('search reindex subscribers', () => {
  it('subscribe persistently to the events whose names the search entries embed', () => {
    expect(unitLeasesMetadata).toMatchObject({ event: 'property_management.unit.updated', persistent: true })
    expect(buildingUnitsMetadata).toMatchObject({ event: 'property_management.building.updated', persistent: true })
    expect(floorUnitsMetadata).toMatchObject({ event: 'property_management.floor.updated', persistent: true })
  })

  it('reindexes the leases of a renamed unit', async () => {
    const { ctx, emitEvent } = contextOf(seed())
    await unitLeasesSubscriber({ id: 'unit-1', ...scope }, ctx)
    expect(upsertedIds(emitEvent)).toEqual([
      { entityType: 'property_management:lease', recordId: 'lease-1' },
      { entityType: 'property_management:lease', recordId: 'lease-2' },
    ])
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.upsert_one',
      expect.objectContaining({ ...scope, crudAction: 'updated' }),
      scope,
    )
  })

  it('reindexes the live units of a building or a floor in its own organization', async () => {
    const building = contextOf(seed())
    await buildingUnitsSubscriber({ id: 'building-1', ...scope }, building.ctx)
    expect(upsertedIds(building.emitEvent).map((entry) => entry.recordId)).toEqual(['unit-1', 'unit-2'])
    const floor = contextOf(seed())
    await floorUnitsSubscriber({ id: 'floor-1', ...scope }, floor.ctx)
    expect(upsertedIds(floor.emitEvent)).toEqual([{ entityType: 'property_management:unit', recordId: 'unit-1' }])
  })

  it('requests one scoped reindex instead of many upserts above the limit', async () => {
    const { ctx, emitEvent } = contextOf(seed())
    await expect(reindexBuildingUnits({ id: 'building-1', ...scope }, ctx, 1)).resolves.toEqual({ mode: 'reindex', count: 2 })
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.reindex',
      { entityType: 'property_management:unit', ...scope },
      { persistent: true, deliverInline: false },
    )
  })

  it('skips the unit reindex when the building or floor name did not change', async () => {
    const building = contextOf(seed())
    await buildingUnitsSubscriber({ id: 'building-1', ...scope, nameChanged: false }, building.ctx)
    const floor = contextOf(seed())
    await floorUnitsSubscriber({ id: 'floor-1', ...scope, nameChanged: false }, floor.ctx)
    expect(building.emitEvent).not.toHaveBeenCalled()
    expect(floor.emitEvent).not.toHaveBeenCalled()
  })

  it('reindexes when the name changed or the payload does not say', async () => {
    const renamed = contextOf(seed())
    await buildingUnitsSubscriber({ id: 'building-1', ...scope, nameChanged: true }, renamed.ctx)
    expect(upsertedIds(renamed.emitEvent).map((entry) => entry.recordId)).toEqual(['unit-1', 'unit-2'])
    const legacy = contextOf(seed())
    await floorUnitsSubscriber({ id: 'floor-1', ...scope }, legacy.ctx)
    expect(upsertedIds(legacy.emitEvent).map((entry) => entry.recordId)).toEqual(['unit-1'])
  })

  it('skips payloads without a full scope', async () => {
    const { ctx, emitEvent } = contextOf(seed())
    await expect(reindexUnitLeases({ id: 'unit-1', tenantId: 'tenant-1' }, ctx)).resolves.toEqual({ mode: 'skipped', count: 0 })
    await expect(reindexFloorUnits({ id: 'floor-unknown', ...scope }, ctx)).resolves.toEqual({ mode: 'skipped', count: 0 })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})

describe('unit search source', () => {
  const unitEntity = searchConfig.entities.find((entity) => entity.entityId === 'property_management:unit')

  function buildContext(rows: Record<string, Array<Record<string, unknown>>>): SearchBuildContext & { queries: Array<{ entityId: string; filters: unknown }> } {
    const queries: Array<{ entityId: string; filters: unknown }> = []
    return {
      record: { id: 'unit-1', name: 'Studio 2B', building_id: 'building-1', floor_id: 'floor-1', catalog_product_id: 'product-1' },
      customFields: {},
      ...scope,
      queries,
      queryEngine: {
        query: async (entityId: string, options: { filters: unknown }) => {
          queries.push({ entityId, filters: options.filters })
          return { items: rows[entityId] ?? [] }
        },
      },
    }
  }

  it('indexes the product name of the open product period', async () => {
    const ctx = buildContext({
      'property_management:building': [{ id: 'building-1', name: 'Harbor Point' }],
      'property_management:floor': [{ id: 'floor-1', name: 'Ground' }],
      'property_management:unit_product_period': [{ id: 'period-1', product_name: 'Private office' }],
      'catalog:catalog_product': [{ id: 'product-1', title: 'Renamed product' }],
    })
    const source = await unitEntity!.buildSource!(ctx)
    expect(source?.text).toEqual(['Studio 2B', 'Harbor Point', 'Ground', 'Private office'])
    expect(ctx.queries).toContainEqual({
      entityId: 'property_management:unit_product_period',
      filters: { unit_id: { $eq: 'unit-1' }, valid_to: { $exists: false } },
    })
    expect(ctx.queries.some((query) => query.entityId === 'catalog:catalog_product')).toBe(false)
  })

  it('falls back to the catalog product title for a unit without an open period', async () => {
    const ctx = buildContext({ 'catalog:catalog_product': [{ id: 'product-1', title: 'Meeting room' }] })
    const source = await unitEntity!.buildSource!(ctx)
    expect(source?.text).toEqual(['Studio 2B', 'Meeting room'])
  })
})

describe('lease search source', () => {
  const leaseEntity = searchConfig.entities.find((entity) => entity.entityId === 'property_management:lease')
  const customerEncryptedFields = ['display_name', 'primary_email', 'primary_phone', 'next_interaction_name', 'description']

  function buildContext(): SearchBuildContext & { queries: string[] } {
    const queries: string[] = []
    return {
      record: { id: 'lease-1', reference: 'LSE-0001', status: 'active', unit_id: 'unit-1', customer_company_id: 'company-1' },
      customFields: {},
      ...scope,
      queries,
      queryEngine: {
        query: async (entityId: string) => {
          queries.push(entityId)
          if (entityId === 'property_management:unit') return { items: [{ id: 'unit-1', name: 'Studio 2B' }] }
          if (entityId === 'customers:customer_entity') {
            return { items: [{ id: 'company-1', display_name: 'Acme Secret Ltd', primary_email: 'cfo@acme.test', primary_phone: '+48 600 000 000' }] }
          }
          return { items: [] }
        },
      },
    }
  }

  it('indexes the reference and unit name but never the encrypted CRM company fields', async () => {
    const ctx = buildContext()
    const source = await leaseEntity!.buildSource!(ctx)
    expect(source?.text).toEqual(['LSE-0001', 'Studio 2B'])
    expect(source?.presenter).toEqual({ title: 'LSE-0001', subtitle: 'Studio 2B', icon: 'file-signature', badge: 'active' })
    expect(ctx.queries).not.toContain('customers:customer_entity')
    const serialized = JSON.stringify(source)
    expect(serialized).not.toContain('Acme Secret Ltd')
    expect(serialized).not.toContain('cfo@acme.test')
    for (const field of customerEncryptedFields) expect(leaseEntity!.fieldPolicy?.searchable ?? []).not.toContain(field)
    expect(leaseEntity!.fieldPolicy?.hashOnly).toContain('customer_company_id')
  })

  it('reports a failed related lookup and still indexes the lease', async () => {
    const ctx: SearchBuildContext = {
      ...buildContext(),
      queryEngine: { query: async () => { throw new Error('[internal] query engine down') } },
    }
    const source = await leaseEntity!.buildSource!(ctx)
    expect(source?.text).toEqual(['LSE-0001'])
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      module: 'property_management',
      code: 'property_management.search_source_lookup_failed',
    }))
  })
})
