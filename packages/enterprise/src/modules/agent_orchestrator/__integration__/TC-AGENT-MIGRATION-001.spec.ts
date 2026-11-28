import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20260906141535_agent_orchestrator } from '../migrations/Migration20260906141535_agent_orchestrator'
import { Migration20261008103746_agent_run_cached_input_tokens } from '../migrations/Migration20261008103746_agent_run_cached_input_tokens'

/**
 * TC-AGENT-MIGRATION-001: `agent_runs.cached_input_tokens` migration boundary (#6240).
 *
 * Runs the migrations' exact SQL against the real Postgres:
 *  - fresh install: the ephemeral database ran every migration, so the live table has the column;
 *  - 0.8.0 upgrade: the shipped squash's `agent_runs` DDL (byte-identical to the v0.8.0 release)
 *    is replayed into a temporary table, then the stacked migration is applied on top of a
 *    legacy row, re-applied over an already-present column, rolled back and re-applied.
 *
 * Self-contained: the upgrade scenarios use a connection-scoped temporary table that is dropped
 * in `finally`; the live `agent_runs` table is only read.
 */

const UPGRADE_TABLE = 'agent_runs_upgrade_from_0_8_0'

type MigrationWithSql = { up(): void | Promise<void>; down(): void | Promise<void> }

async function collectSql<T extends MigrationWithSql>(
  migrationClass: { prototype: T },
  direction: 'up' | 'down',
): Promise<string[]> {
  const migration = Object.create(migrationClass.prototype) as T
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  await migration[direction]()
  return statements
}

function retarget(statement: string): string {
  return statement.replaceAll('"agent_runs"', `"${UPGRADE_TABLE}"`)
}

async function runCachedInputMigration(client: IntegrationDbClient, direction: 'up' | 'down'): Promise<void> {
  for (const statement of await collectSql(Migration20261008103746_agent_run_cached_input_tokens, direction)) {
    await client.query(retarget(statement))
  }
}

async function createLegacyAgentRunsTable(client: IntegrationDbClient): Promise<void> {
  const squash = await collectSql(Migration20260906141535_agent_orchestrator, 'up')
  const createAgentRuns = squash.find((statement) => statement.startsWith('create table "agent_runs" ('))
  if (!createAgentRuns) throw new Error('[internal] squash migration no longer creates "agent_runs"')
  await client.query(`drop table if exists "${UPGRADE_TABLE}"`)
  await client.query(retarget(createAgentRuns).replace('create table', 'create temporary table'))
}

async function readCachedColumn(
  client: IntegrationDbClient,
  table: string,
): Promise<{ data_type: string; is_nullable: string } | null> {
  const result = await client.query<{ data_type: string; is_nullable: string }>(
    `select data_type, is_nullable
       from information_schema.columns
      where table_name = $1 and column_name = 'cached_input_tokens'
        and table_schema = any (current_schemas(true))`,
    [table],
  )
  return result.rows[0] ?? null
}

async function insertRun(client: IntegrationDbClient, cachedInputTokens?: number): Promise<string> {
  const id = randomUUID()
  const columns = ['id', 'tenant_id', 'organization_id', 'agent_id', 'input', 'input_tokens', 'output_tokens']
  const values: unknown[] = [id, randomUUID(), randomUUID(), 'tc_agent_migration_001', '{}', 1200, 300]
  if (cachedInputTokens !== undefined) {
    columns.push('cached_input_tokens')
    values.push(cachedInputTokens)
  }
  const placeholders = values.map((_, index) => `$${index + 1}`)
  await client.query(
    `insert into "${UPGRADE_TABLE}" (${columns.join(', ')}, created_at, updated_at)
     values (${placeholders.join(', ')}, now(), now())`,
    values,
  )
  return id
}

async function readRuns(client: IntegrationDbClient): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(`select * from "${UPGRADE_TABLE}" order by id`)
  return result.rows
}

test.describe('TC-AGENT-MIGRATION-001: agent_runs.cached_input_tokens migration boundary', () => {
  test('fresh install exposes a nullable integer column and records the migration', async () => {
    await withClient(async (client) => {
      await expect(readCachedColumn(client, 'agent_runs')).resolves.toEqual({ data_type: 'integer', is_nullable: 'YES' })
      const applied = await client.query<{ name: string }>(
        `select name from mikro_orm_migrations_agent_orchestrator where name like 'Migration20261008103746%'`,
      )
      expect(applied.rows).toHaveLength(1)
    })
  })

  test('upgrading a 0.8.0 agent_runs table keeps legacy rows and tolerates an already-present column', async () => {
    await withClient(async (client) => {
      try {
        await createLegacyAgentRunsTable(client)
        await expect(readCachedColumn(client, UPGRADE_TABLE)).resolves.toBeNull()
        const legacyRunId = await insertRun(client)

        await runCachedInputMigration(client, 'up')
        await expect(readCachedColumn(client, UPGRADE_TABLE)).resolves.toEqual({ data_type: 'integer', is_nullable: 'YES' })
        const [legacyRun] = await readRuns(client)
        expect(legacyRun).toMatchObject({ id: legacyRunId, input_tokens: 1200, output_tokens: 300, cached_input_tokens: null })

        await runCachedInputMigration(client, 'up')
        const cachedRunId = await insertRun(client, 800)
        const cachedByRunId = new Map((await readRuns(client)).map((run) => [run.id, run.cached_input_tokens]))
        expect(cachedByRunId).toEqual(new Map([[legacyRunId, null], [cachedRunId, 800]]))
      } finally {
        await client.query(`drop table if exists "${UPGRADE_TABLE}"`)
      }
    })
  })

  test('rollback drops only the column and reapplication restores it', async () => {
    await withClient(async (client) => {
      try {
        await createLegacyAgentRunsTable(client)
        await runCachedInputMigration(client, 'up')
        const runId = await insertRun(client, 800)

        await runCachedInputMigration(client, 'down')
        await expect(readCachedColumn(client, UPGRADE_TABLE)).resolves.toBeNull()
        const [rolledBackRun] = await readRuns(client)
        expect(rolledBackRun).toMatchObject({ id: runId, input_tokens: 1200, output_tokens: 300 })
        expect(rolledBackRun).not.toHaveProperty('cached_input_tokens')

        await runCachedInputMigration(client, 'down')
        await expect(readCachedColumn(client, UPGRADE_TABLE)).resolves.toBeNull()

        await runCachedInputMigration(client, 'up')
        await expect(readCachedColumn(client, UPGRADE_TABLE)).resolves.toEqual({ data_type: 'integer', is_nullable: 'YES' })
        const [reappliedRun] = await readRuns(client)
        expect(reappliedRun).toMatchObject({ id: runId, cached_input_tokens: null })
      } finally {
        await client.query(`drop table if exists "${UPGRADE_TABLE}"`)
      }
    })
  })
})
