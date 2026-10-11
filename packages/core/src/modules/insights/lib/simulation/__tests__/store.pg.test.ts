/**
 * Runs the change simulator SQL (run creation under the tenant lock: dedupe, active-run limits,
 * stale abandonment; compare-and-set updates; privacy filters; decisions; purge; GDPR erasure; the
 * read-only slice transaction and its tenant lock) against a real PostgreSQL. Gated on
 * OM_INSIGHTS_SIMULATION_PG_URL (a throwaway database): the suite creates its own uniquely named
 * schema from the insights migration and drops it afterwards.
 *
 *   OM_INSIGHTS_SIMULATION_PG_URL=postgres://postgres:postgres@localhost:55432/om_simulator \
 *     npx jest --config jest.config.cjs src/modules/insights/lib/simulation/__tests__/store.pg.test.ts --runInBand
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { Pool } from 'pg'
import { InsightsSimulationDecision, InsightsSimulationRun } from '../../../data/entities'
import { Migration20261010130000_insights } from '../../../migrations/Migration20261010130000_insights'
import { runInReadOnlySlice } from '../jobs'
import { runInReadOnlyTransaction } from '../inline'
import {
  SimulationBusyError,
  SimulationDecisionExistsError,
  abandonStaleSimulationRuns,
  createSimulationRun,
  deleteSimulationRunsOfScope,
  deleteSimulationRunsOfUser,
  eraseSimulationDecider,
  findSimulationRun,
  insertCompletedSimulationRun,
  insertSimulationDecision,
  listSimulationRuns,
  purgeExpiredSimulationRuns,
  purgeOldSimulationDecisions,
  simulationRunBudgets,
  updateActiveSimulationRun,
  type NewSimulationRun,
} from '../store'

const PG_URL = process.env.OM_INSIGHTS_SIMULATION_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-0000-4000-8000-00000000c601'
const OTHER_TENANT = '11111111-0000-4000-8000-00000000c602'
const ORG_A = '22222222-0000-4000-8000-00000000c601'
const ORG_B = '22222222-0000-4000-8000-00000000c602'
const USER_A = '33333333-0000-4000-8000-00000000c601'
const USER_B = '33333333-0000-4000-8000-00000000c602'
const DAY = 24 * 60 * 60 * 1000

async function migrationStatements(): Promise<string[]> {
  const migration = Object.create(Migration20261010130000_insights.prototype) as Migration20261010130000_insights
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration.up()
  return statements
}

function newRun(overrides: Partial<NewSimulationRun> = {}): NewSimulationRun {
  const now = Date.now()
  return {
    scope: { tenantId: TENANT, organizationId: ORG_A },
    kind: 'business_rules.rule_backtest',
    requesterUserId: USER_A,
    input: { ruleId: 'R1' },
    inputsHash: randomUUID(),
    artifactKind: 'business_rules.rule',
    artifactId: null,
    artifactVersion: null,
    proposalFingerprint: 'fp',
    windowFrom: new Date(now - 30 * DAY),
    windowTo: new Date(now),
    budgets: simulationRunBudgets(),
    engineVersion: 1,
    contributionVersion: 1,
    expiresAt: new Date(now + 30 * DAY),
    ...overrides,
  }
}

maybe('change simulator store (PostgreSQL)', () => {
  const schema = `sim_store_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let pool: Pool
  let orm: MikroORM
  let em: EntityManager

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL })
    await pool.query(`create schema "${schema}"`)
    const client = await pool.connect()
    try {
      await client.query(`set search_path to "${schema}"`)
      for (const statement of await migrationStatements()) await client.query(statement)
    } finally {
      client.release()
    }
    orm = await MikroORM.init({
      entities: [InsightsSimulationRun, InsightsSimulationDecision],
      metadataProvider: ReflectMetadataProvider,
      clientUrl: PG_URL,
      schema,
      allowGlobalContext: true,
      discovery: { warnWhenNoEntities: false },
      debug: false,
    })
    em = orm.em as EntityManager
  })

  afterAll(async () => {
    await orm?.close(true)
    await pool?.query(`drop schema if exists "${schema}" cascade`)
    await pool?.end()
  })

  beforeEach(async () => {
    await pool.query(`truncate "${schema}"."insights_simulation_runs", "${schema}"."insights_simulation_decisions"`)
  })

  async function setStatus(id: string, status: string, updatedAt?: Date): Promise<void> {
    await pool.query(`update "${schema}"."insights_simulation_runs" set status = $2, updated_at = coalesce($3, updated_at) where id = $1`, [id, status, updatedAt ?? null])
  }

  it('creates a run, then answers the same requester\'s identical live run instead of a new one', async () => {
    const input = newRun()
    const first = await createSimulationRun(em, input)
    expect(first.created).toBe(true)
    expect(first.run.status).toBe('queued')
    const second = await createSimulationRun(em, input)
    expect(second).toEqual(expect.objectContaining({ created: false }))
    expect(second.run.id).toBe(first.run.id)
    await setStatus(first.run.id, 'completed')
    const third = await createSimulationRun(em, input)
    expect(third.created).toBe(false)
  })

  it('never blocks a retry of a failed or cancelled run and replaces an expired duplicate', async () => {
    const input = newRun()
    const failed = await createSimulationRun(em, input)
    await setStatus(failed.run.id, 'failed')
    const retried = await createSimulationRun(em, input)
    expect(retried.created).toBe(true)
    await setStatus(retried.run.id, 'completed')
    await pool.query(`update "${schema}"."insights_simulation_runs" set expires_at = now() - interval '1 minute' where id = $1`, [retried.run.id])
    const replaced = await createSimulationRun(em, input)
    expect(replaced.created).toBe(true)
    const { rows } = await pool.query(`select id from "${schema}"."insights_simulation_runs" where id = $1`, [retried.run.id])
    expect(rows).toEqual([])
  })

  it('enforces two active runs per user and five per tenant, across organizations', async () => {
    await createSimulationRun(em, newRun())
    await createSimulationRun(em, newRun({ scope: { tenantId: TENANT, organizationId: ORG_B } }))
    await expect(createSimulationRun(em, newRun())).rejects.toEqual(expect.objectContaining({ reason: 'user' }))
    await expect(createSimulationRun(em, newRun())).rejects.toBeInstanceOf(SimulationBusyError)
    for (let index = 0; index < 3; index += 1) {
      await createSimulationRun(em, newRun({ requesterUserId: randomUUID() }))
    }
    await expect(createSimulationRun(em, newRun({ requesterUserId: USER_B }))).rejects.toEqual(expect.objectContaining({ reason: 'tenant' }))
    const otherTenant = await createSimulationRun(em, newRun({ scope: { tenantId: OTHER_TENANT, organizationId: ORG_A } }))
    expect(otherTenant.created).toBe(true)
  })

  it('serializes concurrent requests of one user under the tenant lock', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createSimulationRun(em, newRun())))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof SimulationBusyError)).toHaveLength(3)
  })

  it('fails stale active runs as abandoned so they stop counting against the limits', async () => {
    const first = await createSimulationRun(em, newRun())
    const second = await createSimulationRun(em, newRun())
    await setStatus(first.run.id, 'running', new Date(Date.now() - 60 * 60 * 1000))
    const third = await createSimulationRun(em, newRun())
    expect(third.created).toBe(true)
    expect(third.abandoned).toEqual([{ id: first.run.id, tenantId: TENANT, organizationId: ORG_A, requestedByUserId: USER_A, progressJobId: null }])
    const { rows } = await pool.query(`select status, error_code from "${schema}"."insights_simulation_runs" where id = $1`, [first.run.id])
    expect(rows[0]).toEqual({ status: 'failed', error_code: 'abandoned' })
    await setStatus(second.run.id, 'queued', new Date(Date.now() - 60 * 60 * 1000))
    const swept = await abandonStaleSimulationRuns(em)
    expect(swept.map((run) => run.id)).toEqual([second.run.id])
  })

  it('updates only an active run at the expected version (compare-and-set)', async () => {
    const { run } = await createSimulationRun(em, newRun())
    const started = await updateActiveSimulationRun(em, { tenantId: TENANT, organizationId: ORG_A }, run.id, run.updatedAt, { status: 'running', resultJson: { partial: { cursor: 1 } } })
    expect(started?.status).toBe('running')
    expect(started!.updatedAt.getTime()).toBeGreaterThan(run.updatedAt.getTime())
    expect(await updateActiveSimulationRun(em, { tenantId: TENANT, organizationId: ORG_A }, run.id, run.updatedAt, { status: 'completed' })).toBeNull()
    expect(await updateActiveSimulationRun(em, { tenantId: TENANT, organizationId: ORG_B }, run.id, null, { status: 'completed' })).toBeNull()
    const cancelled = await updateActiveSimulationRun(em, { tenantId: TENANT, organizationId: ORG_A }, run.id, null, { status: 'cancelled', resultJson: null })
    expect(cancelled?.status).toBe('cancelled')
    expect(await updateActiveSimulationRun(em, { tenantId: TENANT, organizationId: ORG_A }, run.id, null, { status: 'running' })).toBeNull()
  })

  it('finds and lists only the requester\'s unexpired runs of the organization', async () => {
    const mine = await createSimulationRun(em, newRun())
    const theirs = await createSimulationRun(em, newRun({ requesterUserId: USER_B }))
    const otherOrg = await createSimulationRun(em, newRun({ scope: { tenantId: TENANT, organizationId: ORG_B } }))
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    expect((await findSimulationRun(em.fork(), { scope, runId: mine.run.id, requesterUserId: USER_A }))?.id).toBe(mine.run.id)
    expect(await findSimulationRun(em.fork(), { scope, runId: theirs.run.id, requesterUserId: USER_A })).toBeNull()
    expect(await findSimulationRun(em.fork(), { scope, runId: otherOrg.run.id, requesterUserId: USER_A })).toBeNull()
    expect((await findSimulationRun(em.fork(), { scope, runId: theirs.run.id, requesterUserId: null }))?.id).toBe(theirs.run.id)
    await pool.query(`update "${schema}"."insights_simulation_runs" set expires_at = now() - interval '1 second' where id = $1`, [mine.run.id])
    expect(await findSimulationRun(em.fork(), { scope, runId: mine.run.id, requesterUserId: USER_A })).toBeNull()
    await setStatus(mine.run.id, 'completed')
    await setStatus(otherOrg.run.id, 'completed')
    await createSimulationRun(em, newRun({ kind: 'other_module.kind' }))
    const listed = await listSimulationRuns(em.fork(), { scope, requesterUserId: USER_A, kinds: ['business_rules.rule_backtest', 'other_module.kind'], page: 1, pageSize: 10 })
    expect(listed.total).toBe(1)
    expect(listed.items.map((run) => run.kind)).toEqual(['other_module.kind'])
    expect((await listSimulationRuns(em.fork(), { scope, requesterUserId: USER_A, kinds: ['business_rules.rule_backtest'], page: 1, pageSize: 10 })).total).toBe(0)
    expect((await listSimulationRuns(em.fork(), { scope, requesterUserId: USER_A, kinds: [], page: 1, pageSize: 10 })).total).toBe(0)
  })

  it('appends one decision of each kind per run', async () => {
    const { run } = await createSimulationRun(em, newRun())
    const applied = await insertSimulationDecision(em, { run, decision: 'applied', decidedByUserId: USER_A, artifactId: 'rule-1', artifactUpdatedAtAfter: new Date(), verified: true })
    expect(applied).toEqual(expect.objectContaining({ tenantId: TENANT, organizationId: ORG_A, runId: run.id, verified: true }))
    await expect(insertSimulationDecision(em, { run, decision: 'applied', decidedByUserId: USER_A, artifactId: null, artifactUpdatedAtAfter: null, verified: false })).rejects.toBeInstanceOf(SimulationDecisionExistsError)
    await insertSimulationDecision(em, { run, decision: 'discarded', decidedByUserId: USER_A, artifactId: null, artifactUpdatedAtAfter: null, verified: null })
    const { rows } = await pool.query(`select count(*)::int as count from "${schema}"."insights_simulation_decisions" where run_id = $1`, [run.id])
    expect(rows[0].count).toBe(2)
  })

  it('purges expired runs and decisions older than 13 months in batches', async () => {
    const live = await createSimulationRun(em, newRun())
    const expired = await createSimulationRun(em, newRun({ requesterUserId: USER_B }))
    await pool.query(`update "${schema}"."insights_simulation_runs" set expires_at = now() - interval '1 hour' where id = $1`, [expired.run.id])
    expect(await purgeExpiredSimulationRuns(em)).toBe(1)
    const old = await insertSimulationDecision(em, { run: live.run, decision: 'applied', decidedByUserId: USER_A, artifactId: null, artifactUpdatedAtAfter: null, verified: false })
    await insertSimulationDecision(em, { run: live.run, decision: 'discarded', decidedByUserId: USER_A, artifactId: null, artifactUpdatedAtAfter: null, verified: null })
    await pool.query(`update "${schema}"."insights_simulation_decisions" set created_at = now() - interval '14 months' where id = $1`, [old.id])
    expect(await purgeOldSimulationDecisions(em)).toBe(1)
    const { rows } = await pool.query(`select decision from "${schema}"."insights_simulation_decisions"`)
    expect(rows).toEqual([{ decision: 'discarded' }])
  })

  it('erases a deleted user: runs removed, decisions rewritten to one random token', async () => {
    const mine = await createSimulationRun(em, newRun())
    const theirs = await createSimulationRun(em, newRun({ requesterUserId: USER_B }))
    await setStatus(theirs.run.id, 'completed')
    await insertSimulationDecision(em, { run: theirs.run, decision: 'applied', decidedByUserId: USER_B, artifactId: null, artifactUpdatedAtAfter: null, verified: false })
    await insertSimulationDecision(em, { run: theirs.run, decision: 'discarded', decidedByUserId: USER_B, artifactId: null, artifactUpdatedAtAfter: null, verified: null })
    await insertSimulationDecision(em, { run: mine.run, decision: 'discarded', decidedByUserId: USER_A, artifactId: null, artifactUpdatedAtAfter: null, verified: null })
    const erased = await deleteSimulationRunsOfUser(em, TENANT, USER_B)
    expect(erased.deleted).toBe(1)
    expect(await eraseSimulationDecider(em, TENANT, USER_B)).toBe(2)
    const { rows } = await pool.query(`select decided_by_user_id from "${schema}"."insights_simulation_decisions" order by decided_by_user_id`)
    const tokens = rows.map((row: { decided_by_user_id: string }) => row.decided_by_user_id)
    expect(tokens).toContain(USER_A)
    const erasedTokens = tokens.filter((token: string) => token !== USER_A)
    expect(erasedTokens).toHaveLength(2)
    expect(new Set(erasedTokens).size).toBe(1)
    expect(erasedTokens[0]).toMatch(/^erased:[0-9a-f-]{36}$/)
    expect(erasedTokens[0]).not.toContain(USER_B)
    expect(await eraseSimulationDecider(em, OTHER_TENANT, USER_A)).toBe(0)
  })

  it('purges the runs of a deleted organization or tenant and reports active progress jobs', async () => {
    const jobId = randomUUID()
    const inA = await createSimulationRun(em, newRun())
    await pool.query(`update "${schema}"."insights_simulation_runs" set progress_job_id = $2 where id = $1`, [inA.run.id, jobId])
    await createSimulationRun(em, newRun({ scope: { tenantId: TENANT, organizationId: ORG_B } }))
    await createSimulationRun(em, newRun({ scope: { tenantId: OTHER_TENANT, organizationId: ORG_A } }))
    const organization = await deleteSimulationRunsOfScope(em, { tenantId: TENANT, organizationId: ORG_A })
    expect(organization).toEqual({ deleted: 1, progressJobIds: [{ progressJobId: jobId, organizationId: ORG_A }] })
    expect((await deleteSimulationRunsOfScope(em, { tenantId: TENANT, organizationId: null })).deleted).toBe(1)
    const { rows } = await pool.query(`select tenant_id from "${schema}"."insights_simulation_runs"`)
    expect(rows).toEqual([{ tenant_id: OTHER_TENANT }])
  })

  it('runs a slice read-only, statement-bounded and one at a time per tenant', async () => {
    let release: () => void = () => undefined
    const holding = new Promise<void>((resolve) => { release = resolve })
    let entered: () => void = () => undefined
    const inside = new Promise<void>((resolve) => { entered = resolve })
    const first = runInReadOnlySlice(em, TENANT, async (trx) => {
      const db = trx.getKysely<unknown>()
      const timeout = await sql<{ statement_timeout: string }>`show statement_timeout`.execute(db)
      const readOnly = await sql<{ transaction_read_only: string }>`show transaction_read_only`.execute(db)
      entered()
      await holding
      return { timeout: timeout.rows[0]?.statement_timeout, readOnly: readOnly.rows[0]?.transaction_read_only }
    })
    await inside
    await expect(runInReadOnlySlice(em, TENANT, async () => 'second')).resolves.toEqual({ acquired: false })
    await expect(runInReadOnlySlice(em, OTHER_TENANT, async () => 'other tenant')).resolves.toEqual({ acquired: true, value: 'other tenant' })
    release()
    await expect(first).resolves.toEqual({ acquired: true, value: { timeout: '5s', readOnly: 'on' } })
    await expect(runInReadOnlySlice(em, TENANT, async (trx) => {
      await sql`insert into ${sql.table(`${schema}.insights_simulation_decisions`)} (id, tenant_id, organization_id, run_id, decision, decided_by_user_id, artifact_kind, created_at) values (gen_random_uuid(), ${TENANT}, ${ORG_A}, gen_random_uuid(), 'applied', 'x', 'k', now())`.execute(trx.getKysely<unknown>())
      return 'written'
    })).rejects.toEqual(expect.objectContaining({ code: '25006' }))
  })

  it('stores inline runs as completed at once, outside the active-run limits and the dedupe of live runs', async () => {
    await createSimulationRun(em, newRun())
    const now = new Date()
    const completed = (inputsHash: string) => insertCompletedSimulationRun(em, {
      ...newRun({ kind: 'auth.role_acl_preview', inputsHash, windowFrom: now, windowTo: now, expiresAt: new Date(now.getTime() + DAY) }),
      startedAt: now,
      completedAt: now,
      resultJson: { k: 10, truncated: false, groups: [], summary: { warnings: [], counts: { pages_lost: 1 }, lists: {} } },
      coverageJson: {},
      caveats: ['auth.simulation.caveats.currentState'],
      fidelity: 'observed',
    })
    const first = await completed(randomUUID())
    const second = await completed(randomUUID())
    expect(first.id).not.toBe(second.id)
    const stored = await findSimulationRun(em.fork(), { scope: { tenantId: TENANT, organizationId: ORG_A }, runId: first.id, requesterUserId: USER_A })
    expect(stored).toEqual(expect.objectContaining({ status: 'completed', kind: 'auth.role_acl_preview', progressJobId: null }))
    expect(stored?.resultJson).toEqual(expect.objectContaining({ summary: { warnings: [], counts: { pages_lost: 1 }, lists: {} } }))
    await expect(createSimulationRun(em, newRun())).resolves.toEqual(expect.objectContaining({ created: true }))
    await expect(createSimulationRun(em, newRun())).rejects.toBeInstanceOf(SimulationBusyError)
  })

  it('runs an inline kind in a read-only, statement-bounded transaction without the tenant slice lock', async () => {
    const inside = await runInReadOnlySlice(em, TENANT, async () => runInReadOnlyTransaction(em, async (trx) => {
      const db = trx.getKysely<unknown>()
      const timeout = await sql<{ statement_timeout: string }>`show statement_timeout`.execute(db)
      const readOnly = await sql<{ transaction_read_only: string }>`show transaction_read_only`.execute(db)
      return { timeout: timeout.rows[0]?.statement_timeout, readOnly: readOnly.rows[0]?.transaction_read_only }
    }))
    expect(inside).toEqual({ acquired: true, value: { timeout: '5s', readOnly: 'on' } })
    await expect(runInReadOnlyTransaction(em, async (trx) => {
      await sql`insert into ${sql.table(`${schema}.insights_simulation_decisions`)} (id, tenant_id, organization_id, run_id, decision, decided_by_user_id, artifact_kind, created_at) values (gen_random_uuid(), ${TENANT}, ${ORG_A}, gen_random_uuid(), 'applied', 'x', 'k', now())`.execute(trx.getKysely<unknown>())
      return 'written'
    })).rejects.toEqual(expect.objectContaining({ code: '25006' }))
  })
})
