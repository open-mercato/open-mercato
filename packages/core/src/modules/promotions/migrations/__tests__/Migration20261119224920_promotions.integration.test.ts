import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261014132951_promotions } from '../Migration20261014132951_promotions'
import { Migration20261027113557_promotions } from '../Migration20261027113557_promotions'
import { Migration20261119224920_promotions } from '../Migration20261119224920_promotions'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const NEW_COLUMNS = ['cart_id', 'generated_code_id', 'order_id', 'reverted_at']
const NEW_INDEXES = ['promotion_code_usages_cart_idx', 'promotion_code_usages_order_idx']
const byName = (left: string, right: string) => left.localeCompare(right)
const NEW_FOREIGN_KEY = 'promotion_code_usages_generated_code_id_foreign'

type MigrationClass = { prototype: { up(): void | Promise<void>; down(): void | Promise<void> } }

type UsageRow = {
  id: string
  code_id: string
  customer_id: string | null
  organization_id: string
  tenant_id: string
  used_at: Date
}

/**
 * Upgrade/rollback boundary of the code-use reversal migration against a real
 * PostgreSQL, starting from the schema the two earlier promotions migrations build and
 * a `promotion_code_usages` row written before it:
 * - `up` adds `cart_id`, `order_id`, `generated_code_id` and `reverted_at` as nullable
 *   columns, the generated-code foreign key and the cart/order indexes, and leaves the
 *   existing row's fields untouched (its new columns are NULL);
 * - `down` drops exactly those columns, the foreign key and the indexes, and keeps the
 *   existing row with its original fields.
 */
describeWithPostgres('Promotions code-use reversal migration against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  let schema: string

  function database(): Client {
    if (!client) throw new Error('[internal] promotions migration test database is not connected')
    return client
  }

  async function migrate(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<void> {
    const migration = Object.create(migrationClass.prototype) as MigrationClass['prototype']
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

  async function usageColumns(): Promise<Map<string, string>> {
    const result = await database().query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = $1 and table_name = 'promotion_code_usages'`,
      [schema],
    )
    return new Map(result.rows.map((row) => [row.column_name, row.is_nullable]))
  }

  async function usageIndexes(): Promise<string[]> {
    const result = await database().query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = $1 and tablename = 'promotion_code_usages'`,
      [schema],
    )
    return result.rows.map((row) => row.indexname).sort(byName)
  }

  async function usageForeignKeys(): Promise<string[]> {
    const result = await database().query<{ constraint_name: string }>(
      `select constraint_name from information_schema.table_constraints
       where table_schema = $1 and table_name = 'promotion_code_usages' and constraint_type = 'FOREIGN KEY'
       order by constraint_name`,
      [schema],
    )
    return result.rows.map((row) => row.constraint_name)
  }

  async function readUsage(id: string): Promise<Record<string, unknown>> {
    const result = await database().query<Record<string, unknown>>('select * from promotion_code_usages where id = $1', [id])
    expect(result.rows).toHaveLength(1)
    return result.rows[0]
  }

  async function seedLegacyUsage(): Promise<UsageRow> {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const codeId = randomUUID()
    await database().query(
      `insert into promotion_codes (id, organization_id, tenant_id, name, type, code, generated, used, usage, active, created_at, updated_at)
       values ($1, $2, $3, 'Legacy code', 'static', 'LEGACY10', 0, 1, 'multiple', true, now(), now())`,
      [codeId, organizationId, tenantId],
    )
    const usage: UsageRow = {
      id: randomUUID(),
      code_id: codeId,
      customer_id: 'customer-legacy',
      organization_id: organizationId,
      tenant_id: tenantId,
      used_at: new Date('2026-10-01T12:00:00.000Z'),
    }
    await database().query(
      `insert into promotion_code_usages (id, code_id, customer_id, organization_id, tenant_id, used_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [usage.id, usage.code_id, usage.customer_id, usage.organization_id, usage.tenant_id, usage.used_at],
    )
    return usage
  }

  function expectOriginalFields(row: Record<string, unknown>, usage: UsageRow): void {
    expect(row.id).toBe(usage.id)
    expect(row.code_id).toBe(usage.code_id)
    expect(row.customer_id).toBe(usage.customer_id)
    expect(row.organization_id).toBe(usage.organization_id)
    expect(row.tenant_id).toBe(usage.tenant_id)
    expect((row.used_at as Date).toISOString()).toBe(usage.used_at.toISOString())
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'promotions_migration_test', POSTGRES_USER: 'promotions_test', POSTGRES_PASSWORD: 'promotions_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'promotions_migration_test',
      user: 'promotions_test',
      password: 'promotions_test',
    })
    await client.connect()
  }, 120_000)

  beforeEach(async () => {
    schema = `promotions_migration_${randomUUID().replaceAll('-', '')}`
    await database().query(`create schema "${schema}"`)
    await database().query(`set search_path to "${schema}"`)
    await migrate(Migration20261014132951_promotions, 'up')
    await migrate(Migration20261027113557_promotions, 'up')
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
  })

  it('up keeps an existing usage row intact and adds the nullable reversal columns, foreign key and indexes', async () => {
    const usage = await seedLegacyUsage()
    const indexesBefore = await usageIndexes()
    expect(indexesBefore).not.toEqual(expect.arrayContaining([NEW_INDEXES[0]]))

    await migrate(Migration20261119224920_promotions, 'up')

    const columns = await usageColumns()
    for (const column of NEW_COLUMNS) expect(columns.get(column)).toBe('YES')
    expect(await usageIndexes()).toEqual([...indexesBefore, ...NEW_INDEXES].sort(byName))
    expect(await usageForeignKeys()).toContain(NEW_FOREIGN_KEY)

    const row = await readUsage(usage.id)
    expectOriginalFields(row, usage)
    for (const column of NEW_COLUMNS) expect(row[column]).toBeNull()
  })

  it('down removes the reversal columns, foreign key and indexes and keeps the existing usage row', async () => {
    const usage = await seedLegacyUsage()
    const columnsBefore = await usageColumns()
    const indexesBefore = await usageIndexes()
    const foreignKeysBefore = await usageForeignKeys()

    await migrate(Migration20261119224920_promotions, 'up')
    await migrate(Migration20261119224920_promotions, 'down')

    const columns = await usageColumns()
    for (const column of NEW_COLUMNS) expect(columns.has(column)).toBe(false)
    expect(columns).toEqual(columnsBefore)
    expect(await usageIndexes()).toEqual(indexesBefore)
    expect(await usageForeignKeys()).toEqual(foreignKeysBefore)
    expect(await usageForeignKeys()).not.toContain(NEW_FOREIGN_KEY)

    const row = await readUsage(usage.id)
    expectOriginalFields(row, usage)
    expect(Object.keys(row).sort(byName)).toEqual([...columnsBefore.keys()].sort(byName))
  })
})
