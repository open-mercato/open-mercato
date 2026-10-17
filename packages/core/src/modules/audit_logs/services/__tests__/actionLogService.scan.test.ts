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
import { decryptWithAesGcm, encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { ActionLogService, hasUndecryptedColumn } from '../actionLogService'
import {
  ACTION_LOG_SCAN_DEFAULT_MAX_BYTES,
  ActionLogDecryptionUnavailableError,
  type ActionLogHistoryDatabase,
  type ActionLogScanQuery,
  type ActionLogStateChangeQuery,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORG_ID = '10000000-0000-4000-8000-000000000002'
const LOG_ONE = '20000000-0000-4000-8000-000000000001'
const LOG_TWO = '20000000-0000-4000-8000-000000000002'
const LOG_THREE = '20000000-0000-4000-8000-000000000003'
const RECORD_ID = '30000000-0000-4000-8000-000000000001'
const CORRELATION_ID = '40000000-0000-4000-8000-000000000001'
const UNTIL = '2026-10-08T12:00:00.000000Z'
const AFTER_AT = '2026-10-08T09:00:00.654321Z'

const TIMEOUT_SQL = 'set local statement_timeout = 5000'
const PROBE_MARKER = 'as "payload_bytes"'
const PAYLOAD_MARKER = '"action_logs"."snapshot_before"'
const STATE_CHANGE_MARKER = 'action_logs.updated_at at time zone'

type RowSet = Record<string, unknown>[]

type RecordingDb = {
  db: Kysely<ActionLogHistoryDatabase>
  queries: CompiledQuery[]
  setProbeRows: (rows: RowSet) => void
  setPayloadRows: (rows: RowSet) => void
  setStateChangeRows: (rows: RowSet) => void
}

type RowSets = {
  probe: RowSet
  payload: RowSet
  stateChanges: RowSet
}

function resolveRows(compiledQuery: CompiledQuery, rowSets: RowSets): RowSet {
  const statement = compiledQuery.sql
  if (!/^\s*select/i.test(statement)) return []
  if (statement.includes(PROBE_MARKER)) return rowSets.probe
  if (statement.includes(PAYLOAD_MARKER)) {
    const requestedIds = new Set(
      compiledQuery.parameters.filter((value): value is string => typeof value === 'string'),
    )
    return rowSets.payload.filter((row) => requestedIds.has(String(row.id)))
  }
  if (statement.includes(STATE_CHANGE_MARKER)) return rowSets.stateChanges
  return []
}

function createRecordingDb(): RecordingDb {
  const queries: CompiledQuery[] = []
  const rowSets: RowSets = { probe: [], payload: [], stateChanges: [] }
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiledQuery)
      return { rows: resolveRows(compiledQuery, rowSets) as R[] }
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
    setProbeRows: (rows) => { rowSets.probe = rows },
    setPayloadRows: (rows) => { rowSets.payload = rows },
    setStateChangeRows: (rows) => { rowSets.stateChanges = rows },
  }
}

type FakeEncryptionService = {
  isEnabled: () => boolean
  getDek: (tenantId: string | null) => Promise<TenantDek | null>
  decryptEntityPayload: jest.Mock
}

function passThroughEncryption(): FakeEncryptionService {
  return {
    isEnabled: () => false,
    getDek: async () => null,
    decryptEntityPayload: jest.fn(),
  }
}

function keyedEncryption(dekKey: string | null, overrides: Partial<FakeEncryptionService> = {}): FakeEncryptionService {
  return {
    isEnabled: () => true,
    getDek: async (tenantId) => (dekKey && tenantId ? { tenantId, key: dekKey, fetchedAt: Date.now() } : null),
    decryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => payload),
    ...overrides,
  }
}

function buildService(recording: RecordingDb, encryption: FakeEncryptionService = passThroughEncryption()) {
  const em = { getKysely: () => recording.db }
  return new ActionLogService(em as never, encryption as never)
}

const PROBE_CURSORS: Record<string, string> = {}

