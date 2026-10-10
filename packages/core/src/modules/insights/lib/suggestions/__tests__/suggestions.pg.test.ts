/**
 * Runs the automation suggestion SQL (upsert by signature, supersede rules, visibility-scoped
 * listing, lookup) and one mining pass end to end against a real PostgreSQL. Gated on
 * OM_INSIGHTS_XRAY_PG_URL (a throwaway database): the suite creates its own uniquely named
 * schema from the insights migration and drops it afterwards.
 *
 *   OM_INSIGHTS_XRAY_PG_URL=postgres://postgres:postgres@localhost:55432/om_xray6_analytics \
 *     npx jest --config jest.config.cjs src/modules/insights/lib/suggestions/__tests__/suggestions.pg.test.ts --runInBand
 */
import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { XraySettingsSnapshot } from '../../projection/settings'

const loadXraySettings = jest.fn(async (): Promise<XraySettingsSnapshot> => ({
  id: null,
  updatedAt: null,
  enabled: true,
  retentionDays: 365,
  kAnonymity: 5,
  debounceSeconds: 0,
  individualsEnabled: false,
  timeZone: 'UTC',
  suggestionMinSupport: 5,
  conformanceWorkflowId: null,
  activityStepMap: null,
}))

jest.mock('../../projection/payloads', () => {
  const actual = jest.requireActual('../../projection/payloads')
  return { ...actual, assertXrayScope: async () => undefined }
})
jest.mock('../../projection/settings', () => {
  const actual = jest.requireActual('../../projection/settings')
  return { ...actual, loadXraySettings: (...args: unknown[]) => loadXraySettings(...(args as [])) }
})
jest.mock('../../projection/killSwitch', () => ({ isXrayIngestEnabled: async () => true }))

import { Migration20261008180752_insights } from '../../../migrations/Migration20261008180752_insights'
import { normalizeCauseKind, type AnalyticsEventRow } from '../../analytics/trace'
import type { XrayDatabase } from '../../projection/types'
import { testProcessConfig, testRegistry } from '../../process/__tests__/processTestSupport'
import { runXraySuggestionJob } from '../job'
import type { MinedSuggestion } from '../mine'
import { clearSuggestionPass, listSuggestionPasses, markSuggestionPass } from '../passes'
import { lockXrayCursorState } from '../../projection/completeness'
import {
  findSuggestion,
  listSuggestions,
  supersedeMissingSuggestions,
  supersedeProcessSuggestions,
  upsertSuggestions,
  type SuggestionUpsert,
} from '../store'
import { dealRows } from './suggestionsTestSupport'

const PG_URL = process.env.OM_INSIGHTS_XRAY_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-0000-4000-8000-00000000b601'
const OTHER_TENANT = '11111111-0000-4000-8000-00000000b602'
const ORG_A = '22222222-0000-4000-8000-00000000b601'
const ORG_B = '22222222-0000-4000-8000-00000000b602'
const SCOPE_A = { tenantId: TENANT, organizationId: ORG_A }
const SCOPE_B = { tenantId: TENANT, organizationId: ORG_B }

async function migrationStatements(): Promise<string[]> {
  const migration = Object.create(Migration20261008180752_insights.prototype) as Migration20261008180752_insights
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration.up()
  return statements
}

function upsert(signature: string, overrides: Partial<SuggestionUpsert> = {}): SuggestionUpsert {
  const base: MinedSuggestion = {
    processKey: 'test.deal',
    signatureHash: signature,
    trigger: { activityKey: 'created', activityKind: 'lifecycle', field: null, value: null },
    condition: null,
    followups: [{ field: 'status', value: 'qa_review', activityKind: 'stage' }],
    windowSeconds: 600,
    support: 8,
    triggerCount: 8,
    supportCases: 8,
    confidence: 0.6756,
    confidenceRatio: 1,
    baseRate: 1 / 3,
    lift: 3,
    distinctActorCount: 3,
  }
  return { ...base, triggerEventId: 'test.deal.created', draftable: true, notDraftableReason: null, commandId: 'test.deals.update', ...overrides }
}

