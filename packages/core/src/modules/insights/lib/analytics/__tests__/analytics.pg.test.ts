/**
 * Runs the X-Ray analytics library (SQL loading, statistical guards, collapse, privacy,
 * rollups, cache) against a real PostgreSQL. Gated on OM_INSIGHTS_XRAY_PG_URL (a throwaway
 * database): the suite creates its own uniquely named schema from the insights migration and
 * drops it afterwards.
 *
 *   OM_INSIGHTS_XRAY_PG_URL=postgres://postgres:postgres@localhost:55432/om_scratch \
 *     npx jest src/modules/insights/lib/analytics/__tests__/analytics.pg.test.ts --runInBand
 */
import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { createCacheService } from '@open-mercato/cache'
import { Migration20261008180752_insights } from '../../../migrations/Migration20261008180752_insights'
import { summarizeCase } from '../../process/caseSummary'
import { testRegistry } from '../../process/__tests__/processTestSupport'
import type { XrayDatabase } from '../../projection/types'
import {
  AnalyticsIndividualsDeniedError,
  AnalyticsInvalidRequestError,
  AnalyticsProcessNotFoundError,
  AnalyticsTimeoutError,
  AnalyticsTooLargeError,
  AnalyticsWindowTooLargeError,
  createAnalyticsCacheState,
  createXrayAnalytics,
  resolveDefaultWindow,
  sequenceModel,
  type AccessLogWriter,
  type AnalyticsOrgSettings,
  type AnalyticsRequestInput,
  type AnalyticsViewer,
  type XrayAnalyticsDeps,
} from '../index'
import { loadCaseEvents, listActiveProcessKeys, runAnalyticsQuery } from '../query'
import { isRollupPassDue, listRollupPasses, markRollupPass, markRollupsInvalidated, pruneStaleRollups, upsertRollup } from '../rollups'
import { normalizeCauseKind, type AnalyticsEventRow } from '../trace'
import { XRAY_MAP_END, rollupMetricsSchema } from '../types'
import { DAY_MS, HOUR_MS, actorOf, creation, dealProcess, stepRow } from './analyticsTestSupport'

const PG_URL = process.env.OM_INSIGHTS_XRAY_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-0000-4000-8000-00000000a601'
const OTHER_TENANT = '11111111-0000-4000-8000-00000000a602'
const ORG_A = '22222222-0000-4000-8000-00000000a601'
const ORG_B = '22222222-0000-4000-8000-00000000a602'
const ORG_C = '22222222-0000-4000-8000-00000000a603'
const ROLE_BIG = '99999999-0000-4000-8000-00000000a601'
const ROLE_SOLO = '99999999-0000-4000-8000-00000000a602'
const TEAM_BIG = '99999999-0000-4000-8000-00000000a611'
const TEAM_SOLO = '99999999-0000-4000-8000-00000000a612'
const VIEWER_ID = '33333333-0000-4000-8000-00000000a601'
const NOW = Date.UTC(2026, 0, 20, 12)
const registry = testRegistry()
const VIEWER: AnalyticsViewer = { userId: VIEWER_ID, features: ['insights.xray.view'], canViewIndividuals: false }

async function migrationStatements(): Promise<string[]> {
  const migration = Object.create(Migration20261008180752_insights.prototype) as Migration20261008180752_insights
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration.up()
  return statements
}

type SeedOptions = {
  tenantId?: string
  organizationId?: string
  processKey?: string
  voided?: ReadonlySet<string>
}

type CaseShape = {
  startMs: number
  durationDays?: number | null
  actor?: string
  organizationId?: string
  createdCause?: string
  createdSync?: boolean
  loop?: boolean
  correction?: boolean
}