function probeRow(id: string, payloadBytes: string | number): Record<string, unknown> {
  return { id, cursor_at: PROBE_CURSORS[id] ?? '2026-10-08T09:00:00.000000Z', payload_bytes: payloadBytes }
}

function historyRow(id: string, cursorAt: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
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
        frames: [{ kind: 'user' }, { kind: 'workflow', id: 'wf-1' }],
      },
    },
    cause_kind: 'workflow',
    cause_id: 'wf-1',
    correlation_id: CORRELATION_ID,
    caused_by_log_id: null,
    created_at: new Date(cursorAt.replace(/(\.\d{3})\d*Z$/, '$1Z')),
    cursor_at: cursorAt,
    ...overrides,
  }
}

const CURSOR_ONE = '2026-10-08T10:00:00.000001Z'
const CURSOR_TWO = '2026-10-08T10:00:00.000002Z'
const CURSOR_THREE = '2026-10-08T11:30:00.123456Z'

PROBE_CURSORS[LOG_ONE] = CURSOR_ONE
PROBE_CURSORS[LOG_TWO] = CURSOR_TWO
PROBE_CURSORS[LOG_THREE] = CURSOR_THREE

const PAYLOAD_ROWS = [
  historyRow(LOG_ONE, CURSOR_ONE),
  historyRow(LOG_TWO, CURSOR_TWO),
  historyRow(LOG_THREE, CURSOR_THREE),
]

const baseScan: ActionLogScanQuery = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  after: null,
  until: UNTIL,
  limit: 100,
}

function probeQuery(recording: RecordingDb): CompiledQuery {
  const query = recording.queries.find((candidate) => candidate.sql.includes(PROBE_MARKER))
  if (!query) throw new Error('[internal] probe query was not issued')
  return query
}

function payloadQuery(recording: RecordingDb): CompiledQuery | undefined {
  return recording.queries.find((candidate) => candidate.sql.includes(PAYLOAD_MARKER))
}

const ORIGINAL_ENCRYPTION_TOGGLE = process.env.TENANT_DATA_ENCRYPTION

function restoreEncryptionToggle(): void {
  if (ORIGINAL_ENCRYPTION_TOGGLE === undefined) delete process.env.TENANT_DATA_ENCRYPTION
  else process.env.TENANT_DATA_ENCRYPTION = ORIGINAL_ENCRYPTION_TOGGLE
}

