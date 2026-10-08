/**
 * Real-SQL coverage of the X-Ray store hardening: per-process contracts and rebuild scans,
 * the rebuild reset, value lookups served by the value index, per-organization batched
 * erasure, the lease lock timeout, the bounded status counts, cursor listing and the
 * retention indexes. Gated on OM_INSIGHTS_XRAY_PG_URL (a throwaway database); the suite
 * creates its own schema from the insights migration and drops it afterwards.
 *
 *   OM_INSIGHTS_XRAY_PG_URL=postgres://postgres:postgres@localhost:55432/om_scratch \
 *     npx jest src/modules/insights/lib/projection/__tests__/store.hardening.pg.test.ts --runInBand
 */
import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql, type CompiledQuery } from 'kysely'
import { Pool, type PoolClient } from 'pg'
import type { ProcessDescriptor } from '@open-mercato/shared/modules/insights/process'
import { Migration20261008180752_insights } from '../../../migrations/Migration20261008180752_insights'
import { createProjectionStore, type ProjectionEventInsert, type ProjectionLease, type ProjectionStore } from '../store'
import { runIngestSlice, runScanSlice, type XrayIngestDeps } from '../ingest'
import type { XrayDatabase } from '../types'
import { createMemoryLogSource, microIso, type MemoryLogRow } from './memoryProjection'
import { DEAL_ID, ORDER_ID, ORG_ID, OTHER_ORG_ID, STAGE_A, TENANT_ID, USER_ID, nextLogId, testProcessConfig, testRegistry } from '../../process/__tests__/processTestSupport'

const PG_URL = process.env.OM_INSIGHTS_XRAY_PG_URL
const maybe = PG_URL ? describe : describe.skip

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const OTHER_SCOPE = { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID }
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff'
const OTHER_TENANT_SCOPE = { tenantId: OTHER_TENANT, organizationId: '22222222-0000-4000-8000-0000000000ff' }
const LEASE_MS = 120_000
const SETTLE_MS = 60_000
const dealProcess = testRegistry().processes[0]
const CHAIN = 'cccccccc-0000-4000-8000-0000000000c1'

async function migrationStatements(): Promise<string[]> {
  const migration = Object.create(Migration20261008180752_insights.prototype) as Migration20261008180752_insights
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration.up()
  return statements
}

function event(overrides: Partial<ProjectionEventInsert> = {}): ProjectionEventInsert {
  return {
    processKey: dealProcess.processKey,
    caseKind: dealProcess.resourceKind,
    caseId: DEAL_ID,
    activityKey: 'created',
    activityKind: 'lifecycle',
    occurredAt: '2026-10-08T10:00:00.123456Z',
    sourceLogId: nextLogId(),
    seq: 0,
    actorUserId: null,
    actorPseudonym: 'tk1:actor',
    actorRoleIds: null,
    actorTeamId: null,
    causeKind: 'user',
    causeId: null,
    viaSyncRun: false,
    followupField: null,
    followupUserId: null,
    followupValue: null,
    voided: false,
    voidedByLogId: null,
    ...overrides,
  }
}

function statusEvent(value: string, overrides: Partial<ProjectionEventInsert> = {}): ProjectionEventInsert {
  return event({ activityKey: `status:${value}`, activityKind: 'stage', followupField: 'status', followupValue: value, ...overrides })
}

