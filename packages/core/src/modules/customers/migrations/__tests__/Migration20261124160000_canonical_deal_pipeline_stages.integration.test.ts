import { Client } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { Migration20261124160000_canonical_deal_pipeline_stages } from '../Migration20261124160000_canonical_deal_pipeline_stages'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('canonical deal pipeline stages migration', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  const credentials = { POSTGRES_USER: 'migration_test', POSTGRES_PASSWORD: 'migration_test' }

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment(credentials)
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: credentials.POSTGRES_USER,
      password: credentials.POSTGRES_PASSWORD,
    })
    await client.connect()
  }, 60_000)

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  })

  it('reuses the scoped canonical values and preserves other stages and dictionary rows', async () => {
    const db = client as Client
    await db.query(`
      create temporary table customer_deals (
        id integer primary key, tenant_id text, organization_id text, pipeline_stage_id integer,
        pipeline_stage text, updated_at text not null default 'original'
      );
      create temporary table customer_pipeline_stages (
        id integer primary key, tenant_id text, organization_id text, name text
      );
      create temporary table customer_dictionary_entries (
        tenant_id text, organization_id text, kind text, normalized_value text, value text
      );
      insert into customer_pipeline_stages values
        (1, 'tenant', 'org', 'Marketing Qualified Lead'),
        (2, 'tenant', 'org', 'Custom stage'),
        (3, 'other-tenant', 'org', 'Marketing Qualified Lead');
      insert into customer_dictionary_entries values
        ('tenant', 'org', 'pipeline_stage', 'marketing_qualified_lead', 'marketing_qualified_lead'),
        ('tenant', 'org', 'pipeline_stage', 'marketing qualified lead', 'Marketing Qualified Lead'),
        ('tenant', 'org', 'pipeline_stage', 'sales_qualified_lead', 'SALES_QUALIFIED_LEAD'),
        ('tenant', 'other-org', 'source', 'marketing_qualified_lead', 'marketing_qualified_lead');
      insert into customer_deals (id, tenant_id, organization_id, pipeline_stage_id, pipeline_stage) values
        (1, 'tenant', 'org', 1, 'Marketing Qualified Lead'),
        (2, 'tenant', 'org', null, 'Sales Qualified Lead'),
        (3, 'tenant', 'org', 2, 'Marketing Qualified Lead'),
        (4, 'tenant', 'org', 3, 'Marketing Qualified Lead'),
        (5, 'tenant', 'other-org', null, 'Marketing Qualified Lead'),
        (6, 'other-tenant', 'org', null, 'Marketing Qualified Lead'),
        (7, 'tenant', 'org', 2, 'Custom stage');
    `)

    const statements: string[] = []
    const migration = Object.create(Migration20261124160000_canonical_deal_pipeline_stages.prototype) as Migration20261124160000_canonical_deal_pipeline_stages
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    migration.up()
    for (const statement of statements) await db.query(statement)
    for (const statement of statements) expect((await db.query(statement)).rowCount).toBe(0)

    const deals = await db.query<{ pipeline_stage: string; updated_at: string }>(
      'select pipeline_stage, updated_at from customer_deals order by id',
    )
    expect(deals.rows.map((row) => row.pipeline_stage)).toEqual([
      'marketing_qualified_lead', 'SALES_QUALIFIED_LEAD', 'Marketing Qualified Lead',
      'Marketing Qualified Lead', 'Marketing Qualified Lead', 'Marketing Qualified Lead', 'Custom stage',
    ])
    expect(deals.rows.every((row) => row.updated_at === 'original')).toBe(true)
    expect((await db.query('select * from customer_dictionary_entries')).rowCount).toBe(4)
  })
})
