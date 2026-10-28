import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { registerEntityIds } from '../../encryption/entityIds'
import { withAdvisoryXactLock } from '../../db/advisoryLock'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

const ENTITY_ID = 'user:qa_record'
const RECORD_ID = 'a1234567-e89b-42d3-a456-426614174000'
const mockTxEm = { getKysely: jest.fn() }

jest.mock('../../db/advisoryLock', () => ({
  withAdvisoryXactLock: jest.fn(async (
    _em: unknown,
    _key: string,
    work: (txEm: typeof mockTxEm) => Promise<unknown>,
  ) => work(mockTxEm)),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

type StorageRow = {
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string | null
  doc: Record<string, unknown>
  deleted_at: string | null
}

function buildEngine(rows: StorageRow[] = [], insertError?: unknown) {
  const filters: Array<[unknown, string, unknown]> = []
  const select = {
    select: (_column: string) => select,
    where: (column: unknown, operator: string, value: unknown) => {
      filters.push([column, operator, value])
      return select
    },
    executeTakeFirst: jest.fn(async () => rows.find((row) => filters.every(([column, _operator, value]) => (
      typeof column === 'string'
        ? row[column as keyof StorageRow] === value
        : row.entity_id.toLowerCase() === value
    )))),
  }
  const insert = {
    values: jest.fn((_payload: unknown) => insert),
    execute: jest.fn(async () => {
      if (insertError) throw insertError
      return []
    }),
  }
  const transactionDb = {
    selectFrom: jest.fn(() => select),
    insertInto: jest.fn(() => insert),
  }
  mockTxEm.getKysely.mockReturnValue(transactionDb)
  const legacyWrite = {
    values: (_payload: unknown) => legacyWrite,
    onConflict: (_callback: unknown) => legacyWrite,
    set: (_values: unknown) => legacyWrite,
    where: (_column: unknown, _operator: string, _value: unknown) => legacyWrite,
    execute: async () => {
      if (insertError) throw insertError
      return []
    },
    executeTakeFirst: async () => ({ numUpdatedRows: 1n }),
  }
  const requestDb = {
    selectFrom: jest.fn(() => ({
      select: () => ({ where: () => ({ executeTakeFirst: async () => ({ present: 1 }) }) }),
    })),
    insertInto: jest.fn(() => legacyWrite),
    updateTable: jest.fn(() => legacyWrite),
  }
  const em = {
    getKysely: () => requestDb,
    getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
    find: async () => [],
  }
  return {
    engine: new DefaultDataEngine(em as never, {} as never),
    em, requestDb, transactionDb, insert, filters,
  }
}

const existingRow: StorageRow = {
  entity_type: ENTITY_ID,
  entity_id: RECORD_ID,
  organization_id: 'org-a',
  tenant_id: 'tenant-a',
  doc: { id: RECORD_ID, title: 'Newer document' },
  deleted_at: null,
}

describe('create-only custom entity records', () => {
  const previousBackcompat = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM

  beforeEach(() => {
    jest.clearAllMocks()
    clearDataEngineTableExistsCache()
    registerEntityIds({})
    process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'true'
  })

  afterEach(() => {
    if (previousBackcompat === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = previousBackcompat
  })

  test.each([null, '2026-10-28T00:00:00.000Z'])('rejects an existing UUID, including tombstones (%s)', async (deletedAt) => {
    const row = { ...existingRow, deleted_at: deletedAt }
    const { engine, transactionDb, requestDb } = buildEngine([row])

    await expect(engine.createCustomEntityRecord({
      entityId: ENTITY_ID, recordId: RECORD_ID.toUpperCase(),
      organizationId: 'org-a', tenantId: 'tenant-a', values: { title: 'Stale document' }, createOnly: true,
    })).rejects.toMatchObject({ status: 409, body: { code: 'custom_entity_record_exists' } })

    expect(row.doc).toEqual({ id: RECORD_ID, title: 'Newer document' })
    expect(transactionDb.insertInto).not.toHaveBeenCalled()
    expect(requestDb.updateTable).not.toHaveBeenCalled()
    expect(setRecordCustomFields).not.toHaveBeenCalled()
  })

  test.each([
    ['tenant-a', 'org-a'], ['tenant-b', 'org-a'], ['tenant-a', 'org-b'], [null, null],
  ] as const)('checks and inserts on the locked transaction for scope %s / %s', async (tenantId, organizationId) => {
    const otherRow = { ...existingRow, entity_id: RECORD_ID.toUpperCase(), tenant_id: 'other-tenant' }
    const { engine, em, insert, filters, requestDb } = buildEngine([otherRow])

    await expect(engine.createCustomEntityRecord({
      entityId: ENTITY_ID, recordId: RECORD_ID.toUpperCase(),
      tenantId, organizationId, values: {}, createOnly: true,
    })).resolves.toEqual({ id: RECORD_ID.toUpperCase() })

    expect(withAdvisoryXactLock).toHaveBeenCalledWith(
      em, `custom_entity_create:${JSON.stringify([tenantId, organizationId, ENTITY_ID, RECORD_ID])}`, expect.any(Function),
    )
    expect(filters).toContainEqual(['tenant_id', tenantId === null ? 'is' : '=', tenantId])
    expect(filters).toContainEqual(['organization_id', organizationId === null ? 'is' : '=', organizationId])
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: RECORD_ID.toUpperCase(), tenant_id: tenantId, organization_id: organizationId,
    }))
    expect(requestDb.insertInto).not.toHaveBeenCalled()
    expect(requestDb.updateTable).not.toHaveBeenCalled()
  })

  test('rejects an uppercase UUID already stored by a legacy caller', async () => {
    const { engine } = buildEngine([{ ...existingRow, entity_id: RECORD_ID.toUpperCase() }])
    await expect(engine.createCustomEntityRecord({
      entityId: ENTITY_ID, recordId: RECORD_ID, tenantId: 'tenant-a', organizationId: 'org-a',
      values: {}, createOnly: true,
    })).rejects.toMatchObject({ status: 409 })
  })

  test.each([
    [{ code: '23505', constraint: 'custom_entities_storage_unique_idx' }, 409],
    [new Error('[internal] storage unavailable'), undefined],
  ] as const)('propagates insert errors without attempting an update (%s)', async (error, status) => {
    const { engine, requestDb } = buildEngine([], error)
    const result = engine.createCustomEntityRecord({
      entityId: ENTITY_ID, recordId: RECORD_ID, organizationId: 'org-a', tenantId: 'tenant-a',
      values: {}, createOnly: true,
    })
    if (status) await expect(result).rejects.toMatchObject({ status })
    else await expect(result).rejects.toBe(error)
    expect(requestDb.updateTable).not.toHaveBeenCalled()
    expect(setRecordCustomFields).not.toHaveBeenCalled()
  })
})