describe('ActionLogService.scanDecrypted', () => {
  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
  })

  afterAll(() => {
    restoreEncryptionToggle()
  })

  it('probes then loads the page in one read transaction under the history statement timeout', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '10')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    await service.scanDecrypted(baseScan)

    expect(recording.queries.map((query) => query.sql)).toEqual([
      TIMEOUT_SQL,
      expect.stringContaining(PROBE_MARKER),
      expect.stringContaining(PAYLOAD_MARKER),
    ])
  })

  it('scopes the probe by tenant, organization, live rows and the inclusive upper bound in ascending keyset order', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanDecrypted(baseScan)

    const probe = probeQuery(recording)
    expect(probe.sql).toContain('from "action_logs"')
    expect(probe.sql).toContain('"action_logs"."deleted_at" is null')
    expect(probe.sql).toContain('"action_logs"."tenant_id" = $1')
    expect(probe.sql).toContain('"action_logs"."organization_id" = $2')
    expect(probe.sql).toContain('"action_logs"."created_at" <= $3::timestamptz')
    expect(probe.sql).not.toContain('"action_logs"."resource_kind" in')
    expect(probe.sql).not.toContain('"action_logs"."created_at" >')
    expect(probe.sql).toContain('order by "action_logs"."created_at" asc, "action_logs"."id" asc')
    expect(probe.sql).toContain('limit $4')
    expect(probe.sql).toContain('pg_column_size(action_logs.snapshot_before)')
    expect(probe.sql).toContain('pg_column_size(action_logs.snapshot_after)')
    expect(probe.sql).toContain('pg_column_size(action_logs.changes_json)')
    expect(probe.sql).toContain('pg_column_size(action_logs.context_json)')
    expect(probe.parameters).toEqual([TENANT_ID, ORG_ID, UNTIL, 101])
  })

  it('continues strictly after the cursor with full microsecond precision', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanDecrypted({ ...baseScan, after: { createdAt: AFTER_AT, id: LOG_ONE } })

    const probe = probeQuery(recording)
    expect(probe.sql).toContain(
      '"action_logs"."created_at" >= $4::timestamptz and ("action_logs"."created_at" > $5::timestamptz or ("action_logs"."created_at" = $6::timestamptz and "action_logs"."id" > $7))',
    )
    expect(probe.sql).not.toContain('"action_logs"."id" >= ')
    expect(probe.sql).toContain('limit $8')
    expect(probe.parameters).toEqual([TENANT_ID, ORG_ID, UNTIL, AFTER_AT, AFTER_AT, AFTER_AT, LOG_ONE, 101])
  })

  it('narrows the scan to the normalized resource kinds', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanDecrypted({
      ...baseScan,
      resourceKinds: ['customers.deal', ' customers.deal ', '', 'sales.order'],
      after: { createdAt: AFTER_AT, id: LOG_ONE },
    })

    const probe = probeQuery(recording)
    expect(probe.sql).toContain('"action_logs"."resource_kind" in ($4, $5)')
    expect(probe.parameters).toEqual([
      TENANT_ID,
      ORG_ID,
      UNTIL,
      'customers.deal',
      'sales.order',
      AFTER_AT,
      AFTER_AT,
      AFTER_AT,
      LOG_ONE,
      101,
    ])
  })

  it('returns an exhausted empty page without querying for an empty resource kind list', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)
    const emptyPage = { entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }

    await expect(service.scanDecrypted({ ...baseScan, resourceKinds: [] })).resolves.toEqual(emptyPage)
    await expect(service.scanDecrypted({ ...baseScan, resourceKinds: ['', '   '] })).resolves.toEqual(emptyPage)
    expect(recording.queries).toEqual([])
  })

  it.each([
    ['a non-uuid tenant', { tenantId: 'tenant-1' }],
    ['an empty tenant', { tenantId: '' }],
    ['a non-uuid organization', { organizationId: 'org-1' }],
    ['an empty organization', { organizationId: '   ' }],
  ])('returns an exhausted empty page without querying for %s', async (_label, overrides) => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.scanDecrypted({ ...baseScan, ...overrides })).resolves.toEqual({
      entries: [],
      lastCursor: null,
      exhausted: true,
      payloadBytes: 0,
      undecryptable: 0,
    })
    expect(recording.queries).toEqual([])
  })

  it.each([
    ['a non-timestamp cursor', { after: { createdAt: 'yesterday', id: LOG_ONE } }],
    ['an impossible cursor date', { after: { createdAt: '2026-02-31T00:00:00Z', id: LOG_ONE } }],
    ['a non-uuid cursor id', { after: { createdAt: AFTER_AT, id: 'nope' } }],
    ['a non-timestamp upper bound', { until: 'now' }],
    ['an impossible upper bound', { until: '2026-02-31T00:00:00Z' }],
    ['a local-time upper bound', { until: '2026-10-08 12:00:00Z' }],
  ])('rejects %s with a TypeError before querying', async (_label, overrides) => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.scanDecrypted({ ...baseScan, ...overrides })).rejects.toThrow(TypeError)
    expect(recording.queries).toEqual([])
  })

  it.each([
    [5000, 501],
    [500, 501],
    [0, 2],
    [-3, 2],
    [Number.NaN, 2],
    [7.9, 8],
  ])('clamps limit %p and probes one row past it (%p)', async (limit, probeLimit) => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanDecrypted({ ...baseScan, limit })

    expect(probeQuery(recording).parameters.at(-1)).toBe(probeLimit)
  })

  it('loads only the rows that fit the byte budget and reports the page as not exhausted', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '5'), probeRow(LOG_TWO, '5'), probeRow(LOG_THREE, '50')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, maxBytes: 12 })

    const payload = payloadQuery(recording)
    expect(payload?.sql).toContain('"action_logs"."id" in ($3, $4)')
    expect(payload?.parameters).toEqual([TENANT_ID, ORG_ID, LOG_ONE, LOG_TWO])
    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE, LOG_TWO])
    expect(page.payloadBytes).toBe(10)
    expect(page.exhausted).toBe(false)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_TWO, id: LOG_TWO })
  })

  it('keeps the probe position when picked rows vanish before the payload read and re-checks soft deletion', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '5'), probeRow(LOG_TWO, '5'), probeRow(LOG_THREE, '50')])
    recording.setPayloadRows([])
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, maxBytes: 12 })

    expect(payloadQuery(recording)?.sql).toContain('"action_logs"."deleted_at" is null')
    expect(page.entries).toEqual([])
    expect(page.exhausted).toBe(false)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_TWO, id: LOG_TWO })
  })

  it('still loads a single row larger than the byte budget so the scan makes progress', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '4096'), probeRow(LOG_TWO, '1')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, maxBytes: 12 })

    expect(payloadQuery(recording)?.parameters).toEqual([TENANT_ID, ORG_ID, LOG_ONE])
    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE])
    expect(page.payloadBytes).toBe(4096)
    expect(page.exhausted).toBe(false)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_ONE, id: LOG_ONE })
  })

  it('reports exhaustion once a lone oversized row is the last candidate', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '4096')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, maxBytes: 12 })

    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE])
    expect(page.exhausted).toBe(true)
  })

  it('falls back to the default byte budget for a missing or unusable maxBytes', async () => {
    const half = ACTION_LOG_SCAN_DEFAULT_MAX_BYTES / 2
    for (const maxBytes of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const recording = createRecordingDb()
      recording.setProbeRows([probeRow(LOG_ONE, String(half)), probeRow(LOG_TWO, String(half)), probeRow(LOG_THREE, '1')])
      recording.setPayloadRows(PAYLOAD_ROWS)
      const service = buildService(recording)

      const page = await service.scanDecrypted({ ...baseScan, maxBytes })

      expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE, LOG_TWO])
      expect(page.payloadBytes).toBe(ACTION_LOG_SCAN_DEFAULT_MAX_BYTES)
      expect(page.exhausted).toBe(false)
    }
  })

  it('treats a missing or malformed payload size as zero bytes', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, 'garbage'), { id: LOG_TWO, payload_bytes: null }, probeRow(LOG_THREE, 7)])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, maxBytes: 7 })

    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE, LOG_TWO, LOG_THREE])
    expect(page.payloadBytes).toBe(7)
    expect(page.exhausted).toBe(true)
  })

  it('is exhausted when every candidate is taken and the probe returned no more than the limit', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1'), probeRow(LOG_TWO, '1')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, limit: 2 })

    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE, LOG_TWO])
    expect(page.exhausted).toBe(true)
  })

  it('is not exhausted when the probe returned the extra look-ahead row, which is never loaded', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1'), probeRow(LOG_TWO, '1'), probeRow(LOG_THREE, '1')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    const page = await service.scanDecrypted({ ...baseScan, limit: 2 })

    expect(payloadQuery(recording)?.parameters).toEqual([TENANT_ID, ORG_ID, LOG_ONE, LOG_TWO])
    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE, LOG_TWO])
    expect(page.payloadBytes).toBe(2)
    expect(page.exhausted).toBe(false)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_TWO, id: LOG_TWO })
  })

  it('skips the payload query and returns an exhausted page when the probe finds nothing', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    const page = await service.scanDecrypted(baseScan)

    expect(page).toEqual({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 })
    expect(recording.queries).toHaveLength(2)
    expect(payloadQuery(recording)).toBeUndefined()
  })

  it('loads the payload columns and microsecond cursor inside the tenant and organization scope', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1'), probeRow(LOG_TWO, '1')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const service = buildService(recording)

    await service.scanDecrypted(baseScan)

    const payload = payloadQuery(recording)
    expect(payload?.sql).toContain('"action_logs"."snapshot_after"')
    expect(payload?.sql).toContain('"action_logs"."changes_json"')
    expect(payload?.sql).toContain('"action_logs"."context_json"')
    expect(payload?.sql).toContain(
      'to_char(action_logs.created_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') as "cursor_at"',
    )
    expect(payload?.sql).toContain('"action_logs"."tenant_id" = $1')
    expect(payload?.sql).toContain('"action_logs"."organization_id" = $2')
    expect(payload?.sql).toContain('"action_logs"."id" in ($3, $4)')
    expect(payload?.sql).toContain('order by "action_logs"."created_at" asc, "action_logs"."id" asc')
  })

  it('maps rows through the decrypt path into history entries and returns the last cursor', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '3'), probeRow(LOG_THREE, '4')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    const encryption = passThroughEncryption()
    const service = buildService(recording, encryption)

    const page = await service.scanDecrypted(baseScan)

    expect(encryption.decryptEntityPayload).not.toHaveBeenCalled()
    expect(page.entries).toHaveLength(2)
    expect(page.entries[0]).toEqual(expect.objectContaining({
      logId: LOG_ONE,
      cursorAt: CURSOR_ONE,
      at: '2026-10-08T10:00:00.000Z',
      commandId: 'customers.deals.update',
      organizationId: ORG_ID,
      resourceKind: 'customers.deal',
      resourceId: RECORD_ID,
      snapshotBefore: { deal: { status: 'open' } },
      snapshotAfter: { deal: { status: 'won' } },
      changes: { 'deal.status': { from: 'open', to: 'won' } },
      causeKind: 'workflow',
      correlationId: CORRELATION_ID,
    }))
    expect(page.entries[1].logId).toBe(LOG_THREE)
    expect(page.entries[1].cursorAt).toBe(CURSOR_THREE)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_THREE, id: LOG_THREE })
    expect(page.payloadBytes).toBe(7)
    expect(page.exhausted).toBe(true)
  })

  it('decrypts every loaded row through the tenant encryption service', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([historyRow(LOG_ONE, CURSOR_ONE, { snapshot_after: 'encrypted' })])
    const decryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      snapshot_after: JSON.stringify({ deal: { status: 'decrypted' } }),
    }))
    const service = buildService(recording, {
      isEnabled: () => true,
      getDek: async () => null,
      decryptEntityPayload,
    })

    const page = await service.scanDecrypted(baseScan)

    expect(decryptEntityPayload).toHaveBeenCalledTimes(1)
    expect(decryptEntityPayload).toHaveBeenCalledWith(
      'audit_logs:action_log',
      expect.objectContaining({ id: LOG_ONE }),
      TENANT_ID,
      ORG_ID,
      expect.anything(),
    )
    expect(page.entries[0].snapshotAfter).toEqual({ deal: { status: 'decrypted' } })
    expect(page.entries[0].cursorAt).toBe(CURSOR_ONE)
    expect(page.undecryptable).toBe(0)
  })

  it('refuses to scan while tenant data encryption is on but no encryption service can decrypt', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows(PAYLOAD_ROWS)
    await expect(buildService(recording).scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
    const missing = new ActionLogService({ getKysely: () => recording.db } as never)
    await expect(missing.scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
    expect(recording.queries).toEqual([])
  })

  it('propagates a decryption failure instead of returning the sealed row', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([historyRow(LOG_ONE, CURSOR_ONE)])
    const service = buildService(recording, {
      isEnabled: () => true,
      getDek: async () => null,
      decryptEntityPayload: jest.fn(async () => {
        throw new Error('encryption map lookup failed')
      }),
    })
    await expect(service.scanDecrypted(baseScan)).rejects.toThrow('encryption map lookup failed')
  })

  it('leaves out and counts rows sealed under a key other than the obtained data key, keeping the cursor past them', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const sealed = encryptWithAesGcm('customers.deals.update', generateDek()).value
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1'), probeRow(LOG_TWO, '1'), probeRow(LOG_THREE, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE),
      historyRow(LOG_TWO, CURSOR_TWO, { command_id: sealed }),
      historyRow(LOG_THREE, CURSOR_THREE, { snapshot_after: encryptWithAesGcm('{}', generateDek()).value }),
    ])
    const page = await buildService(recording, keyedEncryption(generateDek())).scanDecrypted(baseScan)
    expect(page.entries.map((entry) => entry.logId)).toEqual([LOG_ONE])
    expect(page.undecryptable).toBe(2)
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_THREE, id: LOG_THREE })
    expect(JSON.stringify(page.entries)).not.toContain(sealed)
  })

  it('returns a row whose sealed columns open under the obtained data key', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const dekKey = generateDek()
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE, {
        command_id: encryptWithAesGcm('customers.deals.update', dekKey).value,
        snapshot_after: encryptWithAesGcm(JSON.stringify({ deal: { status: 'won' } }), dekKey).value,
      }),
    ])
    const decryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      command_id: decryptWithAesGcm(String(payload.command_id), dekKey),
    }))
    const service = buildService(recording, keyedEncryption(dekKey, { decryptEntityPayload }))

    const page = await service.scanDecrypted(baseScan)

    expect(page.undecryptable).toBe(0)
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]).toEqual(expect.objectContaining({
      logId: LOG_ONE,
      commandId: 'customers.deals.update',
      snapshotAfter: { deal: { status: 'won' } },
    }))
    expect(page.lastCursor).toEqual({ createdAt: CURSOR_ONE, id: LOG_ONE })
  })

  it('refuses to drop a sealed row when no data key could be obtained for it', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1'), probeRow(LOG_TWO, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE),
      historyRow(LOG_TWO, CURSOR_TWO, { command_id: encryptWithAesGcm('customers.deals.update', generateDek()).value }),
    ])
    const service = buildService(recording, keyedEncryption(null))

    await expect(service.scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
  })

  it('refuses to continue when the encryption service becomes unavailable after the probe', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const dekKey = generateDek()
    let healthChecks = 0
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE, { snapshot_after: encryptWithAesGcm('{}', dekKey).value }),
    ])
    const service = buildService(recording, keyedEncryption(dekKey, {
      isEnabled: () => {
        healthChecks += 1
        return healthChecks === 1
      },
    }))

    await expect(service.scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
    expect(payloadQuery(recording)).toBeDefined()
  })

  it('refuses to drop a sealed row while tenant data encryption is switched off', async () => {
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE, { snapshot_after: encryptWithAesGcm('{}', generateDek()).value }),
    ])

    await expect(buildService(recording).scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
    const missing = new ActionLogService({ getKysely: () => recording.db } as never)
    await expect(missing.scanDecrypted(baseScan)).rejects.toBeInstanceOf(ActionLogDecryptionUnavailableError)
  })

  it('opens a whole column the obtained data key opens although the map-driven decryption skipped it', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const dekKey = generateDek()
    const recording = createRecordingDb()
    recording.setProbeRows([probeRow(LOG_ONE, '1')])
    recording.setPayloadRows([
      historyRow(LOG_ONE, CURSOR_ONE, { command_id: encryptWithAesGcm('customers.deals.update', dekKey).value }),
    ])
    const service = buildService(recording, keyedEncryption(dekKey))

    const page = await service.scanDecrypted(baseScan)

    expect(page.undecryptable).toBe(0)
    expect(page.entries).toEqual([expect.objectContaining({ logId: LOG_ONE, commandId: 'customers.deals.update' })])
  })
})

