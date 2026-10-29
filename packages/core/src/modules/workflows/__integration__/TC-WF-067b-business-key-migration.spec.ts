import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  withClient,
  type IntegrationDbClient,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { Migration20261011090000_workflows } from '../migrations/Migration20261011090000_workflows'

/**
 * TC-WF-067b: the business-key migration round trip against real PostgreSQL (#7182).
 *
 * Runs `Migration20261011090000_workflows`'s own `up()` / `down()` statements
 * (collected from `addSql`, never re-typed) up → down → up, and asserts after
 * each step that the `business_key` column and the four indexes exist or are
 * gone, and that the partial unique index arbitrates ONLY open instances in the
 * same tenant / organization / workflow scope.
 *
 * Isolation: the shared database already carries the migrated schema and the
 * app is serving from it, so the spec never touches the live tables. It builds
 * a throwaway schema holding pre-migration copies of `workflow_instances` and
 * `user_tasks` (`LIKE … INCLUDING DEFAULTS`, then `business_key` dropped), pins
 * `search_path` to it for the session, and drops the schema in `finally`.
 */

const MIGRATION_INDEXES = [
  { table: 'workflow_instances', name: 'workflow_instances_business_key_open_uq' },
  { table: 'workflow_instances', name: 'workflow_instances_business_key_idx' },
  { table: 'workflow_instances', name: 'workflow_instances_metadata_gin_idx' },
  { table: 'user_tasks', name: 'user_tasks_entity_bindings_gin_idx' },
] as const

type Scope = { tenantId: string; organizationId: string; workflowId: string }

async function collectMigrationSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261011090000_workflows.prototype) as Migration20261011090000_workflows
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => {
      statements.push(sql)
    },
  })
  await migration[direction]()
  return statements
}

async function runStatements(client: IntegrationDbClient, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await client.query(statement)
  }
}

async function hasBusinessKeyColumn(client: IntegrationDbClient, schema: string): Promise<boolean> {
  const result = await client.query<{ data_type: string; character_maximum_length: number | null; is_nullable: string }>(
    `select data_type, character_maximum_length, is_nullable
       from information_schema.columns
      where table_schema = $1 and table_name = 'workflow_instances' and column_name = 'business_key'`,
    [schema],
  )
  const column = result.rows[0]
  if (!column) return false
  expect(column).toEqual({ data_type: 'character varying', character_maximum_length: 255, is_nullable: 'YES' })
  return true
}

