import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20260825140000_customers } from '../migrations/Migration20260825140000_customers'

/**
 * TC-CRM-7325: Migration20260825140000_customers runs whether or not the app
 * enables `communication_channels`, whose two tables the channel backfill reads.
 *
 * Every statement in the migration names its tables unqualified, so each test
 * runs it inside a throwaway schema set as the session `search_path`. The
 * migrated database's own tables stay out of reach, and each test decides which
 * of the peer tables exist.
 */

type PeerTable = 'message_channel_links' | 'external_conversations'

const tenantA = randomUUID()
const tenantB = randomUUID()

async function collectMigrationSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20260825140000_customers.prototype,
  ) as Migration20260825140000_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  await migration[direction]()
  return statements
}

async function runMigration(client: IntegrationDbClient, direction: 'up' | 'down'): Promise<void> {
  for (const statement of await collectMigrationSql(direction)) {
    await client.query(statement)
  }
}

async function inIsolatedSchema(
  peerTables: readonly PeerTable[],
  run: (client: IntegrationDbClient, schema: string) => Promise<void>,
): Promise<void> {
  const schema = `tc_crm_7325_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  await withClient(async (client) => {
    await client.query(`create schema "${schema}"`)
    try {
      await client.query(`set search_path to "${schema}"`)
      await client.query(
        `create table customer_interactions (
           id uuid primary key,
           tenant_id uuid not null,
           entity_id uuid not null,
           interaction_type text not null,
           external_message_id uuid null,
           deleted_at timestamptz null
         )`,
      )
      if (peerTables.includes('message_channel_links')) {
        await client.query(
          `create table message_channel_links (
             id uuid primary key,
             tenant_id uuid not null,
             external_conversation_id uuid not null
           )`,
        )
      }
      if (peerTables.includes('external_conversations')) {
        await client.query(
          `create table external_conversations (
             id uuid primary key,
             tenant_id uuid not null,
             channel_id uuid not null
           )`,
        )
      }
      await run(client, schema)
    } finally {
      await client.query('reset search_path')
      await client.query(`drop schema "${schema}" cascade`)
    }
  })
}

async function insertInteraction(
  client: IntegrationDbClient,
  row: { tenantId: string; interactionType: string; externalMessageId: string | null },
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `insert into customer_interactions (id, tenant_id, entity_id, interaction_type, external_message_id)
     values ($1, $2, $3, $4, $5)`,
    [id, row.tenantId, randomUUID(), row.interactionType, row.externalMessageId],
  )
  return id
}

async function insertLink(client: IntegrationDbClient, tenantId: string, conversationId: string): Promise<string> {
  const id = randomUUID()
  await client.query(
    'insert into message_channel_links (id, tenant_id, external_conversation_id) values ($1, $2, $3)',
    [id, tenantId, conversationId],
  )
  return id
}

async function insertConversation(client: IntegrationDbClient, tenantId: string, channelId: string): Promise<string> {
  const id = randomUUID()
  await client.query(
    'insert into external_conversations (id, tenant_id, channel_id) values ($1, $2, $3)',
    [id, tenantId, channelId],
  )
  return id
}

async function readChannelIds(client: IntegrationDbClient): Promise<Map<string, string | null>> {
  const result = await client.query<{ id: string; channel_id: string | null }>(
    'select id, channel_id from customer_interactions',
  )
  return new Map(result.rows.map((row) => [row.id, row.channel_id]))
}

async function readSchemaState(
  client: IntegrationDbClient,
  schema: string,
): Promise<{ hasChannelColumn: boolean; hasChannelIndex: boolean }> {
  const column = await client.query(
    `select 1 from information_schema.columns
      where table_schema = $1 and table_name = 'customer_interactions' and column_name = 'channel_id'`,
    [schema],
  )
  const index = await client.query(
    `select 1 from pg_indexes
      where schemaname = $1 and indexname = 'customer_interactions_email_channel_idx'`,
    [schema],
  )
  return { hasChannelColumn: column.rows.length === 1, hasChannelIndex: index.rows.length === 1 }
}

test.describe('TC-CRM-7325: the channel backfill migration runs with and without communication_channels', () => {
  test('up and down both apply when neither communication_channels table exists', async () => {
    await inIsolatedSchema([], async (client, schema) => {
      const interactionId = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'email',
        externalMessageId: randomUUID(),
      })

      await runMigration(client, 'up')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: true, hasChannelIndex: true })
      expect((await readChannelIds(client)).get(interactionId)).toBeNull()

      await runMigration(client, 'down')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: false, hasChannelIndex: false })
    })
  })

  test('up and down both apply when only message_channel_links exists', async () => {
    await inIsolatedSchema(['message_channel_links'], async (client, schema) => {
      const linkId = await insertLink(client, tenantA, randomUUID())
      const interactionId = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'email',
        externalMessageId: linkId,
      })

      await runMigration(client, 'up')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: true, hasChannelIndex: true })
      expect((await readChannelIds(client)).get(interactionId)).toBeNull()

      await runMigration(client, 'down')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: false, hasChannelIndex: false })
    })
  })

  test('up and down both apply when only external_conversations exists', async () => {
    await inIsolatedSchema(['external_conversations'], async (client, schema) => {
      await insertConversation(client, tenantA, randomUUID())
      const interactionId = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'email',
        externalMessageId: randomUUID(),
      })

      await runMigration(client, 'up')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: true, hasChannelIndex: true })
      expect((await readChannelIds(client)).get(interactionId)).toBeNull()

      await runMigration(client, 'down')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: false, hasChannelIndex: false })
    })
  })

  test('up sets channel_id only on email interactions whose link and conversation share their tenant', async () => {
    await inIsolatedSchema(['message_channel_links', 'external_conversations'], async (client, schema) => {
      const channelA = randomUUID()
      const conversationA = await insertConversation(client, tenantA, channelA)
      const conversationB = await insertConversation(client, tenantB, randomUUID())
      const linkToOwnConversation = await insertLink(client, tenantA, conversationA)
      const linkToForeignConversation = await insertLink(client, tenantA, conversationB)

      const sameTenantEmail = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'email',
        externalMessageId: linkToOwnConversation,
      })
      const foreignTenantLink = await insertInteraction(client, {
        tenantId: tenantB,
        interactionType: 'email',
        externalMessageId: linkToOwnConversation,
      })
      const foreignTenantConversation = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'email',
        externalMessageId: linkToForeignConversation,
      })
      const sameTenantNonEmail = await insertInteraction(client, {
        tenantId: tenantA,
        interactionType: 'call',
        externalMessageId: linkToOwnConversation,
      })

      await runMigration(client, 'up')

      expect(await readChannelIds(client)).toEqual(
        new Map([
          [sameTenantEmail, channelA],
          [foreignTenantLink, null],
          [foreignTenantConversation, null],
          [sameTenantNonEmail, null],
        ]),
      )

      await runMigration(client, 'down')

      expect(await readSchemaState(client, schema)).toEqual({ hasChannelColumn: false, hasChannelIndex: false })
    })
  })
})
