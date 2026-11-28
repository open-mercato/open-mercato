import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

/**
 * `recipient_name` and `phone` were added to the `customers:customer_address` encryption map in
 * `encryption.ts`, but tenant maps are only seeded at tenant creation. Without this backfill an
 * upgraded tenant keeps writing both columns as plaintext. Forward-only on purpose: removing the
 * rules on `down()` would also switch off encryption for maps seeded or edited by admins.
 */
export class Migration20261026180000_customers_address_contact_encryption extends Migration {

  override name = 'Migration20261026180000_customers_address_contact_encryption';

  override up(): void | Promise<void> {
    this.addSql(
      buildEncryptionMapBackfillSql({
        entityId: 'customers:customer_address',
        fields: [{ field: 'recipient_name' }, { field: 'phone' }],
      }),
    );
  }

  override down(): void | Promise<void> {
    // Forward-only: see class doc.
  }

}
