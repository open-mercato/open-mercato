import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261119120000_sales_quotes_external_reference_idx } from '../Migration20261119120000_sales_quotes_external_reference_idx'
import { Migration20261119120100_sales_orders_external_reference_idx } from '../Migration20261119120100_sales_orders_external_reference_idx'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type MigrationClass =
  | typeof Migration20261119120000_sales_quotes_external_reference_idx
  | typeof Migration20261119120100_sales_orders_external_reference_idx

const CASES: Array<{ table: string; indexName: string; migration: MigrationClass }> = [
  {
    table: 'sales_quotes',
    indexName: 'sales_quotes_external_reference_hash_idx',
    migration: Migration20261119120000_sales_quotes_external_reference_idx,
  },
  {
    table: 'sales_orders',
    indexName: 'sales_orders_external_reference_hash_idx',
    migration: Migration20261119120100_sales_orders_external_reference_idx,
  },
]

function incompressibleReference(bytes: number): string {
  return randomBytes(bytes).toString('base64')
}

/**
 * Upgrade/rollback boundary of the SA1 external-reference indexes against a real
 * PostgreSQL, on tables that already hold references the create schema's 191-character
 * limit never applied to (the document update path accepts any length):
 * - a B-tree over the full text cannot be built over such a row (control);
 * - `up` builds the hash index over both short checkout references and long historical
 *   ones, and both stay readable by equality and writable afterwards;
 * - `down` drops it, and `up` reapplies cleanly, including a retry over an existing index.
 */
describeWithPostgres('SA1 external-reference index migrations against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  let schema: string

  function database(): Client {
    if (!client) throw new Error('[internal] external-reference migration test database is not connected')
    return client
  }

  async function migrate(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<void> {
    const migration = Object.create(migrationClass.prototype) as InstanceType<MigrationClass>
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    expect(migration.isTransactional()).toBe(false)
    await migration[direction]()
    for (const statement of statements) await database().query(statement)
  }

  async function indexState(indexName: string): Promise<{ method: string; valid: boolean } | undefined> {
    const result = await database().query<{ method: string; valid: boolean }>(
      `select am.amname as method, i.indisvalid as valid
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_index i on i.indexrelid = c.oid
       join pg_am am on am.oid = c.relam
       where n.nspname = $1 and c.relname = $2`,
      [schema, indexName],
    )
    return result.rows[0]
  }

  async function insertDocument(table: string, tenantId: string, externalReference: string | null): Promise<string> {
    const id = randomUUID()
    await database().query(
      `insert into "${table}" (id, tenant_id, external_reference) values ($1, $2, $3)`,
      [id, tenantId, externalReference],
    )
    return id
  }

  async function findIds(table: string, tenantId: string, externalReference: string): Promise<string[]> {
    const result = await database().query<{ id: string }>(
      `select id from "${table}" where tenant_id = $1 and external_reference = $2 order by id`,
      [tenantId, externalReference],
    )
    return result.rows.map((row) => row.id)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'sales_ext_ref_test', POSTGRES_USER: 'sales_ext_ref', POSTGRES_PASSWORD: 'sales_ext_ref' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'sales_ext_ref_test',
      user: 'sales_ext_ref',
      password: 'sales_ext_ref',
    })
    await client.connect()
  }, 120_000)

  beforeEach(async () => {
    schema = `sales_ext_ref_${randomUUID().replaceAll('-', '')}`
    await database().query(`create schema "${schema}"`)
    await database().query(`set search_path to "${schema}"`)
    for (const { table } of CASES) {
      await database().query(`create table "${table}" (
        id uuid primary key,
        tenant_id uuid not null,
        external_reference text null
      )`)
    }
  })

  afterEach(async () => {
    await database().query('set search_path to public')
    await database().query(`drop schema if exists "${schema}" cascade`)
  })

  afterAll(async () => {
    await client?.end()
    await postgres?.stop()
  })

  it.each(CASES)('$table: a full-text B-tree cannot index a long historical reference (control)', async ({ table }) => {
    await insertDocument(table, randomUUID(), incompressibleReference(6000))
    await expect(
      database().query(`create index "${table}_btree_control" on "${table}" ("tenant_id", "external_reference")`),
    ).rejects.toThrow(/index row size|exceeds/i)
  })

  it.each(CASES)('$table: up, down and reapply over short and long references', async ({ table, indexName, migration }) => {
    const tenantId = randomUUID()
    const otherTenantId = randomUUID()
    const checkoutReference = `checkout:${randomUUID()}:1`
    const longReference = incompressibleReference(6000)
    const checkoutId = await insertDocument(table, tenantId, checkoutReference)
    const longId = await insertDocument(table, tenantId, longReference)
    const otherTenantDocumentId = await insertDocument(table, otherTenantId, checkoutReference)
    await insertDocument(table, tenantId, null)

    await migrate(migration, 'up')
    expect(await indexState(indexName)).toEqual({ method: 'hash', valid: true })
    expect(await findIds(table, tenantId, checkoutReference)).toEqual([checkoutId])
    expect(await findIds(table, otherTenantId, checkoutReference)).toEqual([otherTenantDocumentId])
    expect(await findIds(table, tenantId, longReference)).toEqual([longId])

    const longerReference = incompressibleReference(12000)
    await database().query(`update "${table}" set external_reference = $1 where id = $2`, [longerReference, checkoutId])
    const newLongId = await insertDocument(table, tenantId, incompressibleReference(9000))
    expect(await findIds(table, tenantId, longerReference)).toEqual([checkoutId])
    expect(newLongId).toBeTruthy()

    await migrate(migration, 'up')
    expect(await indexState(indexName)).toEqual({ method: 'hash', valid: true })

    await migrate(migration, 'down')
    expect(await indexState(indexName)).toBeUndefined()
    expect(await findIds(table, tenantId, longReference)).toEqual([longId])

    await migrate(migration, 'up')
    expect(await indexState(indexName)).toEqual({ method: 'hash', valid: true })
    expect(await findIds(table, tenantId, longerReference)).toEqual([checkoutId])
    expect(await findIds(table, otherTenantId, checkoutReference)).toEqual([otherTenantDocumentId])
  })
})
