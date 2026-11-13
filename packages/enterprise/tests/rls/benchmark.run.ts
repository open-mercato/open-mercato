import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { Pool } from 'pg'
import { installTenantPoolBoundary, type BoundaryPool } from '../../src/lib/rls/runtime/pool'
import { runWithTenantBoundary } from '../../src/lib/rls/runtime/scope'

const databaseUrl = process.env.OM_RLS_TEST_DATABASE_URL
assert.ok(databaseUrl, '[internal] Explicit disposable PostgreSQL URL is required')
const suffix = randomUUID().replaceAll('-', '')
const schema = `rls_benchmark_${suffix}`
const role = schema
const password = randomUUID()
const admin = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
const runtimeUrl = new URL(databaseUrl)
runtimeUrl.username = role
runtimeUrl.password = password
const tenantIds = [randomUUID(), randomUUID()]
const table = `"${schema}".records`
const results: Record<string, number | string>[] = []
const percentile = (values: number[], fraction: number) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1]

try {
  await admin.query(`create role "${role}" login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit`)
  await admin.query(`create schema "${schema}"`)
  await admin.query(`create table ${table}(id integer primary key, tenant_id uuid not null, counter integer not null default 0)`)
  await admin.query(`insert into ${table}(id,tenant_id) select value,case when value%2=0 then $1::uuid else $2::uuid end from generate_series(0,99) value`, tenantIds)
  await admin.query(`grant usage on schema "${schema}" to "${role}"`)
  await admin.query(`grant select,update on ${table} to "${role}"`)
  await admin.query(`create policy tenant_boundary on ${table} using (tenant_id=nullif(current_setting('app.current_tenant_id',true),'')::uuid) with check (tenant_id=nullif(current_setting('app.current_tenant_id',true),'')::uuid)`)
  for (const max of [1, 3, 10]) {
    for (const users of [20, 30, 50, 100]) {
      for (const mode of ['off', 'on'] as const) {
        await admin.query(`alter table ${table} ${mode === 'on' ? 'enable' : 'disable'} row level security`)
        await admin.query(`alter table ${table} force row level security`)
        await admin.query(`update ${table} set counter=0`)
        const pool = new Pool({ connectionString: runtimeUrl.toString(), max, connectionTimeoutMillis: 10_000, query_timeout: 10_000 })
        const boundary = mode === 'on' ? installTenantPoolBoundary(pool as unknown as BoundaryPool, { configurationKey: `benchmark-${suffix}-${max}-${users}` }) : undefined
        let acquisitions = 0
        let queuedAcquisitions = 0
        let peakWaiting = 0
        let leased = 0
        let peakLeased = 0
        const latency: number[] = []
        const checkout: number[] = []
        try {
          await pool.query('select 1')
          const started = performance.now()
          for (let wave = 0; wave < 10; wave += 1) {
            await Promise.all(Array.from({ length: users }, (_, user) => runWithTenantBoundary({ kind: 'tenant', source: 'worker', tenantId: tenantIds[user % 2] }, async () => {
              const operationStarted = performance.now()
              if (pool.idleCount === 0 && pool.totalCount >= max) queuedAcquisitions += 1
              const pending = pool.connect()
              peakWaiting = Math.max(peakWaiting, pool.waitingCount)
              const client = await pending
              checkout.push(performance.now() - operationStarted)
              acquisitions += 1
              leased += 1
              peakLeased = Math.max(peakLeased, leased)
              try {
                const result = await client.query<{ id: number; tenant_id: string; counter: number }>(`update ${table} set counter=counter+1 where id=$1 and tenant_id=$2 returning id,tenant_id,counter`, [user, tenantIds[user % 2]])
                assert.deepEqual(result.rows, [{ id: user, tenant_id: tenantIds[user % 2], counter: wave + 1 }])
                const foreign = await client.query(`select id from ${table} where id=$1 and tenant_id=$2`, [(user + 1) % users, tenantIds[user % 2]])
                assert.equal(foreign.rowCount, 0)
              } finally {
                leased -= 1
                client.release()
              }
              latency.push(performance.now() - operationStarted)
            })))
          }
          const elapsedMs = performance.now() - started
          const oracle = await admin.query<{ count: number; sum: number }>(`select count(*)::integer as count,sum(counter)::integer as sum from ${table}`)
          assert.deepEqual(oracle.rows, [{ count: 100, sum: users * 10 }])
          assert.equal(acquisitions, users * 10)
          assert.ok(peakLeased <= max)
          results.push({ mode, poolMax: max, users, waves: 10, acquisitions, queuedAcquisitions, peakWaiting, peakLeased, elapsedMs, operationP50Ms: percentile(latency, 0.5), operationP95Ms: percentile(latency, 0.95), checkoutP50Ms: percentile(checkout, 0.5), checkoutP95Ms: percentile(checkout, 0.95), errors: 0, isolationViolations: 0 })
        } finally {
          await pool.end()
          boundary?.dispose()
        }
      }
    }
  }
} finally {
  try {
    await admin.query(`drop schema if exists "${schema}" cascade`)
    await admin.query(`drop role if exists "${role}"`)
  } finally { await admin.end() }
}
const report = { workload: 'Same tenant-predicated update and foreign read, ten barrier waves; off disables RLS and adapter, on enables FORCE RLS and production checkout boundary', limitations: 'Connection workload on local disposable PostgreSQL; excludes HTTP, auth, startup catalog checks and ORM. Separate real HTTP concurrency evidence covers application isolation. Checkout latency includes queueing and tenant setup; queuedAcquisitions is an observed saturation count.', results }
if (process.env.OM_RLS_BENCHMARK_OUTPUT) await writeFile(process.env.OM_RLS_BENCHMARK_OUTPUT, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(`PASS paired RLS checkout benchmark: ${results.length} cases, ${results.reduce((sum, result) => sum + Number(result.acquisitions), 0)} acquisitions; disposable fixtures removed\n`)