describe('ActionLogService lenient decryption', () => {
  afterEach(() => {
    restoreEncryptionToggle()
  })

  it.each([
    ['tenant data encryption is on but the service is disabled', 'yes', () => passThroughEncryption()],
    ['tenant data encryption is off', 'no', () => passThroughEncryption()],
    ['no data key can be obtained', 'yes', () => keyedEncryption(null)],
    ['the row is sealed under another key', 'yes', () => keyedEncryption(generateDek())],
  ])('returns a sealed row as stored through findHistoryEntryById when %s', async (_label, toggle, encryption) => {
    process.env.TENANT_DATA_ENCRYPTION = toggle
    const sealed = encryptWithAesGcm('customers.deals.update', generateDek()).value
    const recording = createRecordingDb()
    recording.setPayloadRows([historyRow(LOG_ONE, CURSOR_ONE, { command_id: sealed })])
    const service = buildService(recording, encryption())

    const entry = await service.findHistoryEntryById({ tenantId: TENANT_ID, organizationIds: [ORG_ID], id: LOG_ONE })

    expect(entry).toEqual(expect.objectContaining({ logId: LOG_ONE, commandId: sealed, cursorAt: CURSOR_ONE }))
  })
})

describe('hasUndecryptedColumn', () => {
  it('flags only whole encrypted columns, never user text nested in a snapshot', () => {
    const sealed = encryptWithAesGcm('value', generateDek()).value
    expect(hasUndecryptedColumn({ command_id: sealed })).toBe(true)
    expect(hasUndecryptedColumn({ context_json: sealed })).toBe(true)
    expect(hasUndecryptedColumn({ snapshot_after: { deal: { title: sealed } } })).toBe(false)
    expect(hasUndecryptedColumn({ command_id: 'customers.deals.update', snapshot_before: { deal: { status: 'open' } } })).toBe(false)
    expect(hasUndecryptedColumn({ action_label: sealed })).toBe(false)
  })
})

