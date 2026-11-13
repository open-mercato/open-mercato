import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Pool, type PoolClient } from 'pg'
import type { BoundaryClient } from '../../src/lib/rls/runtime/pool'
import { quoteBoundaryIdentifier } from '../../src/lib/rls/runtime/config'
import { assertTenantTableInventory, parseTenantTableManifest, readTenantCatalog } from '../../src/lib/rls/runtime/manifest'
import { verifyRuntimeDatabaseRole } from '../../src/lib/rls/runtime/roles'
import { reconcileTenantTablePolicies, rollbackTenantTablePolicies, tenantPolicyName, verifyTenantTablePolicies } from '../../src/lib/rls/runtime/policies'
import { createTenantBoundaryAdapter } from '../../src/lib/rls/runtime/registration'
import { runWithTenantBoundary } from '../../src/lib/rls/runtime/scope'

const databaseUrl = process.env.OM_RLS_TEST_DATABASE_URL
assert.ok(databaseUrl, 'Set OM_RLS_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database')
const suffix = randomUUID().replaceAll('-', '')
const schema = `rls_catalog_test_${suffix}`
const role = `rls_catalog_test_${suffix}`
const maintenanceRole = `rls_maint_test_${suffix}`
const password = randomUUID()
const directory = await mkdtemp(path.join(tmpdir(), 'om-rls-catalog-test-'))
const manifestPath = path.join(directory, 'manifest.json')
const admin = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5_000, query_timeout: 15_000 })
const runtimeUrl = new URL(databaseUrl)
runtimeUrl.username = role
runtimeUrl.password = password
const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 2, connectionTimeoutMillis: 5_000, query_timeout: 15_000 })
const maintenanceUrl = new URL(runtimeUrl)
maintenanceUrl.username = maintenanceRole
const maintenance = new Pool({ connectionString: maintenanceUrl.toString(), max: 1, connectionTimeoutMillis: 5_000, query_timeout: 15_000 })
const relation = `${quoteBoundaryIdentifier(schema)}."records"`
const quoteRole = quoteBoundaryIdentifier(role)
const tenantA = randomUUID()
const tenantB = randomUUID()
const rowA = randomUUID()
const rowB = randomUUID()
const manifest = parseTenantTableManifest({ version: 1, tables: [{
  schema, table: 'records', owner: 'runtime-fixture', classification: 'enforced', reason: 'Disposable policy canary',
  tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1,
}] })
let checks = 0

function sqlClient(client: PoolClient): BoundaryClient {
  return {
    query: (...arguments_: unknown[]) => Reflect.apply(client.query, client, arguments_),
    release: client.release.bind(client),
  }
}

async function withClient<Result>(pool: Pool, callback: (client: BoundaryClient) => Promise<Result>): Promise<Result> {
  const physical = await pool.connect()
  try { return await callback(sqlClient(physical)) } finally { physical.release() }
}

async function check(name: string, callback: () => Promise<void>): Promise<void> {
  await callback()
  checks += 1
  process.stdout.write(`PASS ${name}\n`)
}

const runtimeRole = () => withClient(runtime, (client) => verifyRuntimeDatabaseRole(client, [schema]))
const verifyPolicy = () => withClient(runtime, (client) => verifyTenantTablePolicies(client, manifest))
const reconcile = () => withClient(admin, (client) => reconcileTenantTablePolicies(client, manifest, role))

