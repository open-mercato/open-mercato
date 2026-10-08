import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import { ActionLogService } from '../actionLogService'
import {
  isValidHistoryCursor,
  isValidHistoryTimestamp,
  type ActionLogHistoryDatabase,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORG_ID = '10000000-0000-4000-8000-000000000002'
const OTHER_ORG_ID = '10000000-0000-4000-8000-000000000003'
const LOG_ID = '20000000-0000-4000-8000-000000000001'
const SOURCE_LOG_ID = '20000000-0000-4000-8000-000000000002'
const RECORD_ID = '30000000-0000-4000-8000-000000000001'
const CORRELATION_ID = '40000000-0000-4000-8000-000000000001'

type RecordingDb = {
  db: Kysely<ActionLogHistoryDatabase>
  queries: CompiledQuery[]
  setRows: (rows: Record<string, unknown>[]) => void
  setStatementTimeout: (setting: string) => void
}

function createRecordingDb(): RecordingDb {
  const queries: CompiledQuery[] = []
  let rows: Record<string, unknown>[] = []
  let statementTimeout = '0'
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiledQuery)
      if (compiledQuery.sql.includes('pg_settings')) return { rows: [{ setting: statementTimeout }] as R[] }
      if (compiledQuery.sql.startsWith('select set_config')) return { rows: [] }
      if (/^\s*select/i.test(compiledQuery.sql)) return { rows: rows as R[] }
      return { rows: [] }
    },
    async *streamQuery() {
      throw new Error('[internal] streamQuery is not supported in tests')
    },
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<ActionLogHistoryDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (innerDb) => new PostgresIntrospector(innerDb),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return {
    db,
    queries,
    setRows: (next) => { rows = next },
    setStatementTimeout: (setting) => { statementTimeout = setting },
  }
}

const TIMEOUT_SQL = 'set local statement_timeout = 5000'

function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LOG_ID,
    tenant_id: TENANT_ID,
    organization_id: ORG_ID,
    actor_user_id: '50000000-0000-4000-8000-000000000001',
    on_behalf_of_user_id: null,
    command_id: 'customers.deals.update',
    action_label: 'Update deal',
    action_type: 'edit',
    resource_kind: 'customers.deal',
    resource_id: RECORD_ID,
    parent_resource_kind: null,
    parent_resource_id: null,
    execution_state: 'done',
    snapshot_before: { deal: { status: 'open' } },
    snapshot_after: { deal: { status: 'won' } },
    changes_json: { 'deal.status': { from: 'open', to: 'won' } },
    changed_fields: ['deal.status'],
    context_json: {
      causation: {
        correlationId: CORRELATION_ID,
        frames: [{ kind: 'user' }, { kind: 'workflow', id: 'wf-1', meta: { step: 'approve' } }],
      },
    },
    cause_kind: 'workflow',
    cause_id: 'wf-1',
    correlation_id: CORRELATION_ID,
    caused_by_log_id: null,
    created_at: new Date('2026-10-08T10:00:00.123Z'),
    cursor_at: '2026-10-08T10:00:00.123456Z',
    ...overrides,
  }
}

function buildService(recording: RecordingDb, encryption?: unknown) {
  const em = { getKysely: () => recording.db }
  return new ActionLogService(em as never, encryption as never)
}

const baseQuery = {
  tenantId: TENANT_ID,
  organizationIds: [ORG_ID],
  resourceKinds: ['customers.deal'],
  resourceId: RECORD_ID,
  limit: 100,
}

