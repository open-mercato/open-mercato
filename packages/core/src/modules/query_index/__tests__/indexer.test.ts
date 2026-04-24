import { buildIndexDoc, upsertIndexRow, markDeleted } from '../../query_index/lib/indexer'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(),
}))

type TableData = {
  baseTable: string
  baseRows: any[]
  cfValues: any[]
  indexRows?: any[]
}

function createFakeKysely(data: TableData) {
  const inserts: any[] = []
  const updates: any[] = []
  const deletes: any[] = []
  const indexRows = Array.isArray(data.indexRows) ? [...data.indexRows] : []

  const makeExecutor = (onResolve: () => any): any => {
    const exec = async () => onResolve()
    return exec
  }

  const makeSelect = (table: string): any => {
    const state = {
      where: [] as any[],
      selects: [] as any[],
    }
    const chain: any = {
      _ops: state,
      select: (..._cols: any[]) => chain,
      selectAll: () => chain,
      distinct: () => chain,
      where: (..._args: any[]) => { state.where.push(_args); return chain },
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      groupBy: () => chain,
      executeTakeFirst: async () => {
        if (table === data.baseTable) return data.baseRows[0]
        if (table === 'entity_indexes') return indexRows[0]
        if (table === 'entity_translations') return undefined
        return undefined
      },
      execute: async () => {
        if (table === 'custom_field_values') return data.cfValues
        if (table === data.baseTable) return data.baseRows
        return []
      },
    }
    return chain
  }

  const makeInsert = (table: string): any => {
    const entry: any = { table, payload: null, conflictColumns: null, merge: null }
    inserts.push(entry)
    const chain: any = {
      values: (payload: any) => { entry.payload = payload; return chain },
      onConflict: (cb: any) => {
        const ocBuilder: any = {
          columns: (cols: string[]) => { entry.conflictColumns = cols; return ocBuilder },
          doUpdateSet: (merge: any) => { entry.merge = merge; return ocBuilder },
        }
        cb(ocBuilder)
        return chain
      },
      returning: () => chain,
      execute: async () => (table === 'entity_indexes' ? [] : []),
      executeTakeFirst: async () => ({ numInsertedOrUpdatedRows: 1 }),
    }
    return chain
  }

  const makeUpdate = (table: string): any => {
    const entry: any = { table, payload: null, where: [] as any[] }
    updates.push(entry)
    const chain: any = {
      set: (payload: any) => { entry.payload = payload; return chain },
      where: (...args: any[]) => { entry.where.push(args); return chain },
      execute: async () => [{ numUpdatedRows: 1n }],
      executeTakeFirst: async () => ({ numUpdatedRows: 1n }),
    }
    return chain
  }

  const makeDelete = (table: string): any => {
    const entry: any = { table, where: [] as any[] }
    deletes.push(entry)
    const chain: any = {
      where: (...args: any[]) => { entry.where.push(args); return chain },
      execute: async () => {
        if (table === 'entity_indexes') indexRows.length = 0
        return [{ numDeletedRows: 1n }]
      },
    }
    return chain
  }

  const db: any = {
    selectFrom: (table: any) => makeSelect(String(table)),
    insertInto: (table: any) => makeInsert(String(table)),
    updateTable: (table: any) => makeUpdate(String(table)),
    deleteFrom: (table: any) => makeDelete(String(table)),
    transaction: () => ({
      execute: async (fn: (trx: any) => Promise<any>) => fn(db),
    }),
  }

  return { db, inserts, updates, deletes }
}

const resolveEncryptionMock = resolveTenantEncryptionService as jest.Mock

