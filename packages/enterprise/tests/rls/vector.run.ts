import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'
import { createPgVectorDriver } from '@open-mercato/search/vector/drivers/pgvector/index'
import { createPgVectorDatabaseDeclarations, resolvePgVectorStorage } from '@open-mercato/search/vector/drivers/pgvector/storage'
import { registerDatabaseRuntimeAdapter, databaseStorageMode } from '@open-mercato/shared/lib/db/runtime'
import { createTenantBoundaryAdapter } from '../../src/lib/rls/runtime/registration'
import { parseTenantTableManifest } from '../../src/lib/rls/runtime/manifest'
import { reconcileTenantTablePolicies } from '../../src/lib/rls/runtime/policies'
import { runWithTenantBoundary } from '../../src/lib/rls/runtime/scope'
import { quoteBoundaryIdentifier as quote } from '../../src/lib/rls/runtime/config'

const databaseUrl = process.env.OM_RLS_TEST_DATABASE_URL
assert.ok(databaseUrl, 'Set OM_RLS_TEST_DATABASE_URL to an explicitly disposable pgvector database')
const suffix = randomUUID().replaceAll('-', '')
const schema = `rls_vector_${suffix}`
const role = `rls_vector_${suffix}`
const directory = await mkdtemp(path.join(tmpdir(), 'om-rls-vector-'))
const manifestPath = path.join(directory, 'manifest.json')
const admin = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, query_timeout: 15000 })
const runtimeUrl = new URL(databaseUrl)
runtimeUrl.username = role
runtimeUrl.password = randomUUID()
const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 3, options: `-c search_path=${schema},public -c default_transaction_read_only=on`, connectionTimeoutMillis: 5000, query_timeout: 15000 })
const options = { schema, dimension: 3 }
const storage = resolvePgVectorStorage(options)
const declarations = createPgVectorDatabaseDeclarations(options)
const canary = `${quote(schema)}.canary`
const tenants = [randomUUID(), randomUUID()]
const manifest = parseTenantTableManifest({ version: 1, tables: [
  ...declarations.storageTables!.map((entry) => ({ ...entry, owner: 'search', policyVersion: null })),
  ...['entity_indexes', 'custom_entities_storage'].map((table) => ({ schema, table, owner: 'application-fixture', classification: 'deferred', reason: 'Correlated application reads retain application predicates', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: null })),
  { schema, table: 'canary', owner: 'fixture', classification: 'enforced', reason: 'Disposable enforced canary', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1 },
] })
let driver: ReturnType<typeof createPgVectorDriver> | undefined
let checks = 0
async function check(name: string, callback: () => Promise<void>) {
  await callback()
  checks += 1
  process.stdout.write(`PASS ${name}\n`)
}
const tenantRun = <Result>(tenantId: string, callback: () => Promise<Result>) => runWithTenantBoundary({ kind: 'tenant', source: 'worker', tenantId }, callback)
try {
  await admin.query(`create role ${quote(role)} login password '${runtimeUrl.password}' nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`create schema ${quote(schema)}`)
  await admin.query(`set search_path to ${quote(schema)}, public`)
  await admin.query(`create table ${canary}(id uuid primary key, tenant_id uuid not null)`)
  for (const table of ['entity_indexes', 'custom_entities_storage']) {
    await admin.query(`create table ${quote(schema)}.${quote(table)}(id uuid primary key, tenant_id uuid not null)`)
  }
  await writeFile(manifestPath, JSON.stringify(manifest))
  await check('privileged owner-local provider provisions storage and migration ledger idempotently', async () => {
    const client = await admin.connect()
    try {
      await client.query(`set search_path to ${quote(schema)}, public`)
      await declarations.storageProviders![0].provision(client)
      await declarations.storageProviders![0].provision(client)
    } finally { client.release() }
    assert.deepEqual((await admin.query(`select id from ${storage.migrationsIdent}`)).rows, [{ id: '0001_init' }])
    assert.equal((await admin.query('select count(*)::int as total from pg_extension where extname=$1', ['vector'])).rows[0].total, 1)
  })
  await admin.query(`grant usage on schema ${quote(schema)} to ${quote(role)}`)
  await admin.query(`grant select, insert, update, delete on all tables in schema ${quote(schema)} to ${quote(role)}`)
  const client = await admin.connect()
  try { await reconcileTenantTablePolicies(client, manifest, role) } finally { client.release() }
  await admin.query(`insert into ${canary} values($1,$2),($3,$4)`, [randomUUID(), tenants[0], randomUUID(), tenants[1]])
  registerDatabaseRuntimeAdapter(createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema, manifestPath }, {}, suffix))
  driver = createPgVectorDriver({ ...options, pool: runtime })
  const active = driver
  await check('actual enterprise adapter uses SELECT-only active readiness on a nonowner pool', async () => {
    assert.equal(databaseStorageMode(storage.descriptor), 'validate')
    await active.ensureReady()
    assert.equal(await active.isHealthy!(), true)
    const clients = await Promise.all(Array.from({ length: 3 }, () => runtime.connect()))
    try {
      for (const client of clients) {
        assert.equal((await client.query('show default_transaction_read_only')).rows[0].default_transaction_read_only, 'on')
        await client.query('set default_transaction_read_only=off')
      }
    } finally { for (const client of clients) client.release() }
    assert.equal((await runtime.query('select current_user as role')).rows[0].role, role)
    assert.equal((await runtime.query('select count(*)::int as total from pg_tables where schemaname=$1 and tableowner=current_user', [schema])).rows[0].total, 0)
  })
  await check('restricted runtime cannot create or alter storage objects', async () => {
    for (const statement of [`create table ${quote(schema)}.forbidden(id int)`, 'create temp table forbidden(id int)', `alter table ${storage.tableIdent} add column forbidden int`, `truncate ${storage.tableIdent}`]) {
      await assert.rejects(runtime.query(statement), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42501')
    }
  })
  await check('concurrent driver upsert list and count preserve application tenant predicates', async () => {
    assert.ok(active.list && active.count)
    const recordIds = tenants.map(() => Array.from({ length: 12 }, () => randomUUID()))
    await Promise.all(tenants.flatMap((tenantId, tenantIndex) => Array.from({ length: 12 }, (_, index) => tenantRun(tenantId, () => active.upsert({
      entityId: 'fixture:record', recordId: recordIds[tenantIndex][index], tenantId, checksum: `checksum-${index}`, embedding: [1, index / 12, 0], driverId: 'pgvector', resultTitle: `fixture-${index}`,
    })))))
    await Promise.all(tenants.map((tenantId, tenantIndex) => tenantRun(tenantId, () => active.upsert({
      entityId: 'fixture:record', recordId: recordIds[tenantIndex][0], tenantId, checksum: 'updated', embedding: [0, 1, 0], driverId: 'pgvector', resultTitle: 'updated',
    }))))
    await Promise.all(tenants.map((tenantId) => tenantRun(tenantId, async () => {
      const entries = await active.list!({ tenantId, limit: 100 })
      assert.equal(entries.length, 12)
      assert.equal(await active.count!({ tenantId }), 12)
      assert.ok(entries.every((entry) => entry.tenantId === tenantId))
    })))
    assert.equal((await admin.query(`select count(*)::int as total from ${storage.tableIdent}`)).rows[0].total, 24)
    const policy = (await admin.query('select relrowsecurity, relforcerowsecurity from pg_class where oid=$1::regclass', [storage.tableIdent])).rows[0]
    assert.deepEqual(policy, { relrowsecurity: false, relforcerowsecurity: false })
  })
  await check('enforced fixture canary isolates concurrent tenants and absent scope', async () => {
    await Promise.all(Array.from({ length: 24 }, (_, index) => tenantRun(tenants[index % 2], async () => {
      assert.deepEqual((await runtime.query(`select tenant_id from ${canary}`)).rows, [{ tenant_id: tenants[index % 2] }])
      await assert.rejects(runtime.query(`insert into ${canary} values($1,$2)`, [randomUUID(), tenants[(index + 1) % 2]]), /row.level security/i)
    })))
    assert.deepEqual((await runtime.query(`select * from ${canary}`)).rows, [])
    assert.equal(runtime.waitingCount, 0)
    assert.equal(runtime.idleCount, runtime.totalCount)
  })
  await check('driver closes its owned pool idempotently and rejects further use', async () => {
    await active.close()
    await active.close()
    assert.equal(runtime.ended, true)
    await assert.rejects(active.ensureReady(), /closed/)
    await assert.rejects(active.count!({ tenantId: tenants[0] }), /closed/)
  })
} finally {
  if (driver) await driver.close()
  if (!runtime.ended) await runtime.end()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseRuntime.v1')]
  try {
    await admin.query(`drop schema if exists ${quote(schema)} cascade`)
    await admin.query(`drop role if exists ${quote(role)}`)
    assert.deepEqual((await admin.query('select exists(select 1 from pg_namespace where nspname=$1) as schema_exists, exists(select 1 from pg_roles where rolname=$2) as role_exists', [schema, role])).rows, [{ schema_exists: false, role_exists: false }])
  } finally { await admin.end(); await rm(directory, { recursive: true, force: true }) }
}
process.stdout.write(`Enterprise RLS vector regression: ${checks} checks passed; disposable fixtures removed.\n`)