const baseStateChanges: ActionLogStateChangeQuery = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  after: null,
  until: UNTIL,
  limit: 100,
}

function stateChangeQuery(recording: RecordingDb): CompiledQuery {
  const query = recording.queries.find((candidate) => candidate.sql.includes(STATE_CHANGE_MARKER))
  if (!query) throw new Error('[internal] state-change query was not issued')
  return query
}

describe('ActionLogService.scanStateChanges', () => {
  it('lists undone and redone rows in the tenant and organization under the history statement timeout', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanStateChanges(baseStateChanges)

    expect(recording.queries).toHaveLength(2)
    expect(recording.queries[0].sql).toBe(TIMEOUT_SQL)
    const select = stateChangeQuery(recording)
    expect(select.sql).toContain('from "action_logs"')
    expect(select.sql).toContain('"action_logs"."tenant_id" = $1')
    expect(select.sql).toContain('"action_logs"."organization_id" = $2')
    expect(select.sql).toContain('action_logs.execution_state in (\'undone\', \'redone\')')
    expect(select.sql).toContain('"action_logs"."deleted_at" is null')
    expect(select.sql).toContain('"action_logs"."updated_at" <= $3::timestamptz')
    expect(select.sql).not.toContain('"action_logs"."updated_at" >')
    expect(select.sql).not.toContain('"action_logs"."resource_kind" in')
    expect(select.sql).toContain('order by "action_logs"."updated_at" asc, "action_logs"."id" asc')
    expect(select.sql).toContain('limit $4')
    expect(select.sql).not.toContain('snapshot_before')
    expect(select.parameters).toEqual([TENANT_ID, ORG_ID, UNTIL, 101])
    expect(select.parameters).not.toContain('undone')
    expect(select.parameters).not.toContain('redone')
  })

  it('applies the updated_at keyset strictly after the cursor and narrows by resource kind', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanStateChanges({
      ...baseStateChanges,
      after: { updatedAt: AFTER_AT, id: LOG_ONE },
      resourceKinds: ['sales.order', 'sales.order', 'customers.deal'],
    })

    const select = stateChangeQuery(recording)
    expect(select.sql).toContain('"action_logs"."resource_kind" in ($4, $5)')
    expect(select.sql).toContain(
      '"action_logs"."updated_at" >= $6::timestamptz and ("action_logs"."updated_at" > $7::timestamptz or ("action_logs"."updated_at" = $8::timestamptz and "action_logs"."id" > $9))',
    )
    expect(select.sql).not.toContain('"action_logs"."id" >= ')
    expect(select.sql).toContain('limit $10')
    expect(select.parameters).toEqual([
      TENANT_ID,
      ORG_ID,
      UNTIL,
      'sales.order',
      'customers.deal',
      AFTER_AT,
      AFTER_AT,
      AFTER_AT,
      LOG_ONE,
      101,
    ])
  })

  it('returns an exhausted empty page without querying for an empty resource kind list or a bad scope', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)
    const emptyPage = { entries: [], lastCursor: null, exhausted: true }

    await expect(service.scanStateChanges({ ...baseStateChanges, resourceKinds: [] })).resolves.toEqual(emptyPage)
    await expect(service.scanStateChanges({ ...baseStateChanges, tenantId: 'tenant-1' })).resolves.toEqual(emptyPage)
    await expect(service.scanStateChanges({ ...baseStateChanges, organizationId: '' })).resolves.toEqual(emptyPage)
    expect(recording.queries).toEqual([])
  })

  it.each([
    ['a non-timestamp cursor', { after: { updatedAt: 'yesterday', id: LOG_ONE } }],
    ['a non-uuid cursor id', { after: { updatedAt: AFTER_AT, id: 'nope' } }],
    ['an impossible upper bound', { until: '2026-02-31T00:00:00Z' }],
    ['a non-timestamp upper bound', { until: 'now' }],
  ])('rejects %s with a TypeError before querying', async (_label, overrides) => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.scanStateChanges({ ...baseStateChanges, ...overrides })).rejects.toThrow(TypeError)
    expect(recording.queries).toEqual([])
  })

  it('clamps the limit to 500 and probes one row past it', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await service.scanStateChanges({ ...baseStateChanges, limit: 10_000 })

    expect(stateChangeQuery(recording).parameters.at(-1)).toBe(501)
  })

  it('maps state changes with their updated_at cursor and stays open while the look-ahead row exists', async () => {
    const recording = createRecordingDb()
    recording.setStateChangeRows([
      { id: LOG_ONE, execution_state: 'undone', resource_kind: 'customers.deal', cursor_at: CURSOR_ONE },
      { id: LOG_TWO, execution_state: 'redone', resource_kind: null, cursor_at: CURSOR_TWO },
      { id: LOG_THREE, execution_state: 'undone', resource_kind: 'sales.order', cursor_at: CURSOR_THREE },
    ])
    const service = buildService(recording)

    const page = await service.scanStateChanges({ ...baseStateChanges, limit: 2 })

    expect(page.entries).toEqual([
      {
        logId: LOG_ONE,
        executionState: 'undone',
        resourceKind: 'customers.deal',
        cursor: { updatedAt: CURSOR_ONE, id: LOG_ONE },
      },
      {
        logId: LOG_TWO,
        executionState: 'redone',
        resourceKind: null,
        cursor: { updatedAt: CURSOR_TWO, id: LOG_TWO },
      },
    ])
    expect(page.lastCursor).toEqual({ updatedAt: CURSOR_TWO, id: LOG_TWO })
    expect(page.exhausted).toBe(false)
    expect(stateChangeQuery(recording).parameters.at(-1)).toBe(3)
  })

  it('is exhausted when the query returns no more than the limit', async () => {
    const recording = createRecordingDb()
    recording.setStateChangeRows([
      { id: LOG_ONE, execution_state: 'redone', resource_kind: 'customers.deal', cursor_at: CURSOR_ONE },
      { id: LOG_TWO, execution_state: 'undone', resource_kind: 'customers.deal', cursor_at: CURSOR_TWO },
    ])
    const service = buildService(recording)

    const page = await service.scanStateChanges({ ...baseStateChanges, limit: 2 })

    expect(page.entries.map((entry) => entry.executionState)).toEqual(['redone', 'undone'])
    expect(page.lastCursor).toEqual({ updatedAt: CURSOR_TWO, id: LOG_TWO })
    expect(page.exhausted).toBe(true)
  })

  it('returns no cursor for an empty result', async () => {
    const recording = createRecordingDb()
    const service = buildService(recording)

    await expect(service.scanStateChanges(baseStateChanges)).resolves.toEqual({
      entries: [],
      lastCursor: null,
      exhausted: true,
    })
  })
})
