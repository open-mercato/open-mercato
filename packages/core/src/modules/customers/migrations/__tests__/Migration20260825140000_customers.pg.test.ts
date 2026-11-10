import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { Migration20260825140000_customers } from '../Migration20260825140000_customers'

const postgresUrl = process.env.OM_CUSTOMERS_MIGRATION_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

async function runMigration(client: PoolClient, direction: 'up' | 'down'): Promise<void> {
  const migration = Object.create(
    Migration20260825140000_customers.prototype,
  ) as Migration20260825140000_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (statement: string) => statements.push(statement),
  })
  await migration[direction]()
  for (const statement of statements) await client.query(statement)
}

describePostgres('customer interaction channel migration against PostgreSQL', () => {
  let pool: Pool
  let client: PoolClient
  let schema: string
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const channelId = randomUUID()

  beforeAll(() => {
    pool = new Pool({ connectionString: postgresUrl })
  })

  beforeEach(async () => {
    client = await pool.connect()
    schema = `customer_channel_${randomUUID().replaceAll('-', '')}`
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET LOCAL search_path TO "${schema}"`)
    await client.query(`CREATE TABLE customer_interactions (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
      external_message_id uuid, interaction_type text NOT NULL, deleted_at timestamptz
    )`)
  })

  afterEach(async () => {
    await client.query('ROLLBACK')
    client.release()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function createSourceTables(links: boolean, conversations: boolean): Promise<void> {
    if (links) await client.query(`CREATE TABLE message_channel_links (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, external_conversation_id uuid NOT NULL
    )`)
    if (conversations) await client.query(`CREATE TABLE external_conversations (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, channel_id uuid NOT NULL
    )`)
  }

  async function assertDown(): Promise<void> {
    await runMigration(client, 'down')
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'customer_interactions' AND column_name = 'channel_id'`,
      [schema],
    )
    expect(columns.rows).toEqual([])
    expect((await client.query<{ index: string | null }>(
      `SELECT to_regclass('customer_interactions_email_channel_idx')::text AS index`,
    )).rows).toEqual([{ index: null }])
  }

  test.each([
    { links: false, conversations: false },
    { links: true, conversations: false },
    { links: false, conversations: true },
  ])('up/down works when optional sources are incomplete: %j', async ({ links, conversations }) => {
    await createSourceTables(links, conversations)
    const interactionId = randomUUID()
    await client.query(`INSERT INTO customer_interactions
      (id, tenant_id, entity_id, external_message_id, interaction_type)
      VALUES ($1, $2, $3, $4, 'email')`, [interactionId, tenantA, randomUUID(), randomUUID()])

    await runMigration(client, 'up')
    expect((await client.query<{ channel_id: string | null }>(
      'SELECT channel_id FROM customer_interactions WHERE id = $1', [interactionId],
    )).rows).toEqual([{ channel_id: null }])
    expect((await client.query<{ index: string | null }>(
      `SELECT to_regclass('customer_interactions_email_channel_idx')::text AS index`,
    )).rows).toEqual([{ index: 'customer_interactions_email_channel_idx' }])
    await assertDown()
    expect((await client.query('SELECT id FROM customer_interactions')).rows).toEqual([{ id: interactionId }])
  })

  test('backfills only tenant-matched email chains and survives rollback/reapply', async () => {
    await createSourceTables(true, true)
    const validConversation = randomUUID()
    const otherTenantConversation = randomUUID()
    const validLink = randomUUID()
    const mismatchedConversationLink = randomUUID()
    const validInteraction = randomUUID()
    const mismatchedInteraction = randomUUID()
    const mismatchedConversationInteraction = randomUUID()
    const nonEmailInteraction = randomUUID()
    const unresolvedInteraction = randomUUID()

    await client.query(`INSERT INTO external_conversations (id, tenant_id, channel_id)
      VALUES ($1, $2, $3), ($4, $5, $3)`,
    [validConversation, tenantA, channelId, otherTenantConversation, tenantB])
    await client.query(`INSERT INTO message_channel_links (id, tenant_id, external_conversation_id)
      VALUES ($1, $2, $3), ($4, $2, $5)`,
    [validLink, tenantA, validConversation, mismatchedConversationLink, otherTenantConversation])
    await client.query(`INSERT INTO customer_interactions
      (id, tenant_id, entity_id, external_message_id, interaction_type)
      VALUES ($1, $6, $8, $9, 'email'), ($2, $7, $8, $9, 'email'),
      ($3, $6, $8, $10, 'email'), ($4, $6, $8, $9, 'call'), ($5, $6, $8, $11, 'email')`,
    [validInteraction, mismatchedInteraction, mismatchedConversationInteraction, nonEmailInteraction,
      unresolvedInteraction, tenantA, tenantB, randomUUID(), validLink, mismatchedConversationLink, randomUUID()])

    const expected = [
      { id: validInteraction, channel_id: channelId },
      ...[mismatchedInteraction, mismatchedConversationInteraction, nonEmailInteraction, unresolvedInteraction]
        .map((id) => ({ id, channel_id: null })),
    ].sort((left, right) => left.id.localeCompare(right.id))

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runMigration(client, 'up')
      expect((await client.query<{ id: string; channel_id: string | null }>(
        'SELECT id, channel_id FROM customer_interactions ORDER BY id',
      )).rows).toEqual(expected)
      await assertDown()
      expect((await client.query('SELECT id FROM customer_interactions')).rowCount).toBe(5)
    }
  })
})
