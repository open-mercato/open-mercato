/**
 * Runs the X-Ray projection store (CAS lease, fencing, idempotent upserts, voids, exact case
 * recomputation, scans and their job chains, pruning, the erasure ledger) against a real
 * PostgreSQL. Gated on
 * OM_INSIGHTS_XRAY_PG_URL (a throwaway database): the suite creates its own schema from the
 * insights migration and drops it afterwards.
 *
 *   OM_INSIGHTS_XRAY_PG_URL=postgres://postgres:postgres@localhost:55432/om_scratch \
 *     npx jest src/modules/insights/lib/projection/__tests__/store.pg.test.ts --runInBand
 */
import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool, type PoolClient } from 'pg'
import { Migration20261008180752_insights } from '../../../migrations/Migration20261008180752_insights'
import { CASE_EVENT_LIMIT, buildCaseAggregate, summarizeCase, type CaseEventRow } from '../../process/caseSummary'
import {
  MAX_LOG_ID,
  ProjectionLeaseLostError,
  ProjectionScanSupersededError,
  createProjectionStore,
  type ProjectionEventInsert,
  type ProjectionStore,
} from '../store'
import { runIngestSlice, type XrayIngestDeps } from '../ingest'
import type { XrayDatabase } from '../types'
import { createMemoryLogSource, microIso, type MemoryLogRow } from './memoryProjection'
import { DEAL_ID, ORG_ID, OTHER_ORG_ID, STAGE_A, TENANT_ID, USER_ID, nextLogId, testRegistry } from '../../process/__tests__/processTestSupport'

const PG_URL = process.env.OM_INSIGHTS_XRAY_PG_URL
const maybe = PG_URL ? describe : describe.skip

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const OTHER_SCOPE = { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID }
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff'
const LEASE_MS = 120_000
const dealProcess = testRegistry().processes[0]

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

const CHAIN_A = 'cccccccc-0000-4000-8000-0000000000a1'
const CHAIN_B = 'cccccccc-0000-4000-8000-0000000000b2'