async function listMigrationIndexes(client: IntegrationDbClient, schema: string): Promise<Map<string, string>> {
  const result = await client.query<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef from pg_indexes where schemaname = $1 and indexname = any($2::text[])`,
    [schema, MIGRATION_INDEXES.map((index) => index.name)],
  )
  return new Map(result.rows.map((row) => [row.indexname, row.indexdef]))
}

async function expectMigratedSchema(client: IntegrationDbClient, schema: string): Promise<void> {
  expect(await hasBusinessKeyColumn(client, schema), 'business_key column exists').toBe(true)
  const indexes = await listMigrationIndexes(client, schema)
  expect([...indexes.keys()].sort()).toEqual(MIGRATION_INDEXES.map((index) => index.name).sort())
  for (const index of MIGRATION_INDEXES) {
    expect(indexes.get(index.name), `${index.name} is on ${index.table}`).toContain(` ON ${schema}.${index.table} `)
  }
  const openUnique = indexes.get('workflow_instances_business_key_open_uq') ?? ''
  expect(openUnique).toContain('CREATE UNIQUE INDEX')
  expect(openUnique).toContain('(tenant_id, organization_id, workflow_id, business_key)')
  expect(openUnique).toContain('business_key IS NOT NULL')
  expect(openUnique).toContain('deleted_at IS NULL')
  expect(indexes.get('workflow_instances_metadata_gin_idx')).toContain('USING gin (metadata jsonb_path_ops)')
  expect(indexes.get('user_tasks_entity_bindings_gin_idx')).toContain('USING gin (entity_bindings jsonb_path_ops)')
}

async function expectRolledBackSchema(client: IntegrationDbClient, schema: string): Promise<void> {
  expect(await hasBusinessKeyColumn(client, schema), 'business_key column is dropped').toBe(false)
  expect([...(await listMigrationIndexes(client, schema)).keys()], 'every migration index is dropped').toEqual([])
}

async function insertInstance(
  client: IntegrationDbClient,
  scope: Scope,
  input: { businessKey: string | null; status: string; deleted?: boolean },
): Promise<void> {
  await client.query(
    `insert into workflow_instances (
       id, definition_id, workflow_id, version, status, current_step_id, context,
       business_key, started_at, retry_count, is_dry_run, tenant_id, organization_id,
       created_at, updated_at, deleted_at
     ) values (
       $1, $2, $3, 1, $4, 'start', '{}'::jsonb,
       $5, now(), 0, false, $6, $7,
       now(), now(), $8
     )`,
    [
      randomUUID(),
      randomUUID(),
      scope.workflowId,
      input.status,
      input.businessKey,
      scope.tenantId,
      scope.organizationId,
      input.deleted ? new Date().toISOString() : null,
    ],
  )
}

async function expectUniqueViolation(run: () => Promise<void>): Promise<void> {
  let code: string | undefined
  let constraint: string | undefined
  try {
    await run()
  } catch (error) {
    code = (error as { code?: string }).code
    constraint = (error as { constraint?: string }).constraint
  }
  expect(code, 'a second open holder of the key in the same scope is refused').toBe('23505')
  expect(constraint).toBe('workflow_instances_business_key_open_uq')
}

async function expectOpenKeyArbitration(client: IntegrationDbClient): Promise<void> {
  const scope: Scope = { tenantId: randomUUID(), organizationId: randomUUID(), workflowId: `qa-wf-bkey-mig-${randomUUID()}` }
  const key = `order:${randomUUID()}`

  await insertInstance(client, scope, { businessKey: key, status: 'RUNNING' })
  await expectUniqueViolation(() => insertInstance(client, scope, { businessKey: key, status: 'PAUSED' }))

  for (const status of ['COMPLETED', 'FAILED', 'CANCELLED', 'COMPENSATED']) {
    await insertInstance(client, scope, { businessKey: key, status })
    await insertInstance(client, scope, { businessKey: key, status })
  }
  await insertInstance(client, scope, { businessKey: key, status: 'RUNNING', deleted: true })
  await insertInstance(client, scope, { businessKey: null, status: 'RUNNING' })
  await insertInstance(client, scope, { businessKey: null, status: 'RUNNING' })
  await insertInstance(client, { ...scope, organizationId: randomUUID() }, { businessKey: key, status: 'RUNNING' })
  await insertInstance(client, { ...scope, tenantId: randomUUID() }, { businessKey: key, status: 'RUNNING' })
  await insertInstance(client, { ...scope, workflowId: `${scope.workflowId}-other` }, { businessKey: key, status: 'RUNNING' })
  await insertInstance(client, scope, { businessKey: `${key}:other`, status: 'RUNNING' })

  for (const status of ['WAITING_FOR_ACTIVITIES', 'FORKED', 'COMPENSATING']) {
    await expectUniqueViolation(() => insertInstance(client, scope, { businessKey: key, status }))
  }
}

test.describe('TC-WF-067b: business-key migration up/down/up on PostgreSQL', () => {
  test('creates, removes and restores the column and indexes, and arbitrates only open keyed instances', async () => {
    const schema = `qa_wf_bkey_mig_${randomUUID().replace(/-/g, '')}`
    const up = await collectMigrationSql('up')
    const down = await collectMigrationSql('down')
    expect(up).toHaveLength(5)
    expect(down).toHaveLength(5)

    await withClient(async (client) => {
      const liveSchemaResult = await client.query<{ schema: string }>('select current_schema() as schema')
      const liveSchema = liveSchemaResult.rows[0]?.schema ?? 'public'
      try {
        await client.query(`create schema "${schema}"`)
        await client.query(`create table "${schema}".workflow_instances (like "${liveSchema}".workflow_instances including defaults)`)
        await client.query(`create table "${schema}".user_tasks (like "${liveSchema}".user_tasks including defaults)`)
        await client.query(`alter table "${schema}".workflow_instances drop column if exists business_key`)
        await client.query(`set search_path to "${schema}"`)
        await expectRolledBackSchema(client, schema)

        await runStatements(client, up)
        await expectMigratedSchema(client, schema)
        await expectOpenKeyArbitration(client)

        await runStatements(client, down)
        await expectRolledBackSchema(client, schema)

        await runStatements(client, up)
        await expectMigratedSchema(client, schema)
        await expectOpenKeyArbitration(client)
      } finally {
        await client.query(`set search_path to "${liveSchema}"`)
        await client.query(`drop schema if exists "${schema}" cascade`)
      }
    })
  })
})
