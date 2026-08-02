import { DefaultDataEngine } from '../engine'
import { registerEntityIds } from '../../encryption/entityIds'

const ENTITY_ID = 'example:todo'
const RECORD_ID = '11111111-1111-4111-8111-111111111111'

type ScopeCall = [column: string, operator: string, value: unknown]
type QueryCall = {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'table-check'
  scopes: ScopeCall[]
}

function buildDb(options: { rejectFirstInsert?: boolean } = {}) {
  const queries: QueryCall[] = []
  let rejectFirstInsert = options.rejectFirstInsert === true

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
      onConflict: (callback: (builder: {
        columns: (_columns: string[]) => { doUpdateSet: (_values: unknown) => unknown }
      }) => unknown) => {
        callback({
          columns: (_columns) => ({ doUpdateSet: (_values) => ({}) }),
        })
        return chain
      },
      executeTakeFirst: async () => {
        if (operation === 'table-check') return { present: 1 }
        if (operation === 'select') return { doc: { id: RECORD_ID, before: true } }
        return { numUpdatedRows: 1n }
      },
      execute: async () => {
        if (operation === 'insert' && rejectFirstInsert) {
          rejectFirstInsert = false
          throw new Error('[internal] force create fallback')
        }
        return []
      },
    }

    return chain
  }

  return {
    queries,
    db: {
      selectFrom: (table: string) => buildQuery(table === 'information_schema.tables' ? 'table-check' : 'select'),
      insertInto: (_table: string) => buildQuery('insert'),
      updateTable: (_table: string) => buildQuery('update'),
      deleteFrom: (_table: string) => buildQuery('delete'),
    },
  }
}

function buildEngine(options: { rejectFirstInsert?: boolean } = {}) {
  const { db, queries } = buildDb(options)
  const em = {
    getKysely: () => db,
    getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
    find: async () => [],
    persist: () => undefined,
    flush: async () => undefined,
  }
  return {
    engine: new DefaultDataEngine(em as never, {} as never),
    queries,
  }
}

function expectTenantScope(query: QueryCall, tenantId: string | null | undefined) {
  expect(query.scopes).toContainEqual(
    tenantId === null || tenantId === undefined
      ? ['tenant_id', 'is', null]
      : ['tenant_id', '=', tenantId],
  )
}

describe('custom-entity document storage tenant scope', () => {
  beforeEach(() => {
    registerEntityIds({ example: { todo: ENTITY_ID } })
  })

  afterEach(() => {
    registerEntityIds({})
  })

  test.each([
    ['non-null tenant', 'tenant-1'],
    ['global tenant', null],
    ['omitted tenant', undefined],
  ] as const)('create fallback update scopes %s', async (_label, tenantId) => {
    const { engine, queries } = buildEngine({ rejectFirstInsert: true })

    await engine.createCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: null,
      ...(tenantId === undefined ? {} : { tenantId }),
      values: {},
    })

    expectTenantScope(queries.find((query) => query.operation === 'update')!, tenantId)
  })

  test.each([
    ['non-null tenant', 'tenant-1'],
    ['global tenant', null],
    ['omitted tenant', undefined],
  ] as const)('update read and write scope %s', async (_label, tenantId) => {
    const { engine, queries } = buildEngine()

    await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: null,
      ...(tenantId === undefined ? {} : { tenantId }),
      values: {},
    })

    expectTenantScope(queries.find((query) => query.operation === 'select')!, tenantId)
    expectTenantScope(queries.find((query) => query.operation === 'update')!, tenantId)
  })

  test.each([
    ['soft delete', true],
    ['hard delete', false],
  ] as const)('%s scopes both non-null and global tenants', async (_label, soft) => {
    for (const tenantId of ['tenant-1', null, undefined] as const) {
      const { engine, queries } = buildEngine()

      await engine.deleteCustomEntityRecord({
        entityId: ENTITY_ID,
        recordId: RECORD_ID,
        organizationId: null,
        ...(tenantId === undefined ? {} : { tenantId }),
        soft,
      })

      const operation = soft ? 'update' : 'delete'
      expectTenantScope(queries.find((query) => query.operation === operation)!, tenantId)
    }
  })
})
