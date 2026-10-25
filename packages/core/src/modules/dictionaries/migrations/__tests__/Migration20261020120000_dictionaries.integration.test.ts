import { jest } from '@jest/globals'
import type { Migration } from '@mikro-orm/migrations'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20251030150038 } from '../Migration20251030150038'
import { Migration20260602202147_dictionaries } from '../Migration20260602202147_dictionaries'
import { Migration20261020120000_dictionaries } from '../Migration20261020120000_dictionaries'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'dictionaries_migration_test'
const DATABASE_USER = 'dictionaries_migration'
const DATABASE_PASSWORD = 'dictionaries_migration'
const CONSTRAINT_NAME = 'dictionaries_scope_key_unique'
const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

type MigrationClass = { prototype: Migration }
type Direction = 'up' | 'down'
type ScopeKeyConstraint = { contype: string; columns: string[] }
type DictionaryRow = { organizationId?: string; key: string; name?: string; deleted?: boolean }

async function collectSql(migrationClass: MigrationClass, direction: Direction): Promise<string[]> {
  const migration = Object.create(migrationClass.prototype) as Migration
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => {
      statements.push(sql)
    },
  })
  await migration[direction]()
  return statements
}

async function applyMigration(client: Client, migrationClass: MigrationClass, direction: Direction): Promise<void> {
  const statements = await collectSql(migrationClass, direction)
  await client.query('begin')
  try {
    for (const statement of statements) await client.query(statement)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function insertDictionary(client: Client, row: DictionaryRow): Promise<void> {
  await client.query(
    `insert into "dictionaries" ("organization_id", "tenant_id", "key", "name", "created_at", "updated_at", "deleted_at")
     values ($1, $2, $3, $4, now(), now(), case when $5::boolean then now() end)`,
    [row.organizationId ?? ORG_A, TENANT, row.key, row.name ?? row.key, row.deleted === true],
  )
}

async function readScopeKeyConstraint(client: Client): Promise<ScopeKeyConstraint | null> {
  const result = await client.query<ScopeKeyConstraint>(
    `select "constraint".contype::text as contype,
            array_agg("attribute".attname::text order by "column".ordinality) as columns
       from pg_constraint as "constraint"
       cross join lateral unnest("constraint".conkey) with ordinality as "column"(attnum, ordinality)
       join pg_attribute as "attribute"
         on "attribute".attrelid = "constraint".conrelid and "attribute".attnum = "column".attnum
      where "constraint".conname = $1 and "constraint".conrelid = '"dictionaries"'::regclass
      group by "constraint".contype`,
    [CONSTRAINT_NAME],
  )
  return result.rows[0] ?? null
}

async function readKeyReservedGeneration(client: Client): Promise<string | null> {
  const result = await client.query<{ attgenerated: string }>(
    `select attgenerated::text as attgenerated
       from pg_attribute
      where attrelid = '"dictionaries"'::regclass and attname = 'key_reserved' and not attisdropped`,
  )
  return result.rows[0]?.attgenerated ?? null
}

async function countDictionaries(client: Client): Promise<number> {
  const result = await client.query<{ total: number }>('select count(*)::int as total from "dictionaries"')
  return result.rows[0].total
}

describeWithPostgres('Migration20261020120000_dictionaries against real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let client: Client | null = null

  function db(): Client {
    if (!client) throw new Error('[internal] PostgreSQL client is not connected')
    return client
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
    })
    await client.connect()
  }, 180_000)

  afterAll(async () => {
    await Promise.allSettled([client?.end()])
    await Promise.allSettled([postgres?.stop()])
  })

  beforeEach(async () => {
    await db().query('drop table if exists "dictionary_entries", "dictionaries" cascade')
    await applyMigration(db(), Migration20251030150038, 'up')
    await applyMigration(db(), Migration20260602202147_dictionaries, 'up')
  })

  jest.setTimeout(60_000)

  test('starts from the original constraint, which keeps a deleted dictionary holding its key', async () => {
    await expect(readScopeKeyConstraint(db())).resolves.toEqual({
      contype: 'u',
      columns: ['organization_id', 'tenant_id', 'key'],
    })
    await insertDictionary(db(), { key: 'sizes', deleted: true })
    await expect(insertDictionary(db(), { key: 'sizes' })).rejects.toMatchObject({
      code: '23505',
      constraint: CONSTRAINT_NAME,
    })
  })

  test('up keeps the constraint name as a unique constraint that only live dictionaries hold', async () => {
    await insertDictionary(db(), { key: 'colors' })
    await insertDictionary(db(), { key: 'sizes', deleted: true })

    await applyMigration(db(), Migration20261020120000_dictionaries, 'up')

    await expect(readScopeKeyConstraint(db())).resolves.toEqual({
      contype: 'u',
      columns: ['organization_id', 'tenant_id', 'key', 'key_reserved'],
    })
    await expect(readKeyReservedGeneration(db())).resolves.toBe('s')

    await insertDictionary(db(), { key: 'sizes' })
    await insertDictionary(db(), { key: 'sizes', deleted: true })
    await insertDictionary(db(), { key: 'colors', organizationId: ORG_B })
    await expect(insertDictionary(db(), { key: 'sizes' })).rejects.toMatchObject({
      code: '23505',
      constraint: CONSTRAINT_NAME,
    })
    await expect(insertDictionary(db(), { key: 'colors' })).rejects.toMatchObject({
      code: '23505',
      constraint: CONSTRAINT_NAME,
    })

    await db().query(`update "dictionaries" set "deleted_at" = now() where "key" = 'colors' and "organization_id" = $1`, [ORG_A])
    await insertDictionary(db(), { key: 'colors' })

    const live = await db().query(
      `select "key", "organization_id" from "dictionaries" where "deleted_at" is null order by "organization_id", "key"`,
    )
    expect(live.rows).toEqual([
      { key: 'colors', organization_id: ORG_A },
      { key: 'sizes', organization_id: ORG_A },
      { key: 'colors', organization_id: ORG_B },
    ])
  })

  test('up keeps ON CONFLICT ON CONSTRAINT targeting the live dictionary', async () => {
    await insertDictionary(db(), { key: 'colors', name: 'Colors' })
    await insertDictionary(db(), { key: 'sizes', name: 'Old sizes', deleted: true })
    await applyMigration(db(), Migration20261020120000_dictionaries, 'up')

    const upsert = `insert into "dictionaries" ("organization_id", "tenant_id", "key", "name", "created_at", "updated_at")
      values ($1, $2, $3, $4, now(), now())
      on conflict on constraint "${CONSTRAINT_NAME}" do update set "name" = excluded."name"`
    await db().query(upsert, [ORG_A, TENANT, 'colors', 'Colours'])
    await db().query(upsert, [ORG_A, TENANT, 'sizes', 'Sizes'])
    await db().query(
      `insert into "dictionaries" ("organization_id", "tenant_id", "key", "name", "created_at", "updated_at")
       values ($1, $2, 'colors', 'Ignored', now(), now())
       on conflict on constraint "${CONSTRAINT_NAME}" do nothing`,
      [ORG_A, TENANT],
    )

    const rows = await db().query(
      `select "key", "name", "deleted_at" is not null as deleted from "dictionaries" order by "key", "name"`,
    )
    expect(rows.rows).toEqual([
      { key: 'colors', name: 'Colours', deleted: false },
      { key: 'sizes', name: 'Old sizes', deleted: true },
      { key: 'sizes', name: 'Sizes', deleted: false },
    ])
  })

  test('down restores the original constraint when no two dictionaries share a key', async () => {
    await applyMigration(db(), Migration20261020120000_dictionaries, 'up')
    await insertDictionary(db(), { key: 'colors' })
    await insertDictionary(db(), { key: 'sizes', deleted: true })
    await insertDictionary(db(), { key: 'colors', organizationId: ORG_B })

    await applyMigration(db(), Migration20261020120000_dictionaries, 'down')

    await expect(readScopeKeyConstraint(db())).resolves.toEqual({
      contype: 'u',
      columns: ['organization_id', 'tenant_id', 'key'],
    })
    await expect(readKeyReservedGeneration(db())).resolves.toBeNull()
    await expect(countDictionaries(db())).resolves.toBe(3)
  })

  test('down fails and leaves the up state intact while a deleted and a live dictionary share a key', async () => {
    await applyMigration(db(), Migration20261020120000_dictionaries, 'up')
    await insertDictionary(db(), { key: 'sizes', deleted: true })
    await insertDictionary(db(), { key: 'sizes' })

    await expect(applyMigration(db(), Migration20261020120000_dictionaries, 'down')).rejects.toMatchObject({
      code: '23505',
    })

    await expect(readScopeKeyConstraint(db())).resolves.toEqual({
      contype: 'u',
      columns: ['organization_id', 'tenant_id', 'key', 'key_reserved'],
    })
    await expect(readKeyReservedGeneration(db())).resolves.toBe('s')
    await expect(countDictionaries(db())).resolves.toBe(2)
    await expect(insertDictionary(db(), { key: 'sizes' })).rejects.toMatchObject({
      code: '23505',
      constraint: CONSTRAINT_NAME,
    })
  })
})
