import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20261027193000_receipt_scope } from '../migrations/Migration20261027193000_receipt_scope'

test('TC-WEBHOOK-014: receipt deduplication isolates tenant, organization, and unscoped namespaces', async () => {
  await withClient(async (client) => {
    await client.query('create temporary table receipt_scope_test (like webhook_inbound_receipts including all)')
    try {
      const tenantId = randomUUID()
      const organizationId = randomUUID()
      const scopes = [
        [tenantId, organizationId],
        [tenantId, randomUUID()],
        [randomUUID(), organizationId],
        [null, null],
        [tenantId, null],
        [null, organizationId],
      ]

      for (const scope of scopes) {
        const insert = () => client.query<{ id: string }>(
          `insert into receipt_scope_test (endpoint_id, message_id, provider_key, tenant_id, organization_id, created_at)
           values ('shared-source', 'shared-message', 'shared-source', $1, $2, now())
           on conflict do nothing returning id`,
          scope,
        )
        expect((await insert()).rowCount).toBe(1)
        expect((await insert()).rowCount).toBe(0)
      }

      expect((await client.query('select id from receipt_scope_test')).rowCount).toBe(scopes.length)
    } finally {
      await client.query('drop table receipt_scope_test')
    }
  })
})

test('TC-WEBHOOK-014: migrating historic receipts preserves their identity and replay protection', async () => {
  await withClient(async (client) => {
    await client.query('create temporary table webhook_inbound_receipts (like public.webhook_inbound_receipts including defaults)')
    try {
      await client.query('alter table webhook_inbound_receipts add constraint webhook_inbound_receipts_endpoint_message_unique unique (endpoint_id, message_id)')
      const tenantId = randomUUID()
      const organizationId = randomUUID()
      const insert = (messageId: string, scope: [string | null, string | null]) => client.query<{ id: string }>(
        `insert into webhook_inbound_receipts (endpoint_id, message_id, provider_key, tenant_id, organization_id, created_at)
         values ('shared-source', $1, 'shared-source', $2, $3, now())
         on conflict on constraint webhook_inbound_receipts_endpoint_message_unique do nothing returning id`,
        [messageId, ...scope],
      )
      const scopedReceipt = await insert('historic-scoped', [tenantId, organizationId])
      const unscopedReceipt = await insert('historic-unscoped', [null, null])
      const otherOrganizationId = randomUUID()
      expect((await insert('historic-scoped', [tenantId, otherOrganizationId])).rowCount).toBe(0)

      const migration = Object.create(Migration20261027193000_receipt_scope.prototype) as Migration20261027193000_receipt_scope
      const statements: string[] = []
      Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
      await migration.up()
      await client.query('begin')
      try {
        for (const statement of statements) await client.query(statement)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }

      const preserved = await client.query<{ id: string }>('select id from webhook_inbound_receipts')
      expect(preserved.rows.map((receipt) => receipt.id).sort()).toEqual([
        scopedReceipt.rows[0].id,
        unscopedReceipt.rows[0].id,
      ].sort())
      expect((await insert('historic-scoped', [tenantId, otherOrganizationId])).rowCount).toBe(1)
      expect((await insert('historic-scoped', [tenantId, organizationId])).rowCount).toBe(0)
      expect((await insert('historic-unscoped', [null, null])).rowCount).toBe(0)
    } finally {
      await client.query('drop table pg_temp.webhook_inbound_receipts')
    }
  })
})
