import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261119194500_customer_groups } from '../Migration20261119194500_customer_groups'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 60_000
const DATABASE_NAME = 'customer_groups_migration_test'
const DATABASE_USER = 'customer_groups_migration_test'
const DATABASE_PASSWORD = 'customer_groups_migration_test'

const RELEASE_5_COLUMNS = ['terms_currency_code', 'approval_policy', 'allow_quote_requests', 'requires_po_number']

// `customer_group_terms` as the module snapshot describes it before this migration.
const PRE_MIGRATION_SCHEMA = `create table "customer_group_terms" (
  "id" uuid not null default gen_random_uuid() primary key,
  "organization_id" uuid null,
  "tenant_id" uuid not null,
  "group_id" uuid not null,
  "price_kind_id" uuid null,
  "payment_terms_days" int null,
  "allow_purchase_on_account" boolean null,
  "default_credit_limit" numeric null,
  "credit_currency_code" text null,
  "approval_required_above" numeric null,
  "min_order_value" numeric null,
  "assortment_scope" jsonb null,
  "metadata" jsonb null,
  "created_at" timestamptz(6) not null,
  "updated_at" timestamptz(6) not null,
  "deleted_at" timestamptz(6) null
);`

type ColumnRow = { column_name: string; data_type: string; is_nullable: string; column_default: string | null }

const ORIGINAL_ROW_COLUMNS = `"id", "tenant_id", "group_id", "payment_terms_days", "allow_purchase_on_account",
  "default_credit_limit"::text as "default_credit_limit", "credit_currency_code",
  "approval_required_above"::text as "approval_required_above", "min_order_value"::text as "min_order_value",
  "assortment_scope", "metadata"`

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261119194500_customer_groups.prototype,
  ) as Migration20261119194500_customer_groups
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  await migration[direction]()
  return statements
}

async function runMigration(client: Client, direction: 'up' | 'down'): Promise<void> {
  await client.query('begin')
  try {
    for (const sql of await collectSql(direction)) await client.query(sql)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function readColumns(client: Client): Promise<ColumnRow[]> {
  const result = await client.query<ColumnRow>(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_name = 'customer_group_terms'
      order by ordinal_position`,
  )
  return result.rows
}

async function readOriginalRow(client: Client, id: string): Promise<Record<string, unknown>[]> {
  const result = await client.query(`select ${ORIGINAL_ROW_COLUMNS} from "customer_group_terms" where "id" = $1`, [id])
  return result.rows
}

describeWithPostgres('Migration20261119194500_customer_groups against real Postgres', () => {
  let postgres: StartedTestContainer | null = null
  let client: Client | null = null
  let preMigrationColumns: ColumnRow[] = []
  let originalRow: Record<string, unknown>[] = []
  const termsId = randomUUID()
  const tenantId = randomUUID()
  const groupId = randomUUID()

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
    await client.query(PRE_MIGRATION_SCHEMA)
    await client.query(
      `insert into "customer_group_terms" ("id", "tenant_id", "group_id", "payment_terms_days", "allow_purchase_on_account",
         "default_credit_limit", "credit_currency_code", "approval_required_above", "min_order_value",
         "assortment_scope", "metadata", "created_at", "updated_at")
       values ($1, $2, $3, 30, true, 1500.25, 'EUR', 12345678901234567.123456789, 0.000000000000000001,
         '{"categoryIds":["c1"]}', '{"note":"kept"}', now(), now())`,
      [termsId, tenantId, groupId],
    )
    preMigrationColumns = await readColumns(client)
    originalRow = await readOriginalRow(client, termsId)
  }, CASE_TIMEOUT_MS)

  afterAll(async () => {
    await Promise.allSettled([client?.end()])
    await Promise.allSettled([postgres?.stop()])
  })

  it('up() adds the four nullable columns and leaves the existing row inheriting them', async () => {
    const db = client as Client
    await runMigration(db, 'up')
    const after = await readColumns(db)

    expect(after.slice(0, preMigrationColumns.length)).toEqual(preMigrationColumns)
    expect(after.slice(preMigrationColumns.length)).toEqual([
      { column_name: 'terms_currency_code', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'approval_policy', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'allow_quote_requests', data_type: 'boolean', is_nullable: 'YES', column_default: null },
      { column_name: 'requires_po_number', data_type: 'boolean', is_nullable: 'YES', column_default: null },
    ])
    expect(await readOriginalRow(db, termsId)).toEqual(originalRow)
    const added = await db.query(`select ${RELEASE_5_COLUMNS.map((name) => `"${name}"`).join(', ')} from "customer_group_terms" where "id" = $1`, [termsId])
    expect(added.rows).toEqual([
      { terms_currency_code: null, approval_policy: null, allow_quote_requests: null, requires_po_number: null },
    ])
  }, CASE_TIMEOUT_MS)

  it('down() removes only the four columns and keeps the original row values', async () => {
    const db = client as Client
    await db.query(
      `update "customer_group_terms"
          set "terms_currency_code" = 'PLN', "approval_policy" = 'merchant', "allow_quote_requests" = true, "requires_po_number" = true
        where "id" = $1`,
      [termsId],
    )

    await runMigration(db, 'down')

    expect(await readColumns(db)).toEqual(preMigrationColumns)
    expect(await readOriginalRow(db, termsId)).toEqual(originalRow)
  }, CASE_TIMEOUT_MS)

  it('up() applies cleanly again after a rollback and restores the four columns', async () => {
    const db = client as Client
    await runMigration(db, 'up')

    const columns = await readColumns(db)
    expect(columns.map((column) => column.column_name)).toEqual([
      ...preMigrationColumns.map((column) => column.column_name),
      ...RELEASE_5_COLUMNS,
    ])
    expect(await readOriginalRow(db, termsId)).toEqual(originalRow)
  }, CASE_TIMEOUT_MS)
})
