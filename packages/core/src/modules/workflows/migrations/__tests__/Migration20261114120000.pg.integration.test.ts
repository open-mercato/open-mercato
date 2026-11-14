import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { Migration20261114120000_workflows } from '../Migration20261114120000_workflows'
import { acquireWorkflowsPgDatabase, runsAgainstPostgres, type WorkflowsPgDatabase } from '../../lib/__tests__/workflowsPgDatabase'

jest.mock('@mikro-orm/migrations', () => ({ Migration: class Migration {} }))

function migrationSql(direction: 'up' | 'down'): string[] {
  const migration = Object.create(Migration20261114120000_workflows.prototype) as Migration20261114120000_workflows
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
  migration[direction]()
  return statements
}

const describePostgres = runsAgainstPostgres ? describe : describe.skip

describePostgres('workflow definition organization uniqueness migration', () => {
  let database: WorkflowsPgDatabase
  let client: Client

  beforeAll(async () => {
    database = await acquireWorkflowsPgDatabase()
    client = new Client({ connectionString: database.url })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
    await database?.release()
  })

  beforeEach(async () => {
    await client.query('begin')
    await client.query(`create temporary table workflow_definitions (
      id uuid primary key, workflow_id text not null, version integer not null,
      tenant_id uuid not null, organization_id uuid not null, definition jsonb not null,
      constraint workflow_definitions_workflow_id_version_tenant_id_unique unique (workflow_id, version, tenant_id)
    ) on commit drop`)
  })

  afterEach(async () => { await client.query('rollback') })

  async function insert(tenantId: string, organizationId: string, version = 1): Promise<void> {
    await client.query('insert into workflow_definitions values ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), 'code.workflow', version, tenantId, organizationId, { private: organizationId }])
  }

  test('preserves existing definitions and permits independent organizations and versions', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    await insert(tenantId, organizationId)
    for (const sql of migrationSql('up')) await client.query(sql)
    await insert(tenantId, randomUUID())
    await insert(tenantId, organizationId, 2)
    await insert(randomUUID(), organizationId)
    const result = await client.query('select definition from workflow_definitions where tenant_id = $1 and organization_id = $2 and version = 1', [tenantId, organizationId])
    expect(result.rows).toEqual([{ definition: { private: organizationId } }])
    await expect(insert(tenantId, organizationId)).rejects.toMatchObject({ code: '23505', constraint: 'workflow_definitions_workflow_version_tenant_org_unique' })
  })

  test('down restores tenant uniqueness when there are no cross-organization duplicates', async () => {
    const tenantId = randomUUID()
    await insert(tenantId, randomUUID())
    for (const sql of migrationSql('up')) await client.query(sql)
    for (const sql of migrationSql('down')) await client.query(sql)
    await expect(insert(tenantId, randomUUID())).rejects.toMatchObject({ code: '23505', constraint: 'workflow_definitions_workflow_id_version_tenant_id_unique' })
  })

  test('failed rollback retains organization uniqueness and every independent row', async () => {
    const tenantId = randomUUID()
    for (const sql of migrationSql('up')) await client.query(sql)
    await insert(tenantId, randomUUID())
    await insert(tenantId, randomUUID())
    await client.query('savepoint rollback_attempt')
    const statements = migrationSql('down')
    await client.query(statements[0])
    await expect(client.query(statements[1])).rejects.toMatchObject({ code: '23505' })
    await client.query('rollback to savepoint rollback_attempt')
    expect((await client.query('select count(*)::int as count from workflow_definitions')).rows).toEqual([{ count: 2 }])
    expect((await client.query("select conname from pg_constraint where conrelid = 'pg_temp.workflow_definitions'::regclass and contype = 'u'")).rows).toEqual([{ conname: 'workflow_definitions_workflow_version_tenant_org_unique' }])
  })
})
