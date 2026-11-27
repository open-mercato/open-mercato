import { Client } from 'pg'
import { Migration20261126130000_attachments } from '../Migration20261126130000_attachments'

const postgresUrl = process.env.OM_ATTACHMENTS_MIGRATION_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('attachment partition ownership migration', () => {
  const tenantId = 'b4a38be6-c8bf-4dcb-bae1-275b13145625'
  const orgId = '70b7e78c-67be-4b04-95db-bd5586a7b410'
  const otherOrgId = 'feaaff12-c986-43c1-b4e5-3ab6ba4bc777'
  let client: Client

  beforeEach(async () => {
    client = new Client({ connectionString: postgresUrl })
    await client.connect()
    await client.query(`
      create temporary table attachment_partitions (
        code text constraint attachment_partitions_code_unique unique,
        tenant_id uuid,
        organization_id uuid
      );
      create temporary table attachments (
        partition_code text,
        tenant_id uuid,
        organization_id uuid
      );
    `)
  })

  afterEach(async () => {
    await client.end()
  })

  async function migrate() {
    const migration = Object.create(Migration20261126130000_attachments.prototype) as Migration20261126130000_attachments
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    migration.up()
    await client.query(statements.join('\n'))
  }

  test('preserves organization-owned, tenant-wide, and global references', async () => {
    await client.query(`
      insert into attachment_partitions values ('organization', $1, $2), ('tenant', $1, null), ('global', null, null)
    `, [tenantId, orgId])
    await client.query(`
      insert into attachments values ('organization', $1, $2), ('tenant', $1, $2), ('global', null, null)
    `, [tenantId, orgId])

    await migrate()

    await expect(client.query("insert into attachment_partitions values ('organization', $1, $2)", [
      tenantId, otherOrgId,
    ])).resolves.toMatchObject({ rowCount: 1 })
    await expect(client.query('select partition_code from attachments order by partition_code')).resolves.toMatchObject({
      rows: [{ partition_code: 'global' }, { partition_code: 'organization' }, { partition_code: 'tenant' }],
    })
  })

  test('keeps the previous uniqueness constraint until existing references are reconciled', async () => {
    await client.query("insert into attachment_partitions values ('original', $1, $2), ('destination', $1, $3)", [
      tenantId, orgId, otherOrgId,
    ])
    await client.query("insert into attachments values ('original', $1, $2)", [tenantId, otherOrgId])

    await expect(migrate()).rejects.toThrow('Attachment partition ownership preflight failed')
    await expect(client.query("insert into attachment_partitions values ('original', $1, $2)", [
      tenantId, otherOrgId,
    ])).rejects.toMatchObject({ constraint: 'attachment_partitions_code_unique' })

    await client.query("update attachments set partition_code = 'destination'")
    await expect(migrate()).resolves.toBeUndefined()
  })
})