maybe('X-Ray store hardening against PostgreSQL', () => {
  jest.setTimeout(60_000)
  const schema = `xray_hard_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let pool: Pool
  let db: Kysely<XrayDatabase>
  let store: ProjectionStore
  const captured: CompiledQuery[] = []
  let capturing: Kysely<XrayDatabase>
  let capturingStore: ProjectionStore

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: PG_URL })
    await setupPool.query(`create schema "${schema}"`)
    await setupPool.end()
    pool = new Pool({ connectionString: PG_URL, max: 8 })
    pool.on('connect', (client: PoolClient) => {
      void client.query(`set search_path to "${schema}"`)
    })
    db = new Kysely<XrayDatabase>({ dialect: new PostgresDialect({ pool }) })
    capturing = new Kysely<XrayDatabase>({
      dialect: new PostgresDialect({ pool }),
      log: (entry) => {
        if (entry.level === 'query') captured.push(entry.query)
      },
    })
    for (const statement of await migrationStatements()) await sql.raw(statement).execute(db)
    store = createProjectionStore(db)
    capturingStore = createProjectionStore(capturing)
  })

  afterAll(async () => {
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    captured.length = 0
    await sql`truncate insights_process_cursors, insights_process_events, insights_process_cases, insights_process_rollups, insights_process_erasures`.execute(db)
  })

  async function leased(scope = SCOPE): Promise<ProjectionLease> {
    const cursor = await store.ensureCursor(scope, SETTLE_MS)
    const lease = await store.acquireLease(cursor, `worker-${randomUUID()}`, LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    return lease
  }

  async function planOf(query: CompiledQuery): Promise<string> {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`set local search_path to "${schema}"`)
      await client.query('set local enable_seqscan = off')
      const result = await client.query<{ 'QUERY PLAN': string }>(`explain ${query.sql}`, [...query.parameters])
      await client.query('rollback')
      return result.rows.map((row) => row['QUERY PLAN']).join('\n')
    } finally {
      client.release()
    }
  }

  async function countRows(table: 'insights_process_events' | 'insights_process_cases', processKey: string): Promise<number> {
    const result = await sql<{ total: string }>`select count(*)::text as total from ${sql.table(table)} where process_key = ${processKey}`.execute(db)
    return Number(result.rows[0]?.total ?? 0)
  }

  it('starts a new cursor without contracts (adopted by the first slice) and covered from its start', async () => {
    const cursor = await store.ensureCursor(SCOPE, SETTLE_MS)
    expect(cursor).toEqual(expect.objectContaining({ contractHashes: null, pendingRebuildKeys: [], scanProcessKeys: null, historyScannedAt: null, undecryptableRows: 0, overlapTimeouts: 0 }))
    expect(cursor.coverageFrom).toBe(cursor.lastCreatedAt)
  })

  it('records per-process contracts, clears one process only and queues, starts, finishes and re-queues its rebuild scan', async () => {
    const lease = await leased()
    const quoteEvent = event({ processKey: 'test.quote', caseKind: 'test.quote', caseId: ORDER_ID })
    await store.commit(lease, LEASE_MS, { events: [event(), quoteEvent], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await sql`insert into insights_process_rollups (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
      values (${TENANT_ID}, ${ORG_ID}, 'test.quote', '7d', now(), now(), now(), '{}'::jsonb, now())`.execute(db)

    const adopted = await store.applyContractTransition(lease, LEASE_MS, { hashes: { 'test.deal': 'd1', 'test.quote': 'q1' }, rebuild: [], change: null })
    expect(adopted).toEqual(expect.objectContaining({ contractHashes: { 'test.deal': 'd1', 'test.quote': 'q1' }, pendingRebuildKeys: [], contractChange: null, contractChangedAt: null }))

    expect(await store.clearProjectionBatch(lease, LEASE_MS, 'insights_process_events', 100, 'test.quote')).toBe(1)
    expect(await store.clearProjectionBatch(lease, LEASE_MS, 'insights_process_rollups', 100, 'test.quote')).toBe(1)
    expect(await countRows('insights_process_events', 'test.deal')).toBe(1)

    const changed = await store.applyContractTransition(lease, LEASE_MS, {
      hashes: { 'test.deal': 'd1', 'test.quote': 'q2' },
      rebuild: ['test.quote'],
      change: { changed: ['test.quote'], added: [], removed: [] },
    })
    expect(changed).toEqual(expect.objectContaining({ contractHashes: { 'test.deal': 'd1', 'test.quote': 'q2' }, pendingRebuildKeys: ['test.quote'], contractChange: { changed: ['test.quote'], added: [], removed: [] } }))
    expect(changed.contractChangedAt).toMatch(/\.\d{6}Z$/)
    const narrowed = await store.applyContractTransition(lease, LEASE_MS, {
      hashes: { 'test.deal': 'd2' },
      rebuild: ['test.deal'],
      change: { changed: ['test.deal'], added: [], removed: ['test.quote'] },
    })
    expect(narrowed.pendingRebuildKeys).toEqual(['test.deal'])

    await sql`update insights_process_cursors set last_reconciled_at = '2026-01-01T00:00:00Z', last_full_reconciled_at = '2026-01-01T00:00:00Z'`.execute(db)
    const rebuild = { scanId: randomUUID(), chainId: CHAIN, kind: 'full_reconcile' as const, from: '2026-01-01T00:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null, processKeys: ['test.deal'] }
    expect(await store.startScanIfIdle(lease, LEASE_MS, rebuild)).toBe(true)
    expect(await store.readCursor(SCOPE)).toEqual(expect.objectContaining({ scanProcessKeys: ['test.deal'], pendingRebuildKeys: [], status: 'backfilling' }))
    expect(await store.finishScan(lease, LEASE_MS, rebuild.scanId, CHAIN, 'full_reconcile')).toBe(true)
    expect(await store.readCursor(SCOPE)).toEqual(expect.objectContaining({
      scanId: null,
      scanProcessKeys: null,
      lastReconciledAt: '2026-01-01T00:00:00.000000Z',
      lastFullReconciledAt: '2026-01-01T00:00:00.000000Z',
      historyScannedAt: null,
      status: 'idle',
    }))

    const retry = { ...rebuild, scanId: randomUUID() }
    expect(await store.startScanIfIdle(lease, LEASE_MS, retry)).toBe(true)
    expect(await store.abandonScan(SCOPE, retry.scanId, CHAIN, '[internal] abandoned')).toEqual({ progressJobId: null })
    expect(await store.readCursor(SCOPE)).toEqual(expect.objectContaining({ scanId: null, pendingRebuildKeys: ['test.deal'], lastReconciledAt: '2026-01-01T00:00:00.000000Z' }))
    await store.releaseLease(lease)
  })

  it('keeps queued process rebuilds across scans of every process, re-queues a replaced rebuild scan and records history coverage', async () => {
    const lease = await leased()
    await store.applyContractTransition(lease, LEASE_MS, { hashes: { 'test.deal': 'd1' }, rebuild: ['test.deal'], change: { changed: [], added: ['test.deal'], removed: [] } })
    const reconcile = { scanId: randomUUID(), chainId: CHAIN, kind: 'reconcile' as const, from: '2026-10-06T00:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null }
    expect(await store.startScanIfIdle(lease, LEASE_MS, reconcile)).toBe(true)
    expect((await store.readCursor(SCOPE))?.pendingRebuildKeys).toEqual(['test.deal'])
    expect(await store.finishScan(lease, LEASE_MS, reconcile.scanId, CHAIN, 'reconcile')).toBe(true)
    expect((await store.readCursor(SCOPE))?.historyScannedAt).toBeNull()

    const rebuild = { scanId: randomUUID(), chainId: CHAIN, kind: 'full_reconcile' as const, from: '2025-10-08T10:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null, processKeys: ['test.deal'] }
    expect(await store.startScanIfIdle(lease, LEASE_MS, rebuild)).toBe(true)
    expect((await store.readCursor(SCOPE))?.pendingRebuildKeys).toEqual([])
    const cursor = await store.readCursor(SCOPE)
    if (!cursor) throw new Error('[internal] cursor expected')
    const backfill = { scanId: randomUUID(), chainId: CHAIN, kind: 'backfill' as const, from: '2025-10-08T10:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null }
    await store.startScan(cursor, backfill)
    expect(await store.readCursor(SCOPE)).toEqual(expect.objectContaining({ scanId: backfill.scanId, scanProcessKeys: null, pendingRebuildKeys: ['test.deal'] }))
    expect(await store.finishScan(lease, LEASE_MS, backfill.scanId, CHAIN, 'backfill')).toBe(true)
    const finished = await store.readCursor(SCOPE)
    expect(finished?.pendingRebuildKeys).toEqual(['test.deal'])
    expect(finished?.coverageFrom).toBe('2025-10-08T10:00:00.000000Z')
    expect(finished?.historyScannedAt).toMatch(/\.\d{6}Z$/)
    await store.releaseLease(lease)
  })

  it('resets the cursor for a rebuild so a full reconciliation is due if the backfill never starts', async () => {
    const lease = await leased()
    await store.applyContractTransition(lease, LEASE_MS, { hashes: { 'test.deal': 'd1' }, rebuild: ['test.deal'], change: { changed: ['test.deal'], added: [], removed: [] } })
    await sql`update insights_process_cursors set last_full_reconciled_at = now(), history_scanned_at = now(), coverage_from = '2025-01-01T00:00:00Z', undecryptable_rows = 3, actor_key_fingerprint = 'tk1:key'`.execute(db)
    await store.resetCursor(lease, LEASE_MS, SETTLE_MS)
    const reset = await store.readCursor(SCOPE)
    expect(reset).toEqual(expect.objectContaining({
      contractHashes: null,
      pendingRebuildKeys: [],
      contractChange: null,
      lastFullReconciledAt: null,
      historyScannedAt: null,
      actorKeyFingerprint: null,
      undecryptableRows: 0,
      scanId: null,
      status: 'idle',
    }))
    expect(reset?.coverageFrom).toBe(reset?.lastCreatedAt)
    expect(Date.parse(await store.now()) - Date.parse(reset?.lastCreatedAt ?? '')).toBeGreaterThanOrEqual(SETTLE_MS - 1000)
    await store.releaseLease(lease)
  })

  it('looks incoming values up and counts distinct values through the value index without reading duplicates', async () => {
    const lease = await leased()
    const otherLease = await leased(OTHER_SCOPE)
    const duplicates = Array.from({ length: 300 }, (_unused, index) => statusEvent('open', { occurredAt: microIso(new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 1000)) }))
    await store.commit(lease, LEASE_MS, { events: [...duplicates, statusEvent('won'), statusEvent('other'), statusEvent('none')], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.commit(otherLease, LEASE_MS, { events: [statusEvent('lost')], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    expect((await store.findKnownValues(SCOPE, 'test.deal', 'status', ['won', 'review', 'open', 'lost'])).sort()).toEqual(['open', 'won'])
    expect(await store.findKnownValues(SCOPE, 'test.deal', 'status', [])).toEqual([])
    expect(await store.countDistinctValues(SCOPE, 'test.deal', 'status', 201)).toBe(2)
    expect(await store.countDistinctValues(SCOPE, 'test.deal', 'status', 1)).toBe(1)
    expect(await store.countDistinctValues(OTHER_SCOPE, 'test.deal', 'status', 201)).toBe(1)
    expect(await store.countDistinctValues(SCOPE, 'test.deal', 'priority', 201)).toBe(0)

    captured.length = 0
    await capturingStore.findKnownValues(SCOPE, 'test.deal', 'status', ['won'])
    await capturingStore.countDistinctValues(SCOPE, 'test.deal', 'status', 201)
    expect(captured).toHaveLength(2)
    await store.releaseLease(lease)
    await store.releaseLease(otherLease)
    await sql`update insights_process_cursors set actor_key_fingerprint = 'tk1:key'`.execute(db)
    await capturingStore.replaceActorPseudonym({ tenantId: TENANT_ID, pseudonym: 'tk1:nobody', replacement: 'erased:x', keyFingerprint: 'tk1:key', userValueFields: [] })
    const fieldScan = captured.find((query) => query.sql.includes('with recursive pairs'))
    expect(fieldScan).toBeDefined()
    for (const query of [...captured.slice(0, 2), ...(fieldScan ? [fieldScan] : [])]) {
      const plan = await planOf(query)
      expect(plan).toContain('insights_process_events_value_idx')
      expect(plan).not.toMatch(/Seq Scan/)
    }
  })

  it('erases a user organization by organization in bounded batches, locking only that organization, also in fields of processes no longer registered', async () => {
    const lease = await leased()
    const otherLease = await leased(OTHER_SCOPE)
    await sql`update insights_process_cursors set actor_key_fingerprint = 'tk1:key'`.execute(db)
    await store.commit(lease, LEASE_MS, {
      events: [
        ...Array.from({ length: 5 }, () => event({ actorPseudonym: 'tk1:erased' })),
        ...Array.from({ length: 3 }, () => event({ activityKey: 'ownerUserId:changed', activityKind: 'followup', followupField: 'ownerUserId', followupValue: 'tk1:erased', actorPseudonym: 'tk1:someone' })),
        event({ processKey: 'retired.process', caseKind: 'retired.case', activityKey: 'assigneeId:changed', activityKind: 'followup', followupField: 'assigneeId', followupValue: 'tk1:erased', actorPseudonym: 'tk1:someone' }),
      ],
      voids: [],
      advance: { kind: 'none' },
      processes: [dealProcess],
    })
    await store.commit(otherLease, LEASE_MS, { events: [event({ actorPseudonym: 'tk1:erased' }), event({ actorPseudonym: 'tk1:erased' })], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.releaseLease(lease)
    await store.releaseLease(otherLease)
    const otherCursor = await store.readCursor(OTHER_SCOPE)
    const holder = await pool.connect()
    let erasing: Promise<{ updated: number; mismatchedOrganizationIds: string[] }> | null = null
    try {
      await holder.query('begin')
      await holder.query(`select id from "${schema}".insights_process_cursors where id = $1 for update`, [otherCursor?.id])
      erasing = store.replaceActorPseudonym({
        tenantId: TENANT_ID,
        pseudonym: 'tk1:erased',
        replacement: 'erased:one',
        keyFingerprint: 'tk1:key',
        userValueFields: [{ processKey: 'test.deal', field: 'ownerUserId' }],
        batchSize: 2,
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
      const midway = await sql<{ organization_id: string; actor_pseudonym: string | null; followup_value: string | null }>`
        select organization_id, actor_pseudonym, followup_value from insights_process_events`.execute(db)
      const leftInOrg = midway.rows.filter((row) => row.organization_id === ORG_ID && (row.actor_pseudonym === 'tk1:erased' || row.followup_value === 'tk1:erased'))
      const leftInOther = midway.rows.filter((row) => row.organization_id === OTHER_ORG_ID && row.actor_pseudonym === 'tk1:erased')
      expect(leftInOrg).toEqual([])
      expect(leftInOther).toHaveLength(2)
      await holder.query('commit')
    } finally {
      await holder.query('rollback').catch(() => undefined)
      holder.release()
    }
    expect(await erasing).toEqual({ updated: 11, mismatchedOrganizationIds: [] })
    const after = await sql<{ total: string }>`select count(*)::text as total from insights_process_events where actor_pseudonym = 'tk1:erased' or followup_value = 'tk1:erased'`.execute(db)
    expect(after.rows[0]?.total).toBe('0')
  })

  it('gives up on a lease after the lock timeout instead of waiting for a long lock holder', async () => {
    const cursor = await store.ensureCursor(SCOPE, SETTLE_MS)
    const holder = await pool.connect()
    try {
      await holder.query('begin')
      await holder.query(`select id from "${schema}".insights_process_cursors where id = $1 for update`, [cursor.id])
      const release = setTimeout(() => {
        void holder.query('rollback')
      }, 2500)
      const startedAt = Date.now()
      const lease = await store.acquireLease(cursor, 'worker-b', LEASE_MS, { lockTimeoutMs: 200 })
      const waited = Date.now() - startedAt
      clearTimeout(release)
      await holder.query('rollback')
      expect(lease).toBeNull()
      expect(waited).toBeLessThan(1500)
    } finally {
      await holder.query('rollback').catch(() => undefined)
      holder.release()
    }
    expect(await store.acquireLease(cursor, 'worker-b', LEASE_MS)).not.toBeNull()
  })

  it('degrades the status counts to null when they exceed their statement timeout', async () => {
    const lease = await leased()
    await store.commit(lease, LEASE_MS, { events: [event(), statusEvent('open', { occurredAt: '2026-10-09T00:00:00.000000Z' })], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.releaseLease(lease)
    const holder = await pool.connect()
    try {
      await holder.query('begin')
      await holder.query(`lock table "${schema}".insights_process_events in access exclusive mode`)
      const release = setTimeout(() => {
        void holder.query('rollback')
      }, 2500)
      const startedAt = Date.now()
      const counts = await store.counts(SCOPE, { statementTimeoutMs: 200 })
      const waited = Date.now() - startedAt
      clearTimeout(release)
      await holder.query('rollback')
      expect(counts).toBeNull()
      expect(waited).toBeLessThan(1500)
    } finally {
      await holder.query('rollback').catch(() => undefined)
      holder.release()
    }
    expect(await store.counts(SCOPE)).toEqual([expect.objectContaining({
      processKey: 'test.deal',
      events: 2,
      firstOccurredAt: '2026-10-08T10:00:00.123456Z',
      lastOccurredAt: '2026-10-09T00:00:00.000000Z',
    })])
  })

  it('lists cursors of one tenant, and of all tenants only on request and in pages', async () => {
    await store.ensureCursor(OTHER_SCOPE, SETTLE_MS)
    await store.ensureCursor(SCOPE, SETTLE_MS)
    await store.ensureCursor(OTHER_TENANT_SCOPE, SETTLE_MS)
    expect((await store.listCursors({ tenantId: TENANT_ID })).map((cursor) => cursor.organizationId)).toEqual([ORG_ID, OTHER_ORG_ID])
    expect((await store.listCursors({ tenantId: TENANT_ID, organizationId: OTHER_ORG_ID })).map((cursor) => cursor.organizationId)).toEqual([OTHER_ORG_ID])
    const first = await store.listCursors({ allTenants: true, limit: 2 })
    expect(first.map((cursor) => [cursor.tenantId, cursor.organizationId])).toEqual([[TENANT_ID, ORG_ID], [TENANT_ID, OTHER_ORG_ID]])
    const last = first[first.length - 1]
    const second = await store.listCursors({ allTenants: true, limit: 2, after: { tenantId: last.tenantId, organizationId: last.organizationId } })
    expect(second.map((cursor) => cursor.organizationId)).toEqual([OTHER_TENANT_SCOPE.organizationId])
  })

  it('prunes by retention through the organization-wide time indexes', async () => {
    const lease = await leased()
    await sql`
      insert into insights_process_events (tenant_id, organization_id, process_key, case_kind, case_id, activity_key, activity_kind, occurred_at, source_log_id, seq, cause_kind, created_at)
      select ${TENANT_ID}, ${ORG_ID}, 'test.p' || (series % 40), 'test.deal', gen_random_uuid(), 'created', 'lifecycle',
        timestamptz '2025-12-25' + series * interval '5 minutes', gen_random_uuid(), 0, 'user', now()
      from generate_series(1, 20000) as series`.execute(db)
    await sql`
      insert into insights_process_cases (tenant_id, organization_id, process_key, case_kind, case_id, started_at, last_activity_at, status, event_count, rework_count, distinct_actor_count, automated_share, variant_hash, variant_keys, dimensions, recomputed_at, created_at, updated_at)
      select ${TENANT_ID}, ${ORG_ID}, 'test.p' || (series % 40), 'test.deal', gen_random_uuid(), now(), timestamptz '2025-12-25' + series * interval '5 minutes', 'open', 1, 0, 1, 0, 'v', '[]'::jsonb, '{}'::jsonb, now(), now(), now()
      from generate_series(1, 20000) as series`.execute(db)
    await sql`analyze insights_process_events`.execute(db)
    await sql`analyze insights_process_cases`.execute(db)
    captured.length = 0
    const capturingLease = { ...lease }
    await capturingStore.pruneProjectionBatch(capturingLease, LEASE_MS, 'insights_process_events', '2026-01-01T00:00:00.000000Z', 100)
    await capturingStore.pruneProjectionBatch(capturingLease, LEASE_MS, 'insights_process_cases', '2026-01-01T00:00:00.000000Z', 100)
    const deletes = captured.filter((query) => /^\s*delete from/i.test(query.sql))
    expect(deletes).toHaveLength(2)
    const eventsPlan = await planOf(deletes[0])
    const casesPlan = await planOf(deletes[1])
    expect(eventsPlan).toContain('insights_process_events_occurred_idx')
    expect(casesPlan).toContain('insights_process_cases_retention_idx')
    await store.releaseLease(lease)
  })

  it('counts undecryptable rows and overlap timeouts on the cursor under the lease', async () => {
    const lease = await leased()
    await store.commit(lease, LEASE_MS, { events: [], voids: [], advance: { kind: 'none' }, processes: [dealProcess], undecryptable: 2 })
    await store.commit(lease, LEASE_MS, { events: [], voids: [], advance: { kind: 'main', lastCreatedAt: '2026-10-08T10:00:00.000001Z', lastLogId: nextLogId() }, processes: [dealProcess], undecryptable: 1 })
    await store.noteOverlapTimeout(lease, LEASE_MS)
    await store.noteOverlapTimeout(lease, LEASE_MS)
    const cursor = await store.readCursor(SCOPE)
    expect(cursor).toEqual(expect.objectContaining({ undecryptableRows: 3, overlapTimeouts: 2 }))
    expect(cursor?.lastOverlapTimeoutAt).toMatch(/\.\d{6}Z$/)
    await store.releaseLease(lease)
  })

  it('rebuilds a changed process end to end: deletes its rows, scans its history and leaves the other process alone', async () => {
    const dbNow = await store.now()
    const createdAt = microIso(new Date(Date.parse(dbNow) - 40 * 60_000))
    const base = (overrides: Partial<MemoryLogRow>): MemoryLogRow => ({
      logId: nextLogId(),
      at: createdAt,
      commandId: 'test.deals.create',
      actionType: 'create',
      executionState: 'done',
      actorUserId: USER_ID,
      actorKind: 'user',
      resourceKind: 'test.deal',
      resourceId: DEAL_ID,
      changedFields: null,
      snapshotBefore: null,
      snapshotAfter: { deal: { status: 'open', stageId: STAGE_A } },
      changes: null,
      causeKind: 'user',
      causeId: null,
      organizationId: ORG_ID,
      actionLabel: null,
      onBehalfOfUserId: null,
      parentResourceKind: null,
      parentResourceId: null,
      correlationId: null,
      causedByLogId: null,
      causation: null,
      historyAction: null,
      sourceLogId: null,
      tenantId: TENANT_ID,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    })
    const deal = testProcessConfig().processes?.[0] as ProcessDescriptor
    const quote: ProcessDescriptor = {
      processKey: 'test.quote',
      labelKey: 'x',
      resourceKind: 'test.quote',
      entityId: 'test:quote',
      requiredFeatures: ['test.quotes.view'],
      stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['quote.status'], changeKeys: ['quote.status'] }],
    }
    const rows = [base({}), base({ resourceKind: 'test.quote', resourceId: ORDER_ID, snapshotAfter: { quote: { status: 'sent' } } })]
    const deps: XrayIngestDeps = {
      store,
      logSource: createMemoryLogSource(rows),
      registry: testRegistry({ version: 1, processes: [deal, quote] }),
      pseudonymizer: { mode: 'tenant_key', fingerprint: 'tk1:e2e-key', pseudonymize: (userId) => `tk1:${userId}` },
      resolveActorDimensions: async (userIds) => new Map(userIds.map((id) => [id, { roleIds: null, teamId: null }])),
      redactedFields: new Set(),
      owner: 'worker-e2e',
    }
    const cursor = await store.ensureCursor(SCOPE, SETTLE_MS)
    await sql`update insights_process_cursors set last_created_at = ${createdAt}::timestamptz - interval '1 minute', state_watermark = ${createdAt}::timestamptz - interval '1 minute', coverage_from = ${createdAt}::timestamptz - interval '1 minute' where id = ${cursor.id}`.execute(db)
    expect(await runIngestSlice(deps, SCOPE, { retentionDays: 30 })).toEqual(expect.objectContaining({ status: 'caught_up', inserted: 5 }))
    const dealBefore = await countRows('insights_process_events', 'test.deal')

    deps.registry = testRegistry({ version: 1, processes: [deal, { ...quote, endStates: [{ field: 'status', values: ['sent'] }] }] })
    const changed = await runIngestSlice(deps, SCOPE, { retentionDays: 30 })
    expect(changed).toEqual(expect.objectContaining({ status: 'caught_up', contractChange: { changed: ['test.quote'], added: [], removed: [] } }))
    expect(changed.scanStarted).toEqual(expect.objectContaining({ kind: 'full_reconcile', processKeys: ['test.quote'], from: microIso(new Date(Date.parse(createdAt) - 60_000)) }))
    expect(await countRows('insights_process_events', 'test.quote')).toBe(0)
    expect(await countRows('insights_process_cases', 'test.quote')).toBe(0)
    expect(await countRows('insights_process_events', 'test.deal')).toBe(dealBefore)

    const scan = changed.scanStarted
    if (!scan) throw new Error('[internal] scan expected')
    expect(await runScanSlice(deps, SCOPE, scan.scanId, scan.chainId)).toEqual(expect.objectContaining({ status: 'completed', inserted: 2 }))
    const quoteCase = await db.selectFrom('insights_process_cases').select(['status']).where('process_key', '=', 'test.quote').executeTakeFirstOrThrow()
    expect(quoteCase.status).toBe('completed')
    expect(await store.readCursor(SCOPE)).toEqual(expect.objectContaining({ pendingRebuildKeys: [], scanProcessKeys: null, scanId: null }))
  })
})
