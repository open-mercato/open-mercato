import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { addressEntity, replaceFixtureAddressPolicy } from '../addressPolicyFixtures'
import { Migration20261016134622_customers } from '../../../migrations/Migration20261016134622_customers'

const postgresUrl = process.env.OM_ENCRYPTION_BACKFILL_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('isolated address upgrade fixtures', () => {
  let client: InstanceType<typeof Client>
  let schema: string

  beforeEach(async () => {
    client = new Client({ connectionString: postgresUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
    await client.connect()
    schema = `address_fixture_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await client.query('SET statement_timeout = 5000')
  })

  afterEach(async () => {
    if (client) {
      try {
        await client.query('ROLLBACK')
        if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await client.end()
      }
    }
  })

  test('actual schema migration adds nullable contacts and down preserves the old address', async () => {
    const id = randomUUID()
    await client.query('CREATE TABLE customer_addresses (id uuid PRIMARY KEY, address_line1 text NOT NULL, company_name text)')
    await client.query('INSERT INTO customer_addresses VALUES ($1, $2, $3)', [id, 'Pre-upgrade road', 'Existing company'])
    const migration = Object.create(Migration20261016134622_customers.prototype) as Migration20261016134622_customers
    let statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    await migration.up()
    for (const statement of statements) await client.query(statement)
    const columns = await client.query('SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name IN ($3, $4) ORDER BY column_name', [schema, 'customer_addresses', 'recipient_name', 'phone'])
    expect(columns.rows).toEqual([{ column_name: 'phone', is_nullable: 'YES' }, { column_name: 'recipient_name', is_nullable: 'YES' }])
    expect((await client.query('SELECT * FROM customer_addresses')).rows).toEqual([{ id, address_line1: 'Pre-upgrade road', company_name: 'Existing company', phone: null, recipient_name: null }])
    await client.query('UPDATE customer_addresses SET recipient_name = $1, phone = $2 WHERE id = $3', ['Recipient', '+1 555 0100', id])
    statements = []
    await migration.down()
    for (const statement of statements) await client.query(statement)
    expect((await client.query('SELECT * FROM customer_addresses')).rows).toEqual([{ id, address_line1: 'Pre-upgrade road', company_name: 'Existing company' }])
    const removed = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name IN ($3, $4)', [schema, 'customer_addresses', 'recipient_name', 'phone'])
    expect(removed.rows).toEqual([])
  })

  test.each([false, true])('fixture policy writes preserve unrelated scopes (rollback=%s)', async (forceFailure) => {
    await client.query(`CREATE TABLE encryption_maps (
      id uuid PRIMARY KEY, entity_id text NOT NULL, tenant_id uuid, organization_id uuid,
      fields_json jsonb, is_active boolean NOT NULL, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, deleted_at timestamptz,
      CHECK (fields_json <> '[{"field":"reject"}]'::jsonb)
    )`)
    await client.query(`CREATE UNIQUE INDEX encryption_maps_scope_unique ON encryption_maps (entity_id, tenant_id, organization_id) NULLS NOT DISTINCT WHERE deleted_at IS NULL`)
    const tenant = randomUUID()
    const organization = randomUUID()
    await replaceFixtureAddressPolicy(client, randomUUID(), randomUUID(), [{ field: 'purpose' }])
    await replaceFixtureAddressPolicy(client, tenant, randomUUID(), [{ field: 'purpose' }])
    const before = (await client.query('SELECT * FROM encryption_maps ORDER BY id')).rows
    const baseline = await replaceFixtureAddressPolicy(client, tenant, organization, [{ field: 'address_line1' }])
    if (forceFailure) {
      await expect(replaceFixtureAddressPolicy(client, tenant, organization, [{ field: 'reject' }])).rejects.toMatchObject({ code: '23514' })
      expect((await client.query('SELECT fields_json FROM encryption_maps WHERE id = $1', [baseline])).rows).toEqual([{ fields_json: [{ field: 'address_line1' }] }])
    } else {
      await replaceFixtureAddressPolicy(client, tenant, organization, [{ field: 'recipient_name' }, { field: 'phone' }])
      await replaceFixtureAddressPolicy(client, tenant, null, [{ field: 'purpose' }])
    }
    const unrelated = await client.query('SELECT * FROM encryption_maps WHERE NOT (entity_id = $1 AND tenant_id = $2 AND (organization_id = $3 OR organization_id IS NULL)) ORDER BY id', [addressEntity, tenant, organization])
    expect(unrelated.rows).toEqual(before)
  })
})
