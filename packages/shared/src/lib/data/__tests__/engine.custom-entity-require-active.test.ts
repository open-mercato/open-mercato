import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { registerEntityIds } from '../../encryption/entityIds'
import { isCrudHttpError } from '../../crud/errors'

const ENTITY_ID = 'example:todo'
const RECORD_ID = '11111111-1111-4111-8111-111111111111'

type ScopeCall = [column: string, operator: string, value: unknown]
type QueryCall = {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'table-check'
  scopes: ScopeCall[]
}

type StorageOptions = {
  selectRow: { doc: Record<string, unknown> } | undefined
  updatedRows: number
}

function buildEngine(options: StorageOptions) {
  const queries: QueryCall[] = []

  const buildQuery = (operation: QueryCall['operation']) => {
    const query: QueryCall = { operation, scopes: [] }
    queries.push(query)
    const chain = {
      select: (_selection: unknown) => chain,
      values: (_values: unknown) => chain,
      set: (_values: unknown) => chain,
      where: (column: string, operator: string, value: unknown) => {
        query.scopes.push([column, operator, value])
        return chain
      },
      executeTakeFirst: async () => {
        if (operation === 'table-check') return { present: 1 }
        if (operation === 'select') return options.selectRow
        return { numUpdatedRows: BigInt(options.updatedRows) }
      },
      execute: async () => [],
    }
    return chain
  }

  const db = {
    selectFrom: (table: string) => buildQuery(table === 'information_schema.tables' ? 'table-check' : 'select'),
    insertInto: (_table: string) => buildQuery('insert'),
    updateTable: (_table: string) => buildQuery('update'),
    deleteFrom: (_table: string) => buildQuery('delete'),
  }
  const em = {
    getKysely: () => db,
    getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
    find: async () => [],
    persist: () => undefined,
    flush: async () => undefined,
  }
  return { engine: new DefaultDataEngine(em as never, {} as never), queries }
}

const activeOnly: ScopeCall = ['deleted_at', 'is', null]

describe('updateCustomEntityRecord requireActive', () => {
  beforeEach(() => {
    registerEntityIds({ example: { todo: ENTITY_ID } })
    clearDataEngineTableExistsCache()
  })

  afterEach(() => {
    registerEntityIds({})
  })

  test('scopes the read and the write to non-deleted rows', async () => {
    const { engine, queries } = buildEngine({ selectRow: { doc: { id: RECORD_ID, before: true } }, updatedRows: 1 })

    await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { name: 'edited' },
      requireActive: true,
    })

    expect(queries.find((query) => query.operation === 'select')!.scopes).toContainEqual(activeOnly)
    expect(queries.find((query) => query.operation === 'update')!.scopes).toContainEqual(activeOnly)
    expect(queries.some((query) => query.operation === 'insert')).toBe(false)
  })

  test('throws 404 without writing when no active row exists (unknown or soft-deleted id)', async () => {
    const { engine, queries } = buildEngine({ selectRow: undefined, updatedRows: 0 })

    const error = await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { name: 'created-via-put' },
      requireActive: true,
    }).catch((err: unknown) => err)

    expect(isCrudHttpError(error) && error.status).toBe(404)
    expect(queries.some((query) => query.operation === 'update' || query.operation === 'insert')).toBe(false)
  })

  test('throws 404 without inserting when the row is deleted between the read and the write', async () => {
    const { engine, queries } = buildEngine({ selectRow: { doc: { id: RECORD_ID } }, updatedRows: 0 })

    const error = await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { name: 'edited' },
      requireActive: true,
    }).catch((err: unknown) => err)

    expect(isCrudHttpError(error) && error.status).toBe(404)
    expect(queries.some((query) => query.operation === 'insert')).toBe(false)
  })

  test('keeps the upsert behaviour when requireActive is not set', async () => {
    const { engine, queries } = buildEngine({ selectRow: undefined, updatedRows: 0 })

    await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { name: 'upserted' },
    })

    expect(queries.find((query) => query.operation === 'select')!.scopes).not.toContainEqual(activeOnly)
    expect(queries.some((query) => query.operation === 'insert')).toBe(true)
  })
})
