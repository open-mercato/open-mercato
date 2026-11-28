import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

export class Migration20261121224000_customers extends Migration {
  override name = 'Migration20261121224000_customers'

  override up(): void {
    this.addSql('alter table "customer_addresses" add "custom_values" jsonb null;')
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'customers:customer_address',
      fields: [{ field: 'custom_values' }],
    }))
  }

  override down(): void {}
}
