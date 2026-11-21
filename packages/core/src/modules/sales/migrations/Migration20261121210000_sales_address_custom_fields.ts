import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

export class Migration20261121210000_sales_address_custom_fields extends Migration {
  override name = 'Migration20261121210000_sales_address_custom_fields'

  override up(): void {
    this.addSql('alter table "sales_orders" add "address_custom_values" jsonb null;')
    this.addSql('alter table "sales_quotes" add "address_custom_values" jsonb null;')
    this.addSql('alter table "sales_document_addresses" add "custom_values" jsonb null;')
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'sales:sales_order',
      fields: [{ field: 'address_custom_values' }],
    }))
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'sales:sales_quote',
      fields: [{ field: 'address_custom_values' }],
    }))
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'sales:sales_document_address',
      fields: [{ field: 'custom_values' }],
    }))
  }

  override down(): void {}
}
