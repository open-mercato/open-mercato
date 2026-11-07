import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261022120000_customers } from '../Migration20261022120000_customers'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 60_000
const DATABASE_NAME = 'customers_migration_test'
const DATABASE_USER = 'customers_migration_test'
const DATABASE_PASSWORD = 'customers_migration_test'

const PRE_MIGRATION_SCHEMA = [
  `create table "customer_pipelines" (
    "id" uuid not null primary key,
    "organization_id" uuid not null,
    "tenant_id" uuid not null,
    "name" text not null,
    "is_default" boolean not null default false,
    "created_at" timestamptz not null,
    "updated_at" timestamptz not null
  );`,
  `create table "customer_pipeline_stages" (
    "id" uuid not null primary key,
    "organization_id" uuid not null,
    "tenant_id" uuid not null,
    "pipeline_id" uuid not null,
    "label" text not null,
    "order" int not null default 0,
    "created_at" timestamptz not null,
    "updated_at" timestamptz not null
  );`,
]

type ColumnRow = { table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261022120000_customers.prototype,
  ) as Migration20261022120000_customers
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
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_name in ('customer_pipelines', 'customer_pipeline_stages')
      order by table_name, ordinal_position`,
  )
  return result.rows
}

function columnNames(columns: ColumnRow[], table: string): string[] {
  return columns.filter((column) => column.table_name === table).map((column) => column.column_name)
}

describeWithPostgres('Migration20261022120000_customers against real Postgres', () => {
  let postgres: StartedTestContainer | null = null
  let client: Client | null = null
  const pipelineId = randomUUID()
  const stageId = randomUUID()
  const organizationId = randomUUID()
  const tenantId = randomUUID()

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
    for (const sql of PRE_MIGRATION_SCHEMA) await client.query(sql)
    await client.query(
      `insert into "customer_pipelines" ("id", "organization_id", "tenant_id", "name", "is_default", "created_at", "updated_at")
       values ($1, $2, $3, 'Existing pipeline', true, now(), now())`,
      [pipelineId, organizationId, tenantId],
    )
    await client.query(
      `insert into "customer_pipeline_stages" ("id", "organization_id", "tenant_id", "pipeline_id", "label", "order", "created_at", "updated_at")
       values ($1, $2, $3, $4, 'Existing stage', 0, now(), now())`,
      [stageId, organizationId, tenantId, pipelineId],
    )
  }, CASE_TIMEOUT_MS)

  afterAll(async () => {
    await Promise.allSettled([client?.end()])
    await Promise.allSettled([postgres?.stop()])
  })

  it('up() backfills existing rows with the flag off and no stage default', async () => {
    const db = client as Client
    const before = await readColumns(db)
    await runMigration(db, 'up')
    const after = await readColumns(db)

    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table_name: 'customer_pipelines',
        column_name: 'stage_probabilities_enabled',
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: 'false',
      }),
      expect.objectContaining({
        table_name: 'customer_pipeline_stages',
        column_name: 'default_probability',
        data_type: 'integer',
        is_nullable: 'YES',
        column_default: null,
      }),
    ]))
    expect(after).toHaveLength(before.length + 2)

    const pipeline = await db.query(`select "name", "stage_probabilities_enabled" from "customer_pipelines" where "id" = $1`, [pipelineId])
    expect(pipeline.rows).toEqual([{ name: 'Existing pipeline', stage_probabilities_enabled: false }])
    const stage = await db.query(`select "label", "default_probability" from "customer_pipeline_stages" where "id" = $1`, [stageId])
    expect(stage.rows).toEqual([{ label: 'Existing stage', default_probability: null }])
  }, CASE_TIMEOUT_MS)

  it('down() removes only the two added columns and keeps the rows', async () => {
    const db = client as Client
    await db.query(`update "customer_pipelines" set "stage_probabilities_enabled" = true where "id" = $1`, [pipelineId])
    await db.query(`update "customer_pipeline_stages" set "default_probability" = 40 where "id" = $1`, [stageId])
    const migrated = await readColumns(db)

    await runMigration(db, 'down')
    const reverted = await readColumns(db)

    expect(columnNames(reverted, 'customer_pipelines')).toEqual(
      columnNames(migrated, 'customer_pipelines').filter((name) => name !== 'stage_probabilities_enabled'),
    )
    expect(columnNames(reverted, 'customer_pipeline_stages')).toEqual(
      columnNames(migrated, 'customer_pipeline_stages').filter((name) => name !== 'default_probability'),
    )
    const pipeline = await db.query(`select "id", "name", "is_default" from "customer_pipelines"`)
    expect(pipeline.rows).toEqual([{ id: pipelineId, name: 'Existing pipeline', is_default: true }])
    const stage = await db.query(`select "id", "label", "pipeline_id" from "customer_pipeline_stages"`)
    expect(stage.rows).toEqual([{ id: stageId, label: 'Existing stage', pipeline_id: pipelineId }])
  }, CASE_TIMEOUT_MS)

  it('up() applies cleanly again after a rollback', async () => {
    const db = client as Client
    await runMigration(db, 'up')
    const pipeline = await db.query(`select "stage_probabilities_enabled" from "customer_pipelines" where "id" = $1`, [pipelineId])
    expect(pipeline.rows).toEqual([{ stage_probabilities_enabled: false }])
    const stage = await db.query(`select "default_probability" from "customer_pipeline_stages" where "id" = $1`, [stageId])
    expect(stage.rows).toEqual([{ default_probability: null }])
  }, CASE_TIMEOUT_MS)
})
