import { batchLoadTranslationsMany } from '../batch'

type Row = { entity_type: string; entity_id: string; translations: Record<string, Record<string, unknown>> | null }

function fakeDb(rows: Row[]) {
  const calls: { executions: number; wheres: unknown[][] } = { executions: 0, wheres: [] }
  const builder = {
    select: () => builder,
    where: (...args: unknown[]) => {
      calls.wheres.push(args)
      return builder
    },
    execute: async () => {
      calls.executions += 1
      return rows
    },
  }
  const db = { selectFrom: () => builder } as unknown as Parameters<typeof batchLoadTranslationsMany>[0]
  return { db, calls }
}

describe('batchLoadTranslationsMany', () => {
  it('answers every entity type with one query and keys rows by type and id', async () => {
    const { db, calls } = fakeDb([
      { entity_type: 'catalog:catalog_product', entity_id: 'p-1', translations: { pl: { title: 'Tytuł' } } },
      { entity_type: 'catalog:catalog_product_tag', entity_id: 't-1', translations: null },
      { entity_type: 'catalog:catalog_product_tag', entity_id: 'p-1', translations: { pl: { label: 'stray' } } },
    ])
    const result = await batchLoadTranslationsMany(
      db,
      [
        { entityType: 'catalog:catalog_product', entityIds: ['p-1'] },
        { entityType: 'catalog:catalog_product_tag', entityIds: ['t-1'] },
        { entityType: 'catalog:catalog_product_variant', entityIds: [] },
      ],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(calls.executions).toBe(1)
    expect(calls.wheres[0]).toEqual(['entity_type', 'in', ['catalog:catalog_product', 'catalog:catalog_product_tag']])
    expect(calls.wheres[1]).toEqual(['entity_id', 'in', ['p-1', 't-1']])
    expect(result.get('catalog:catalog_product')?.get('p-1')).toEqual({ pl: { title: 'Tytuł' } })
    expect(result.get('catalog:catalog_product_tag')?.get('t-1')).toEqual({})
    expect(result.get('catalog:catalog_product_tag')?.has('p-1')).toBe(false)
    expect(result.get('catalog:catalog_product_variant')?.size).toBe(0)
  })

  it('skips the query when no ids are requested', async () => {
    const { db, calls } = fakeDb([])
    const result = await batchLoadTranslationsMany(db, [{ entityType: 'catalog:catalog_product', entityIds: [] }], {})
    expect(calls.executions).toBe(0)
    expect(result.get('catalog:catalog_product')?.size).toBe(0)
  })
})
