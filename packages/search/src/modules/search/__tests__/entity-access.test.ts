import type { SearchEntityConfig } from '@open-mercato/shared/modules/search'
import {
  canReadSearchEntity,
  filterSearchResultsByEntityAccess,
  resolveReadableEntityTypes,
  type SearchEntityDenyReason,
} from '../lib/entity-access'

const CONFIGS: Record<string, SearchEntityConfig> = {
  'customers:customer_person_profile': {
    entityId: 'customers:customer_person_profile',
    aclFeatures: ['customers.people.view'],
  },
  'catalog:catalog_product': {
    entityId: 'catalog:catalog_product',
    aclFeatures: ['catalog.products.view'],
  },
  // Deliberately declares no aclFeatures: models a module that forgot to opt in.
  'wms:warehouse': {
    entityId: 'wms:warehouse',
  },
}

const lookup = {
  getEntityConfig: (entityId: string) => CONFIGS[entityId],
  getAllEntityConfigs: () => Object.values(CONFIGS),
}

function result(entityId: string, recordId: string) {
  return { entityId, recordId }
}

describe('canReadSearchEntity', () => {
  it('allows a caller holding the entity view feature', () => {
    expect(
      canReadSearchEntity('customers:customer_person_profile', lookup, {
        grantedFeatures: ['search.global', 'customers.people.view'],
      }),
    ).toBe(true)
  })

  it('denies a caller holding only search.global', () => {
    expect(
      canReadSearchEntity('customers:customer_person_profile', lookup, {
        grantedFeatures: ['search.global'],
      }),
    ).toBe(false)
  })

  it('honours wildcard grants', () => {
    expect(
      canReadSearchEntity('catalog:catalog_product', lookup, {
        grantedFeatures: ['catalog.*'],
      }),
    ).toBe(true)
  })

  it('fails closed for an entity that is not configured for search', () => {
    const reasons: SearchEntityDenyReason[] = []
    expect(
      canReadSearchEntity('unknown:entity', lookup, { grantedFeatures: ['*'] }, {
        onDeny: (_entityId, reason) => reasons.push(reason),
      }),
    ).toBe(false)
    expect(reasons).toEqual(['unconfigured'])
  })

  it('fails closed for a configured entity that declares no aclFeatures', () => {
    const reasons: SearchEntityDenyReason[] = []
    expect(
      canReadSearchEntity('wms:warehouse', lookup, { grantedFeatures: ['wms.view'] }, {
        onDeny: (_entityId, reason) => reasons.push(reason),
      }),
    ).toBe(false)
    expect(reasons).toEqual(['no-acl-features'])
  })

  it('lets a superadmin through regardless of declared features', () => {
    expect(
      canReadSearchEntity('wms:warehouse', lookup, { grantedFeatures: [], isSuperAdmin: true }),
    ).toBe(true)
  })
})

describe('resolveReadableEntityTypes', () => {
  it('narrows the query to the entity types the caller can read', () => {
    expect(
      resolveReadableEntityTypes(lookup, { grantedFeatures: ['customers.people.view'] }),
    ).toEqual(['customers:customer_person_profile'])
  })

  it('returns an empty list when nothing is readable, so callers can short-circuit', () => {
    expect(resolveReadableEntityTypes(lookup, { grantedFeatures: ['search.global'] })).toEqual([])
  })

  it('intersects the readable types with the explicitly requested ones', () => {
    expect(
      resolveReadableEntityTypes(lookup, { grantedFeatures: ['*'] }, ['catalog:catalog_product', 'wms:warehouse']),
    ).toEqual(['catalog:catalog_product'])
  })

  it('applies no restriction for a superadmin and passes an explicit request through', () => {
    expect(
      resolveReadableEntityTypes(lookup, { grantedFeatures: [], isSuperAdmin: true }),
    ).toBeUndefined()
    expect(
      resolveReadableEntityTypes(lookup, { grantedFeatures: [], isSuperAdmin: true }, ['wms:warehouse']),
    ).toEqual(['wms:warehouse'])
  })

  it('skips entities explicitly disabled for search', () => {
    const disabledLookup = {
      getEntityConfig: (entityId: string) => CONFIGS[entityId],
      getAllEntityConfigs: () => [
        { entityId: 'catalog:catalog_product', aclFeatures: ['catalog.products.view'], enabled: false },
      ],
    }

    expect(resolveReadableEntityTypes(disabledLookup, { grantedFeatures: ['*'] })).toEqual([])
  })
})

describe('filterSearchResultsByEntityAccess', () => {
  const results = [
    result('customers:customer_person_profile', 'person-1'),
    result('catalog:catalog_product', 'product-1'),
    result('customers:customer_person_profile', 'person-2'),
    result('wms:warehouse', 'warehouse-1'),
  ]

  it('drops results for entity types the caller cannot view', () => {
    const filtered = filterSearchResultsByEntityAccess(results, lookup, {
      grantedFeatures: ['search.global', 'customers.people.view'],
    })

    expect(filtered.map((r) => r.recordId)).toEqual(['person-1', 'person-2'])
  })

  it('returns nothing when the caller holds only search.global', () => {
    expect(
      filterSearchResultsByEntityAccess(results, lookup, { grantedFeatures: ['search.global'] }),
    ).toEqual([])
  })

  it('returns everything for a superadmin', () => {
    expect(
      filterSearchResultsByEntityAccess(results, lookup, {
        grantedFeatures: [],
        isSuperAdmin: true,
      }),
    ).toHaveLength(results.length)
  })

  it('reports each denied entity type once, not once per result', () => {
    const denied: string[] = []
    filterSearchResultsByEntityAccess(
      results,
      lookup,
      { grantedFeatures: ['catalog.products.view'] },
      { onDeny: (entityId) => denied.push(entityId) },
    )

    expect(denied).toEqual(['customers:customer_person_profile', 'wms:warehouse'])
  })
})