maybe('X-Ray projection store against PostgreSQL', () => {
  jest.setTimeout(60_000)
  const schema = `xray_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let pool: Pool
  let db: Kysely<XrayDatabase>
  let store: ProjectionStore

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: PG_URL })
    await setupPool.query(`create schema "${schema}"`)
    await setupPool.end()
    pool = new Pool({ connectionString: PG_URL, max: 6 })
    pool.on('connect', (client: PoolClient) => {
      void client.query(`set search_path to "${schema}"`)
    })
    db = new Kysely<XrayDatabase>({ dialect: new PostgresDialect({ pool }) })
    for (const statement of await migrationStatements()) await sql.raw(statement).execute(db)
    store = createProjectionStore(db)
  })

  afterAll(async () => {
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate insights_process_cursors, insights_process_events, insights_process_cases, insights_process_rollups, insights_process_erasures`.execute(db)
  })

  it('creates one cursor per organization, starting at now minus the settle lag', async () => {
    const first = await store.ensureCursor(SCOPE, 60_000)
    await sql`update insights_process_cursors set contract_hashes = '{"test.deal":"hash-1"}'::jsonb`.execute(db)
    const second = await store.ensureCursor(SCOPE, 60_000)
    expect(second.id).toBe(first.id)
    expect(second.contractHashes).toEqual({ 'test.deal': 'hash-1' })
    expect(first).toEqual(expect.objectContaining({ status: 'idle', leaseToken: 0, lastLogId: MAX_LOG_ID }))
    const dbNow = Date.parse(await store.now())
    expect(dbNow - Date.parse(first.lastCreatedAt ?? '')).toBeGreaterThanOrEqual(59_000)
    expect(first.lastCreatedAt).toMatch(/\.\d{6}Z$/)
  })

  it('grants the lease to exactly one of many concurrent acquirers', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const leases = await Promise.all(Array.from({ length: 6 }, (_unused, index) => store.acquireLease(cursor, `worker-${index}`, LEASE_MS)))
    const granted = leases.filter((lease) => lease !== null)
    expect(granted).toHaveLength(1)
    expect(granted[0]?.token).toBe(1)
  })

  it('fences a stale owner after an expired lease is taken over', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const stale = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    expect(stale).not.toBeNull()
    expect(await store.acquireLease(cursor, 'worker-b', LEASE_MS)).toBeNull()
    await sql`update insights_process_cursors set lease_until = now() - interval '1 second' where id = ${cursor.id}`.execute(db)
    const current = await store.acquireLease(cursor, 'worker-b', LEASE_MS)
    expect(current?.token).toBe(2)
    if (!stale || !current) throw new Error('[internal] leases expected')
    await expect(store.commit(stale, LEASE_MS, { events: [event()], voids: [], advance: { kind: 'none' }, processes: [dealProcess] }))
      .rejects.toBeInstanceOf(ProjectionLeaseLostError)
    const rows = await sql<{ count: string }>`select count(*)::text as count from insights_process_events`.execute(db)
    expect(rows.rows[0]?.count).toBe('0')
    await store.releaseLease(stale)
    expect((await store.readCursor(SCOPE))?.leaseOwner).toBe('worker-b')
    const result = await store.commit(current, LEASE_MS, { events: [event()], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    expect(result.inserted).toBe(1)
    await store.releaseLease(current)
    expect((await store.readCursor(SCOPE))?.leaseOwner).toBeNull()
  })

  it('makes an acquirer wait for an in-flight fenced write and then see the extended lease', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    await sql`update insights_process_cursors set lease_owner = 'worker-a', lease_token = 1, lease_until = now() - interval '1 second' where id = ${cursor.id}`.execute(db)
    const holder = await pool.connect()
    try {
      await holder.query('begin')
      await holder.query(`select id from "${schema}".insights_process_cursors where id = $1 and lease_owner = 'worker-a' and lease_token = 1 for update`, [cursor.id])
      const contender = store.acquireLease(cursor, 'worker-b', LEASE_MS)
      await new Promise((resolve) => setTimeout(resolve, 300))
      await holder.query(`update "${schema}".insights_process_cursors set lease_until = now() + interval '2 minutes' where id = $1`, [cursor.id])
      await holder.query('commit')
      expect(await contender).toBeNull()
    } finally {
      holder.release()
    }
    expect((await store.readCursor(SCOPE))?.leaseOwner).toBe('worker-a')
  })

  it('inserts idempotently, voids, recomputes and removes cases, and persists microsecond cursors', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    const created = event({ occurredAt: '2026-10-08T10:00:00.000001Z' })
    const opened = event({ sourceLogId: created.sourceLogId, seq: 1, activityKey: 'status:open', activityKind: 'stage', followupField: 'status', followupValue: 'open', occurredAt: created.occurredAt })
    const won = event({ activityKey: 'status:won', activityKind: 'stage', followupField: 'status', followupValue: 'won', occurredAt: '2026-10-08T10:05:00.000002Z' })
    const first = await store.commit(lease, LEASE_MS, {
      events: [created, opened, won],
      voids: [],
      advance: { kind: 'main', lastCreatedAt: '2026-10-08T10:05:00.000002Z', lastLogId: won.sourceLogId },
      processes: [dealProcess],
    })
    expect(first).toEqual({ inserted: 3, voided: 0, casesRecomputed: 1, casesRemoved: 0 })
    const again = await store.commit(lease, LEASE_MS, { events: [created, opened, won], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    expect(again.inserted).toBe(0)
    const caseRow = await db.selectFrom('insights_process_cases').selectAll().executeTakeFirstOrThrow()
    expect(caseRow).toEqual(expect.objectContaining({ status: 'completed', event_count: 3, rework_count: 0, distinct_actor_count: 1 }))
    expect(caseRow.variant_keys).toEqual(['created', 'status:open', 'status:won'])
    expect((await store.readCursor(SCOPE))?.lastCreatedAt).toBe('2026-10-08T10:05:00.000002Z')

    await store.commit(lease, LEASE_MS, { events: [], voids: [{ sourceLogIds: [won.sourceLogId], voidedByLogId: null }], advance: { kind: 'none' }, processes: [dealProcess] })
    const traceId = nextLogId()
    const traced = await store.commit(lease, LEASE_MS, { events: [], voids: [{ sourceLogIds: [won.sourceLogId], voidedByLogId: traceId }], advance: { kind: 'none' }, processes: [dealProcess] })
    expect(traced.voided).toBe(1)
    const voidedRow = await db.selectFrom('insights_process_events').select(['voided', 'voided_by_log_id']).where('source_log_id', '=', won.sourceLogId).executeTakeFirstOrThrow()
    expect(voidedRow).toEqual({ voided: true, voided_by_log_id: traceId })
    expect((await db.selectFrom('insights_process_cases').select(['status', 'event_count']).executeTakeFirstOrThrow())).toEqual({ status: 'open', event_count: 2 })

    const removed = await store.commit(lease, LEASE_MS, { events: [], voids: [{ sourceLogIds: [created.sourceLogId], voidedByLogId: nextLogId() }], advance: { kind: 'none' }, processes: [dealProcess] })
    expect(removed.casesRemoved).toBe(1)
    expect(await db.selectFrom('insights_process_cases').selectAll().execute()).toEqual([])
    await store.releaseLease(lease)
  })

  it('refuses scan writes of a superseded scan and finishes or abandons the active one', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const progressJobId = randomUUID()
    await store.startScan(cursor, { scanId: 'aaaaaaaa-0000-4000-8000-000000000001', chainId: CHAIN_A, kind: 'backfill', from: '2026-01-01T00:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null })
    await store.startScan(cursor, { scanId: 'aaaaaaaa-0000-4000-8000-000000000002', chainId: CHAIN_B, kind: 'backfill', from: null, until: '2026-10-08T10:00:00.000000Z', progressJobId })
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    await expect(store.commit(lease, LEASE_MS, {
      events: [event()],
      voids: [],
      advance: { kind: 'scan', scanId: 'aaaaaaaa-0000-4000-8000-000000000001', chainId: CHAIN_A, afterCreatedAt: '2026-05-01T00:00:00.000000Z', afterLogId: MAX_LOG_ID, processedDelta: 1 },
      processes: [dealProcess],
    })).rejects.toBeInstanceOf(ProjectionScanSupersededError)
    expect(await db.selectFrom('insights_process_events').selectAll().execute()).toEqual([])
    await expect(store.commit(lease, LEASE_MS, {
      events: [event()],
      voids: [],
      advance: { kind: 'scan', scanId: 'aaaaaaaa-0000-4000-8000-000000000002', chainId: CHAIN_A, afterCreatedAt: '2026-05-01T00:00:00.000000Z', afterLogId: MAX_LOG_ID, processedDelta: 1 },
      processes: [dealProcess],
    })).rejects.toBeInstanceOf(ProjectionScanSupersededError)
    await store.commit(lease, LEASE_MS, {
      events: [event()],
      voids: [],
      advance: { kind: 'scan', scanId: 'aaaaaaaa-0000-4000-8000-000000000002', chainId: CHAIN_B, afterCreatedAt: '2026-05-01T00:00:00.000007Z', afterLogId: MAX_LOG_ID, processedDelta: 5 },
      processes: [dealProcess],
    })
    const scanning = await store.readCursor(SCOPE)
    expect(scanning).toEqual(expect.objectContaining({ status: 'backfilling', scanAfterCreatedAt: '2026-05-01T00:00:00.000007Z', scanProcessedCount: 5, scanProgressJobId: progressJobId }))
    expect(await store.finishScan(lease, LEASE_MS, 'aaaaaaaa-0000-4000-8000-000000000001', CHAIN_A, 'backfill')).toBe(false)
    expect(await store.finishScan(lease, LEASE_MS, 'aaaaaaaa-0000-4000-8000-000000000002', CHAIN_A, 'backfill')).toBe(false)
    expect(await store.finishScan(lease, LEASE_MS, 'aaaaaaaa-0000-4000-8000-000000000002', CHAIN_B, 'backfill')).toBe(true)
    const finished = await store.readCursor(SCOPE)
    expect(finished).toEqual(expect.objectContaining({ status: 'idle', scanId: null, scanChainId: null, scanProgressJobId: null }))
    await store.releaseLease(lease)

    await sql`update insights_process_cursors set last_reconciled_at = '2026-01-01T00:00:00Z', last_full_reconciled_at = '2026-01-01T00:00:00Z'`.execute(db)
    await store.startScan(cursor, { scanId: 'aaaaaaaa-0000-4000-8000-000000000003', chainId: CHAIN_A, kind: 'reconcile', from: null, until: '2026-10-08T10:00:00.000000Z', progressJobId })
    expect(await store.abandonScan(SCOPE, 'aaaaaaaa-0000-4000-8000-000000000004', CHAIN_A, 'abandoned')).toBeNull()
    expect(await store.abandonScan(SCOPE, 'aaaaaaaa-0000-4000-8000-000000000003', CHAIN_B, 'abandoned')).toBeNull()
    expect(await store.abandonScan(SCOPE, 'aaaaaaaa-0000-4000-8000-000000000003', CHAIN_A, 'abandoned')).toEqual({ progressJobId })
    const abandoned = await store.readCursor(SCOPE)
    expect(abandoned).toEqual(expect.objectContaining({ status: 'idle', scanId: null, scanChainId: null, lastError: 'abandoned', lastFullReconciledAt: '2026-01-01T00:00:00.000000Z' }))
    expect(Date.parse(await store.now()) - Date.parse(abandoned?.lastReconciledAt ?? '')).toBeLessThan(60_000)
  })

  it('starts a scheduled scan only when idle, hands a stalled scan to one new chain and ignores stale heartbeats', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    const scheduled = { scanId: 'aaaaaaaa-0000-4000-8000-000000000011', chainId: CHAIN_A, kind: 'reconcile' as const, from: '2026-10-06T00:00:00.000000Z', until: '2026-10-08T10:00:00.000000Z', progressJobId: null }
    expect(await store.startScanIfIdle(lease, LEASE_MS, scheduled)).toBe(true)
    expect(await store.startScanIfIdle(lease, LEASE_MS, { ...scheduled, scanId: 'aaaaaaaa-0000-4000-8000-000000000012' })).toBe(false)
    expect((await store.readCursor(SCOPE))?.scanId).toBe(scheduled.scanId)

    expect(await store.resumeStalledScan(lease, LEASE_MS, 10 * 60_000)).toBeNull()
    await sql`update insights_process_cursors set scan_updated_at = now() - interval '11 minutes'`.execute(db)
    expect(await store.touchScan(SCOPE, scheduled.scanId, CHAIN_B)).toBe(false)
    const resumed = await store.resumeStalledScan(lease, LEASE_MS, 10 * 60_000)
    expect(resumed).toEqual({ scanId: scheduled.scanId, chainId: expect.any(String), progressJobId: null })
    expect(resumed?.chainId).not.toBe(CHAIN_A)
    expect(await store.resumeStalledScan(lease, LEASE_MS, 10 * 60_000)).toBeNull()
    expect(await store.touchScan(SCOPE, scheduled.scanId, CHAIN_A)).toBe(false)
    expect(await store.touchScan(SCOPE, scheduled.scanId, resumed?.chainId ?? '')).toBe(true)
    expect((await store.readCursor(SCOPE))?.scanChainId).toBe(resumed?.chainId)
    await store.releaseLease(lease)
  })

  it('reads distinct values, counts, prunes inactive cases and clears one organization only', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const otherCursor = await store.ensureCursor(OTHER_SCOPE, 60_000)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    const otherLease = await store.acquireLease(otherCursor, 'worker-a', LEASE_MS)
    if (!lease || !otherLease) throw new Error('[internal] leases expected')
    const oldCase = randomUUID()
    const oldEvent = event({ caseId: oldCase, occurredAt: '2025-01-01T00:00:00.000000Z' })
    const activeOld = event({ occurredAt: '2025-01-01T00:00:00.000000Z' })
    const activeNew = event({ activityKey: 'status:open', activityKind: 'stage', followupField: 'status', followupValue: 'open', occurredAt: '2026-10-01T00:00:00.000000Z' })
    const reserved = event({ activityKey: 'status:other', activityKind: 'stage', followupField: 'status', followupValue: 'other', occurredAt: '2026-10-02T00:00:00.000000Z' })
    await store.commit(lease, LEASE_MS, { events: [oldEvent, activeOld, activeNew, reserved], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.commit(otherLease, LEASE_MS, { events: [event({ occurredAt: '2025-01-01T00:00:00.000000Z' })], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    expect(await store.findKnownValues(SCOPE, dealProcess.processKey, 'status', ['open', 'won'])).toEqual(['open'])
    expect(await store.countDistinctValues(SCOPE, dealProcess.processKey, 'status', 201)).toBe(1)
    expect(await store.counts(SCOPE)).toEqual([expect.objectContaining({ processKey: dealProcess.processKey, events: 4, voidedEvents: 0, cases: 2, openCases: 2 })])

    const cutoff = '2026-01-01T00:00:00.000000Z'
    expect(await store.pruneProjectionBatch(lease, LEASE_MS, 'insights_process_events', cutoff, 100)).toBe(1)
    expect(await store.pruneProjectionBatch(lease, LEASE_MS, 'insights_process_cases', cutoff, 100)).toBe(1)
    const remaining = await db.selectFrom('insights_process_events').select('source_log_id').where('organization_id', '=', ORG_ID).execute()
    expect(remaining.map((row) => row.source_log_id).sort()).toEqual([activeOld.sourceLogId, activeNew.sourceLogId, reserved.sourceLogId].sort())

    expect(await store.clearProjectionBatch(lease, LEASE_MS, 'insights_process_events', 100)).toBe(3)
    const left = await db.selectFrom('insights_process_events').select('organization_id').execute()
    expect(left).toEqual([{ organization_id: OTHER_ORG_ID }])
    await store.releaseLease(lease)
    await store.releaseLease(otherLease)
  })

  it('records one erasure per user and re-pseudonymizes only organizations written under the same key', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const otherCursor = await store.ensureCursor(OTHER_SCOPE, 60_000)
    await sql`update insights_process_cursors set actor_key_fingerprint = 'tk1:key' where id = ${cursor.id}`.execute(db)
    await sql`update insights_process_cursors set actor_key_fingerprint = 'tk1:old-key' where id = ${otherCursor.id}`.execute(db)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    const otherLease = await store.acquireLease(otherCursor, 'worker-a', LEASE_MS)
    if (!lease || !otherLease) throw new Error('[internal] leases expected')
    await store.commit(lease, LEASE_MS, {
      events: [
        event({ actorPseudonym: 'tk1:erased-user' }),
        event({ activityKey: 'ownerUserId:changed', activityKind: 'followup', followupField: 'ownerUserId', followupValue: 'tk1:erased-user', actorPseudonym: 'tk1:someone' }),
      ],
      voids: [],
      advance: { kind: 'none' },
      processes: [dealProcess],
    })
    await store.commit(otherLease, LEASE_MS, { events: [event({ actorPseudonym: 'tk1:erased-user' })], voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.releaseLease(lease)
    await store.releaseLease(otherLease)

    const replacement = await store.recordErasure(TENANT_ID, USER_ID)
    expect(replacement).toMatch(/^erased:[0-9a-f-]{36}$/)
    expect(await store.recordErasure(TENANT_ID, USER_ID)).toBe(replacement)
    const fields = [{ processKey: dealProcess.processKey, field: 'ownerUserId' }]
    expect(await store.replaceActorPseudonym({ tenantId: OTHER_TENANT, pseudonym: 'tk1:erased-user', replacement, keyFingerprint: 'tk1:key', userValueFields: fields }))
      .toEqual({ updated: 0, mismatchedOrganizationIds: [] })
    expect(await store.replaceActorPseudonym({ tenantId: TENANT_ID, pseudonym: 'tk1:erased-user', replacement, keyFingerprint: 'tk1:key', userValueFields: fields }))
      .toEqual({ updated: 2, mismatchedOrganizationIds: [OTHER_ORG_ID] })
    const rows = await db
      .selectFrom('insights_process_events')
      .select(['organization_id', 'activity_kind', 'actor_pseudonym', 'followup_value'])
      .orderBy('organization_id')
      .orderBy('activity_kind')
      .execute()
    const expected = [
      { organization_id: ORG_ID, activity_kind: 'followup', actor_pseudonym: 'tk1:someone', followup_value: replacement },
      { organization_id: ORG_ID, activity_kind: 'lifecycle', actor_pseudonym: replacement, followup_value: null },
      { organization_id: OTHER_ORG_ID, activity_kind: 'lifecycle', actor_pseudonym: 'tk1:erased-user', followup_value: null },
    ]
    expect(rows).toEqual(expected.sort((left, right) => (left.organization_id < right.organization_id ? -1 : left.organization_id > right.organization_id ? 1 : 0) || (left.activity_kind < right.activity_kind ? -1 : left.activity_kind > right.activity_kind ? 1 : 0)))
  })

  it('applies the erasure ledger inside every later commit', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const replacement = await store.recordErasure(TENANT_ID, USER_ID)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    await store.commit(lease, LEASE_MS, {
      events: [
        event({ actorUserId: USER_ID, actorPseudonym: 'tk1:user' }),
        event({ activityKey: 'ownerUserId:changed', activityKind: 'followup', followupField: 'ownerUserId', followupUserId: USER_ID, followupValue: 'tk1:user', actorUserId: OTHER_TENANT, actorPseudonym: 'tk1:someone' }),
      ],
      voids: [],
      advance: { kind: 'none' },
      processes: [dealProcess],
    })
    await store.releaseLease(lease)
    const rows = await db.selectFrom('insights_process_events').select(['actor_pseudonym', 'followup_value']).orderBy('activity_kind').execute()
    expect(rows).toEqual([
      { actor_pseudonym: 'tk1:someone', followup_value: replacement },
      { actor_pseudonym: replacement, followup_value: null },
    ])
  })

  it('makes an erasure wait for an in-flight commit and then cover its rows', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    await sql`update insights_process_cursors set actor_key_fingerprint = 'tk1:key' where id = ${cursor.id}`.execute(db)
    const holder = await pool.connect()
    let erased: Promise<{ updated: number; mismatchedOrganizationIds: string[] }> | null = null
    try {
      await holder.query('begin')
      await holder.query(`select id from "${schema}".insights_process_cursors where id = $1 for update`, [cursor.id])
      await holder.query(
        `insert into "${schema}".insights_process_events (tenant_id, organization_id, process_key, case_kind, case_id, activity_key, activity_kind, occurred_at, source_log_id, seq, actor_pseudonym, cause_kind, created_at)
         values ($1, $2, $3, $4, $5, 'created', 'lifecycle', now(), $6, 0, 'tk1:late-user', 'user', now())`,
        [TENANT_ID, ORG_ID, dealProcess.processKey, dealProcess.resourceKind, DEAL_ID, nextLogId()],
      )
      erased = store.replaceActorPseudonym({ tenantId: TENANT_ID, pseudonym: 'tk1:late-user', replacement: 'erased:late', keyFingerprint: 'tk1:key', userValueFields: [] })
      await new Promise((resolve) => setTimeout(resolve, 300))
      await holder.query('commit')
    } finally {
      holder.release()
    }
    expect(await erased).toEqual({ updated: 1, mismatchedOrganizationIds: [] })
    const rows = await db.selectFrom('insights_process_events').select(['actor_pseudonym']).execute()
    expect(rows).toEqual([{ actor_pseudonym: 'erased:late' }])
  })

  it('summarizes a case beyond the event window exactly in SQL', async () => {
    const cursor = await store.ensureCursor(SCOPE, 60_000)
    const lease = await store.acquireLease(cursor, 'worker-a', LEASE_MS)
    if (!lease) throw new Error('[internal] lease expected')
    const total = CASE_EVENT_LIMIT + 25
    const base = Date.parse('2026-01-01T00:00:00.000Z')
    const events: ProjectionEventInsert[] = []
    for (let index = 0; index < total; index += 1) {
      const occurredAt = microIso(new Date(base + index * 1000))
      if (index === 0) {
        events.push(event({ occurredAt, activityKey: 'created', activityKind: 'lifecycle' }))
      } else if (index === total - 2) {
        events.push(event({ occurredAt, activityKey: 'status:won', activityKind: 'stage', followupField: 'status', followupValue: 'won', causeKind: 'workflow', actorPseudonym: 'tk1:late-actor' }))
      } else if (index === total - 1) {
        events.push(event({ occurredAt, activityKey: 'deleted', activityKind: 'lifecycle', causeKind: 'legacy', actorPseudonym: null }))
      } else {
        const status = index % 2 === 0 ? 'open' : 'review'
        events.push(event({ occurredAt, activityKey: `status:${status}`, activityKind: 'stage', followupField: 'status', followupValue: status, actorPseudonym: `tk1:actor-${index % 7}`, viaSyncRun: index % 50 === 0 }))
      }
    }
    await store.commit(lease, LEASE_MS, { events, voids: [], advance: { kind: 'none' }, processes: [dealProcess] })
    await store.releaseLease(lease)
    const rows: CaseEventRow[] = events.map((entry) => ({
      activityKey: entry.activityKey,
      activityKind: entry.activityKind,
      occurredAt: entry.occurredAt,
      sourceLogId: entry.sourceLogId,
      seq: entry.seq,
      actorPseudonym: entry.actorPseudonym,
      causeKind: entry.causeKind,
      viaSyncRun: entry.viaSyncRun,
      followupField: entry.followupField,
      followupValue: entry.followupValue,
    }))
    const expected = summarizeCase(dealProcess, rows.slice(0, CASE_EVENT_LIMIT), buildCaseAggregate(rows))
    if (!expected) throw new Error('[internal] summary expected')
    expect(expected).toEqual(expect.objectContaining({ status: 'deleted', eventCount: total, truncated: true }))
    const caseRow = await db
      .selectFrom('insights_process_cases')
      .select([
        'status',
        'event_count',
        'rework_count',
        'distinct_actor_count',
        'automated_share',
        'variant_hash',
        'dimensions',
        'truncated',
        sql<string>`to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('started_at'),
        sql<string>`to_char(last_activity_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('last_activity_at'),
        sql<string | null>`to_char(ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('ended_at'),
      ])
      .executeTakeFirstOrThrow()
    expect(caseRow).toEqual({
      status: expected.status,
      event_count: expected.eventCount,
      rework_count: expected.reworkCount,
      distinct_actor_count: expected.distinctActorCount,
      automated_share: expected.automatedShare,
      variant_hash: expected.variantHash,
      dimensions: expected.dimensions,
      truncated: true,
      started_at: expected.startedAt,
      last_activity_at: expected.lastActivityAt,
      ended_at: expected.endedAt,
    })
    expect(caseRow.last_activity_at).toBe(events[total - 1].occurredAt)
    expect(caseRow.dimensions).toEqual(expect.objectContaining({ stages: { status: 'won' }, legacyEvents: 1 }))
  })

  it('runs the incremental ingest end to end and restarts idempotently', async () => {
    const dbNow = await store.now()
    const createdAt = microIso(new Date(Date.parse(dbNow) - 5 * 60_000))
    const row: MemoryLogRow = {
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
    }
    const deps: XrayIngestDeps = {
      store,
      logSource: createMemoryLogSource([row]),
      registry: testRegistry(),
      pseudonymizer: { mode: 'tenant_key', fingerprint: 'tk1:e2e-key', pseudonymize: (userId) => `tk1:${userId}` },
      resolveActorDimensions: async (userIds) => new Map(userIds.map((id) => [id, { roleIds: null, teamId: null }])),
      redactedFields: new Set(),
      owner: 'worker-e2e',
    }
    const first = await runIngestSlice(deps, SCOPE, { retentionDays: 365 })
    expect(first).toEqual(expect.objectContaining({ status: 'caught_up', inserted: 3 }))
    const second = await runIngestSlice(deps, SCOPE, { retentionDays: 365 })
    expect(second).toEqual(expect.objectContaining({ status: 'caught_up', inserted: 0 }))
    const events = await db.selectFrom('insights_process_events').select(['activity_key', 'seq', 'occurred_at']).orderBy('seq').execute()
    expect(events.map((entry) => entry.activity_key)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`])
    const cursor = await store.readCursor(SCOPE)
    expect(cursor).toEqual(expect.objectContaining({ leaseOwner: null, leaseToken: 2, actorKeyFingerprint: 'tk1:e2e-key', lastError: null }))
  })
})