describe('Indexer', () => {
  beforeEach(() => {
    resolveEncryptionMock.mockReset()
  })

  test('buildIndexDoc composes base row and custom fields (singleton and arrays)', async () => {
    const fake = createFakeKysely({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'A', organization_id: 'org1', tenant_id: 't1' }],
      cfValues: [
        { field_key: 'vip', value_bool: true },
        { field_key: 'tags', value_text: 'a' },
        { field_key: 'tags', value_text: 'b' },
      ],
    })
    const em: any = { getKysely: () => fake.db }
    const doc = await buildIndexDoc(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    expect(doc).toBeTruthy()
    expect(doc!.id).toBe('1')
    expect(doc!['cf:vip']).toBe(true)
    expect(doc!['cf:tags']).toEqual(['a', 'b'])
    expect(doc!.search_text).toContain('A')
    expect(doc!.search_text).toContain('b')
  })

  test('buildIndexDoc keeps encrypted payload (no decryption on write)', async () => {
    resolveEncryptionMock.mockReturnValue({
      isEnabled: () => true,
      decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => ({
        ...payload,
        title: 'Decrypted',
      }),
    })
    const fake = createFakeKysely({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'Encrypted', organization_id: 'org1', tenant_id: 't1' }],
      cfValues: [{ field_key: 'secret', value_text: 'enc' }],
    })
    const em: any = { getKysely: () => fake.db }
    const doc = await buildIndexDoc(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    expect(doc).toBeTruthy()
    expect(doc!.title).toBe('Encrypted')
    expect(doc!['cf:secret']).toBe('enc')
  })

  test('upsertIndexRow inserts or merges index row with built doc', async () => {
    const fake = createFakeKysely({
      baseTable: 'todos',
      baseRows: [{ id: '1', title: 'A' }],
      cfValues: [{ field_key: 'vip', value_bool: false }],
    })
    const em: any = { getKysely: () => fake.db }
    await upsertIndexRow(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1', tenantId: 't1' })
    const lastInsert = fake.inserts[fake.inserts.length - 1]
    expect(lastInsert.table).toBe('entity_indexes')
    expect(lastInsert.conflictColumns).toEqual(['entity_type', 'entity_id', 'organization_id_coalesced'])
    expect(lastInsert.payload.entity_type).toBe('example:todo')
    expect(lastInsert.payload.entity_id).toBe('1')
    expect(lastInsert.payload.organization_id).toBe('org1')
    expect(lastInsert.payload.tenant_id).toBe('t1')
    // merge payload contains the doc stamp via raw sql fragment (JSON); presence suffices here
    expect(lastInsert.merge).toBeTruthy()
    expect(lastInsert.merge.index_version).toBe(1)
  })

  test('upsertIndexRow removes index row when base row missing', async () => {
    const fake = createFakeKysely({
      baseTable: 'todos',
      baseRows: [],
      cfValues: [],
      indexRows: [{ entity_type: 'example:todo', entity_id: 'x', organization_id: 'org1', deleted_at: null }],
    })
    const em: any = { getKysely: () => fake.db }
    await upsertIndexRow(em, { entityType: 'example:todo', recordId: 'x', organizationId: 'org1' })
    const lastDelete = fake.deletes[fake.deletes.length - 1]
    expect(lastDelete.table).toBe('entity_indexes')
    // Verify scoping via where-args contains entity_type and entity_id
    const flatArgs = lastDelete.where.flat(2).map((v: unknown) => String(v))
    expect(flatArgs).toEqual(expect.arrayContaining(['entity_type', 'example:todo']))
    expect(flatArgs).toEqual(expect.arrayContaining(['entity_id', 'x']))
  })

  test('markDeleted removes index row', async () => {
    const fake = createFakeKysely({
      baseTable: 'todos',
      baseRows: [],
      cfValues: [],
      indexRows: [{ entity_type: 'example:todo', entity_id: '1', organization_id: 'org1', deleted_at: null }],
    })
    const em: any = { getKysely: () => fake.db }
    await markDeleted(em, { entityType: 'example:todo', recordId: '1', organizationId: 'org1' })
    const del = fake.deletes[fake.deletes.length - 1]
    expect(del.table).toBe('entity_indexes')
  })
})
