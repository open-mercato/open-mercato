import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

export class Migration20261107120000_mfa_secret_encryption extends Migration {
  override up(): void {
    this.addSql('alter table "user_mfa_methods" add column "secret_hash" text null;')
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'security:user_mfa_method',
      fields: [{ field: 'secret', hashField: 'secret_hash' }, { field: 'provider_metadata' }],
    }))
  }
}
