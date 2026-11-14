import {
  applyIndexDocEnrichers,
  getIndexDocEnrichers,
  registerIndexDocEnricher,
  resetIndexDocEnrichers,
  type IndexDocEnrichmentTarget,
} from '@open-mercato/core/modules/query_index/lib/doc-enrichers'
import {
  PRODUCT_SCOPE_KEYS_DOC_KEY,
  PRODUCT_SCOPE_KEYS_ENTITY_TYPE,
  buildProductScopeKeys,
  catalogProductScopeKeysEnricher,
  compareCodeUnits,
  computeProductScopeKeys,
  isProductScopeIndexed,
} from '../productScopeKeys'
import { register } from '../../di'
import { createFakeKysely, type RecordedQuery } from './fakeKysely'

const TENANT = 'tenant-1'
const ORG = 'org-1'

type CategoryRow = { product_id: string; category_id: string; ancestor_ids: unknown }
type TagRow = { product_id: string; tag_id: string }

function respondWith(categoryRows: CategoryRow[], tagRows: TagRow[]) {
  return (query: RecordedQuery) => {
    if (query.sql.includes('catalog_product_category_assignments')) return categoryRows
    if (query.sql.includes('catalog_product_tag_assignments')) return tagRows
    return []
  }
}

function target(recordId: string): IndexDocEnrichmentTarget {
  return { recordId, doc: { id: recordId, title: 'Product' }, tenantId: TENANT, organizationId: ORG }
}

describe('buildProductScopeKeys', () => {
  it('includes every assigned category, its ancestors and every tag', () => {
    expect(buildProductScopeKeys({
      categories: [{ categoryId: 'leaf', ancestorIds: ['root', 'mid'] }],
      tagIds: ['sale'],
    })).toEqual(['cat:leaf', 'cat:mid', 'cat:root', 'tag:sale'])
  })

  it('de-duplicates shared ancestors and repeated tags', () => {
    expect(buildProductScopeKeys({
      categories: [
        { categoryId: 'a', ancestorIds: ['root'] },
        { categoryId: 'b', ancestorIds: ['root'] },
        { categoryId: 'root', ancestorIds: [] },
      ],
      tagIds: ['t1', 't1'],
    })).toEqual(['cat:a', 'cat:b', 'cat:root', 'tag:t1'])
  })

  it('sorts by UTF-16 code units, not locale order', () => {
    const keys = buildProductScopeKeys({ categories: [], tagIds: ['a', 'B'] })
    expect(keys).toEqual(['tag:B', 'tag:a'])
    expect(['b', 'A', 'a'].sort(compareCodeUnits)).toEqual(['A', 'a', 'b'])
  })

  it('returns an empty list for a product without assignments', () => {
    expect(buildProductScopeKeys({ categories: [], tagIds: [] })).toEqual([])
  })
})

describe('computeProductScopeKeys', () => {
  it('computes a whole batch in exactly two queries, scoped to tenant and organization', async () => {
    const fake = createFakeKysely(respondWith(
      [
        { product_id: 'p1', category_id: 'leaf', ancestor_ids: ['root', 'mid'] },
        { product_id: 'p2', category_id: 'root', ancestor_ids: [] },
        { product_id: 'p2', category_id: 'other', ancestor_ids: '["root"]' },
      ],
      [
        { product_id: 'p1', tag_id: 'sale' },
        { product_id: 'p3', tag_id: 'new' },
      ],
    ))

    const result = await computeProductScopeKeys(fake.db, ['p1', 'p2', 'p3', 'p4', 'p1'], { tenantId: TENANT, organizationId: ORG })

    expect(fake.queries).toHaveLength(2)
    expect(result.get('p1')).toEqual(['cat:leaf', 'cat:mid', 'cat:root', 'tag:sale'])
    expect(result.get('p2')).toEqual(['cat:other', 'cat:root'])
    expect(result.get('p3')).toEqual(['tag:new'])
    expect(result.get('p4')).toEqual([])
    expect(Array.from(result.keys())).toHaveLength(4)

    const [categoryQuery, tagQuery] = fake.queries
    expect(categoryQuery.sql).toContain('inner join "catalog_product_categories" as "c" on "c"."id" = "a"."category_id"')
    expect(categoryQuery.sql).toContain('"c"."deleted_at" is null')
    expect(categoryQuery.sql).toContain('"a"."tenant_id" = $')
    expect(categoryQuery.sql).toContain('"a"."organization_id" = $')
    expect(categoryQuery.sql).toContain('"c"."tenant_id" = $')
    expect(categoryQuery.sql).toContain('"c"."organization_id" = $')
    expect(categoryQuery.parameters).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4', TENANT, ORG]))
    expect(tagQuery.sql).toContain('"t"."tenant_id" = $')
    expect(tagQuery.sql).toContain('"t"."organization_id" = $')
  })

  it('never yields keys for categories the query filtered out as deleted', async () => {
    const fake = createFakeKysely(respondWith([], [{ product_id: 'p1', tag_id: 'sale' }]))
    const result = await computeProductScopeKeys(fake.db, ['p1'], { tenantId: TENANT, organizationId: ORG })
    expect(result.get('p1')).toEqual(['tag:sale'])
  })

  it('compiles a null scope to IS NULL rather than an unscoped query', async () => {
    const fake = createFakeKysely(respondWith([], []))
    await computeProductScopeKeys(fake.db, ['p1'], { tenantId: null, organizationId: null })
    expect(fake.queries[0].sql).toContain('"a"."tenant_id" is null')
    expect(fake.queries[1].sql).toContain('"t"."organization_id" is null')
  })

  it('runs no query for an empty batch', async () => {
    const fake = createFakeKysely(respondWith([], []))
    expect((await computeProductScopeKeys(fake.db, [], { tenantId: TENANT, organizationId: ORG })).size).toBe(0)
    expect(fake.queries).toHaveLength(0)
  })
})

