import { MikroORM } from '@mikro-orm/postgresql'
import { WebhookInboundReceiptEntity } from '../../data/entities'

it.each(['public', 'webhook_receipts_regression', 'webhook_receipts_"quoted'])(
  'creates the scoped null-safe receipt constraint in schema %s',
  async (schema) => {
    const orm = await MikroORM.init({
      entities: [WebhookInboundReceiptEntity],
      dbName: 'webhook_receipts_schema_test',
      schema,
    })
    try {
      const sql = await orm.schema.getCreateSchemaSQL({ wrap: false })
      const table = `"${schema.replaceAll('"', '""')}"."webhook_inbound_receipts"`
      const createdTable = schema === 'public' ? '"webhook_inbound_receipts"' : table
      expect(sql).toContain(`create table ${createdTable}`)
      expect(sql).toContain(
        `alter table ${table} add constraint "webhook_inbound_receipts_endpoint_message_unique" unique nulls not distinct ("endpoint_id", "message_id", "tenant_id", "organization_id")`,
      )
      expect(sql).not.toContain('alter table "webhook_inbound_receipts"')
    } finally {
      await orm.close(true)
    }
  },
)
