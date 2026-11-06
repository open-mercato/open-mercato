import { MetadataStorage } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { WebhookInboundReceiptEntity } from '../entities'
import { Migration20261027193000_receipt_scope } from '../../migrations/Migration20261027193000_receipt_scope'

it('keeps the named receipt constraint scoped and null-safe in metadata and migration', async () => {
  const metadata = Object.values(MetadataStorage.getMetadata()).find(
    (candidate) => candidate.className === WebhookInboundReceiptEntity.name,
  )
  const receiptConstraint = metadata?.uniques.find(
    (constraint) => constraint.name === 'webhook_inbound_receipts_endpoint_message_unique',
  )
  expect(receiptConstraint?.properties).toEqual(['endpointId', 'messageId', 'tenantId', 'organizationId'])
  const orm = await MikroORM.init({
    entities: [WebhookInboundReceiptEntity],
    dbName: 'webhook_receipts_schema_test',
  })
  let constraintSql: string | undefined
  try {
    const sql = await orm.schema.getCreateSchemaSQL({ wrap: false })
    constraintSql = sql.split('\n').find((statement) => statement.startsWith('alter table '))?.replace('"public".', '')
  } finally {
    await orm.close(true)
  }
  expect(constraintSql).toContain('unique nulls not distinct')

  const migration = Object.create(Migration20261027193000_receipt_scope.prototype) as Migration20261027193000_receipt_scope
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
  await migration.up()

  expect(migration.isTransactional()).toBe(true)
  expect(statements).toEqual([
    'alter table "webhook_inbound_receipts" drop constraint "webhook_inbound_receipts_endpoint_message_unique";',
    constraintSql,
  ])
})

it('refuses an automatic rollback that could discard legitimate cross-scope receipts', () => {
  const migration = Object.create(Migration20261027193000_receipt_scope.prototype) as Migration20261027193000_receipt_scope
  const addSql = jest.fn()
  Object.defineProperty(migration, 'addSql', { value: addSql })

  expect(() => migration.down()).toThrow('This migration cannot be reverted')
  expect(addSql).not.toHaveBeenCalled()
})