describe('ActionLogService.findFieldHistory', () => {
  it('queries by resource with tenant and organization scope under a local statement timeout', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.findFieldHistory(baseQuery)

    expect(recording.queries).toHaveLength(2)
    expect(recording.queries[0].sql).toBe('set local statement_timeout = 5000')
    const select = recording.queries[1]
    expect(select.sql).toContain('from "action_logs"')
    expect(select.sql).toContain('"action_logs"."deleted_at" is null')
    expect(select.sql).toContain('"action_logs"."tenant_id" = $1')
    expect(select.sql).toContain('"action_logs"."organization_id" in ($2)')
    expect(select.sql).toContain('("action_logs"."resource_kind" in ($3) and "action_logs"."resource_id" = $4)')
    expect(select.sql).not.toContain('parent_resource_kind" in')
    expect(select.sql).toContain('order by "action_logs"."created_at" desc, "action_logs"."id" desc')
    expect(select.sql).toContain('limit $5')
    expect(select.parameters).toEqual([TENANT_ID, ORG_ID, 'customers.deal', RECORD_ID, 100])
  })

  it('reads tenant-wide when organizationIds is null and adds child rows on request', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.findFieldHistory({ ...baseQuery, organizationIds: null, includeChildren: true })

    const select = recording.queries[1]
    expect(select.sql).not.toContain('"action_logs"."organization_id" in')
    expect(select.sql).toContain('"action_logs"."parent_resource_kind" in ($4) and "action_logs"."parent_resource_id" = $5')
  })

  it('returns nothing without querying for an empty organization scope or missing identifiers', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.findFieldHistory({ ...baseQuery, organizationIds: [] })).resolves.toEqual({ entries: [], nextBefore: null })
    await expect(service.findFieldHistory({ ...baseQuery, tenantId: '' })).resolves.toEqual({ entries: [], nextBefore: null })
    await expect(service.findFieldHistory({ ...baseQuery, resourceKinds: [] })).resolves.toEqual({ entries: [], nextBefore: null })
    expect(recording.queries).toEqual([])
  })

  it('applies the keyset cursor with full timestamp precision', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.findFieldHistory({
      ...baseQuery,
      before: { at: '2026-10-08T10:00:00.123456Z', id: LOG_ID },
    })

    const select = recording.queries[1]
    expect(select.sql).toContain('("action_logs"."created_at" < $5::timestamptz or ("action_logs"."created_at" = $6::timestamptz and "action_logs"."id" < $7))')
    expect(select.parameters).toEqual(expect.arrayContaining(['2026-10-08T10:00:00.123456Z', LOG_ID]))
  })

  it('rejects malformed cursors and clamps the limit', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.findFieldHistory({ ...baseQuery, before: { at: 'yesterday', id: LOG_ID } })).rejects.toThrow(TypeError)
    await expect(service.findFieldHistory({ ...baseQuery, before: { at: '2026-10-08T10:00:00Z', id: 'nope' } })).rejects.toThrow(TypeError)
    await service.findFieldHistory({ ...baseQuery, limit: 5000 })
    expect(recording.queries.at(-1)?.parameters.at(-1)).toBe(500)
  })

  it('maps decrypted rows into history entries with causation frames and a next cursor', async () => {
    const recording = createRecordingDb()
    recording.setRows([
      historyRow(),
      historyRow({
        id: SOURCE_LOG_ID,
        changed_fields: null,
        changes_json: null,
        cause_kind: 'not-a-kind',
        context_json: { historyAction: 'undo', sourceLogId: LOG_ID },
        cursor_at: '2026-10-08T09:00:00.000000Z',
      }),
    ])
    const service = buildService(recording)

    const page = await service.findFieldHistory({ ...baseQuery, limit: 2 })

    expect(page.entries[0]).toEqual(expect.objectContaining({
      logId: LOG_ID,
      at: '2026-10-08T10:00:00.123Z',
      cursorAt: '2026-10-08T10:00:00.123456Z',
      commandId: 'customers.deals.update',
      actionType: 'edit',
      executionState: 'done',
      changedFields: ['deal.status'],
      snapshotBefore: { deal: { status: 'open' } },
      changes: { 'deal.status': { from: 'open', to: 'won' } },
      causeKind: 'workflow',
      causeId: 'wf-1',
      correlationId: CORRELATION_ID,
      organizationId: ORG_ID,
    }))
    expect(page.entries[0].causation).toEqual({
      correlationId: CORRELATION_ID,
      frames: [{ kind: 'user' }, { kind: 'workflow', id: 'wf-1', meta: { step: 'approve' } }],
    })
    expect(page.entries[1]).toEqual(expect.objectContaining({
      changedFields: null,
      changes: null,
      causeKind: null,
      causation: null,
      historyAction: 'undo',
      sourceLogId: LOG_ID,
    }))
    expect(page.nextBefore).toEqual({ at: '2026-10-08T09:00:00.000000Z', id: SOURCE_LOG_ID })
  })

  it('returns no next cursor when the page is not full', async () => {
    const recording = createRecordingDb()
    recording.setRows([historyRow()])
    const service = buildService(recording)

    const page = await service.findFieldHistory(baseQuery)
    expect(page.nextBefore).toBeNull()
  })

  it('decrypts payload columns through the tenant encryption service', async () => {
    const recording = createRecordingDb()
    recording.setRows([historyRow({ snapshot_after: 'encrypted' })])
    const decryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      snapshot_after: JSON.stringify({ deal: { status: 'decrypted' } }),
    }))
    const service = buildService(recording, {
      isEnabled: () => true,
      getDek: async () => null,
      decryptEntityPayload,
    })

    const page = await service.findFieldHistory(baseQuery)

    expect(decryptEntityPayload).toHaveBeenCalledWith(
      'audit_logs:action_log',
      expect.objectContaining({ id: LOG_ID }),
      TENANT_ID,
      ORG_ID,
      expect.anything(),
    )
    expect(page.entries[0].snapshotAfter).toEqual({ deal: { status: 'decrypted' } })
  })

  it('lowers the timeout of an ambient transaction for the read and restores it afterwards', async () => {
    const recording = createRecordingDb()
    recording.setStatementTimeout('30000')
    await recording.db.transaction().execute(async (trx) => {
      const service = new ActionLogService({ getKysely: () => trx } as never)
      await service.findFieldHistory(baseQuery)
    })

    const statements = recording.queries.map((query) => query.sql)
    expect(statements).toHaveLength(4)
    expect(statements[0]).toContain('pg_settings')
    expect(statements[1]).toBe('select set_config(\'statement_timeout\', $1, true)')
    expect(recording.queries[1].parameters).toEqual(['5000'])
    expect(statements[2]).toContain('from "action_logs"')
    expect(statements[3]).toBe('select set_config(\'statement_timeout\', $1, true)')
    expect(recording.queries[3].parameters).toEqual(['30000'])
  })

  it('keeps a stricter ambient transaction timeout unchanged', async () => {
    const recording = createRecordingDb()
    recording.setStatementTimeout('1000')
    await recording.db.transaction().execute(async (trx) => {
      const service = new ActionLogService({ getKysely: () => trx } as never)
      await service.findFieldHistory(baseQuery)
    })

    const statements = recording.queries.map((query) => query.sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('pg_settings')
    expect(statements[1]).toContain('from "action_logs"')
  })
})

