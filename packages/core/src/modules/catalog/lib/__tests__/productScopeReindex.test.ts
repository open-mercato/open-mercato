import updatedHandler, { metadata as updatedMetadata } from '../../subscribers/product-scope-keys-category-updated'
import deletedHandler, { metadata as deletedMetadata } from '../../subscribers/product-scope-keys-category-deleted'
import { reindexProductsForCategorySubtree } from '../productScopeReindex'
import { createFakeKysely, type FakeKysely, type RecordedQuery } from './fakeKysely'

const TENANT = 'tenant-1'
const ORG = 'org-1'

type Emitted = { event: string; payload: Record<string, unknown>; options?: Record<string, unknown> }

function setup(options: { descendantIds?: unknown; productIds?: string[] } = {}) {
  const respond = (query: RecordedQuery) => {
    if (query.sql.includes('from "catalog_product_categories"')) {
      return options.descendantIds === undefined ? [] : [{ id: 'cat-moved', descendant_ids: options.descendantIds }]
    }
    if (query.sql.includes('catalog_product_category_assignments')) {
      return (options.productIds ?? []).map((productId) => ({ product_id: productId }))
    }
    return []
  }
  const fake: FakeKysely = createFakeKysely(respond)
  const emitted: Emitted[] = []
  const bus = {
    emitEvent: jest.fn(async (event: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
      emitted.push({ event, payload, options: opts })
    }),
  }
  const em = { getKysely: () => fake.db }
  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'eventBus') return bus as T
      throw new Error(`[internal] unexpected resolve ${name}`)
    },
  }
  return { fake, emitted, ctx }
}

describe('product scope_keys reindex subscribers', () => {
  it('subscribes persistently to category update and delete', () => {
    expect(updatedMetadata).toEqual(expect.objectContaining({ event: 'catalog.category.updated', persistent: true }))
    expect(deletedMetadata).toEqual(expect.objectContaining({ event: 'catalog.category.deleted', persistent: true }))
  })

  it('ignores category updates that did not change the hierarchy', async () => {
    const { fake, emitted, ctx } = setup({ descendantIds: [], productIds: ['p1'] })
    await updatedHandler({ id: 'cat-moved', tenantId: TENANT, organizationId: ORG }, ctx)
    await updatedHandler({ id: 'cat-moved', tenantId: TENANT, organizationId: ORG, hierarchyChanged: false }, ctx)
    expect(fake.queries).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('re-parent enqueues a reindex of every product in the moved subtree', async () => {
    const { fake, emitted, ctx } = setup({ descendantIds: ['cat-child', 'cat-grandchild'], productIds: ['p1', 'p2'] })

    await updatedHandler({
      id: 'cat-moved',
      tenantId: TENANT,
      organizationId: ORG,
      hierarchyChanged: true,
      previousDescendantIds: ['cat-child', 'cat-former-child'],
    }, ctx)

    expect(fake.queries).toHaveLength(2)
    const [categoryQuery, assignmentQuery] = fake.queries
    expect(categoryQuery.parameters).toEqual(['cat-moved', TENANT, ORG])
    expect(assignmentQuery.sql).toContain('"a"."category_id" in (')
    expect(assignmentQuery.sql).toContain('"p"."deleted_at" is null')
    expect(assignmentQuery.parameters).toEqual(expect.arrayContaining([
      'cat-moved', 'cat-child', 'cat-grandchild', 'cat-former-child', TENANT, ORG,
    ]))
    expect(assignmentQuery.parameters.filter((value) => value === 'cat-child')).toHaveLength(1)

    expect(emitted).toEqual([
      {
        event: 'query_index.upsert_one',
        payload: { entityType: 'catalog:catalog_product', recordId: 'p1', tenantId: TENANT, organizationId: ORG, crudAction: 'updated' },
        options: undefined,
      },
      {
        event: 'query_index.upsert_one',
        payload: { entityType: 'catalog:catalog_product', recordId: 'p2', tenantId: TENANT, organizationId: ORG, crudAction: 'updated' },
        options: undefined,
      },
    ])
  })

  it('category delete enqueues a reindex of products in the deleted subtree', async () => {
    const { emitted, ctx } = setup({ descendantIds: '["cat-child"]', productIds: ['p9'] })
    await deletedHandler({ id: 'cat-moved', tenantId: TENANT, organizationId: ORG }, ctx)
    expect(emitted.map((entry) => [entry.event, entry.payload.recordId])).toEqual([['query_index.upsert_one', 'p9']])
  })

  it('still reindexes the category itself when its row cannot be loaded', async () => {
    const { fake, emitted, ctx } = setup({ productIds: ['p1'] })
    await deletedHandler({ id: 'cat-gone', tenantId: TENANT, organizationId: ORG }, ctx)
    expect(fake.queries[1].parameters).toEqual(expect.arrayContaining(['cat-gone']))
    expect(emitted).toHaveLength(1)
  })

  it('switches to one scoped background reindex job above the upsert limit', async () => {
    const { fake, emitted, ctx } = setup({ descendantIds: [], productIds: ['p1', 'p2', 'p3'] })

    const result = await reindexProductsForCategorySubtree(
      { id: 'cat-moved', tenantId: TENANT, organizationId: ORG, hierarchyChanged: true },
      ctx,
      2,
    )

    expect(result).toEqual({ mode: 'reindex', productCount: 3 })
    expect(fake.queries[1].sql).toContain('limit $')
    expect(fake.queries[1].parameters).toEqual(expect.arrayContaining([3]))
    expect(emitted).toEqual([
      {
        event: 'query_index.reindex',
        payload: { entityType: 'catalog:catalog_product', tenantId: TENANT, organizationId: ORG },
        options: { persistent: true, deliverInline: false },
      },
    ])
  })

  it('does nothing when no product is assigned in the subtree', async () => {
    const { emitted, ctx } = setup({ descendantIds: [], productIds: [] })
    const result = await reindexProductsForCategorySubtree({ id: 'cat-moved', tenantId: TENANT, organizationId: ORG }, ctx)
    expect(result).toEqual({ mode: 'skipped', productCount: 0 })
    expect(emitted).toHaveLength(0)
  })

  it('fails safe on an unscoped payload: no query, no reindex', async () => {
    const { fake, emitted, ctx } = setup({ descendantIds: [], productIds: ['p1'] })
    await deletedHandler({ id: 'cat-moved', tenantId: TENANT }, ctx)
    await updatedHandler({ id: 'cat-moved', organizationId: ORG, hierarchyChanged: true }, ctx)
    expect(fake.queries).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })
})
