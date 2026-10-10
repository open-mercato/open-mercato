/**
 * Runs the observed-tier SQL (keyset paging, byte budget, scope isolation, coverage lookups and
 * the partial simulation index) against a real PostgreSQL. Gated on OM_BUSINESS_RULES_SIM_PG_URL
 * (a throwaway database): the suite creates its own uniquely named schema with a minimal
 * rule_execution_logs table plus the index migration, and drops it afterwards.
 *
 *   OM_BUSINESS_RULES_SIM_PG_URL=postgres://postgres:postgres@localhost:55432/om_simulator \
 *     npx jest --config jest.config.cjs --runInBand src/modules/business_rules/lib/simulation
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'
import { Kysely, PostgresDialect, sql, type CompiledQuery, type Generated } from 'kysely'
import { Pool } from 'pg'
import { Migration20261010120000_business_rules } from '../../../migrations/Migration20261010120000_business_rules'
import { metadata as crudRuleTriggerMetadata } from '../../../subscribers/crud-rule-trigger'
import {
  CRUD_RULE_TRIGGER_SUBSCRIBER_ID,
  OBSERVED_RULE_LOG_MAX_LIMIT,
  findObservedCoverage,
  isCrudTriggerRow,
  isValidObservedRuleLogCursor,
  readObservedRuleLogs,
  type ObservedRuleLogDatabase,
  type ObservedRuleLogQuery,
  type ObservedRuleLogRow,
} from '../observed'

const PG_URL = process.env.OM_BUSINESS_RULES_SIM_PG_URL
const describeWithPostgres = PG_URL ? describe : describe.skip

const SIMULATION_INDEX = 'rule_execution_logs_simulation_idx'
const TENANT = '11111111-0000-4000-8000-0000000000c1'
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000c2'
const ORG_A = '22222222-0000-4000-8000-0000000000c1'
const ORG_B = '22222222-0000-4000-8000-0000000000c2'
const ENTITY_TYPE = 'customers.deal'
const WINDOW_FROM = new Date('2026-10-01T00:00:00.000Z')
const WINDOW_TO = new Date('2026-10-08T00:00:00.000Z')
const NO_BYTE_LIMIT = 1_000_000_000

async function migrationStatements(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261010120000_business_rules.prototype) as Migration20261010120000_business_rules
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration[direction]()
  return statements
}

function unusedDatabase(): Kysely<ObservedRuleLogDatabase> {
  return new Proxy({}, {
    get: () => {
      throw new Error('[internal] the database must not be queried')
    },
  }) as Kysely<ObservedRuleLogDatabase>
}

const baseQuery: ObservedRuleLogQuery = {
  tenantId: TENANT,
  organizationId: ORG_A,
  entityType: ENTITY_TYPE,
  from: WINDOW_FROM,
  to: WINDOW_TO,
  after: null,
  limit: 10,
  maxBytes: NO_BYTE_LIMIT,
}

describe('observed tier contracts', () => {
  test('names the CRUD rule trigger subscriber exactly', () => {
    expect(CRUD_RULE_TRIGGER_SUBSCRIBER_ID).toBe(crudRuleTriggerMetadata.id)
  })

  test('recognises CRUD trigger rows by their innermost causation frame only', () => {
    expect(isCrudTriggerRow({ innermostFrameKind: 'subscriber', innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID })).toBe(true)
    expect(isCrudTriggerRow({ innermostFrameKind: 'subscriber', innermostFrameId: 'workflows:event-trigger' })).toBe(false)
    expect(isCrudTriggerRow({ innermostFrameKind: 'workflow', innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID })).toBe(false)
    expect(isCrudTriggerRow({ innermostFrameKind: null, innermostFrameId: null })).toBe(false)
  })

  test('validates cursors', () => {
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-10-02T10:00:00.123456Z', id: '42' })).toBe(true)
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-10-02T10:00:00Z', id: '9223372036854775807' })).toBe(true)
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-02-31T10:00:00.000000Z', id: '42' })).toBe(false)
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-10-02 10:00:00', id: '42' })).toBe(false)
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-10-02T10:00:00Z', id: '9223372036854775808' })).toBe(false)
    expect(isValidObservedRuleLogCursor({ executedAt: '2026-10-02T10:00:00Z', id: '1; drop table x' })).toBe(false)
    expect(isValidObservedRuleLogCursor(null)).toBe(false)
  })

  test('rejects invalid input before querying and skips empty windows and id lists', async () => {
    const db = unusedDatabase()
    await expect(readObservedRuleLogs(db, { ...baseQuery, after: { executedAt: 'yesterday', id: '1' } })).rejects.toThrow(TypeError)
    await expect(readObservedRuleLogs(db, { ...baseQuery, tenantId: 'not-a-uuid' })).rejects.toThrow(TypeError)
    await expect(readObservedRuleLogs(db, { ...baseQuery, from: new Date('invalid') })).rejects.toThrow(TypeError)
    await expect(readObservedRuleLogs(db, { ...baseQuery, from: WINDOW_TO, to: WINDOW_FROM })).resolves.toEqual({
      rows: [],
      lastCursor: null,
      exhausted: true,
      payloadBytes: 0,
    })
    const coverageScope = { tenantId: TENANT, organizationId: ORG_A, entityType: ENTITY_TYPE, from: WINDOW_FROM, to: WINDOW_TO }
    await expect(findObservedCoverage(db, { ...coverageScope, entityIds: [] })).resolves.toEqual([])
    await expect(findObservedCoverage(db, { ...coverageScope, entityIds: [''] })).resolves.toEqual([])
  })

  test('builds the partial simulation index concurrently, outside a transaction', async () => {
    const migration = Object.create(Migration20261010120000_business_rules.prototype) as Migration20261010120000_business_rules
    expect(migration.isTransactional()).toBe(false)
    expect(await migrationStatements('up')).toEqual([
      `drop index concurrently if exists "${SIMULATION_INDEX}";`,
      `create index concurrently "${SIMULATION_INDEX}" on "rule_execution_logs" ("tenant_id", "organization_id", "entity_type", "executed_at") where "run_id" is not null;`,
    ])
    expect(await migrationStatements('down')).toEqual([`drop index concurrently if exists "${SIMULATION_INDEX}";`])
  })

  test('records the same index in the migrations snapshot', async () => {
    const snapshotPath = join(__dirname, '..', '..', '..', 'migrations', '.snapshot-open-mercato.json')
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; expression?: string }> }>
    }
    const table = snapshot.tables.find((entry) => entry.name === 'rule_execution_logs')
    const index = table?.indexes.find((entry) => entry.keyName === SIMULATION_INDEX)
    const [, create] = await migrationStatements('up')
    expect(index?.expression).toBe(create.replace(' concurrently', '').replace(/;$/, ''))
  })

  test('caps the page size', () => {
    expect(OBSERVED_RULE_LOG_MAX_LIMIT).toBe(1000)
  })
})

type FixtureTable = {
  id: Generated<string>
  rule_id: string
  entity_id: string
  entity_type: string
  execution_result: string
  input_context: string | null
  executed_at: string
  tenant_id: string
  organization_id: string | null
  run_id: string | null
  causation_json: string | null
  execution_time_ms: number
}

type FixtureDatabase = { rule_execution_logs: FixtureTable }

type FixtureFrame = { kind: string; id?: string }

type Fixture = {
  key: string
  entityId: string
  executedAt: string
  tenantId?: string
  organizationId?: string
  entityType?: string
  runId?: string | null
  data?: unknown
  omitData?: boolean
  eventType?: string
  frames?: FixtureFrame[] | null
  correlationId?: string
  causedByLogId?: string
}

const CRUD_FRAMES: FixtureFrame[] = [
  { kind: 'user', id: 'user-1' },
  { kind: 'subscriber', id: CRUD_RULE_TRIGGER_SUBSCRIBER_ID },
]
const LARGE_NOTES = randomBytes(4000).toString('hex')
const CAUSED_BY_LOG_ID = '33333333-0000-4000-8000-0000000000c1'

const FIXTURES: Fixture[] = [
  { key: 'a1', entityId: 'deal-1', executedAt: '2026-10-01T00:00:00.000000Z', eventType: 'created', data: { id: 'deal-1', status: 'open' }, correlationId: 'corr-1' },
  { key: 'a2', entityId: 'deal-1', executedAt: '2026-10-02T10:00:00.123456Z', eventType: 'updated', data: { id: 'deal-1', status: 'won' }, correlationId: 'corr-2' },
  { key: 'a3', entityId: 'deal-1', executedAt: '2026-10-02T10:00:00.123456Z', eventType: 'updated', data: { status: 'won', id: 'deal-1' }, correlationId: 'corr-2' },
  { key: 'a4', entityId: 'deal-1', executedAt: '2026-10-02T10:00:00.123456Z', eventType: 'updated', data: { id: 'deal-1', status: 'won' }, correlationId: 'corr-2' },
  { key: 'a5', entityId: 'deal-2', executedAt: '2026-10-03T10:00:00.000001Z', eventType: 'updated', data: { id: 'deal-2' }, frames: [{ kind: 'user', id: 'user-1' }], correlationId: 'corr-3' },
  { key: 'a6', entityId: 'deal-2', executedAt: '2026-10-03T10:00:00.000002Z', data: { id: 'deal-2' }, frames: [{ kind: 'user' }, { kind: 'workflow', id: 'wf-1' }], correlationId: 'corr-4' },
  { key: 'a7', entityId: 'deal-3', executedAt: '2026-10-04T08:00:00.000000Z', eventType: 'updated', data: { id: 'deal-3', notes: LARGE_NOTES }, correlationId: 'corr-5', causedByLogId: CAUSED_BY_LOG_ID },
  { key: 'a8', entityId: 'deal-1', executedAt: '2026-10-05T00:00:00.000000Z', eventType: 'deleted', omitData: true, correlationId: 'corr-6' },
  { key: 'a9', entityId: 'deal-4', executedAt: '2026-10-06T00:00:00.000000Z', eventType: 'created', data: { id: 'deal-4' }, frames: null },
  { key: 'x_no_run', entityId: 'deal-1', executedAt: '2026-10-02T11:00:00.000000Z', runId: null, data: { id: 'deal-1' } },
  { key: 'x_before', entityId: 'deal-1', executedAt: '2026-09-30T23:59:59.999999Z', data: { id: 'deal-1' } },
  { key: 'x_at_to', entityId: 'deal-1', executedAt: '2026-10-08T00:00:00.000000Z', data: { id: 'deal-1' } },
  { key: 'x_org_b', entityId: 'deal-1', executedAt: '2026-10-02T12:00:00.000000Z', organizationId: ORG_B, data: { id: 'deal-1' } },
  { key: 'x_tenant', entityId: 'deal-1', executedAt: '2026-10-02T12:00:00.000000Z', tenantId: OTHER_TENANT, data: { id: 'deal-1' } },
  { key: 'x_entity', entityId: 'deal-1', executedAt: '2026-10-02T12:00:00.000000Z', entityType: 'sales.order', data: { id: 'deal-1' } },
]
const ORG_A_ORDER = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']

function inputContextOf(fixture: Fixture): string {
  const context: Record<string, unknown> = { eventType: fixture.eventType, user: { id: 'user-1' } }
  if (!fixture.omitData) context.data = fixture.data
  return JSON.stringify(context)
}

function causationOf(fixture: Fixture): string | null {
  const frames = fixture.frames === undefined ? CRUD_FRAMES : fixture.frames
  if (frames === null) return null
  const envelope: Record<string, unknown> = { correlationId: fixture.correlationId ?? randomUUID(), frames }
  if (fixture.causedByLogId) envelope.causedByLogId = fixture.causedByLogId
  return JSON.stringify(envelope)
}

describeWithPostgres('observed rule logs against PostgreSQL', () => {
  jest.setTimeout(120_000)
  const schema = `br_simulation_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const captured: CompiledQuery[] = []
  const idsByKey = new Map<string, string>()
  const keysById = new Map<string, string>()
  let pool: Pool
  let db: Kysely<ObservedRuleLogDatabase>

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: PG_URL })
    await setupPool.query(`create schema "${schema}"`)
    await setupPool.end()
    pool = new Pool({ connectionString: PG_URL, max: 4, options: `-c search_path=${schema}` })
    db = new Kysely<ObservedRuleLogDatabase>({
      dialect: new PostgresDialect({ pool }),
      log: (event) => {
        if (event.level === 'query') captured.push(event.query)
      },
    })
    await sql`create table rule_execution_logs (
      id bigserial primary key,
      rule_id uuid not null,
      entity_id varchar(255) not null,
      entity_type varchar(50) not null,
      execution_result varchar(20) not null,
      input_context jsonb null,
      output_context jsonb null,
      error_message text null,
      execution_time_ms int not null,
      executed_at timestamptz not null,
      tenant_id uuid not null,
      organization_id uuid null,
      executed_by varchar(50) null,
      run_id uuid null,
      rule_version int null,
      rule_definition_hash text null,
      causation_json jsonb null
    )`.execute(db)
    for (const statement of await migrationStatements('up')) await sql.raw(statement).execute(db)
    const fixtures = db as unknown as Kysely<FixtureDatabase>
    for (const fixture of FIXTURES) {
      const inserted = await fixtures
        .insertInto('rule_execution_logs')
        .values({
          rule_id: randomUUID(),
          entity_id: fixture.entityId,
          entity_type: fixture.entityType ?? ENTITY_TYPE,
          execution_result: 'SUCCESS',
          input_context: inputContextOf(fixture),
          executed_at: fixture.executedAt,
          tenant_id: fixture.tenantId ?? TENANT,
          organization_id: fixture.organizationId ?? ORG_A,
          run_id: fixture.runId === undefined ? randomUUID() : fixture.runId,
          causation_json: causationOf(fixture),
          execution_time_ms: 1,
        })
        .returning(sql<string>`id::text`.as('id'))
        .executeTakeFirstOrThrow()
      idsByKey.set(fixture.key, inserted.id)
      keysById.set(inserted.id, fixture.key)
    }
    await sql`analyze rule_execution_logs`.execute(db)
  })

  afterAll(async () => {
    if (!db) return
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db)
    await db.destroy()
  })

  function keysOf(rows: readonly ObservedRuleLogRow[]): string[] {
    return rows.map((row) => keysById.get(row.id) ?? row.id)
  }

  async function payloadSizes(): Promise<Map<string, number>> {
    const result = await sql<{ id: string; size: number }>`
      select id::text as id, pg_column_size(input_context) as size from rule_execution_logs
    `.execute(db)
    return new Map(result.rows.map((row) => [keysById.get(row.id) ?? row.id, Number(row.size)]))
  }

  async function readAll(query: ObservedRuleLogQuery): Promise<{ pages: string[][]; exhausted: boolean[] }> {
    const pages: string[][] = []
    const exhausted: boolean[] = []
    let after = query.after
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await readObservedRuleLogs(db, { ...query, after })
      pages.push(keysOf(page.rows))
      exhausted.push(page.exhausted)
      if (page.exhausted || !page.lastCursor) break
      after = page.lastCursor
    }
    return { pages, exhausted }
  }

  test('creates a valid partial index', async () => {
    const result = await sql<{ valid: boolean; definition: string }>`
      select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as definition
      from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
      where c.relname = ${SIMULATION_INDEX} and n.nspname = ${schema}
    `.execute(db)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].valid).toBe(true)
    expect(result.rows[0].definition).toContain('(tenant_id, organization_id, entity_type, executed_at)')
    expect(result.rows[0].definition).toContain('WHERE (run_id IS NOT NULL)')
  })

  test('pages the window in (executed_at, id) order and reports exhaustion on the last page', async () => {
    const byTwo = await readAll({ ...baseQuery, limit: 2 })
    expect(byTwo.pages).toEqual([['a1', 'a2'], ['a3', 'a4'], ['a5', 'a6'], ['a7', 'a8'], ['a9']])
    expect(byTwo.exhausted).toEqual([false, false, false, false, true])
    const byThree = await readAll({ ...baseQuery, limit: 3 })
    expect(byThree.pages).toEqual([['a1', 'a2', 'a3'], ['a4', 'a5', 'a6'], ['a7', 'a8', 'a9']])
    expect(byThree.exhausted).toEqual([false, false, true])
    const single = await readObservedRuleLogs(db, baseQuery)
    expect(keysOf(single.rows)).toEqual(ORG_A_ORDER)
    expect(single.exhausted).toBe(true)
  })

  test('splits equal timestamps by id and keeps microsecond neighbours apart', async () => {
    const one = await readAll({ ...baseQuery, limit: 1 })
    expect(one.pages.flat()).toEqual(ORG_A_ORDER)
    const afterA4 = await readObservedRuleLogs(db, {
      ...baseQuery,
      limit: 1,
      after: { executedAt: '2026-10-02T10:00:00.123456Z', id: idsByKey.get('a4') ?? '' },
    })
    expect(keysOf(afterA4.rows)).toEqual(['a5'])
    expect(afterA4.lastCursor).toEqual({ executedAt: '2026-10-03T10:00:00.000001Z', id: idsByKey.get('a5') })
    const afterA5 = await readObservedRuleLogs(db, { ...baseQuery, limit: 1, after: afterA4.lastCursor })
    expect(keysOf(afterA5.rows)).toEqual(['a6'])
    expect(afterA5.lastCursor?.executedAt).toBe('2026-10-03T10:00:00.000002Z')
    const midTie = await readObservedRuleLogs(db, {
      ...baseQuery,
      limit: 2,
      after: { executedAt: '2026-10-02T10:00:00.123456Z', id: idsByKey.get('a2') ?? '' },
    })
    expect(keysOf(midTie.rows)).toEqual(['a3', 'a4'])
  })

  test('maps row details, causation frames and payload hashes', async () => {
    const page = await readObservedRuleLogs(db, baseQuery)
    const byKey = new Map(page.rows.map((row) => [keysById.get(row.id) ?? row.id, row]))
    expect(byKey.get('a2')).toMatchObject({
      id: idsByKey.get('a2'),
      entityId: 'deal-1',
      entityType: ENTITY_TYPE,
      eventType: 'updated',
      executedAt: '2026-10-02T10:00:00.123456Z',
      data: { id: 'deal-1', status: 'won' },
      innermostFrameKind: 'subscriber',
      innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID,
      correlationId: 'corr-2',
      causedByLogId: null,
    })
    expect(byKey.get('a2')?.dataHash).toMatch(/^[0-9a-f]{64}$/)
    expect(byKey.get('a3')?.dataHash).toBe(byKey.get('a2')?.dataHash)
    expect(byKey.get('a4')?.dataHash).toBe(byKey.get('a2')?.dataHash)
    expect(byKey.get('a1')?.dataHash).not.toBe(byKey.get('a2')?.dataHash)
    expect(byKey.get('a8')).toMatchObject({ data: null, eventType: 'deleted' })
    expect(byKey.get('a8')?.dataHash).toBe(createHash('sha256').update('null').digest('hex'))
    expect(byKey.get('a6')).toMatchObject({ eventType: null, innermostFrameKind: 'workflow', innermostFrameId: 'wf-1' })
    expect(byKey.get('a7')).toMatchObject({ causedByLogId: CAUSED_BY_LOG_ID, correlationId: 'corr-5' })
    expect(byKey.get('a9')).toMatchObject({ innermostFrameKind: null, innermostFrameId: null, correlationId: null })
    expect(page.rows.filter(isCrudTriggerRow).map((row) => keysById.get(row.id))).toEqual(['a1', 'a2', 'a3', 'a4', 'a7', 'a8'])
    const sizes = await payloadSizes()
    for (const row of page.rows) expect(row.payloadBytes).toBe(sizes.get(keysById.get(row.id) ?? ''))
    expect(page.payloadBytes).toBe(ORG_A_ORDER.reduce((sum, key) => sum + (sizes.get(key) ?? 0), 0))
  })

  test('keeps the longest prefix within the byte budget and never fewer than one row', async () => {
    const sizes = await payloadSizes()
    const sizeOf = (key: string): number => sizes.get(key) ?? 0
    expect(sizeOf('a7')).toBeGreaterThan(4000)

    const tiny = await readObservedRuleLogs(db, { ...baseQuery, maxBytes: 1 })
    expect(keysOf(tiny.rows)).toEqual(['a1'])
    expect(tiny.exhausted).toBe(false)
    expect(tiny.payloadBytes).toBe(sizeOf('a1'))
    expect(tiny.lastCursor).toEqual({ executedAt: '2026-10-01T00:00:00.000000Z', id: idsByKey.get('a1') })

    const exact = await readObservedRuleLogs(db, { ...baseQuery, maxBytes: sizeOf('a1') + sizeOf('a2') })
    expect(keysOf(exact.rows)).toEqual(['a1', 'a2'])
    const short = await readObservedRuleLogs(db, { ...baseQuery, maxBytes: sizeOf('a1') + sizeOf('a2') - 1 })
    expect(keysOf(short.rows)).toEqual(['a1'])

    const oversized = await readObservedRuleLogs(db, {
      ...baseQuery,
      maxBytes: 10,
      after: { executedAt: '2026-10-03T10:00:00.000002Z', id: idsByKey.get('a6') ?? '' },
    })
    expect(keysOf(oversized.rows)).toEqual(['a7'])
    expect(oversized.payloadBytes).toBe(sizeOf('a7'))
    expect(oversized.exhausted).toBe(false)

    const lastByBudget = await readObservedRuleLogs(db, {
      ...baseQuery,
      maxBytes: sizeOf('a8') + sizeOf('a9'),
      after: { executedAt: '2026-10-04T08:00:00.000000Z', id: idsByKey.get('a7') ?? '' },
    })
    expect(keysOf(lastByBudget.rows)).toEqual(['a8', 'a9'])
    expect(lastByBudget.exhausted).toBe(true)

    const budgetCut = await readAll({ ...baseQuery, maxBytes: 1 })
    expect(budgetCut.pages).toEqual(ORG_A_ORDER.map((key) => [key]))
  })

  test('isolates tenant, organization and entity type and honours the half-open window', async () => {
    const orgB = await readObservedRuleLogs(db, { ...baseQuery, organizationId: ORG_B })
    expect(keysOf(orgB.rows)).toEqual(['x_org_b'])
    const otherTenant = await readObservedRuleLogs(db, { ...baseQuery, tenantId: OTHER_TENANT })
    expect(keysOf(otherTenant.rows)).toEqual(['x_tenant'])
    const otherEntity = await readObservedRuleLogs(db, { ...baseQuery, entityType: 'sales.order' })
    expect(keysOf(otherEntity.rows)).toEqual(['x_entity'])
    const wide = await readObservedRuleLogs(db, {
      ...baseQuery,
      limit: 50,
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-10-09T00:00:00.000Z'),
    })
    expect(keysOf(wide.rows)).toEqual(['x_before', ...ORG_A_ORDER, 'x_at_to'])
    expect(wide.exhausted).toBe(true)
    const narrow = await readObservedRuleLogs(db, {
      ...baseQuery,
      from: new Date('2026-10-02T10:00:00.123Z'),
      to: new Date('2026-10-03T10:00:00.000Z'),
    })
    expect(keysOf(narrow.rows)).toEqual(['a2', 'a3', 'a4'])
  })

  test('finds coverage rows for the given entities from every writer', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A, entityType: ENTITY_TYPE, from: WINDOW_FROM, to: WINDOW_TO }
    const covered = await findObservedCoverage(db, { ...scope, entityIds: ['deal-2', 'deal-3', 'deal-unknown', 'deal-2'] })
    expect(covered).toEqual([
      { eventType: 'updated', entityId: 'deal-2', correlationId: 'corr-3', causedByLogId: null, innermostFrameKind: 'user', innermostFrameId: 'user-1' },
      { eventType: null, entityId: 'deal-2', correlationId: 'corr-4', causedByLogId: null, innermostFrameKind: 'workflow', innermostFrameId: 'wf-1' },
      { eventType: 'updated', entityId: 'deal-3', correlationId: 'corr-5', causedByLogId: CAUSED_BY_LOG_ID, innermostFrameKind: 'subscriber', innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID },
    ])
    expect(covered.filter(isCrudTriggerRow).map((row) => row.entityId)).toEqual(['deal-3'])
    const dealOne = await findObservedCoverage(db, { ...scope, entityIds: ['deal-1'] })
    expect(dealOne.map((row) => row.eventType)).toEqual(['created', 'updated', 'updated', 'updated', 'deleted'])
    const orgB = await findObservedCoverage(db, { ...scope, organizationId: ORG_B, entityIds: ['deal-1', 'deal-2'] })
    expect(orgB).toHaveLength(1)
  })

  test('serves the probe and coverage queries from the partial simulation index', async () => {
    captured.length = 0
    await readObservedRuleLogs(db, {
      ...baseQuery,
      limit: 2,
      after: { executedAt: '2026-10-02T10:00:00.123456Z', id: idsByKey.get('a2') ?? '' },
    })
    const probe = captured[0]
    captured.length = 0
    await findObservedCoverage(db, { ...baseQuery, entityIds: ['deal-1', 'deal-2'] })
    const coverage = captured[0]
    expect(probe.sql).toContain('pg_column_size')
    expect(coverage.sql).toContain('entity_id = any(')
    const client = await pool.connect()
    try {
      await client.query('set enable_seqscan = off')
      for (const query of [probe, coverage]) {
        const plan = await client.query<{ 'QUERY PLAN': string }>(`explain ${query.sql}`, [...query.parameters])
        expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(SIMULATION_INDEX)
      }
    } finally {
      await client.query('reset enable_seqscan')
      client.release()
    }
  })
})
