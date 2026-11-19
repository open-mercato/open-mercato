import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EntitySchema, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { Pool, type PoolClient } from 'pg'
import { attachPoolErrorHandlers, instrumentPrimaryPool, resolvePoolConfig, type ObservablePool } from '@open-mercato/shared/lib/db/mikro'
import { installRlsPoolScope, runWithRlsTenant } from '../../src/lib/rls/poc/poolScope'

const databaseUrl = process.env.OM_RLS_POC_DATABASE_URL
assert.ok(databaseUrl, 'Set OM_RLS_POC_DATABASE_URL to a DISPOSABLE PostgreSQL database with role/schema creation privileges')
const suffix = randomUUID().replaceAll('-', '')
const schema = `rls_poc_${suffix}`
const role = `rls_poc_${suffix}`
const password = randomUUID()
const admin = new Pool({ connectionString: databaseUrl, max: 1 })
const runtimeUrl = new URL(databaseUrl)
runtimeUrl.username = role
runtimeUrl.password = password
const tenantA = randomUUID()
const tenantB = randomUUID()
const rowA = randomUUID()
const rowB = randomUUID()
type RecordRow = { id: string; tenantId: string; label: string }
type ProbeDatabase = { records: { id: string; tenant_id: string; label: string } }
const probe = new EntitySchema<RecordRow>({
  name: 'RlsPocRecord', tableName: 'records', schema,
  properties: {
    id: { type: 'uuid', primary: true },
    tenantId: { type: 'uuid', fieldName: 'tenant_id' },
    label: { type: 'string' },
  },
})
type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>
const orms: TestOrm[] = []
const disposers: Array<() => void> = []
const pools: Pool[] = []
const table = `"${schema}"."records"`
let checks = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  checks += 1
  process.stdout.write(`PASS ${name}\n`)
}
async function openOrm(max: number, scoped = true): Promise<TestOrm> {
  const defaults = resolvePoolConfig({ NODE_ENV: 'test' })
  const orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
    driver: PostgreSqlDriver, clientUrl: runtimeUrl.toString(), entities: [probe],
    pool: { min: 0, max, idleTimeoutMillis: defaults.poolIdleTimeout },
    driverOptions: {
      connectionTimeoutMillis: defaults.poolAcquireTimeout,
      idle_in_transaction_session_timeout: defaults.idleInTransactionTimeoutMs,
      onPoolCreated: (pool: Pool) => {
        pools.push(pool)
        attachPoolErrorHandlers(pool as unknown as ObservablePool)
        disposers.push(instrumentPrimaryPool(pool as unknown as ObservablePool))
        if (scoped) disposers.push(installRlsPoolScope(pool))
      },
    },
  })
  orms.push(orm)
  return orm
}
async function labels(em: EntityManager): Promise<string[]> {
  const rows = await em.execute<Array<{ label: string }>>(`select label from ${table} order by label`)
  return rows.map((row) => row.label)
}
try {
  await admin.query(`create role "${role}" login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit`)
  await admin.query(`create schema "${schema}"`)
  await admin.query(`create table ${table} (id uuid primary key, tenant_id uuid not null, label text not null)`)
  await admin.query(`insert into ${table} values ($1, $2, 'A'), ($3, $4, 'B')`, [rowA, tenantA, rowB, tenantB])
  await admin.query(`alter table ${table} enable row level security`)
  await admin.query(`alter table ${table} force row level security`)
  const predicate = "tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid"
  await admin.query(`create policy tenant_boundary on ${table} using (${predicate}) with check (${predicate})`)
  await admin.query(`grant usage on schema "${schema}" to "${role}"`)
  await admin.query(`grant select, insert, update, delete on ${table} to "${role}"`)
  const orm = await openOrm(1)
  const fork = () => orm.em.fork({ clear: true, freshEventManager: true, useContext: true })
  await check('runtime role cannot bypass RLS and does not own the table', async () => {
    const rows = await fork().execute<Array<{ rolsuper: boolean; rolbypassrls: boolean; owns: boolean }>>(
      `select r.rolsuper, r.rolbypassrls, c.relowner = r.oid as owns from pg_roles r, pg_class c join pg_namespace n on n.oid = c.relnamespace where r.rolname = current_user and n.nspname = ? and c.relname = 'records'`, [schema],
    )
    assert.deepEqual(rows, [{ rolsuper: false, rolbypassrls: false, owns: false }])
  })
  await check('autocommit ORM, raw connection, and Kysely reads obey tenant scope', async () => {
    await runWithRlsTenant(tenantA, async () => {
      assert.deepEqual((await fork().find(probe, {})).map((row) => row.label), ['A'])
      assert.deepEqual(await fork().getConnection().execute(`select label from ${table}`), [{ label: 'A' }])
      assert.deepEqual(await fork().getKysely<ProbeDatabase>().withSchema(schema).selectFrom('records').select('label').execute(), [{ label: 'A' }])
    })
  })
  await check('same physical connection switches A to B and clears absent context', async () => {
    const pids: number[] = []
    for (const tenant of [tenantA, tenantB, tenantA]) {
      await runWithRlsTenant(tenant, async () => {
        const rows = await fork().execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
        pids.push(rows[0].pid)
        assert.deepEqual(await labels(fork()), tenant === tenantA ? ['A'] : ['B'])
      })
    }
    assert.equal(new Set(pids).size, 1)
    assert.deepEqual(await labels(fork()), [])
  })
  await check('missing context denies writes; wrong tenant insert and reassignment are rejected', async () => {
    await assert.rejects(fork().execute(`insert into ${table} values (?, ?, 'denied')`, [randomUUID(), tenantA]), /row.level security/i)
    await runWithRlsTenant(tenantA, async () => {
      await assert.rejects(fork().execute(`insert into ${table} values (?, ?, 'denied')`, [randomUUID(), tenantB]), /row.level security/i)
      await assert.rejects(fork().execute(`update ${table} set tenant_id = ? where id = ?`, [tenantB, rowA]), /row.level security/i)
      const result = await fork().execute(`delete from ${table} where id = ? returning id`, [rowB])
      assert.deepEqual(result, [])
    })
  })
  await check('ORM flush, explicit transaction and Kysely share the pinned connection', async () => {
    await runWithRlsTenant(tenantA, () => fork().transactional(async (tx) => {
      const id = randomUUID()
      tx.persist(tx.create(probe, { id, tenantId: tenantA, label: 'A-created' }))
      await tx.flush()
      assert.equal((await tx.getKysely<ProbeDatabase>().withSchema(schema).selectFrom('records').select('id').where('id', '=', id).execute()).length, 1)
      assert.equal(await tx.count(probe, {}), 2)
      await tx.nativeDelete(probe, { id })
    }))
    assert.deepEqual(await labels(fork()), [])
  })
  await check('rollback returns a reusable connection with no context on the next reservation', async () => {
    await assert.rejects(runWithRlsTenant(tenantA, () => fork().transactional(async (tx) => {
      await tx.execute(`insert into ${table} values (?, ?, 'rolled-back')`, [randomUUID(), tenantA])
      throw new Error('[internal] deliberate rollback')
    })), /deliberate rollback/)
    assert.deepEqual(await labels(fork()), [])
    assert.deepEqual(await runWithRlsTenant(tenantA, () => labels(fork())), ['A'])
  })
  await check('callback pool.query inherits scope and missing scope clears it', async () => {
    const pool = pools[0]
    await runWithRlsTenant(tenantB, async () => assert.deepEqual((await pool.query(`select label from ${table}`)).rows, [{ label: 'B' }]))
    assert.deepEqual((await pool.query(`select label from ${table}`)).rows, [])
  })
  await check('failed setup destroys the checked-out client and max=1 recovers', async () => {
    const pool = pools[0]
    const client = await pool.connect()
    const originalQuery = client.query
    client.query = (() => Promise.reject(new Error('[internal] deliberate setup failure'))) as PoolClient['query']
    client.release()
    await assert.rejects(pool.connect(), /deliberate setup failure/)
    client.query = originalQuery
    assert.deepEqual(await runWithRlsTenant(tenantB, () => labels(fork())), ['B'])
  })
  await check('SET LOCAL outside a transaction reproduces the previous implementation failure', async () => {
    const control = await openOrm(1, false)
    const em = control.em.fork()
    await em.execute("select set_config('app.current_tenant_id', ?, true)", [tenantA])
    assert.deepEqual(await labels(em), [])
  })
  const parallelOrm = await openOrm(3)
  await check('60 overlapping tenant requests stay isolated through a pool of 3', async () => {
    await Promise.all(Array.from({ length: 60 }, (_, index) => {
      const tenant = index % 2 === 0 ? tenantA : tenantB
      return runWithRlsTenant(tenant, async () => {
        const em = parallelOrm.em.fork({ clear: true, freshEventManager: true })
        await em.execute('select pg_sleep(0.005)')
        assert.deepEqual(await labels(em), tenant === tenantA ? ['A'] : ['B'])
      })
    }))
    assert.deepEqual(await labels(parallelOrm.em.fork()), [])
  })
  await check('60 concurrent mixed transactions isolate writes, commits, rollbacks and deletes across 3 simultaneous backends', async () => {
    const operations = Array.from({ length: 60 }, (_, index) => ({
      id: randomUUID(),
      tenantId: index % 2 === 0 ? tenantA : tenantB,
      label: `concurrent-${index}-updated`,
      rollback: index % 3 === 0,
      remove: index % 4 === 0,
    }))
    const firstWaveBackends = new Set<number>()
    const firstWaveTenants = new Set<string>()
    let releaseFirstWave: () => void = () => undefined
    const firstWave = new Promise<void>((resolve) => { releaseFirstWave = resolve })
    const barrierTimeout = setTimeout(releaseFirstWave, 5_000)
    let activeTransactions = 0
    let peakTransactions = 0
    try {
      const outcomes = await Promise.allSettled(operations.map(async (operation, index) => {
        const rollback = new Error('[internal] deliberate concurrent rollback')
        const transaction = runWithRlsTenant(operation.tenantId, () =>
          parallelOrm.em.fork({ clear: true, freshEventManager: true }).transactional(async (tx) => {
            activeTransactions += 1
            peakTransactions = Math.max(peakTransactions, activeTransactions)
            try {
              const [connection] = await tx.execute<Array<{ pid: number; tenant: string }>>(
                "select pg_backend_pid() as pid, current_setting('app.current_tenant_id') as tenant",
              )
              assert.equal(connection.tenant, operation.tenantId)
              if (index < 3) {
                firstWaveBackends.add(connection.pid)
                firstWaveTenants.add(operation.tenantId)
                if (firstWaveBackends.size === 3) releaseFirstWave()
                await firstWave
                assert.equal(firstWaveBackends.size, 3, 'The first wave must hold three distinct database connections simultaneously')
              }
              tx.persist(tx.create(probe, { id: operation.id, tenantId: operation.tenantId, label: 'concurrent-created' }))
              await tx.flush()
              const updated = await tx.getKysely<ProbeDatabase>().withSchema(schema)
                .updateTable('records').set({ label: operation.label }).where('id', '=', operation.id)
                .returningAll().executeTakeFirstOrThrow()
              assert.equal(updated.tenant_id, operation.tenantId)
              assert.equal(updated.label, operation.label)
              const foreignId = operation.tenantId === tenantA ? rowB : rowA
              assert.deepEqual(await tx.execute(`update ${table} set label = 'cross-tenant' where id = ? returning id`, [foreignId]), [])
              assert.deepEqual(await tx.execute(`delete from ${table} where id = ? returning id`, [foreignId]), [])
              const visible = await tx.execute<Array<{ tenant_id: string }>>(`select tenant_id from ${table}`)
              assert.ok(visible.length > 0)
              assert.ok(visible.every((row) => row.tenant_id === operation.tenantId))
              const [afterWrites] = await tx.execute<Array<{ pid: number; tenant: string }>>(
                "select pg_backend_pid() as pid, current_setting('app.current_tenant_id') as tenant",
              )
              assert.deepEqual(afterWrites, connection)
              if (operation.remove) await tx.nativeDelete(probe, { id: operation.id })
              if (operation.rollback) throw rollback
            } finally {
              activeTransactions -= 1
            }
          }),
        )
        if (operation.rollback) await assert.rejects(transaction, (error) => error === rollback)
        else await transaction
      }))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason
      }
      assert.equal(peakTransactions, 3)
      assert.equal(activeTransactions, 0)
      assert.deepEqual([...firstWaveTenants].sort(), [tenantA, tenantB].sort())
      const expected = [
        { id: rowA, tenant_id: tenantA, label: 'A' },
        { id: rowB, tenant_id: tenantB, label: 'B' },
        ...operations.filter((operation) => !operation.rollback && !operation.remove)
          .map((operation) => ({ id: operation.id, tenant_id: operation.tenantId, label: operation.label })),
      ].sort((left, right) => left.id.localeCompare(right.id))
      const actual = await admin.query<{ id: string; tenant_id: string; label: string }>(`select id, tenant_id, label from ${table}`)
      assert.deepEqual(actual.rows.sort((left, right) => left.id.localeCompare(right.id)), expected)
      assert.deepEqual(await labels(parallelOrm.em.fork()), [])
    } finally {
      clearTimeout(barrierTimeout)
    }
  })
  await check('nested tenant switching is rejected', async () => {
    assert.throws(() => runWithRlsTenant(tenantA, () => runWithRlsTenant(tenantB, () => undefined)), /Cannot change RLS tenant/)
  })
  process.stdout.write(`Enterprise RLS PoC: ${checks} checks passed; disposable fixtures only.\n`)
} finally {
  for (const dispose of disposers.reverse()) dispose()
  await Promise.allSettled(orms.map((orm) => orm.close(true)))
  try {
    await admin.query(`drop schema if exists "${schema}" cascade`)
    await admin.query(`drop role if exists "${role}"`)
  } finally {
    await admin.end()
  }
}
