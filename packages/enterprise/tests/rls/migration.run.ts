import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { Pool } from 'pg'
import type { PackageResolver } from '../../../cli/src/lib/resolver'
import { registerDatabaseRuntimeAdapter } from '@open-mercato/shared/lib/db/runtime'
import { createTenantBoundaryAdapter } from '../../src/lib/rls/runtime/registration'
import { createTenantMigrationHooks } from '../../src/lib/rls/runtime/migrations'
import { parseTenantTableManifest } from '../../src/lib/rls/runtime/manifest'
import { runWithTenantBoundary } from '../../src/lib/rls/runtime/scope'

assert.equal(process.versions.node, '24.22.3')
assert.ok(process.env.OM_RLS_TEST_DATABASE_URL)
const admin = new Pool({ connectionString: process.env.OM_RLS_TEST_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 })
const directory = await mkdtemp(path.join(tmpdir(), 'om-rls-migrate-'))
const role = 'fixture_runtime'
const maintenanceRole = 'fixture_maintenance'
const password = randomUUID()
const runtimeUrl = new URL(process.env.OM_RLS_TEST_DATABASE_URL)
runtimeUrl.username = role
runtimeUrl.password = password
const maintenanceUrl = new URL(runtimeUrl)
maintenanceUrl.username = maintenanceRole
process.env.DATABASE_URL = runtimeUrl.toString()
process.env.OM_TENANT_RLS_MAINTENANCE_DATABASE_URL = maintenanceUrl.toString()
process.env.OM_MIGRATION_REINDEX = 'on'
process.env.OM_CLI_QUIET = '1'
process.env.OM_TENANT_RLS = 'off'
const manifest = parseTenantTableManifest({ version: 1, tables: [{ schema: 'public', table: 'records', owner: 'fixture', classification: 'enforced', reason: 'Disposable migration fixture', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1 }] })
const manifestPath = path.join(directory, 'manifest.json')
const configuration = { enabled: true, poolMode: 'direct', schema: 'public', manifestPath } as const
const modules = ['a_fixture', 'b_fixture']
const resolver: PackageResolver = {
  isMonorepo: () => true, getRootDir: () => directory, getAppDir: () => directory,
  getOutputDir: () => directory, getModulesConfigPath: () => directory,
  discoverPackages: () => [], loadEnabledModules: () => modules.map((id) => ({ id, from: '@app' })),
  getModulePaths: ({ id }) => ({ appBase: path.join(directory, id), pkgBase: path.join(directory, id) }),
  getModuleImportBase: ({ id }) => ({ appBase: path.join(directory, id), pkgBase: path.join(directory, id) }),
  getPackageOutputDir: () => directory, getPackageRoot: () => directory,
}
const emitted: string[] = []
let disposed = 0
let reindexContainers = 0
let reconciled = false
mock.module(import.meta.resolve('@open-mercato/shared/lib/di/container'), { namedExports: {
  createRequestContainer: async () => {
    reindexContainers += 1
    return {
      resolve: (name: string) => {
        assert.equal(name, 'eventBus')
        return { emitEvent: async (event: string, payload: Record<string, unknown>, options: unknown) => {
          assert.equal(reconciled, true, 'Protected reindex must follow successful reconciliation')
          assert.equal(event, 'query_index.reindex')
          assert.deepEqual(options, { persistent: true })
          assert.equal(payload.allowAllTenants, true)
          assert.equal(payload.force, false)
          emitted.push(String(payload.entityType))
        } }
      },
      dispose: async () => { disposed += 1 },
    }
  },
} })
const { dbMigrate } = await import('../../../cli/src/lib/db/commands')
const migrationImport = import.meta.resolve('@mikro-orm/migrations')
async function migration(module: string, stamp: string, sql: string, entity?: string) {
  const target = path.join(directory, module, 'migrations')
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, `Migration${stamp}.js`), `import { Migration } from ${JSON.stringify(migrationImport)};\nexport const queryIndexReindexEntityTypes = ${JSON.stringify(entity ? [entity] : [])};\nexport class Migration${stamp} extends Migration { async up() { this.addSql(${JSON.stringify(sql)}); } }\n`)
}
async function policy(enabled: boolean) {
  const result = await admin.query('select relrowsecurity, relforcerowsecurity from pg_class where oid = \'public.records\'::regclass')
  assert.deepEqual(result.rows, [{ relrowsecurity: enabled, relforcerowsecurity: enabled }])
}
async function history(module: string, count: number) {
  const result = await admin.query(`select count(*)::int as count from mikro_orm_migrations_${module}`)
  assert.equal(result.rows[0].count, count)
}
try {
  await admin.query('revoke temporary on database postgres from public')
  await admin.query(`create role ${role} login password '${password}' nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`create role ${maintenanceRole} login password '${password}' nosuperuser bypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`grant usage, create on schema public to ${maintenanceRole}`)
  await writeFile(manifestPath, JSON.stringify(manifest))
  await migration(modules[0], '20261113000001', `create table records (id uuid primary key, tenant_id uuid not null); grant select, insert, update, delete on records to ${role}`)
  await migration(modules[1], '20261113000002', 'create table second_fixture (id integer primary key)')
  process.env.DATABASE_URL = maintenanceUrl.toString()
  await dbMigrate(resolver)
  await policy(false)
  await history(modules[0], 1)
  await history(modules[1], 1)
  process.stdout.write('PASS activation off runs two module migrations without installing policies\n')
  process.env.DATABASE_URL = runtimeUrl.toString()
  process.env.OM_TENANT_RLS = 'on'
  const adapter = createTenantBoundaryAdapter(configuration, { ...process.env }, randomUUID())
  registerDatabaseRuntimeAdapter({ ...adapter, afterMigrate: async () => { await adapter.afterMigrate!(); reconciled = true } })
  await migration(modules[0], '20261113000003', 'alter table records add column label text', 'fixture:records')
  await migration(modules[1], '20261113000004', "do $$ begin if not exists(select 1 from second_fixture where id=1) then raise exception 'fixture later migration failure'; end if; end $$", 'fixture:second')
  await admin.query(`alter role ${role} bypassrls`)
  try {
    await assert.rejects(dbMigrate(resolver), /unsafe ownership/)
    await history(modules[0], 1)
    await history(modules[1], 1)
    assert.deepEqual(emitted, [])
    assert.equal(reindexContainers, 0)
  } finally {
    await admin.query(`alter role ${role} nobypassrls`)
  }
  process.stdout.write('PASS unsafe runtime preflight prevents all pending module migrations\n')
  await assert.rejects(dbMigrate(resolver), /fixture later migration failure/)
  await history(modules[0], 2)
  await history(modules[1], 1)
  assert.deepEqual(emitted, [])
  assert.equal(reindexContainers, 0)
  await policy(false)
  process.stdout.write('PASS later module failure preserves earlier committed history and suppresses reindex\n')
  await admin.query('insert into second_fixture values (1)')
  await admin.query('create policy unexpected_fixture_policy on records using (true)')
  await assert.rejects(dbMigrate(resolver), /refuses to overwrite an unowned table policy/)
  await history(modules[1], 2)
  assert.deepEqual(emitted, [])
  assert.equal(reindexContainers, 0)
  await policy(false)
  process.stdout.write('PASS reconciliation failure after committed migrations suppresses protected reindex\n')
  await admin.query('drop policy unexpected_fixture_policy on records')
  const lock = await admin.connect()
  let retry: Promise<void> | undefined
  try {
    await lock.query('begin')
    await lock.query("select pg_advisory_xact_lock(hashtextextended('open-mercato:tenant-rls-policy:v1', 0))")
    retry = dbMigrate(resolver)
    const deadline = Date.now() + 10000
    for (;;) {
      const waiting = await admin.query("select count(*)::int as count from pg_stat_activity where usename=$1 and wait_event='advisory'", [maintenanceRole])
      if (waiting.rows[0].count > 0) break
      assert.ok(Date.now() < deadline, 'dbMigrate completion must wait on the real reconciliation advisory lock')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.deepEqual(emitted, [])
    assert.equal(reindexContainers, 0)
    await policy(false)
  } finally {
    await lock.query('rollback')
    lock.release()
    await retry
  }
  process.stdout.write('PASS concurrent advisory lock blocks reconciliation and protected reindex until release\n')
  await policy(true)
  assert.deepEqual(emitted.sort(), ['fixture:records', 'fixture:second'])
  assert.equal(disposed, 1)
  process.stdout.write('PASS zero-pending retry reconciles and recovers both committed reindex declarations\n')
  emitted.length = 0
  reconciled = false
  await dbMigrate(resolver)
  await policy(true)
  assert.deepEqual(emitted.sort(), ['fixture:records', 'fixture:second'])
  const hooks = createTenantMigrationHooks(configuration, { ...process.env }, async () => manifest)
  await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'cli', operation: 'fixture:rollback' }, hooks.rollbackPolicies)
  await policy(false)
  reconciled = false
  await dbMigrate(resolver)
  await policy(true)
  await history(modules[0], 2)
  await history(modules[1], 2)
  process.stdout.write('PASS no-pending completion and exact rollback/re-enable preserve migration ledgers\n')
} finally {
  try {
    await admin.query('drop table if exists records, second_fixture, mikro_orm_migrations_a_fixture, mikro_orm_migrations_b_fixture cascade')
    await admin.query(`drop owned by ${role}, ${maintenanceRole}`)
    await admin.query(`drop role ${role}, ${maintenanceRole}`)
    assert.equal((await admin.query("select count(*)::int as count from pg_roles where rolname in ('fixture_runtime','fixture_maintenance')")).rows[0].count, 0)
    assert.equal((await admin.query("select count(*)::int as count from pg_tables where schemaname='public'")).rows[0].count, 0)
  } finally {
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    await assert.rejects(access(directory), { code: 'ENOENT' })
    mock.restoreAll()
  }
}
process.stdout.write('PASS production dbMigrate assertions complete; database fixtures removed\n')
