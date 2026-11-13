import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20260828120000_auth } from '../Migration20260828120000_auth'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type AclRow = { id: string; deleted_at: Date | null; features: string[] }

describeWithPostgres('ACL live-row migration against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  let schema: string

  function database(): Client {
    if (!client) throw new Error('[internal] ACL migration test database is not connected')
    return client
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    const migration = Object.create(Migration20260828120000_auth.prototype) as Migration20260828120000_auth
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    await migration[direction]()
    await database().query('begin')
    try {
      for (const statement of statements) await database().query(statement)
      await database().query('commit')
    } catch (error) {
      await database().query('rollback')
      throw error
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'acl_migration_test', POSTGRES_USER: 'acl_test', POSTGRES_PASSWORD: 'acl_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'acl_migration_test',
      user: 'acl_test',
      password: 'acl_test',
    })
    await client.connect()
  }, 120_000)

  beforeEach(async () => {
    schema = `acl_migration_${randomUUID().replaceAll('-', '')}`
    await database().query(`create schema "${schema}"`)
    await database().query(`set search_path to "${schema}"`)
    for (const [table, principal] of [['user_acls', 'user_id'], ['role_acls', 'role_id']]) {
      await database().query(`create table ${table} (
        id uuid primary key, ${principal} uuid not null, tenant_id uuid not null,
        created_at timestamptz not null, updated_at timestamptz,
        deleted_at timestamptz, features jsonb not null
      )`)
    }
  })

  afterEach(async () => {
    await database().query('set search_path to public')
    await database().query(`drop schema if exists "${schema}" cascade`)
  })

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it.each([
    ['user_acls', 'user_id', 'user_acls_active_unique_idx'],
    ['role_acls', 'role_id', 'role_acls_active_unique_idx'],
  ])('%s preserves deterministic winners and history through up/down', async (table, principalColumn, indexName) => {
    const tenant = randomUUID()
    const otherTenant = randomUUID()
    const principals = Array.from({ length: 4 }, () => randomUUID())
    const createdEarly = '2026-01-01T00:00:00.000Z'
    const createdLate = '2026-01-02T00:00:00.000Z'
    const updated = '2026-01-03T00:00:00.000Z'
    const revokedAt = '2026-01-04T00:00:00.000Z'
    const ids = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
    const historyId = randomUUID()
    const foreignTenantId = randomUUID()

    async function insert(id: string, principal: string, scopeTenant: string, createdAt: string, updatedAt: string | null, deletedAt: string | null): Promise<void> {
      await database().query(
        `insert into ${table} (id, ${principalColumn}, tenant_id, created_at, updated_at, deleted_at, features)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [id, principal, scopeTenant, createdAt, updatedAt, deletedAt, JSON.stringify([`fixture.${id}`])],
      )
    }

    await insert(ids[0], principals[0], tenant, createdLate, null, null)
    await insert(ids[1], principals[0], tenant, createdEarly, updated, null)
    await insert(ids[2], principals[1], tenant, createdEarly, null, null)
    await insert(ids[3], principals[1], tenant, createdLate, null, null)
    await insert(ids[4], principals[2], tenant, createdEarly, updated, null)
    await insert(ids[5], principals[2], tenant, createdLate, updated, null)
    await insert(ids[6], principals[3], tenant, createdEarly, updated, null)
    await insert(ids[7], principals[3], tenant, createdEarly, updated, null)
    await insert(historyId, principals[0], tenant, revokedAt, revokedAt, revokedAt)
    await insert(foreignTenantId, principals[0], otherTenant, createdEarly, null, null)

    await migrate('up')
    const rows = (await database().query<AclRow>(`select id, deleted_at, features from ${table} order by id`)).rows
    expect(rows).toHaveLength(10)
    expect(rows.filter((row) => row.deleted_at === null).map((row) => row.id).sort())
      .toEqual([ids[1], ids[3], ids[5], ids[7], foreignTenantId].sort())
    for (const loser of [ids[0], ids[2], ids[4], ids[6]]) {
      expect(rows.find((row) => row.id === loser)?.deleted_at).toBeInstanceOf(Date)
    }
    expect(rows.find((row) => row.id === historyId)?.deleted_at?.toISOString()).toBe(revokedAt)
    for (const row of rows) expect(row.features).toEqual([`fixture.${row.id}`])

    const index = await database().query<{ indexdef: string }>(
      'select indexdef from pg_indexes where schemaname = $1 and indexname = $2', [schema, indexName],
    )
    expect(index.rows).toHaveLength(1)
    expect(index.rows[0].indexdef).toContain('UNIQUE INDEX')
    expect(index.rows[0].indexdef).toContain('WHERE (deleted_at IS NULL)')
    await expect(insert(randomUUID(), principals[0], tenant, createdLate, updated, null))
      .rejects.toMatchObject({ code: '23505', constraint: indexName })
    await insert(randomUUID(), principals[0], tenant, createdLate, updated, revokedAt)
    await insert(randomUUID(), principals[0], randomUUID(), createdLate, updated, null)

    const beforeRepeat = (await database().query<AclRow>(`select id, deleted_at, features from ${table} order by id`)).rows
    await migrate('up')
    expect((await database().query<AclRow>(`select id, deleted_at, features from ${table} order by id`)).rows).toEqual(beforeRepeat)
    await migrate('down')
    expect((await database().query<AclRow>(`select id, deleted_at, features from ${table} order by id`)).rows).toEqual(beforeRepeat)
    expect((await database().query(
      'select indexname from pg_indexes where schemaname = $1 and indexname in ($2, $3)',
      [schema, 'user_acls_active_unique_idx', 'role_acls_active_unique_idx'],
    )).rows).toHaveLength(0)
    await expect(insert(randomUUID(), principals[0], tenant, createdLate, updated, null)).resolves.toBeUndefined()
  })
})