maybe('X-Ray automation suggestions against PostgreSQL', () => {
  jest.setTimeout(120_000)
  const schema = `xray_suggestions_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let db: Kysely<XrayDatabase>

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: PG_URL })
    await setupPool.query(`create schema "${schema}"`)
    await setupPool.end()
    const pool = new Pool({ connectionString: PG_URL, max: 4, options: `-c search_path=${schema}` })
    db = new Kysely<XrayDatabase>({ dialect: new PostgresDialect({ pool }) })
    for (const statement of await migrationStatements()) await sql.raw(statement).execute(db)
  })

  afterAll(async () => {
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate insights_automation_suggestions, insights_process_settings, insights_process_events, insights_process_cases, insights_process_cursors, insights_process_rollups`.execute(db)
  })

  async function rowOf(signature: string, scope = SCOPE_A) {
    return (await sql<{ status: string; updated_at: Date; computed_at: Date; support: number; drafted_artifact_id: string | null }>`
      select status, updated_at, computed_at, support, drafted_artifact_id from insights_automation_suggestions
      where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId} and signature_hash = ${signature}
    `.execute(db)).rows[0]
  }

  async function setStatus(signature: string, status: string) {
    await sql`update insights_automation_suggestions set status = ${status} where signature_hash = ${signature}`.execute(db)
  }

  it('creates open rows with millisecond versions and keeps the version on an identical pass', async () => {
    expect(await upsertSuggestions(db, SCOPE_A, [upsert('s1')])).toBe(1)
    const created = await rowOf('s1')
    expect(created.status).toBe('open')
    expect(created.updated_at.getUTCMilliseconds() * 1000).toBe(Number((await sql<{ us: string }>`select extract(microseconds from updated_at)::bigint % 1000000 as us from insights_automation_suggestions`.execute(db)).rows[0].us))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await upsertSuggestions(db, SCOPE_A, [upsert('s1')])
    const again = await rowOf('s1')
    expect(again.updated_at.getTime()).toBe(created.updated_at.getTime())
    expect(again.computed_at.getTime()).toBeGreaterThan(created.computed_at.getTime())
    await upsertSuggestions(db, SCOPE_A, [upsert('s1', { support: 9 })])
    const changed = await rowOf('s1')
    expect(changed.support).toBe(9)
    expect(changed.updated_at.getTime()).toBeGreaterThan(again.updated_at.getTime())
  })

  it('reopens a superseded rule found again, but never undoes a dismissal or a draft', async () => {
    await upsertSuggestions(db, SCOPE_A, [upsert('superseded'), upsert('dismissed'), upsert('drafted')])
    await setStatus('superseded', 'superseded')
    await setStatus('dismissed', 'dismissed')
    await setStatus('drafted', 'drafted')
    const before = await rowOf('superseded')
    await upsertSuggestions(db, SCOPE_A, [upsert('superseded'), upsert('dismissed', { support: 12 }), upsert('drafted')])
    expect((await rowOf('superseded')).status).toBe('open')
    expect((await rowOf('superseded')).updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    expect(await rowOf('dismissed')).toEqual(expect.objectContaining({ status: 'dismissed', support: 12 }))
    expect((await rowOf('drafted')).status).toBe('drafted')
  })

  it('supersedes only open rules of the evaluated processes that were not found, in that organization', async () => {
    await upsertSuggestions(db, SCOPE_A, [upsert('kept'), upsert('gone'), upsert('dismissed'), upsert('other-process', { processKey: 'test.order' })])
    await upsertSuggestions(db, SCOPE_B, [upsert('gone')])
    await setStatus('dismissed', 'dismissed')
    expect(await supersedeMissingSuggestions(db, SCOPE_A, ['test.deal'], ['kept'])).toBe(1)
    expect((await rowOf('kept')).status).toBe('open')
    expect((await rowOf('gone')).status).toBe('superseded')
    expect((await rowOf('dismissed')).status).toBe('dismissed')
    expect((await rowOf('other-process')).status).toBe('open')
    expect((await rowOf('gone', SCOPE_B)).status).toBe('open')
    expect(await supersedeMissingSuggestions(db, SCOPE_A, [], [])).toBe(0)
  })

  it('supersedes the open rules of cleared processes (rebuild / contract change)', async () => {
    await upsertSuggestions(db, SCOPE_A, [upsert('deal'), upsert('order', { processKey: 'test.order' }), upsert('drafted')])
    await setStatus('drafted', 'drafted')
    expect(await supersedeProcessSuggestions(db, SCOPE_A, ['test.order'])).toBe(1)
    expect((await rowOf('order')).status).toBe('superseded')
    expect((await rowOf('deal')).status).toBe('open')
    expect(await supersedeProcessSuggestions(db, SCOPE_A, null)).toBe(1)
    expect((await rowOf('deal')).status).toBe('superseded')
    expect((await rowOf('drafted')).status).toBe('drafted')
    expect(await supersedeProcessSuggestions(db, SCOPE_A, [])).toBe(0)
  })

  it('lists only visible processes and organizations, hides disabled organizations and other tenants, filters and pages', async () => {
    await upsertSuggestions(db, SCOPE_A, [upsert('a1', { confidence: 0.9 }), upsert('a2', { confidence: 0.7 }), upsert('a-order', { processKey: 'test.order' })])
    await upsertSuggestions(db, SCOPE_B, [upsert('b1')])
    await upsertSuggestions(db, { tenantId: OTHER_TENANT, organizationId: ORG_A }, [upsert('foreign')])
    await setStatus('a2', 'dismissed')
    const both = await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: null }], page: 1, pageSize: 50 })
    expect(both.items.map((item) => item.signatureHash)).toEqual(['a1', 'a2', 'b1'])
    expect(both.total).toBe(3)
    const onlyA = await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: [ORG_A] }], page: 1, pageSize: 50 })
    expect(onlyA.items.map((item) => item.signatureHash)).toEqual(['a1', 'a2'])
    const mixed = await listSuggestions(db, {
      tenantId: TENANT,
      visibility: [{ processKey: 'test.deal', organizationIds: [ORG_B] }, { processKey: 'test.order', organizationIds: [ORG_A] }],
      page: 1,
      pageSize: 50,
    })
    expect(mixed.items.map((item) => item.signatureHash).sort()).toEqual(['a-order', 'b1'])
    const dismissed = await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: null }], status: 'dismissed', page: 1, pageSize: 50 })
    expect(dismissed.items.map((item) => item.signatureHash)).toEqual(['a2'])
    const paged = await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: null }], page: 2, pageSize: 2 })
    expect(paged).toEqual(expect.objectContaining({ total: 3 }))
    expect(paged.items.map((item) => item.signatureHash)).toEqual(['b1'])
    expect((await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: [] }], page: 1, pageSize: 50 })).total).toBe(0)
    await db.insertInto('insights_process_settings').values({
      tenant_id: TENANT, organization_id: ORG_B, enabled: false, retention_days: 365, k_anonymity: 10, debounce_seconds: 120,
      individuals_enabled: false, suggestion_min_support: null, conformance_workflow_id: null, activity_step_map: null,
      created_at: new Date(), updated_at: new Date(), deleted_at: null,
    }).execute()
    const withoutDisabled = await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: null }], page: 1, pageSize: 50 })
    expect(withoutDisabled.items.map((item) => item.signatureHash)).toEqual(['a1', 'a2'])
    const b1 = both.items.find((item) => item.signatureHash === 'b1')
    expect(b1 && await findSuggestion(db, TENANT, b1.id)).toBeNull()
  })

  it('finds a suggestion only in its own tenant, with ISO millisecond versions', async () => {
    await upsertSuggestions(db, SCOPE_A, [upsert('s1')])
    const [stored] = (await listSuggestions(db, { tenantId: TENANT, visibility: [{ processKey: 'test.deal', organizationIds: null }], page: 1, pageSize: 10 })).items
    expect(await findSuggestion(db, TENANT, stored.id)).toEqual(expect.objectContaining({ id: stored.id, status: 'open', draftable: true }))
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(await findSuggestion(db, OTHER_TENANT, stored.id)).toBeNull()
  })

  it('forgets a mining pass of one organization and reads the cursor state under a share lock', async () => {
    await markSuggestionPass(db, SCOPE_A)
    await markSuggestionPass(db, SCOPE_B)
    await clearSuggestionPass(db, SCOPE_A)
    const passes = await listSuggestionPasses(db, [SCOPE_A, SCOPE_B])
    expect(passes.has(`${TENANT}|${ORG_A}`)).toBe(false)
    expect(passes.has(`${TENANT}|${ORG_B}`)).toBe(true)
    expect(await db.transaction().execute((trx) => lockXrayCursorState(trx, SCOPE_A))).toBeNull()
    await sql`insert into insights_process_cursors (tenant_id, organization_id, last_created_at, status, pending_rebuild_keys, contract_hashes, created_at, updated_at)
      values (${TENANT}, ${ORG_A}, now(), 'idle', '["test.deal"]'::jsonb, '{"test.deal":"h1"}'::jsonb, now(), now())`.execute(db)
    const state = await db.transaction().execute((trx) => lockXrayCursorState(trx, SCOPE_A))
    expect(state).toEqual({ status: 'idle', scanId: null, pendingRebuildKeys: ['test.deal'], lastCreatedAt: expect.stringMatching(/Z$/), contractHashes: { 'test.deal': 'h1' } })
  })

  describe('one mining pass end to end', () => {
    function registry() {
      const config = testProcessConfig()
      return testRegistry({ ...config, processes: (config.processes ?? []).map((process) => ({ ...process, automation: { updateCommandId: 'test.deals.update' } })) })
    }

    async function seed(nowMs: number, count: number) {
      const rows: AnalyticsEventRow[] = []
      for (let index = 1; index <= count; index += 1) {
        rows.push(...dealRows(index, { startMs: nowMs - 5 * 86_400_000 + index * 3_600_000, followup: { key: 'status:qa_review', delayMs: 300_000 } }))
      }
      await db.insertInto('insights_process_events').values(rows.map((row) => ({
        tenant_id: TENANT,
        organization_id: ORG_A,
        process_key: 'test.deal',
        case_kind: 'test.deal',
        case_id: row.caseId,
        activity_key: row.activityKey,
        activity_kind: row.activityKind,
        occurred_at: row.occurredAt,
        source_log_id: randomUUID(),
        seq: row.seq,
        actor_pseudonym: row.actorPseudonym,
        actor_role_ids: null,
        actor_team_id: null,
        cause_kind: normalizeCauseKind(row.causeKind),
        cause_id: null,
        via_sync_run: false,
        followup_field: row.followupField,
        followup_value: row.followupValue,
        voided: false,
        voided_by_log_id: null,
        created_at: new Date(nowMs).toISOString(),
      }))).execute()
      return rows
    }

    async function cursor(status = 'idle') {
      await sql`insert into insights_process_cursors (tenant_id, organization_id, last_created_at, status, created_at, updated_at)
        values (${TENANT}, ${ORG_A}, now() - interval '1 minute', ${status}, now(), now())`.execute(db)
    }

    function container() {
      return { resolve: (name: string) => (name === 'em' ? { fork: () => ({ getKysely: () => db }) } : undefined) }
    }

    const catalog = { payloadPaths: (eventId: string) => (eventId === 'test.deal.created' ? new Set(['id', 'tenantId', 'organizationId']) : null) }

    async function ageMiningPass() {
      await sql`update insights_process_rollups set computed_at = computed_at - interval '1 minute' where window_key = '__suggestion_pass__'`.execute(db)
    }

    it('mines, stores (no actor data at all), records the pass and is idempotent; a vanished rule is superseded', async () => {
      const nowMs = Date.parse((await sql<{ now: string }>`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`.execute(db)).rows[0].now)
      const rows = await seed(nowMs, 8)
      await cursor()
      const first = await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog })
      expect(first).toEqual(expect.objectContaining({ status: 'done', processes: 1, found: 1, written: 1, superseded: 0 }))
      const stored = (await sql<Record<string, unknown>>`select * from insights_automation_suggestions`.execute(db)).rows
      expect(stored).toHaveLength(1)
      expect(stored[0]).toEqual(expect.objectContaining({ status: 'open', support: 8, trigger_count: 8, window_seconds: 600, distinct_actor_count: 3, draftable: false, not_draftable_reason: 'workflows_unavailable' }))
      const serialized = JSON.stringify(stored)
      for (const pseudonym of new Set(rows.map((row) => row.actorPseudonym).filter((value): value is string => Boolean(value)))) {
        expect(serialized).not.toContain(pseudonym)
      }
      const columns = (await sql<{ column_name: string }>`
        select column_name from information_schema.columns where table_schema = ${schema} and table_name = 'insights_automation_suggestions'
      `.execute(db)).rows.map((row) => row.column_name)
      expect(columns.filter((column) => /actor|user|pseudonym/.test(column))).toEqual(['distinct_actor_count'])
      expect((await listSuggestionPasses(db, [SCOPE_A])).has(`${TENANT}|${ORG_A}`)).toBe(true)

      expect(await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog })).toEqual({ status: 'not_due' })
      const version = (await rowOf(String(stored[0].signature_hash))).updated_at
      expect(await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog, force: true })).toEqual({ status: 'not_due' })
      await ageMiningPass()
      expect(await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog, force: true })).toEqual(expect.objectContaining({ written: 1, superseded: 0 }))
      expect((await rowOf(String(stored[0].signature_hash))).updated_at.getTime()).toBe(version.getTime())

      await sql`update insights_process_events set voided = true where activity_key = 'status:qa_review'`.execute(db)
      await ageMiningPass()
      expect(await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog, force: true })).toEqual(expect.objectContaining({ found: 0, superseded: 1 }))
      expect((await rowOf(String(stored[0].signature_hash))).status).toBe('superseded')
    })

    it('mines nothing while the projection is incomplete', async () => {
      const nowMs = Date.now()
      await seed(nowMs, 8)
      await cursor('backfilling')
      expect(await runXraySuggestionJob(container(), SCOPE_A, { registry: registry(), catalog })).toEqual({ status: 'incomplete' })
      expect((await sql<{ total: string }>`select count(*)::text as total from insights_automation_suggestions`.execute(db)).rows[0].total).toBe('0')
    })
  })
})