describe('ActionLogService history lookups', () => {
  it('loads one entry by id inside the tenant and organization scope', async () => {
    const recording = createRecordingDb()
    recording.setRows([historyRow()])
    const service = buildService(recording)

    const entry = await service.findHistoryEntryById({ tenantId: TENANT_ID, organizationIds: [ORG_ID, OTHER_ORG_ID], id: LOG_ID })

    expect(entry?.logId).toBe(LOG_ID)
    const select = recording.queries[1]
    expect(select.sql).toContain('"action_logs"."tenant_id" = $1')
    expect(select.sql).toContain('"action_logs"."id" = $2')
    expect(select.sql).toContain('"action_logs"."organization_id" in ($3, $4)')
  })

  it('returns null for an empty scope or a malformed id without querying', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.findHistoryEntryById({ tenantId: TENANT_ID, organizationIds: [], id: LOG_ID })).resolves.toBeNull()
    await expect(service.findHistoryEntryById({ tenantId: TENANT_ID, organizationIds: null, id: 'abc' })).resolves.toBeNull()
    expect(recording.queries).toEqual([])
  })

  it('returns plaintext scopes of referenced logs inside the tenant only', async () => {
    const recording = createRecordingDb()
    recording.setRows([{ id: LOG_ID, organization_id: OTHER_ORG_ID, resource_kind: 'customers.deal', resource_id: RECORD_ID }])
    const service = buildService(recording)

    const scopes = await service.findLogScopes({ tenantId: TENANT_ID, ids: [LOG_ID, 'not-a-uuid', LOG_ID] })

    expect(scopes).toEqual([{ id: LOG_ID, organizationId: OTHER_ORG_ID, resourceKind: 'customers.deal', resourceId: RECORD_ID }])
    expect(recording.queries[0].sql).toBe(TIMEOUT_SQL)
    expect(recording.queries[1].sql).toContain('"action_logs"."tenant_id" = $1')
    expect(recording.queries[1].parameters).toEqual([TENANT_ID, LOG_ID])
  })

  it('looks up every referenced log in chunks of 500 instead of dropping ids', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)
    const ids = Array.from({ length: 1200 }, (_unused, index) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`)

    await service.findLogScopes({ tenantId: TENANT_ID, ids })

    const selects = recording.queries.filter((query) => query.sql.includes('from "action_logs"'))
    expect(recording.queries[0].sql).toBe(TIMEOUT_SQL)
    expect(selects.map((query) => query.parameters.length - 1)).toEqual([500, 500, 200])
    expect(selects.flatMap((query) => query.parameters.slice(1))).toEqual(ids)
  })

  it('aggregates history rows by resource kind and cause kind', async () => {
    const recording = createRecordingDb()
    recording.setRows([
      { resource_kind: 'customers.deal', cause_kind: null, row_count: '3' },
      { resource_kind: 'customers.deal', cause_kind: 'workflow', row_count: '2' },
    ])
    const service = buildService(recording)

    const rows = await service.countHistoryByCause({
      tenantId: TENANT_ID,
      resourceKinds: ['customers.deal'],
      since: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(rows).toEqual([
      { resourceKind: 'customers.deal', causeKind: null, count: 3 },
      { resourceKind: 'customers.deal', causeKind: 'workflow', count: 2 },
    ])
    expect(recording.queries[0].sql).toBe(TIMEOUT_SQL)
    expect(recording.queries[1].sql).toContain('group by "action_logs"."resource_kind", "action_logs"."cause_kind"')
    expect(recording.queries[1].sql).toContain('"action_logs"."created_at" >= $3')
  })

  it('lists which resource ids have any history', async () => {
    const recording = createRecordingDb()
    recording.setRows([{ resource_id: RECORD_ID }])
    const service = buildService(recording)

    const ids = await service.findResourceIdsWithHistory({
      tenantId: TENANT_ID,
      resourceKinds: ['customers.deal'],
      resourceIds: [RECORD_ID, 'other'],
    })

    expect(ids).toEqual([RECORD_ID])
    expect(recording.queries[0].sql).toBe(TIMEOUT_SQL)
    expect(recording.queries[1].sql).toContain('select distinct')
  })
})

describe('history cursor validation', () => {
  it.each([
    ['2026-10-08T10:00:00Z', true],
    ['2026-10-08T10:00:00.123456Z', true],
    ['2028-02-29T00:00:00Z', true],
    ['2026-02-31T00:00:00Z', false],
    ['2026-02-29T00:00:00Z', false],
    ['2026-10-08T24:00:00Z', false],
    ['2026-13-01T00:00:00Z', false],
    ['2026-10-08 10:00:00Z', false],
  ])('accepts only real UTC instants: %s', (at, valid) => {
    expect(isValidHistoryTimestamp(at)).toBe(valid)
    expect(isValidHistoryCursor({ at, id: LOG_ID })).toBe(valid)
  })

  it('rejects an impossible cursor date before querying', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.findFieldHistory({ ...baseQuery, before: { at: '2026-02-31T00:00:00Z', id: LOG_ID } })).rejects.toThrow(TypeError)
    expect(recording.queries).toEqual([])
  })
})