describe('catalogProductScopeKeysEnricher through the query_index hook', () => {
  beforeEach(() => resetIndexDocEnrichers())
  afterAll(() => resetIndexDocEnrichers())

  it('is registered from catalog di.ts for catalog:catalog_product', () => {
    register({ register: jest.fn() } as unknown as Parameters<typeof register>[0])
    const enrichers = getIndexDocEnrichers(PRODUCT_SCOPE_KEYS_ENTITY_TYPE)
    expect(enrichers.map((entry) => entry.id)).toEqual([catalogProductScopeKeysEnricher.id])
    expect(enrichers[0].keys).toEqual([PRODUCT_SCOPE_KEYS_DOC_KEY])
  })

  it('writes sorted scope_keys onto every document of the batch', async () => {
    registerIndexDocEnricher(catalogProductScopeKeysEnricher)
    const fake = createFakeKysely(respondWith(
      [{ product_id: 'p1', category_id: 'leaf', ancestor_ids: ['root'] }],
      [{ product_id: 'p2', tag_id: 'sale' }],
    ))
    const targets = [target('p1'), target('p2')]

    await applyIndexDocEnrichers(fake.db, PRODUCT_SCOPE_KEYS_ENTITY_TYPE, targets)

    expect(fake.queries).toHaveLength(2)
    expect(targets[0].doc.scope_keys).toEqual(['cat:leaf', 'cat:root'])
    expect(targets[1].doc.scope_keys).toEqual(['tag:sale'])
    expect(isProductScopeIndexed(targets[0].doc)).toBe(true)
    expect(isProductScopeIndexed(targets[1].doc)).toBe(true)
  })

  it('fails closed: a query failure writes scope_keys as null', async () => {
    registerIndexDocEnricher(catalogProductScopeKeysEnricher)
    const fake = createFakeKysely(() => {
      throw new Error('connection reset')
    })
    const targets = [target('p1'), target('p2')]

    await applyIndexDocEnrichers(fake.db, PRODUCT_SCOPE_KEYS_ENTITY_TYPE, targets)

    expect(targets[0].doc.scope_keys).toBeNull()
    expect(targets[1].doc.scope_keys).toBeNull()
    expect(isProductScopeIndexed(targets[0].doc)).toBe(false)
  })
})

describe('isProductScopeIndexed', () => {
  it('treats null, a missing key and malformed values as not indexed', () => {
    expect(isProductScopeIndexed(null)).toBe(false)
    expect(isProductScopeIndexed(undefined)).toBe(false)
    expect(isProductScopeIndexed({})).toBe(false)
    expect(isProductScopeIndexed({ scope_keys: null })).toBe(false)
    expect(isProductScopeIndexed({ scope_keys: 'cat:1' })).toBe(false)
    expect(isProductScopeIndexed({ scope_keys: ['cat:1', 2] })).toBe(false)
  })

  it('treats a string array, including an empty one, as indexed', () => {
    expect(isProductScopeIndexed({ scope_keys: [] })).toBe(true)
    expect(isProductScopeIndexed({ scope_keys: ['cat:1', 'tag:2'] })).toBe(true)
  })
})