maybe('X-Ray analytics against PostgreSQL', () => {
  jest.setTimeout(120_000)
  const schema = `xray_analytics_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let db: Kysely<XrayDatabase>
  let settings: Map<string, AnalyticsOrgSettings>

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: PG_URL })
    await setupPool.query(`create schema "${schema}"`)
    await setupPool.end()
    const pool = new Pool({ connectionString: PG_URL, max: 6, options: `-c search_path=${schema}` })
    db = new Kysely<XrayDatabase>({ dialect: new PostgresDialect({ pool }) })
    for (const statement of await migrationStatements()) await sql.raw(statement).execute(db)
  })

  afterAll(async () => {
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate insights_process_cursors, insights_process_events, insights_process_cases, insights_process_rollups, insights_process_erasures, insights_process_settings`.execute(db)
    settings = new Map([
      [ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false }],
      [ORG_B, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false }],
    ])
  })

  function analyticsWith(overrides: Partial<XrayAnalyticsDeps> = {}) {
    return createXrayAnalytics({
      db,
      registry: () => registry,
      loadSettings: async (_tenantId, organizationIds) => new Map(organizationIds
        .filter((organizationId) => settings.has(organizationId))
        .map((organizationId) => [organizationId, settings.get(organizationId) as AnalyticsOrgSettings])),
      cache: null,
      cacheState: createAnalyticsCacheState(),
      clock: () => NOW,
      ...overrides,
    })
  }

  function request(overrides: Partial<AnalyticsRequestInput> = {}): AnalyticsRequestInput {
    return {
      scope: { tenantId: TENANT, organizationIds: [ORG_A] },
      processKey: dealProcess.processKey,
      window: { windowKey: '30d' },
      viewer: VIEWER,
      ...overrides,
    }
  }

  async function insertRows(rows: AnalyticsEventRow[], options: SeedOptions = {}): Promise<void> {
    if (rows.length === 0) return
    await db.insertInto('insights_process_events').values(rows.map((row) => ({
      tenant_id: options.tenantId ?? TENANT,
      organization_id: row.organizationId,
      process_key: options.processKey ?? dealProcess.processKey,
      case_kind: dealProcess.resourceKind,
      case_id: row.caseId,
      activity_key: row.activityKey,
      activity_kind: row.activityKind,
      occurred_at: row.occurredAt,
      source_log_id: row.sourceLogId,
      seq: row.seq,
      actor_pseudonym: row.actorPseudonym,
      actor_role_ids: row.actorRoleIds,
      actor_team_id: row.actorTeamId,
      cause_kind: normalizeCauseKind(row.causeKind),
      cause_id: null,
      via_sync_run: row.viaSyncRun,
      followup_field: row.followupField,
      followup_value: row.followupValue,
      voided: options.voided?.has(row.sourceLogId) ?? false,
      voided_by_log_id: null,
      created_at: new Date(NOW).toISOString(),
    }))).execute()
  }

  async function seedCase(rows: AnalyticsEventRow[], options: SeedOptions = {}): Promise<void> {
    await insertRows(rows, options)
    const live = rows
      .filter((row) => !options.voided?.has(row.sourceLogId))
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.sourceLogId.localeCompare(right.sourceLogId) || left.seq - right.seq)
    const summary = summarizeCase(dealProcess, live.map((row) => ({
      activityKey: row.activityKey,
      activityKind: row.activityKind,
      occurredAt: row.occurredAt,
      sourceLogId: row.sourceLogId,
      seq: row.seq,
      actorPseudonym: row.actorPseudonym,
      causeKind: normalizeCauseKind(row.causeKind),
      viaSyncRun: row.viaSyncRun,
      followupField: row.followupField,
      followupValue: row.followupValue,
    })))
    if (!summary) return
    await db.insertInto('insights_process_cases').values({
      tenant_id: options.tenantId ?? TENANT,
      organization_id: rows[0].organizationId,
      process_key: options.processKey ?? dealProcess.processKey,
      case_kind: dealProcess.resourceKind,
      case_id: rows[0].caseId,
      started_at: summary.startedAt,
      last_activity_at: summary.lastActivityAt,
      ended_at: summary.endedAt,
      status: summary.status,
      event_count: summary.eventCount,
      rework_count: summary.reworkCount,
      distinct_actor_count: summary.distinctActorCount,
      automated_share: summary.automatedShare,
      variant_hash: summary.variantHash,
      variant_keys: JSON.stringify(summary.variantKeys),
      dimensions: JSON.stringify(summary.dimensions),
      truncated: false,
      recomputed_at: new Date(NOW).toISOString(),
      created_at: new Date(NOW).toISOString(),
      updated_at: new Date(NOW).toISOString(),
    }).execute()
  }

  function dealRows(shape: CaseShape): AnalyticsEventRow[] {
    const caseId = randomUUID()
    const organizationId = shape.organizationId ?? ORG_A
    const actor = shape.actor ?? actorOf(1)
    const rows = [...creation(caseId, shape.startMs, { actor, cause: shape.createdCause ?? 'user', sync: shape.createdSync }, organizationId)]
    let at = shape.startMs + DAY_MS
    if (shape.loop) {
      rows.push(stepRow(caseId, { key: 'status:qualified', atMs: at, actor }, organizationId))
      rows.push(stepRow(caseId, { key: 'status:proposal', atMs: at + 20_000, actor }, organizationId))
      rows.push(stepRow(caseId, { key: 'status:negotiation', atMs: at + 40_000, actor }, organizationId))
    } else if (shape.correction) {
      rows.push(stepRow(caseId, { key: 'status:lost', atMs: at, actor }, organizationId))
      rows.push(stepRow(caseId, { key: 'status:open', atMs: at + 30_000, actor }, organizationId))
      at += DAY_MS
      rows.push(stepRow(caseId, { key: 'status:qualified', atMs: at, actor }, organizationId))
    } else {
      rows.push(stepRow(caseId, { key: 'status:qualified', atMs: at, actor }, organizationId))
    }
    if (shape.durationDays !== null) {
      rows.push(stepRow(caseId, { key: 'status:won', atMs: shape.startMs + (shape.durationDays ?? 2) * DAY_MS, actor }, organizationId))
    }
    return rows
  }

  async function seedDeals(count: number, shape: Omit<CaseShape, 'actor'> & { actors?: number }, options: SeedOptions = {}): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await seedCase(dealRows({ ...shape, actor: actorOf((index % (shape.actors ?? 3)) + 1), startMs: shape.startMs + index * HOUR_MS }), options)
    }
  }

  async function insertCursor(organizationId: string, lastCreatedAtMs: number, tenantId = TENANT): Promise<void> {
    await db.insertInto('insights_process_cursors').values({
      tenant_id: tenantId,
      organization_id: organizationId,
      last_created_at: new Date(lastCreatedAtMs).toISOString(),
      status: 'idle',
      scan_processed_count: 0,
      lease_token: 0,
      created_at: new Date(NOW).toISOString(),
      updated_at: new Date(NOW).toISOString(),
    }).execute()
  }

  it('withholds small duration cells and reports open cases as right-censored', async () => {
    const analytics = analyticsWith()
    await seedDeals(3, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    await seedDeals(2, { startMs: NOW - 40 * DAY_MS, durationDays: null })
    await seedDeals(1, { startMs: NOW - 2 * DAY_MS, durationDays: null })
    const small = await analytics.getDurations(request())
    expect(small.n).toBe(3)
    expect(small.completed).toBeNull()
    expect(small.open).toBeNull()
    expect(small.byOrganization).toEqual([{ organizationId: ORG_A, completed: null, open: null }])
    expect(small.suppressed.minCases).toBe(4)
    await seedDeals(3, { startMs: NOW - 45 * DAY_MS, durationDays: null })
    await seedDeals(3, { startMs: NOW - 9 * DAY_MS, durationDays: 2 })
    const enough = await analytics.getDurations(request())
    expect(enough.n).toBe(6)
    expect(enough.completed?.stats).toEqual({ n: 6, medianMs: 2 * DAY_MS, p90Ms: null, lowConfidence: true })
    expect(enough.open).toEqual(expect.objectContaining({ empty: false, censored: true, asOf: new Date(NOW).toISOString() }))
    expect(enough.open?.stats).toEqual(expect.objectContaining({ n: 6, p90Ms: null, lowConfidence: true }))
    expect(enough.open?.histogram.filter((bucket) => bucket.count > 0)).toEqual([
      { bucket: '1d_7d', count: 1 },
      { bucket: '30d_90d', count: 5 },
    ])
    expect(enough.byOrganization).toEqual([expect.objectContaining({ organizationId: ORG_A, completed: expect.objectContaining({ excludedSyncRun: 0 }) })])
  })

  it('splits durations per organization (Simpson) and scopes tenant-wide, listed and empty organization filters', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 20 * DAY_MS, durationDays: 2, organizationId: ORG_A })
    await seedDeals(6, { startMs: NOW - 20 * DAY_MS, durationDays: 10, organizationId: ORG_B })
    await seedDeals(6, { startMs: NOW - 20 * DAY_MS, durationDays: 1, organizationId: ORG_A }, { tenantId: OTHER_TENANT })
    await insertCursor(ORG_A, NOW - HOUR_MS)
    await insertCursor(ORG_B, NOW - 2 * HOUR_MS)
    await insertCursor(ORG_A, NOW - 5 * HOUR_MS, OTHER_TENANT)
    const tenantWide = await analytics.getDurations(request({ scope: { tenantId: TENANT, organizationIds: null } }))
    expect(tenantWide.n).toBe(12)
    expect(tenantWide.organizationIds).toBeNull()
    expect(Date.parse(tenantWide.computedThrough ?? '')).toBe(NOW - 2 * HOUR_MS)
    expect(tenantWide.completed?.stats.medianMs).toBe(6 * DAY_MS)
    expect(tenantWide.byOrganization.map((entry) => [entry.organizationId, entry.completed?.stats.medianMs])).toEqual([
      [ORG_A, 2 * DAY_MS],
      [ORG_B, 10 * DAY_MS],
    ])
    const listed = await analytics.getDurations(request({ scope: { tenantId: TENANT, organizationIds: [ORG_A] } }))
    expect(listed.n).toBe(6)
    expect(listed.byOrganization.map((entry) => entry.organizationId)).toEqual([ORG_A])
    expect(Date.parse(listed.computedThrough ?? '')).toBe(NOW - HOUR_MS)
    const empty = await analytics.getDurations(request({ scope: { tenantId: TENANT, organizationIds: [] } }))
    expect(empty).toEqual(expect.objectContaining({ n: 0, computedThrough: null, byOrganization: [] }))
    const otherTenant = await analytics.getProcessMap(request({ scope: { tenantId: OTHER_TENANT, organizationIds: [ORG_A] } }))
    expect(otherTenant.n).toBe(6)
    expect(await loadCaseEvents(db, { scope: { tenantId: TENANT, organizationIds: [] }, processKey: dealProcess.processKey, registeredKeys: [dealProcess.processKey], from: new Date(0).toISOString(), to: new Date(NOW).toISOString() })).toEqual([])
  })

  it('collapses debounce loops at query time and returns raw and collapsed counts', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 3, loop: true })
    const map = await analytics.getProcessMap(request())
    expect(map.events).toEqual({ raw: 36, collapsed: 24, debounced: 12, corrected: 0 })
    const edge = (from: string, to: string) => map.edges.find((candidate) => candidate.from === from && candidate.to === to)
    expect(edge('status:open', 'status:negotiation')).toEqual(expect.objectContaining({ raw: 0, collapsed: 6, cases: 6 }))
    expect(edge('status:open', 'status:qualified')).toEqual(expect.objectContaining({ raw: 6, collapsed: 0 }))
    expect(edge('status:won', XRAY_MAP_END)).toEqual(expect.objectContaining({ raw: 6, collapsed: 6 }))
    const variants = await analytics.getVariants({ ...request(), limit: 5 })
    expect(variants.distinctVariants).toEqual({ raw: 1, collapsed: 1 })
    expect(variants.items[0].activityKeys).toEqual(['created', 'status:open', 'status:negotiation', 'status:won'])
  })

  it('tells corrections (A→B→A) apart from rework', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 4, correction: true })
    const rework = await analytics.getRework(request())
    expect(rework).toEqual(expect.objectContaining({ n: 6, rework: 0, reworkRaw: 6, corrections: 6, casesWithRework: 0, casesWithReworkRaw: 6, reworkRate: 0 }))
    expect(rework.byStage).toEqual([
      { activityKey: 'status:open', rework: 0, reworkRaw: 6, corrections: 0, cases: 6 },
      { activityKey: 'status:lost', rework: 0, reworkRaw: 0, corrections: 6, cases: 6 },
    ])
  })

  it('keeps automated steps tagged by cause and buckets legacy rows apart from human ones', async () => {
    const analytics = analyticsWith()
    for (let index = 0; index < 6; index += 1) {
      const caseId = randomUUID()
      const startMs = NOW - 10 * DAY_MS + index * HOUR_MS
      await seedCase([
        ...creation(caseId, startMs, { actor: actorOf((index % 3) + 1), cause: 'legacy' }, ORG_A),
        stepRow(caseId, { key: 'status:qualified', atMs: startMs + DAY_MS, actor: null, cause: 'workflow' }, ORG_A),
        stepRow(caseId, { key: 'status:won', atMs: startMs + 2 * DAY_MS, actor: actorOf((index % 3) + 1), cause: 'user' }, ORG_A),
      ])
    }
    const map = await analytics.getProcessMap(request())
    const node = (key: string) => map.nodes.find((candidate) => candidate.activityKey === key)
    expect(node('created')?.causes).toEqual({ human: 0, automated: 0, legacy: 6, other: 0, byKind: { legacy: 6 } })
    expect(node('status:qualified')?.causes).toEqual({ human: 0, automated: 6, legacy: 0, other: 0, byKind: { workflow: 6 } })
    expect(node('status:won')?.causes.human).toBe(6)
    const breakdown = await analytics.getBreakdown({ ...request(), groupBy: 'org' })
    expect(breakdown.items).toEqual([expect.objectContaining({ organizationId: ORG_A, group: ORG_A, collapsed: 24, cases: 6, actors: 3 })])
    expect(breakdown.items[0].causes).toEqual(expect.objectContaining({ human: 6, automated: 6, legacy: 12 }))
  })

  it('excludes sync_run steps from duration statistics by default', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 20 * DAY_MS, durationDays: 2 })
    await seedDeals(1, { startMs: NOW - 15 * DAY_MS, durationDays: 12, createdCause: 'sync_run', createdSync: true })
    const durations = await analytics.getDurations(request())
    expect(durations.completed?.stats).toEqual(expect.objectContaining({ n: 6, medianMs: 2 * DAY_MS }))
    expect(durations.completed?.excludedSyncRun).toBe(1)
    const withSync = await analytics.getDurations(request({ filters: { includeSyncRun: true } }))
    expect(withSync.completed?.stats.n).toBe(7)
    expect(withSync.includeSyncRun).toBe(true)
    const bottlenecks = await analytics.getBottlenecks(request())
    expect(bottlenecks.transitions.excludedSyncRun).toBe(2)
  })

  it('never reads voided events', async () => {
    const analytics = analyticsWith()
    const voided = new Set<string>()
    for (let index = 0; index < 6; index += 1) {
      const rows = dealRows({ startMs: NOW - 10 * DAY_MS + index * HOUR_MS, durationDays: 3, actor: actorOf((index % 3) + 1) })
      const undone = stepRow(rows[0].caseId, { key: 'status:lost', atMs: NOW - 9 * DAY_MS + index * HOUR_MS + 1000, actor: actorOf((index % 3) + 1) }, ORG_A)
      voided.add(undone.sourceLogId)
      await seedCase([...rows, undone], { voided })
    }
    const fullyVoided = dealRows({ startMs: NOW - 5 * DAY_MS, durationDays: 1 })
    await insertRows(fullyVoided, { voided: new Set(fullyVoided.map((row) => row.sourceLogId)) })
    const map = await analytics.getProcessMap(request())
    expect(map.n).toBe(6)
    expect(map.events.raw).toBe(24)
    expect(map.nodes.map((node) => node.activityKey)).not.toContain('status:lost')
  })

  it('suppresses cells under k cases or with fewer than three distinct actors', async () => {
    settings.set(ORG_A, { kAnonymity: 10, debounceSeconds: 120, individualsEnabled: false })
    const analytics = analyticsWith()
    await seedDeals(9, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    const tooFewCases = await analytics.getProcessMap(request())
    expect(tooFewCases).toEqual(expect.objectContaining({ n: 9, kAnonymity: 10, nodes: [], edges: [] }))
    expect(tooFewCases.suppressed.minCases).toBeGreaterThan(0)
    await seedDeals(3, { startMs: NOW - 8 * DAY_MS, durationDays: 2 })
    const visible = await analytics.getProcessMap(request())
    expect(visible.n).toBe(12)
    expect(visible.edges.length).toBeGreaterThan(0)
    await sql`truncate insights_process_events, insights_process_cases`.execute(db)
    await seedDeals(12, { startMs: NOW - 10 * DAY_MS, durationDays: 2, actors: 2 })
    const fewActors = await analytics.getProcessMap(request())
    expect(fewActors.edges).toEqual([])
    expect(fewActors.suppressed.minActors).toBeGreaterThan(0)
  })

  it('places day boundaries in the tenant time zone', async () => {
    const analytics = analyticsWith()
    const warsawWindow = resolveDefaultWindow('7d', NOW, 'Europe/Warsaw')
    expect(warsawWindow.fromMs).toBe(Date.UTC(2026, 0, 13, 23))
    await seedCase(creation(randomUUID(), Date.UTC(2026, 0, 13, 23, 30), {}, ORG_A))
    await seedCase(creation(randomUUID(), Date.UTC(2026, 0, 13, 22, 30), {}, ORG_A))
    const warsaw = await analytics.getProcessMap(request({ window: { windowKey: '7d' }, timeZone: 'Europe/Warsaw' }))
    expect(warsaw.n).toBe(1)
    expect(warsaw.window).toEqual({ from: warsawWindow.from, to: warsawWindow.to, windowKey: '7d', timeZone: 'Europe/Warsaw' })
    const utc = await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))
    expect(utc.n).toBe(0)
  })

  it('refuses windows over 180 days and maps statement timeouts to a typed error', async () => {
    const analytics = analyticsWith()
    await expect(analytics.getProcessMap(request({
      window: { from: new Date(NOW - 200 * DAY_MS).toISOString(), to: new Date(NOW).toISOString() },
    }))).rejects.toBeInstanceOf(AnalyticsWindowTooLargeError)
    await expect(runAnalyticsQuery(db, async (trx) => sql`select pg_sleep(1)`.execute(trx), { timeoutMs: 50 })).rejects.toBeInstanceOf(AnalyticsTimeoutError)
    await expect(runAnalyticsQuery(db, async (trx) => sql`insert into insights_process_erasures (tenant_id, user_id, replacement, created_at) values (${TENANT}, ${VIEWER_ID}, 'x', now())`.execute(trx)))
      .rejects.toEqual(expect.objectContaining({ code: '25006' }))
  })

  it('refuses reads above the event budget and skips such rollup windows', async () => {
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    const bounded = analyticsWith({ maxEvents: 5 })
    await expect(bounded.getProcessMap(request())).rejects.toBeInstanceOf(AnalyticsTooLargeError)
    expect(await bounded.computeRollups({ tenantId: TENANT, organizationId: ORG_A })).toEqual({ processes: 1, written: 1, skipped: 2 })
    const stored = await db.selectFrom('insights_process_rollups').select(['window_key']).execute()
    expect(stored).toEqual([{ window_key: '7d' }])
  })

  it('reads only currently registered process keys', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    for (let index = 0; index < 6; index += 1) {
      await insertRows(dealRows({ startMs: NOW - 10 * DAY_MS + index * HOUR_MS, durationDays: 2 }), { processKey: 'test.ghost' })
    }
    await expect(analytics.getProcessMap(request({ processKey: 'test.ghost' }))).rejects.toBeInstanceOf(AnalyticsProcessNotFoundError)
    const window = resolveDefaultWindow('30d', NOW, 'UTC')
    expect(await loadCaseEvents(db, { scope: { tenantId: TENANT, organizationIds: [ORG_A] }, processKey: 'test.ghost', registeredKeys: [dealProcess.processKey], from: window.from, to: window.to })).toEqual([])
    expect(await listActiveProcessKeys(db, { tenantId: TENANT, organizationId: ORG_A, registeredKeys: [dealProcess.processKey], since: window.from })).toEqual([dealProcess.processKey])
    expect(await analytics.computeRollups({ tenantId: TENANT, organizationId: ORG_A })).toEqual({ processes: 1, written: 3, skipped: 0 })
    const keys = await db.selectFrom('insights_process_rollups').select('process_key').distinct().execute()
    expect(keys.map((row) => row.process_key)).toEqual([dealProcess.processKey])
  })

  it('upserts rollups idempotently, serves them for default windows and stops after an invalidation', async () => {
    const analytics = analyticsWith()
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await insertCursor(ORG_A, NOW - HOUR_MS)
    await seedDeals(6, { startMs: NOW - 5 * DAY_MS, durationDays: 2 })
    expect(await analytics.computeRollups(scope)).toEqual({ processes: 1, written: 3, skipped: 0 })
    expect(await analytics.computeRollups(scope)).toEqual({ processes: 1, written: 3, skipped: 0 })
    const rows = await db.selectFrom('insights_process_rollups').select(['window_key', 'computed_at']).orderBy('window_key').execute()
    expect(rows.map((row) => row.window_key)).toEqual(['30d', '7d', '90d'])
    const fromRollup = await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))
    expect(fromRollup).toEqual(expect.objectContaining({ source: 'rollup', n: 6 }))
    const variants = await analytics.getVariants({ ...request({ window: { windowKey: '7d' } }), limit: 1 })
    expect(variants).toEqual(expect.objectContaining({ source: 'rollup', n: 6 }))
    const live = await analytics.getProcessMap(request({ window: { windowKey: '7d' }, filters: { causeKinds: ['user'] } }))
    expect(live.source).toBe('live')
    const pooled = await analytics.getProcessMap(request({ window: { windowKey: '7d' }, scope: { tenantId: TENANT, organizationIds: [ORG_A, ORG_B] } }))
    expect(pooled.source).toBe('live')
    await seedDeals(2, { startMs: NOW - 3 * DAY_MS, durationDays: 1 })
    expect((await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))).n).toBe(6)
    await analytics.invalidate(scope)
    const afterInvalidation = await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))
    expect(afterInvalidation).toEqual(expect.objectContaining({ source: 'live', n: 8 }))
    await analytics.computeRollups(scope)
    expect(await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))).toEqual(expect.objectContaining({ source: 'rollup', n: 8 }))
    settings.set(ORG_A, { kAnonymity: 6, debounceSeconds: 120, individualsEnabled: false })
    expect((await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))).source).toBe('live')
    settings.set(ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false })
    const window = resolveDefaultWindow('7d', NOW, 'UTC')
    const stored = await db.selectFrom('insights_process_rollups').select(['metrics']).where('window_key', '=', '7d').executeTakeFirstOrThrow()
    const late = await upsertRollup(db, {
      scope,
      processKey: dealProcess.processKey,
      window,
      computedAt: new Date(Date.UTC(1971, 0, 1)).toISOString(),
      metrics: rollupMetricsSchema.parse(stored.metrics),
    })
    expect(late).toBe(false)
    await markRollupsInvalidated(db, scope)
    const markers = await db.selectFrom('insights_process_rollups').select(['window_key']).where('process_key', '=', '*').execute()
    expect(markers).toEqual([{ window_key: '__invalidated__' }])
    expect((await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))).source).toBe('live')
  })

  it('gates per-person breakdowns and writes the access log before returning them', async () => {
    const entries: unknown[] = []
    const writer: AccessLogWriter = { log: async (entry) => { entries.push(entry); return { id: randomUUID() } } }
    const individualsViewer: AnalyticsViewer = { ...VIEWER, features: ['insights.xray.view', 'insights.xray.view_individuals'], canViewIndividuals: true }
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2, actors: 1 })
    const disabled = analyticsWith({ accessLog: writer })
    await expect(disabled.getBreakdown({ ...request({ viewer: individualsViewer }), groupBy: 'user' })).rejects.toBeInstanceOf(AnalyticsIndividualsDeniedError)
    expect(entries).toEqual([])
    settings.set(ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: true })
    const enabled = analyticsWith({ accessLog: writer })
    const perPerson = await enabled.getBreakdown({ ...request({ viewer: individualsViewer }), groupBy: 'user' })
    expect(perPerson.perPerson).toBe(true)
    expect(perPerson.items).toEqual([expect.objectContaining({ group: actorOf(1), cases: 6, actors: 1 })])
    expect(entries).toEqual([expect.objectContaining({ tenantId: TENANT, organizationId: ORG_A, actorUserId: VIEWER_ID, resourceKind: 'insights.xray.individuals' })])
    const failing = analyticsWith({ accessLog: { log: async () => { throw new Error('[internal] audit store down') } } })
    const denied = await failing.getBreakdown({ ...request({ viewer: individualsViewer }), groupBy: 'user' }).then(() => null, (error: unknown) => error)
    expect(denied).toBeInstanceOf(AnalyticsIndividualsDeniedError)
    expect((denied as AnalyticsIndividualsDeniedError).reason).toBe('access_log_failed')
    const withoutWriter = analyticsWith()
    await expect(withoutWriter.getBreakdown({ ...request({ viewer: individualsViewer }), groupBy: 'user' })).rejects.toEqual(expect.objectContaining({ reason: 'access_log_unavailable' }))
  })

  it('lists case ids with keyset pagination and filters', async () => {
    const analytics = analyticsWith()
    await seedDeals(5, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    await seedDeals(2, { startMs: NOW - 6 * DAY_MS, durationDays: null })
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await analytics.listCases({ ...request(), pageSize: 3, cursor })
      expect(page.n).toBe(7)
      expect(page.items.length).toBeLessThanOrEqual(3)
      seen.push(...page.items.map((item) => item.caseId))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 5)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(7)
    expect((await analytics.listCases({ ...request(), statuses: ['completed'] })).n).toBe(5)
    expect((await analytics.listCases({ ...request(), activityKey: 'status:won' })).n).toBe(5)
    const openVariant = await db.selectFrom('insights_process_cases').select('variant_hash').where('status', '=', 'open').executeTakeFirstOrThrow()
    expect((await analytics.listCases({ ...request(), variantHash: openVariant.variant_hash })).n).toBe(0)
    const variants = await analytics.getVariants({ ...request(), limit: 5 })
    expect((await analytics.listCases({ ...request(), variantHashes: variants.items[0].rawVariantHashes })).n).toBe(5)
    expect((await analytics.listCases({ ...request({ filters: { causeKinds: ['workflow'] } }) })).n).toBe(0)
    expect((await analytics.listCases({ ...request({ filters: { causeKinds: ['user'] } }) })).n).toBe(7)
    expect((await analytics.listCases({ ...request({ scope: { tenantId: TENANT, organizationIds: [ORG_B] } }) })).n).toBe(0)
  })

  it('evaluates conformance on completed traces', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    const result = await analytics.getConformance({ ...request(), models: [sequenceModel(['created', 'status:open', 'status:qualified', 'status:won'])] })
    expect(result).toEqual(expect.objectContaining({ status: 'ok', n: 6, coverage: 1 }))
    if (result.status !== 'ok') return
    expect(result.models[0]).toEqual(expect.objectContaining({ conformingCases: 6, fitness: 1 }))
    const refused = await analytics.getConformance({ ...request(), models: [sequenceModel(['created', 'status:won'])] })
    expect(refused).toEqual(expect.objectContaining({ status: 'refused', reason: 'insufficient_coverage' }))
  })

  it('caches results per permission fingerprint until the organization is invalidated', async () => {
    const analytics = analyticsWith({ cache: createCacheService({ strategy: 'memory' }) })
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    expect((await analytics.getProcessMap(request())).n).toBe(6)
    await seedDeals(1, { startMs: NOW - 4 * DAY_MS, durationDays: 1 })
    expect((await analytics.getProcessMap(request())).n).toBe(6)
    const otherViewer = { ...VIEWER, userId: randomUUID(), features: ['insights.*'] }
    expect((await analytics.getProcessMap(request({ viewer: otherViewer }))).n).toBe(7)
    await analytics.invalidate(scope)
    expect((await analytics.getProcessMap(request())).n).toBe(7)
  })

  function roleDealRows(startMs: number, actor: string, roleIds: string[], teamId: string | null): AnalyticsEventRow[] {
    const caseId = randomUUID()
    const sourceLogId = randomUUID()
    const shared = { actor, roleIds, teamId }
    return [
      stepRow(caseId, { ...shared, key: 'created', kind: 'lifecycle', field: null, value: null, atMs: startMs, sourceLogId, seq: 0 }, ORG_A),
      stepRow(caseId, { ...shared, key: 'status:open', atMs: startMs, sourceLogId, seq: 1 }, ORG_A),
      stepRow(caseId, { ...shared, key: 'status:qualified', atMs: startMs + DAY_MS }, ORG_A),
      stepRow(caseId, { ...shared, key: 'status:won', atMs: startMs + 2 * DAY_MS }, ORG_A),
    ]
  }

  async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run()
      return null
    } catch (error) {
      return error
    }
  }

  it('refuses role and team filters whose values single out fewer than k cases or three actors, value by value', async () => {
    for (let index = 0; index < 6; index += 1) {
      await seedCase(roleDealRows(NOW - 10 * DAY_MS + index * HOUR_MS, actorOf((index % 3) + 1), [ROLE_BIG], TEAM_BIG))
      await seedCase(roleDealRows(NOW - 9 * DAY_MS + index * HOUR_MS, actorOf(9), [ROLE_SOLO], TEAM_SOLO))
    }
    const entries: unknown[] = []
    const writer: AccessLogWriter = { log: async (entry) => { entries.push(entry); return { id: randomUUID() } } }
    const individualsViewer: AnalyticsViewer = { ...VIEWER, features: ['insights.xray.view', 'insights.xray.view_individuals'], canViewIndividuals: true }
    const analytics = analyticsWith({ accessLog: writer })
    const tooNarrow = expect.objectContaining({ code: 'filter_too_narrow', status: 422, hint: 'widen_actor_filter' })
    await expect(analytics.getProcessMap(request({ filters: { actorRoleIds: [ROLE_SOLO] } }))).rejects.toEqual(tooNarrow)
    await expect(analytics.getProcessMap(request({ filters: { actorRoleIds: [ROLE_BIG, ROLE_SOLO] } }))).rejects.toEqual(tooNarrow)
    await expect(analytics.getVariants({ ...request({ filters: { actorTeamIds: [TEAM_BIG, TEAM_SOLO] } }), limit: 5 })).rejects.toEqual(tooNarrow)
    await expect(analytics.getDurations(request({ filters: { actorRoleIds: [randomUUID()] } }))).rejects.toEqual(tooNarrow)
    await expect(analytics.listCases(request({ filters: { actorRoleIds: [ROLE_SOLO] } }))).rejects.toEqual(tooNarrow)
    await expect(analytics.getBreakdown({ ...request({ viewer: individualsViewer, filters: { actorRoleIds: [ROLE_SOLO] } }), groupBy: 'role' })).rejects.toEqual(tooNarrow)
    const refused = await errorOf(() => analytics.getRework(request({ filters: { actorTeamIds: [TEAM_SOLO] } })))
    expect(refused).toEqual(tooNarrow)
    expect((refused as Error).message).not.toMatch(/\d/)
    expect((await analytics.getProcessMap(request({ filters: { actorRoleIds: [ROLE_BIG] } }))).n).toBe(6)
    expect((await analytics.listCases(request({ filters: { actorTeamIds: [TEAM_BIG] } }))).n).toBe(6)
    expect(entries).toEqual([])
    settings.set(ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: true })
    const perPerson = await analyticsWith({ accessLog: writer }).getBreakdown({ ...request({ viewer: individualsViewer, filters: { actorRoleIds: [ROLE_SOLO] } }), groupBy: 'user' })
    expect(perPerson.items).toEqual([expect.objectContaining({ group: actorOf(9), cases: 6 })])
    expect(entries).toHaveLength(1)
  })

  it('applies organization settings and shares cache entries for upper-case identifiers', async () => {
    settings.set(ORG_A, { kAnonymity: 6, debounceSeconds: 120, individualsEnabled: false })
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    const upperScope = { tenantId: TENANT.toUpperCase(), organizationIds: [ORG_A.toUpperCase()] }
    const upper = await analyticsWith().getProcessMap(request({ scope: upperScope }))
    expect(upper).toEqual(expect.objectContaining({ kAnonymity: 6, n: 6, organizationIds: [ORG_A] }))
    const cached = analyticsWith({ cache: createCacheService({ strategy: 'memory' }) })
    expect((await cached.getProcessMap(request())).n).toBe(6)
    await seedDeals(1, { startMs: NOW - 4 * DAY_MS, durationDays: 1 })
    expect((await cached.getProcessMap(request({ scope: upperScope }))).n).toBe(6)
    await cached.invalidate({ tenantId: TENANT.toUpperCase(), organizationId: ORG_A.toUpperCase() })
    expect((await cached.getProcessMap(request())).n).toBe(7)
  })

  it('lists the analytics population and drills into variants through the stored variant hash of cases completed in the window', async () => {
    const analytics = analyticsWith()
    const window = { from: new Date(NOW - 20 * DAY_MS).toISOString(), to: new Date(NOW - 5 * DAY_MS).toISOString() }
    const withPayment = (rows: AnalyticsEventRow[], atMs: number): AnalyticsEventRow[] => [
      ...rows,
      stepRow(rows[0].caseId, { key: 'payment.created', kind: 'milestone', field: null, value: null, atMs, actor: rows[0].actorPseudonym }, ORG_A),
    ]
    for (let index = 0; index < 6; index += 1) {
      await seedCase(withPayment(dealRows({ startMs: NOW - 15 * DAY_MS + index * HOUR_MS, durationDays: 2, actor: actorOf((index % 3) + 1) }), NOW - 2 * DAY_MS))
    }
    await seedCase(withPayment(dealRows({ startMs: NOW - 15 * DAY_MS, durationDays: 11 }), NOW - 2 * DAY_MS))
    const outside = randomUUID()
    await seedCase([
      ...creation(outside, NOW - 25 * DAY_MS, {}, ORG_A),
      stepRow(outside, { key: 'status:qualified', atMs: NOW - 3 * DAY_MS }, ORG_A),
    ])
    const map = await analytics.getProcessMap(request({ window }))
    expect(map.n).toBe(7)
    expect((await analytics.listCases(request({ window }))).n).toBe(map.n)
    const variants = await analytics.getVariants({ ...request({ window }), limit: 5 })
    expect(variants.items[0]).toEqual(expect.objectContaining({ cases: 6, rawVariantHashesTruncated: false }))
    const stored = await db.selectFrom('insights_process_cases').select('variant_hash').where('status', '=', 'completed').execute()
    expect(new Set(stored.map((row) => row.variant_hash)).size).toBe(1)
    expect(variants.items[0].rawVariantHashes).toEqual([stored[0].variant_hash])
    const drill = await analytics.listCases({ ...request({ window }), variantHashes: variants.items[0].rawVariantHashes })
    expect(drill.n).toBe(6)
  })

  it('reports an incomplete projection (no cursor, backfill, running scan, settings-only organization) without computedThrough', async () => {
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    const analytics = analyticsWith()
    expect(await analytics.getProcessMap(request())).toEqual(expect.objectContaining({ computedThrough: null, incomplete: true }))
    await insertCursor(ORG_A, NOW - HOUR_MS)
    const complete = await analytics.getProcessMap(request())
    expect(complete).toEqual(expect.objectContaining({ incomplete: false }))
    expect(Date.parse(complete.computedThrough ?? '')).toBe(NOW - HOUR_MS)
    await db.updateTable('insights_process_cursors').set({ status: 'backfilling' }).execute()
    expect(await analytics.getDurations(request())).toEqual(expect.objectContaining({ computedThrough: null, incomplete: true }))
    await db.updateTable('insights_process_cursors').set({ status: 'idle', scan_id: randomUUID() }).execute()
    expect(await analytics.listCases(request())).toEqual(expect.objectContaining({ computedThrough: null, incomplete: true }))
    await db.updateTable('insights_process_cursors').set({ scan_id: null }).execute()
    expect(await analytics.listCases(request())).toEqual(expect.objectContaining({ incomplete: false }))
    await sql`insert into insights_process_settings (tenant_id, organization_id, k_anonymity, created_at, updated_at) values (${TENANT}, ${ORG_C}, 7, now(), now())`.execute(db)
    settings.set(ORG_C, { kAnonymity: 7, debounceSeconds: 120, individualsEnabled: false })
    const tenantWide = await analytics.getProcessMap(request({ scope: { tenantId: TENANT, organizationIds: null } }))
    expect(tenantWide).toEqual(expect.objectContaining({ kAnonymity: 7, computedThrough: null, incomplete: true }))
  })

  it('excludes organizations whose settings disable X-Ray; a disabled settings-only organization never makes a tenant-wide view incomplete', async () => {
    const analytics = analyticsWith()
    await insertCursor(ORG_A, NOW - HOUR_MS)
    await insertCursor(ORG_B, NOW - HOUR_MS)
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2, organizationId: ORG_B })
    const tenantWide = request({ scope: { tenantId: TENANT, organizationIds: null } })
    expect(await analytics.getProcessMap(tenantWide)).toEqual(expect.objectContaining({ n: 12, incomplete: false }))
    await sql`insert into insights_process_settings (tenant_id, organization_id, enabled, created_at, updated_at) values (${TENANT}, ${ORG_B}, false, now(), now())`.execute(db)
    settings.set(ORG_B, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false, enabled: false })
    expect(await analytics.getProcessMap(tenantWide)).toEqual(expect.objectContaining({ n: 6, incomplete: false, organizationIds: null }))
    expect((await analytics.listCases(tenantWide)).n).toBe(6)
    expect(await analytics.getProcessMap(request({ scope: { tenantId: TENANT, organizationIds: [ORG_A, ORG_B] } })))
      .toEqual(expect.objectContaining({ n: 6, organizationIds: [ORG_A] }))
    expect(await analytics.getProcessMap(request({ scope: { tenantId: TENANT, organizationIds: [ORG_B] } })))
      .toEqual(expect.objectContaining({ n: 0, organizationIds: [], incomplete: false }))
    await sql`insert into insights_process_settings (tenant_id, organization_id, enabled, created_at, updated_at) values (${TENANT}, ${ORG_C}, false, now(), now())`.execute(db)
    settings.set(ORG_C, { kAnonymity: 9, debounceSeconds: 120, individualsEnabled: false, enabled: false })
    const withDisabledSettingsOnly = await analytics.getProcessMap(tenantWide)
    expect(withDisabledSettingsOnly).toEqual(expect.objectContaining({ n: 6, incomplete: false, kAnonymity: 5 }))
    expect(Date.parse(withDisabledSettingsOnly.computedThrough ?? '')).toBe(NOW - HOUR_MS)
    await sql`update insights_process_settings set deleted_at = now() where organization_id = ${ORG_B}`.execute(db)
    settings.delete(ORG_B)
    expect((await analytics.getProcessMap(tenantWide)).n).toBe(12)
  })

  it('summarizes a process: cases with activity in the window, open cases withheld below k, projection state', async () => {
    const analytics = analyticsWith()
    await seedDeals(6, { startMs: NOW - 10 * DAY_MS, durationDays: 2 })
    await seedDeals(2, { startMs: NOW - 5 * DAY_MS, durationDays: null })
    expect(await analytics.getSummary(request())).toEqual(expect.objectContaining({
      processKey: dealProcess.processKey,
      organizationIds: [ORG_A],
      n: 8,
      lowConfidence: true,
      openCases: null,
      kAnonymity: 5,
      computedThrough: null,
      incomplete: true,
      openCasesAsOf: new Date(NOW).toISOString(),
    }))
    await insertCursor(ORG_A, NOW - HOUR_MS)
    await seedDeals(3, { startMs: NOW - 4 * DAY_MS, durationDays: null })
    const summary = await analytics.getSummary(request())
    expect(summary).toEqual(expect.objectContaining({ n: 11, openCases: 5, incomplete: false }))
    expect(Date.parse(summary.computedThrough ?? '')).toBe(NOW - HOUR_MS)
    expect(await analytics.getSummary(request({ scope: { tenantId: TENANT, organizationIds: [] } }))).toEqual(expect.objectContaining({ n: 0, openCases: 0, organizationIds: [] }))
    expect((await analytics.getSummary(request({ scope: { tenantId: OTHER_TENANT, organizationIds: [ORG_A] } }))).n).toBe(0)
    await expect(analytics.getSummary(request({ filters: { causeKinds: ['user'] } }))).rejects.toBeInstanceOf(AnalyticsInvalidRequestError)
  })

  it('computes rollups in the organization time zone, records passes and prunes ended windows but never the markers', async () => {
    const analytics = analyticsWith()
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    settings.set(ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false, timeZone: 'Europe/Warsaw' })
    await insertCursor(ORG_A, NOW - HOUR_MS)
    await seedDeals(6, { startMs: NOW - 5 * DAY_MS, durationDays: 2 })
    expect(await analytics.computeRollups(scope)).toEqual({ processes: 1, written: 3, skipped: 0 })
    const zones = await db.selectFrom('insights_process_rollups').select(['window_key', 'metrics']).where('process_key', '=', dealProcess.processKey).execute()
    expect(zones.map((row) => rollupMetricsSchema.parse(row.metrics).timeZone)).toEqual(['Europe/Warsaw', 'Europe/Warsaw', 'Europe/Warsaw'])
    expect(await analytics.getProcessMap(request({ window: { windowKey: '7d' } }))).toEqual(expect.objectContaining({ source: 'rollup', window: expect.objectContaining({ timeZone: 'Europe/Warsaw' }) }))
    expect((await analytics.getProcessMap(request({ window: { windowKey: '7d' }, timeZone: 'UTC' }))).source).toBe('live')

    expect(await listRollupPasses(db, [scope])).toEqual(new Map())
    await markRollupPass(db, scope)
    const passes = await listRollupPasses(db, [scope, { tenantId: TENANT, organizationId: ORG_B }, { tenantId: OTHER_TENANT, organizationId: ORG_A }])
    expect(Array.from(passes.keys())).toEqual([`${TENANT}|${ORG_A}`])
    const passAt = passes.get(`${TENANT}|${ORG_A}`) ?? ''
    expect(isRollupPassDue(passAt, new Date(Date.parse(passAt) + 14 * 60_000).toISOString())).toBe(false)
    expect(isRollupPassDue(passAt, new Date(Date.parse(passAt) + 15 * 60_000).toISOString())).toBe(true)
    expect(isRollupPassDue(undefined, passAt)).toBe(true)

    const stored = await db.selectFrom('insights_process_rollups').select(['metrics']).where('window_key', '=', '7d').executeTakeFirstOrThrow()
    const yesterday = resolveDefaultWindow('7d', NOW - DAY_MS, 'Europe/Warsaw')
    await sql`update insights_process_rollups set window_end = now() + interval '1 day' where window_key in ('7d', '30d', '90d')`.execute(db)
    await sql`insert into insights_process_rollups (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
      values (${TENANT}, ${ORG_A}, ${dealProcess.processKey}, '7d', ${yesterday.from}::timestamptz, now() - interval '1 hour', now() - interval '1 day', ${JSON.stringify(stored.metrics)}::jsonb, now())`.execute(db)
    await sql`insert into insights_process_rollups (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
      values (${TENANT}, ${ORG_B}, ${dealProcess.processKey}, '7d', ${yesterday.from}::timestamptz, now() - interval '1 hour', now() - interval '1 day', '{}'::jsonb, now())`.execute(db)
    await markRollupsInvalidated(db, scope)
    await sql`update insights_process_rollups set window_end = now() - interval '1 day' where window_key in ('__invalidated__', '__rollup_pass__')`.execute(db)
    expect(await pruneStaleRollups(db, scope)).toBe(1)
    const left = await db.selectFrom('insights_process_rollups').select(['organization_id', 'window_key', 'window_start']).orderBy('organization_id').orderBy('window_key').execute()
    expect(left.filter((row) => row.organization_id === ORG_A).map((row) => row.window_key)).toEqual(['30d', '7d', '90d', '__invalidated__', '__rollup_pass__'])
    expect(left.filter((row) => row.organization_id === ORG_B)).toHaveLength(1)
    expect(await pruneStaleRollups(db, scope)).toBe(0)

    settings.set(ORG_A, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false, enabled: false })
    expect(await analytics.computeRollups(scope)).toEqual({ processes: 0, written: 0, skipped: 0 })
  })

  it('never moves the rollup invalidation marker backwards', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await markRollupsInvalidated(db, scope)
    await sql`update insights_process_rollups set computed_at = now() + interval '1 hour', window_end = now() + interval '1 hour' where window_key = '__invalidated__'`.execute(db)
    const marker = () => db.selectFrom('insights_process_rollups').select(['computed_at', 'window_end']).where('window_key', '=', '__invalidated__').executeTakeFirstOrThrow()
    const before = await marker()
    await markRollupsInvalidated(db, scope)
    const after = await marker()
    expect(new Date(after.computed_at).getTime()).toBe(new Date(before.computed_at).getTime())
    expect(new Date(after.window_end).getTime()).toBe(new Date(before.window_end).getTime())
  })
})
