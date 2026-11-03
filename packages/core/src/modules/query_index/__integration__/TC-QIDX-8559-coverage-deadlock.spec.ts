import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { expect, test } from '@playwright/test'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'
import { applyCoverageAdjustments, refreshCoverageSnapshot, writeCoverageCounts } from '../lib/coverage'

async function withFixture(run: (db: Kysely<Record<string, Record<string, unknown>>>, schema: string) => Promise<void>) {
  const schema = `qidx_8559_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: resolveIntegrationDatabaseUrl() })
  let db: Kysely<Record<string, Record<string, unknown>>> | undefined
  try {
    await admin.query(`create schema ${schema}`)
    const pool = new Pool({
      connectionString: resolveIntegrationDatabaseUrl(),
      options: `-c search_path=${schema},public -c statement_timeout=5000`,
      max: 8,
    })
    db = new Kysely({ dialect: new PostgresDialect({ pool }) })
    await sql.raw(`
      create table ${schema}.entity_index_coverage (like public.entity_index_coverage including all);
      create table ${schema}.tenants (id uuid primary key);
      create table ${schema}.organizations (id uuid primary key, tenant_id uuid references ${schema}.tenants);
      create table ${schema}.coverage_fixture (id uuid primary key, tenant_id uuid references ${schema}.tenants,
        organization_id uuid references ${schema}.organizations, deleted_at timestamptz);
      create table ${schema}.entity_indexes (record_id uuid, entity_type text, tenant_id uuid,
        organization_id uuid, deleted_at timestamptz);
    `).execute(db)
    await run(db, schema)
  } finally {
    await db?.destroy()
    await admin.query(`drop schema if exists ${schema} cascade`)
    const remaining = await admin.query('select 1 from pg_namespace where nspname = $1', [schema])
    await admin.end()
    expect(remaining.rows).toHaveLength(0)
  }
}

function emFor(db: object, schema?: string): EntityManager {
  return {
    getKysely: () => db,
    getMetadata: () => ({ getAll: () => [{ className: 'CoverageFixture', tableName: 'coverage_fixture', schema }] }),
  } as unknown as EntityManager
}

const entityType = 'query_index:coverage_fixture'
const organizationId = '00000000-0000-0000-0000-000000000000'
const globalScope = { entityType, tenantId: null, organizationId: null }

test('TC-QIDX-8559: real delta and snapshot writers cannot acquire opposing duplicate-row locks', async () => {
  await withFixture(async (db, schema) => {
    const firstId = randomUUID()
    const secondId = randomUUID()
    await sql`insert into entity_index_coverage (id, entity_type, organization_id, base_count, refreshed_at)
      values (${firstId}::uuid, ${entityType}, ${organizationId}::uuid, 1, now()),
             (${secondId}::uuid, ${entityType}, ${organizationId}::uuid, 1, now())`.execute(db)
    await sql`update entity_index_coverage set base_count = 2 where id = ${firstId}::uuid`.execute(db)
    await sql.raw(`
      create function ${schema}.gate_coverage() returns trigger language plpgsql as $body$
      begin
        if TG_OP = 'UPDATE' and OLD.id = '${firstId}'::uuid then
          perform pg_advisory_xact_lock(hashtextextended('${schema}_update', 0));
        elsif TG_OP = 'DELETE' and OLD.id = '${secondId}'::uuid then
          perform pg_advisory_xact_lock(hashtextextended('${schema}_delete', 0));
        end if;
        if TG_OP = 'DELETE' then return OLD; end if;
        return NEW;
      end $body$;
      create trigger gate_coverage before update or delete on ${schema}.entity_index_coverage
        for each row execute function ${schema}.gate_coverage();
    `).execute(db)
    await db.connection().execute(async (controller) => {
      const controllerPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(controller)).rows[0]!.pid
      await sql`select pg_advisory_lock(hashtextextended(${`${schema}_update`}, 0)),
        pg_advisory_lock(hashtextextended(${`${schema}_delete`}, 0))`.execute(controller)
      let deltaPid = 0
      let snapshotPid = 0
      const blockers = async (pid: number) => (await sql<{ blockers: number[] }>`select pg_blocking_pids(${pid}) as blockers`
        .execute(controller)).rows[0]!.blockers
      const delta = db.transaction().execute(async (trx) => {
        await sql`set local enable_seqscan = off`.execute(trx)
        await sql`set local enable_bitmapscan = off`.execute(trx)
        const order = await sql<{ id: string }>`select id from entity_index_coverage
          where entity_type = ${entityType} and tenant_id is null and with_deleted = false
          and (organization_id is null or organization_id = ${organizationId}::uuid)`.execute(trx)
        expect(order.rows.map((row) => row.id)).toEqual([firstId, secondId])
        deltaPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx)).rows[0]!.pid
        await applyCoverageAdjustments(emFor(trx), [{ ...globalScope, deltaBase: 1, deltaIndex: 1 }])
      })
      const deltaSettled = Promise.allSettled([delta])
      let snapshotSettled: Promise<PromiseSettledResult<void>[]> | undefined
      let coordinated = false
      try {
        await expect.poll(async () => deltaPid > 0 && (await blockers(deltaPid)).includes(controllerPid), { timeout: 5000 }).toBe(true)
        const snapshot = db.connection().execute(async (connection) => {
          await sql`set enable_indexscan = off`.execute(connection)
          await sql`set enable_bitmapscan = off`.execute(connection)
          try {
            const order = await sql<{ id: string }>`select id from entity_index_coverage
              where entity_type = ${entityType}`.execute(connection)
            expect(order.rows.map((row) => row.id)).toEqual([secondId, firstId])
            snapshotPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection)).rows[0]!.pid
            await writeCoverageCounts(emFor(connection), globalScope, { baseCount: 20, indexedCount: 18, vectorCount: 16 })
          } finally {
            await sql`reset enable_indexscan`.execute(connection)
            await sql`reset enable_bitmapscan`.execute(connection)
          }
        })
        snapshotSettled = Promise.allSettled([snapshot])
        await expect.poll(async () => snapshotPid > 0 && (await blockers(snapshotPid)).length > 0, { timeout: 5000 }).toBe(true)
        coordinated = (await blockers(snapshotPid)).includes(deltaPid)
        await sql`select pg_advisory_unlock(hashtextextended(${`${schema}_update`}, 0))`.execute(controller)
        if (!coordinated) {
          await expect.poll(async () => (await blockers(deltaPid)).includes(snapshotPid), { timeout: 5000 }).toBe(true)
        }
      } finally {
        await sql`select pg_advisory_unlock(hashtextextended(${`${schema}_update`}, 0)),
          pg_advisory_unlock(hashtextextended(${`${schema}_delete`}, 0))`.execute(controller)
        const results = [...await deltaSettled, ...await (snapshotSettled ?? Promise.resolve([]))]
        expect(results.filter((result) => result.status === 'rejected')).toEqual([])
      }
      expect(coordinated).toBe(true)
    })
    const rows = await sql<{ base_count: number; indexed_count: number; vector_indexed_count: number }>`
      select base_count, indexed_count, vector_indexed_count from entity_index_coverage`.execute(db)
    expect(rows.rows).toEqual([{ base_count: 20, indexed_count: 18, vector_indexed_count: 16 }])
  })
})

test('TC-QIDX-8559: snapshot and delta writers coordinate before tuple locks and retain exact scoped counts', async () => {
  await withFixture(async (db, schema) => {
    const tenantId = randomUUID()
    const otherTenantId = randomUUID()
    const scopedOrgId = randomUUID()
    await sql`insert into tenants values (${tenantId}::uuid), (${otherTenantId}::uuid)`.execute(db)
    await sql`insert into organizations values (${scopedOrgId}::uuid, ${tenantId}::uuid)`.execute(db)
    await sql`insert into coverage_fixture values
      (gen_random_uuid(), ${tenantId}::uuid, ${scopedOrgId}::uuid, null),
      (gen_random_uuid(), ${otherTenantId}::uuid, null, null),
      (gen_random_uuid(), ${tenantId}::uuid, ${scopedOrgId}::uuid, now())`.execute(db)
    await sql`insert into entity_indexes select id, ${entityType}, tenant_id, organization_id, deleted_at
      from coverage_fixture`.execute(db)
    await sql`insert into entity_index_coverage (entity_type, organization_id, base_count, refreshed_at)
      values (${entityType}, ${organizationId}::uuid, 99, now()),
             (${entityType}, ${organizationId}::uuid, 98, now()),
             (${entityType}, null, 97, now())`.execute(db)
    const em = emFor(db, schema)
    const scoped = { entityType, tenantId, organizationId: scopedOrgId }
    const refresh = (scope = globalScope) => refreshCoverageSnapshot(em, scope)
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(Array.from({ length: 5 }, () => refresh()))
      const rows = await sql<{ base_count: number; indexed_count: number }>`select base_count, indexed_count
        from entity_index_coverage where tenant_id is null`.execute(db)
      expect(rows.rows).toEqual([{ base_count: 2, indexed_count: 2 }])
    }
    await refreshCoverageSnapshot(em, { ...globalScope, withDeleted: true })
    await refreshCoverageSnapshot(em, scoped)
    let release!: () => void
    let ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const locked = new Promise<void>((resolve) => { ready = resolve })
    let holderPid = 0
    const holder = db.transaction().execute(async (trx) => {
      holderPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx)).rows[0]!.pid
      await writeCoverageCounts(emFor(trx), globalScope, { vectorCount: 7 })
      ready()
      await gate
    })
    const holderSettled = Promise.allSettled([holder])
    let pending: Promise<PromiseSettledResult<void>[]> = Promise.resolve([])
    try {
      await Promise.race([locked, holder])
      const snapshot = writeCoverageCounts(em, globalScope, {})
      const delta = applyCoverageAdjustments(em, [{ ...globalScope, deltaBase: 1, deltaIndex: 1 }])
      pending = Promise.allSettled([snapshot, delta])
      await expect.poll(async () => {
        const waiting = await sql<{ count: number }>`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event = 'advisory'
          and ${holderPid} = any(pg_blocking_pids(pid))`.execute(db)
        return waiting.rows[0]?.count
      }, { timeout: 5000 }).toBe(2)
      await writeCoverageCounts(em, scoped, { vectorCount: 11 })
    } finally {
      release()
      expect((await holderSettled).map((result) => result.status)).toEqual(['fulfilled'])
      await pending
    }
    expect((await pending).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    const rows = await sql<{ tenant_id: string | null; with_deleted: boolean; base_count: number;
      indexed_count: number; vector_indexed_count: number }>`select tenant_id, with_deleted, base_count,
        indexed_count, vector_indexed_count from entity_index_coverage order by tenant_id nulls first, with_deleted`.execute(db)
    expect(rows.rows).toEqual([
      { tenant_id: null, with_deleted: false, base_count: 3, indexed_count: 3, vector_indexed_count: 7 },
      { tenant_id: null, with_deleted: true, base_count: 3, indexed_count: 3, vector_indexed_count: 0 },
      { tenant_id: tenantId, with_deleted: false, base_count: 1, indexed_count: 1, vector_indexed_count: 11 },
    ])
  })
})