try {
  await writeFile(manifestPath, JSON.stringify(manifest))
  const database = (await admin.query<{ name: string }>('select current_database() as name')).rows[0].name
  await admin.query(`revoke temporary on database ${quoteBoundaryIdentifier(database)} from public`)
  await admin.query(`create role ${quoteRole} login password '${password}' nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`create role ${quoteBoundaryIdentifier(maintenanceRole)} login password '${password}' nosuperuser bypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`create schema ${quoteBoundaryIdentifier(schema)}`)
  await admin.query(`create table ${relation} (id uuid primary key, tenant_id uuid not null, label text not null)`)
  await admin.query(`grant usage on schema ${quoteBoundaryIdentifier(schema)} to ${quoteRole}`)
  await admin.query(`grant select, insert, update, delete on ${relation} to ${quoteRole}`)

  await check('restricted login passes catalog role preflight without requiring installed policies', async () => {
    assert.equal((await runtimeRole()).current_role, role)
    await withClient(runtime, async (client) => assertTenantTableInventory(manifest, await readTenantCatalog(client), 'preflight'))
    await assert.rejects(verifyPolicy(), /enabled and forced/)
  })

  for (const [name, enable, disable] of [
    ['superuser', 'superuser', 'nosuperuser'], ['bypass', 'bypassrls', 'nobypassrls'],
    ['role creation', 'createrole', 'nocreaterole'], ['database creation', 'createdb', 'nocreatedb'],
    ['replication', 'replication', 'noreplication'],
  ]) {
    await check(`unsafe ${name} runtime role is rejected`, async () => {
      await admin.query(`alter role ${quoteRole} ${enable}`)
      try { await assert.rejects(runtimeRole(), /unsafe/) } finally { await admin.query(`alter role ${quoteRole} ${disable}`) }
    })
  }

  await check('NOINHERIT membership still blocks SET ROLE escalation', async () => {
    const parent = quoteBoundaryIdentifier(`parent_${suffix}`)
    await admin.query(`create role ${parent} nologin`)
    try {
      await admin.query(`grant ${parent} to ${quoteRole}`)
      try { await assert.rejects(runtimeRole(), /unsafe/) } finally { await admin.query(`revoke ${parent} from ${quoteRole}`) }
    } finally { await admin.query(`drop role ${parent}`) }
  })

  await check('effective database CREATE and TEMP privileges are rejected', async () => {
    for (const privilege of ['create', 'temporary']) {
      await admin.query(`grant ${privilege} on database ${quoteBoundaryIdentifier(database)} to ${quoteRole}`)
      try { await assert.rejects(runtimeRole(), /unsafe/) } finally {
        await admin.query(`revoke ${privilege} on database ${quoteBoundaryIdentifier(database)} from ${quoteRole}`)
      }
    }
  })

  await check('effective schema CREATE privileges are rejected even outside the canary schema', async () => {
    const other = quoteBoundaryIdentifier(`other_${suffix}`)
    await admin.query(`create schema ${other}`)
    try {
      await admin.query(`grant create on schema ${other} to ${quoteRole}`)
      try { await assert.rejects(runtimeRole(), /application schemas/) } finally { await admin.query(`revoke create on schema ${other} from ${quoteRole}`) }
    } finally { await admin.query(`drop schema ${other}`) }
  })

  await check('TRUNCATE and grant-option privileges are rejected', async () => {
    await admin.query(`grant truncate on ${relation} to ${quoteRole}`)
    try { await assert.rejects(runtimeRole(), /truncate or delegate/) } finally { await admin.query(`revoke truncate on ${relation} from ${quoteRole}`) }
    await admin.query(`grant select on ${relation} to ${quoteRole} with grant option`)
    try { await assert.rejects(runtimeRole(), /truncate or delegate/) } finally { await admin.query(`revoke grant option for select on ${relation} from ${quoteRole}`) }
    await admin.query(`grant select(label) on ${relation} to ${quoteRole} with grant option`)
    try { await assert.rejects(runtimeRole(), /truncate or delegate/) } finally {
      await admin.query(`revoke select(label) on ${relation} from ${quoteRole}`)
    }
  })

  await check('runtime object ownership is rejected', async () => {
    await admin.query(`alter table ${relation} owner to ${quoteRole}`)
    try { await assert.rejects(runtimeRole(), /own, truncate/) } finally {
      await admin.query(`alter table ${relation} owner to current_user`)
      await admin.query(`grant select, insert, update, delete on ${relation} to ${quoteRole}`)
    }
  })

  await check('PUBLIC-executable application SECURITY DEFINER functions are rejected', async () => {
    const name = `${quoteBoundaryIdentifier(schema)}."unsafe_function"`
    await admin.query(`create function ${name}() returns integer language sql security definer as 'select 1'`)
    try { await assert.rejects(runtimeRole(), /SECURITY DEFINER/) } finally { await admin.query(`drop function ${name}()`) }
  })

  await check('an unknown SQL tenant table blocks manifest coverage', async () => {
    const other = `${quoteBoundaryIdentifier(schema)}."unclassified"`
    await admin.query(`create table ${other}(tenant_id uuid not null)`)
    try {
      await withClient(runtime, async (client) => {
        const tables = await readTenantCatalog(client)
        assert.throws(() => assertTenantTableInventory(manifest, tables, 'preflight'), /unclassified/)
      })
    } finally { await admin.query(`drop table ${other}`) }
  })

  await check('nullable or non-UUID tenant columns cannot satisfy the reviewed canary', async () => {
    await admin.query(`alter table ${relation} alter column tenant_id drop not null`)
    try {
      await withClient(runtime, async (client) => {
        const tables = await readTenantCatalog(client)
        assert.throws(() => assertTenantTableInventory(manifest, tables, 'preflight'), /differs/)
      })
    } finally { await admin.query(`alter table ${relation} alter column tenant_id set not null`) }
    await admin.query(`alter table ${relation} alter column tenant_id type text using tenant_id::text`)
    try {
      await withClient(runtime, async (client) => {
        const tables = await readTenantCatalog(client)
        assert.throws(() => assertTenantTableInventory(manifest, tables, 'preflight'), /differs/)
      })
    } finally { await admin.query(`alter table ${relation} alter column tenant_id type uuid using tenant_id::uuid`) }
  })

  await check('inheritance cannot silently extend the enforced canary', async () => {
    const child = `${quoteBoundaryIdentifier(schema)}."inherited_records"`
    await admin.query(`create table ${child}() inherits(${relation})`)
    try {
      await withClient(runtime, async (client) => {
        const tables = await readTenantCatalog(client)
        assert.throws(() => assertTenantTableInventory(manifest, tables, 'preflight'), /inheritance|unclassified/)
      })
    } finally { await admin.query(`drop table ${child}`) }
  })

  await check('canonical policies reconcile idempotently and enforce missing/wrong-tenant SQL', async () => {
    await reconcile()
    await reconcile()
    await verifyPolicy()
    await admin.query(`insert into ${relation} values($1,$2,'A'),($3,$4,'B')`, [rowA, tenantA, rowB, tenantB])
    await withClient(runtime, async (client) => {
      assert.deepEqual((await client.query(`select label from ${relation}`) as { rows: unknown[] }).rows, [])
      await client.query("select set_config('app.current_tenant_id',$1,false)", [tenantA])
      assert.deepEqual((await client.query(`select label from ${relation}`) as { rows: unknown[] }).rows, [{ label: 'A' }])
      await assert.rejects(Promise.resolve(client.query(`insert into ${relation} values($1,$2,'wrong')`, [randomUUID(), tenantB])), /row.level security/i)
      await assert.rejects(Promise.resolve(client.query(`update ${relation} set tenant_id=$1 where id=$2`, [tenantB, rowA])), /row.level security/i)
      assert.deepEqual((await client.query(`delete from ${relation} where id=$1 returning id`, [rowB]) as { rows: unknown[] }).rows, [])
    })
  })

  await check('the registered production adapter verifies actual ORM metadata before tenant queries', async () => {
    const guarded = new Pool({ connectionString: runtimeUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 })
    const adapter = createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema, manifestPath }, {}, suffix)
    const lifecycle = adapter.configurePool(guarded, {
      id: 'primary', purpose: 'runtime', tables: 'primary',
      metadata: () => [{ schema, table: 'records', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false }],
    })
    try {
      await lifecycle.ready()
      assert.deepEqual((await guarded.query(`select label from ${relation}`)).rows, [])
      await runWithTenantBoundary({ kind: 'tenant', tenantId: tenantA, source: 'api' }, async () => {
        assert.deepEqual((await guarded.query(`select label from ${relation}`)).rows, [{ label: 'A' }])
      })
    } finally { await guarded.end(); lifecycle.dispose() }
  })

  await check('production readiness refuses unsafe roles and incomplete installed policies', async () => {
    for (const failure of ['role', 'policy']) {
      if (failure === 'role') await admin.query(`alter role ${quoteRole} createrole`)
      else await admin.query(`alter table ${relation} no force row level security`)
      const guarded = new Pool({ connectionString: runtimeUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 })
      const adapter = createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema, manifestPath }, {}, `${suffix}-${failure}`)
      const lifecycle = adapter.configurePool(guarded, { id: 'fixture', purpose: 'runtime', tables: [`${schema}.records`] })
      try {
        await assert.rejects(lifecycle.ready(), failure === 'role' ? /unsafe/ : /enabled and forced/)
        await assert.rejects(guarded.query(`select label from ${relation}`), failure === 'role' ? /unsafe/ : /enabled and forced/)
      } finally {
        await guarded.end()
        lifecycle.dispose()
        if (failure === 'role') await admin.query(`alter role ${quoteRole} nocreaterole`)
        else await reconcile()
      }
    }
  })

  await check('unknown widening policies block startup and reconciliation without being overwritten', async () => {
    await admin.query(`create policy unexpected_widening on ${relation} using(true) with check(true)`)
    try {
      await assert.rejects(verifyPolicy(), /additional policies/)
      await assert.rejects(reconcile(), /unowned/)
      assert.equal((await admin.query('select count(*)::integer as count from pg_policy where polname=$1 and polrelid=$2::regclass', ['unexpected_widening', relation])).rows[0].count, 1)
    } finally { await admin.query(`drop policy unexpected_widening on ${relation}`) }
    await verifyPolicy()
  })

  await check('owned policy drift and missing FORCE fail runtime validation and can be repaired', async () => {
    await admin.query(`alter policy ${quoteBoundaryIdentifier(tenantPolicyName)} on ${relation} using(true) with check(true)`)
    await assert.rejects(verifyPolicy(), /canonical/)
    await reconcile()
    await admin.query(`alter table ${relation} no force row level security`)
    await assert.rejects(verifyPolicy(), /enabled and forced/)
    await reconcile()
    await verifyPolicy()
  })

  await check('accessible owner-rights views are rejected transitively', async () => {
    const first = `${quoteBoundaryIdentifier(schema)}."first_view"`
    const second = `${quoteBoundaryIdentifier(schema)}."second_view"`
    await admin.query(`create view ${first} as select * from ${relation}`)
    await admin.query(`create view ${second} as select * from ${first}`)
    await admin.query(`grant select on ${second} to ${quoteRole}`)
    try { await assert.rejects(verifyPolicy(), /dependent view/) } finally { await admin.query(`drop view ${first} cascade`) }
  })

  await check('maintenance role is verified separately and never lends its bypass pool to tenant work', async () => {
    const adapter = createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema, manifestPath }, {
      DATABASE_URL: runtimeUrl.toString(), OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: maintenanceUrl.toString(),
    }, `${suffix}-maintenance`)
    await admin.query(`grant usage on schema ${quoteBoundaryIdentifier(schema)} to ${quoteBoundaryIdentifier(maintenanceRole)}`)
    await admin.query(`grant select on ${relation} to ${quoteBoundaryIdentifier(maintenanceRole)}`)
    const guarded = maintenance as unknown as import('../../src/lib/rls/runtime/pool').BoundaryPool
    const lifecycle = adapter.configurePool(guarded, { id: 'maintenance-regression', purpose: 'maintenance', tables: 'primary' })
    try {
      await lifecycle.ready()
      await assert.rejects(guarded.connect(), /explicit maintenance/)
      await runWithTenantBoundary({ kind: 'maintenance', source: 'cli', tenantId: null, operation: 'regression' }, async () => {
        const client = await guarded.connect()
        try {
          const result = await client.query(`select id from ${relation}`) as { rows: { id: string }[] }
          assert.deepEqual(result.rows.map((row) => row.id).sort(), [rowA, rowB].sort())
          await runWithTenantBoundary({ kind: 'tenant', source: 'worker', tenantId: tenantA }, async () => {
            await assert.rejects(guarded.connect(), /explicit maintenance/)
            await assert.rejects(Promise.resolve(client.query(`select id from ${relation}`)), /explicit maintenance/)
          })
        } finally { client.release() }
      })
    } finally {
      await maintenance.end()
      lifecycle.dispose()
    }
  })

  await check('concurrent reconcilers serialize through a bounded advisory transaction lock', async () => {
    const results = await Promise.allSettled([reconcile(), reconcile()])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    await verifyPolicy()
  })

  await check('exact-version rollback and no-pending re-enable preserve the canary boundary lifecycle', async () => {
    await withClient(admin, (client) => rollbackTenantTablePolicies(client, manifest, role))
    await assert.rejects(verifyPolicy(), /enabled and forced/)
    await reconcile()
    await verifyPolicy()
    await admin.query(`alter policy ${quoteBoundaryIdentifier(tenantPolicyName)} on ${relation} using(true)`)
    await assert.rejects(withClient(admin, (client) => rollbackTenantTablePolicies(client, manifest, role)), /canonical/)
    await reconcile()
  })
} finally {
  await runtime.end()
  if (!maintenance.ended) await maintenance.end()
  try {
    await admin.query(`drop schema if exists ${quoteBoundaryIdentifier(schema)} cascade`)
    await admin.query(`drop role if exists ${quoteRole}`)
    await admin.query(`drop role if exists ${quoteBoundaryIdentifier(maintenanceRole)}`)
    const remaining = await admin.query('select exists(select 1 from pg_namespace where nspname=$1) as schema_exists, exists(select 1 from pg_roles where rolname=$2) as role_exists, exists(select 1 from pg_roles where rolname=$3) as maintenance_role_exists', [schema, role, maintenanceRole])
    assert.deepEqual(remaining.rows, [{ schema_exists: false, role_exists: false, maintenance_role_exists: false }])
  } finally { await admin.end(); await rm(directory, { recursive: true, force: true }) }
}
process.stdout.write(`Enterprise RLS catalog regression: ${checks} checks passed; disposable fixtures removed.\n`)
