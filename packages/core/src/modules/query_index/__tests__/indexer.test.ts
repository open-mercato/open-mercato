import { buildIndexDoc, upsertIndexRow, markDeleted } from '../../query_index/lib/indexer'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(),
}))

function createFakeKnex(data: {
  baseTable: string
  baseRows: any[]
  cfValues: any[]
  indexRows?: any[]
}) {
  const calls: any[] = []
  const inserts: any[] = []
  const updates: any[] = []
  const deletes: any[] = []
  const indexRows = Array.isArray(data.indexRows) ? [...data.indexRows] : []

  function raw(sql: string, params?: any[]) { return { toString: () => sql, sql, params } }

  function builderFor(table: string) {
    const ops = { table, wheres: [] as any[], selects: [] as any[] }
    const b: any = {
      _ops: ops,
      select: function (...cols: any[]) { ops.selects.push(cols); return this },
      where: function (...args: any[]) { ops.wheres.push(args[0]); return this },
      andWhere: function (...args: any[]) { ops.wheres.push(args[0]); return this },
      andWhereRaw: function (sql: any, params?: any[]) { ops.wheres.push(['andWhereRaw', sql, params]); return this },
      orWhereNull: function (col: any) { ops.wheres.push(['orWhereNull', col]); return this },
      modify: function (fn: Function) {
        const qb: any = {
          andWhere: (cb: any) => {
            const inner: any = {
              where: (obj: any) => ({
                orWhereNull: (col: any) => { ops.wheres.push(['andWhereFn', obj, ['orWhereNull', col]]); return inner },
              }),
            }
            cb(inner)
            return qb
          },
          whereNull: (col: any) => { ops.wheres.push(['isNull', col]); return qb },
        }
        fn(qb)
        return this
      },
      first: async function () {
        if (table === data.baseTable) return data.baseRows[0]
        if (table === 'entity_indexes') return indexRows[0]
        return undefined
      },
      then: function (resolve: any) {
        if (table === 'custom_field_values') return Promise.resolve(resolve(data.cfValues))
        if (table === data.baseTable) return Promise.resolve(resolve(data.baseRows))
        return Promise.resolve(resolve([]))
      },
      insert: function (payload: any) {
        inserts.push({ table, payload })
        return {
          onConflict: (keys: string[]) => ({
            merge: (mergePayload: any) => { inserts[inserts.length - 1].conflict = keys; inserts[inserts.length - 1].merge = mergePayload; return Promise.resolve() },
          }),
        }
      },
      update: function (payload: any) { updates.push({ table, wheres: ops.wheres, payload }); return Promise.resolve(1) },
      delete: function () { deletes.push({ table, wheres: ops.wheres }); if (table === 'entity_indexes') indexRows.length = 0; return Promise.resolve(1) },
      del: function () { deletes.push({ table, wheres: ops.wheres }); if (table === 'entity_indexes') indexRows.length = 0; return Promise.resolve(1) },
      raw,
    }
    calls.push(b)
    return b
  }
  const fn: any = (t: any) => builderFor(t)
  fn._calls = calls
  fn._inserts = inserts
  fn._updates = updates
  fn._deletes = deletes
  fn.raw = raw
  fn.fn = { now: () => 'now()' }
  return fn
}

const resolveEncryptionMock = resolveTenantEncryptionService as jest.Mock

describe('Indexer', () => {
  beforeEach(() => {
    resolveEncryptionMock.mockReset()
  })

  test('buildIndexDoc composes base row and custom fields (singleton and arrays)', async () => {
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'A', organization_id: 'org1', tenant_id: 't1' }],
      cfValues: [
        { field_key: 'vip', value_bool: true },
        { field_key: 'tags', value_text: 'a' },
        { field_key: 'tags', value_text: 'b' },
      ],
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const doc = await buildIndexDoc(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    expect(doc).toBeTruthy()
    expect(doc!.id).toBe('1')
    expect(doc!['cf:vip']).toBe(true)
    expect(doc!['cf:tags']).toEqual(['a','b'])
  })

  test('buildIndexDoc decrypts indexed payload when encryption is available', async () => {
    resolveEncryptionMock.mockReturnValue({
      isEnabled: () => true,
      decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => ({
        ...payload,
        title: 'Decrypted',
      }),
    })
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'Encrypted', organization_id: 'org1', tenant_id: 't1' }],
      cfValues: [],
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    const doc = await buildIndexDoc(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    expect(doc).toBeTruthy()
    expect(doc!.title).toBe('Decrypted')
    expect(resolveEncryptionMock).toHaveBeenCalled()
  })

  test('upsertIndexRow inserts or merges index row with built doc', async () => {
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'A' }],
      cfValues: [{ field_key: 'vip', value_bool: false }],
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    await upsertIndexRow(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    const lastInsert = fakeKnex._inserts[fakeKnex._inserts.length - 1]
    expect(lastInsert.table).toBe('entity_indexes')
    expect(lastInsert.conflict).toEqual(['entity_type', 'entity_id', 'organization_id_coalesced'])
    expect(lastInsert.merge.entity_type).toBe('example:todo')
    expect(lastInsert.merge.entity_id).toBe('1')
    expect(lastInsert.merge.organization_id).toBe('org1')
    expect(lastInsert.merge.tenant_id).toBe('t1')
    expect(lastInsert.merge.doc['cf:vip']).toBe(false)
  })

  test('upsertIndexRow removes index row when base row missing', async () => {
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      baseRows: [],
      cfValues: [],
      indexRows: [{ entity_type: 'example:todo', entity_id: 'x', organization_id: 'org1', deleted_at: null }],
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    await upsertIndexRow(em, { entityType: 'example:todo', recordId: 'x', organizationId: 'org1' })
    const lastDelete = fakeKnex._deletes[fakeKnex._deletes.length - 1]
    expect(lastDelete.table).toBe('entity_indexes')
    // Ensure where contains expected matching keys
    const whereObj = lastDelete.wheres.find((w: any) => typeof w === 'object')
    expect(whereObj.entity_type).toBe('example:todo')
    expect(whereObj.entity_id).toBe('x')
  })

  test('markDeleted removes index row', async () => {
    const fakeKnex = createFakeKnex({
      baseTable: 'todos',
      baseRows: [],
      cfValues: [],
      indexRows: [{ entity_type: 'example:todo', entity_id: '1', organization_id: 'org1', deleted_at: null }],
    })
    const em: any = { getConnection: () => ({ getKnex: () => fakeKnex }) }
    await markDeleted(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1' })
    const del = fakeKnex._deletes[fakeKnex._deletes.length - 1]
    expect(del.table).toBe('entity_indexes')
  })
})
