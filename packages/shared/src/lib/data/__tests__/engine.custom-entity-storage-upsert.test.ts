import fs from 'node:fs'
import path from 'node:path'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { registerEntityIds } from '../../encryption/entityIds'

const ENTITY_ID = 'example:todo'
const RECORD_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../core/src/modules/entities/migrations')

type SnapshotIndex = { keyName: string; unique: boolean; primary: boolean; expression?: string | null }
type SnapshotTable = { name: string; indexes: SnapshotIndex[] }

type Operation = 'table-check' | 'select' | 'insert' | 'update' | 'delete'
type QueryCall = { operation: Operation; scopes: Array<[string, string, unknown]>; onConflict: boolean }

function buildEngine(options: { updatedRows: number }) {
  const queries: QueryCall[] = []
  const buildQuery = (operation: Operation) => {
    const query: QueryCall = { operation, scopes: [], onConflict: false }
    queries.push(query)
    const chain = {
      select: () => chain,
      values: () => chain,
      set: () => chain,
      where: (column: string, operator: string, value: unknown) => {
        query.scopes.push([column, operator, value])
        return chain
      },
      onConflict: () => {
        query.onConflict = true
        return chain
      },
      executeTakeFirst: async () => {
        if (operation === 'table-check') return { present: 1 }
        return { numUpdatedRows: BigInt(options.updatedRows) }
      },
      execute: async () => [],
    }
    return chain
  }
  const db = {
    selectFrom: (table: string) => buildQuery(table === 'information_schema.tables' ? 'table-check' : 'select'),
    insertInto: () => buildQuery('insert'),
    updateTable: () => buildQuery('update'),
    deleteFrom: () => buildQuery('delete'),
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

function readStorageTableSnapshot(): SnapshotTable {
  const snapshot = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, '.snapshot-open-mercato.json'), 'utf8')) as { tables: SnapshotTable[] }
  const table = snapshot.tables.find((entry) => entry.name === 'custom_entities_storage')
  if (!table) throw new Error('[internal] custom_entities_storage missing from entities snapshot')
  return table
}

function readMigrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^Migration.*\.ts$/.test(file))
    .map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n')
}

describe('custom_entities_storage write strategy is pinned to its index definition', () => {
  beforeEach(() => {
    registerEntityIds({ example: { todo: ENTITY_ID } })
    clearDataEngineTableExistsCache()
  })

  afterEach(() => {
    registerEntityIds({})
  })

  test('the table has no unique arbiter index an ON CONFLICT target could match', () => {
    const table = readStorageTableSnapshot()
    const uniqueNonPrimary = table.indexes.filter((index) => index.unique && !index.primary)
    expect(uniqueNonPrimary).toEqual([])
    expect(table.indexes.find((index) => index.keyName === 'custom_entities_storage_unique_idx')?.unique).toBe(false)

    const sql = readMigrationSql()
    expect(sql).toContain('create index "custom_entities_storage_unique_idx" on "custom_entities_storage" ("entity_type", "entity_id", "organization_id");')
    expect(sql).not.toMatch(/create unique index[^;]*on "custom_entities_storage"/i)
    expect(sql).not.toMatch(/alter table "custom_entities_storage"[^;]*add constraint[^;]*unique/i)
  })

  test.each([
    ['organization + tenant scope', ORG_ID, TENANT_ID],
    ['global scope', null, null],
  ] as const)('create never issues ON CONFLICT and updates in place when the row exists (%s)', async (_label, organizationId, tenantId) => {
    const { engine, queries } = buildEngine({ updatedRows: 1 })

    await engine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId, tenantId, values: {} })

    expect(queries.some((query) => query.onConflict)).toBe(false)
    expect(queries.filter((query) => query.operation === 'insert')).toHaveLength(0)
    const update = queries.find((query) => query.operation === 'update')!
    expect(update.scopes).toEqual([
      ['entity_type', '=', ENTITY_ID],
      ['entity_id', '=', RECORD_ID],
      organizationId === null ? ['organization_id', 'is', null] : ['organization_id', '=', organizationId],
      tenantId === null ? ['tenant_id', 'is', null] : ['tenant_id', '=', tenantId],
    ])
  })

  test('create inserts exactly once when no row matches the scoped update', async () => {
    const { engine, queries } = buildEngine({ updatedRows: 0 })

    await engine.createCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: ORG_ID, tenantId: TENANT_ID, values: {} })

    expect(queries.some((query) => query.onConflict)).toBe(false)
    const writes = queries.filter((query) => query.operation === 'update' || query.operation === 'insert').map((query) => query.operation)
    expect(writes).toEqual(['update', 'insert'])
  })

  test('update shares the same scoped update-then-insert write', async () => {
    const { engine, queries } = buildEngine({ updatedRows: 0 })

    await engine.updateCustomEntityRecord({ entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: ORG_ID, tenantId: TENANT_ID, values: {} })

    expect(queries.some((query) => query.onConflict)).toBe(false)
    const writes = queries.filter((query) => query.operation === 'update' || query.operation === 'insert').map((query) => query.operation)
    expect(writes).toEqual(['update', 'insert'])
  })
})
