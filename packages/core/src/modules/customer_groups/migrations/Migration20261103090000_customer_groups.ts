import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Issue #8893: credit hold_reason/ledger note and purchase-approval decision notes are declared
// in encryption.ts, but tenant encryption maps are only seeded at tenant creation (`auth:setup`).
// Every tenant that already existed before these fields shipped has no map row for these
// entities, so `encryptEntityPayload` returns them unchanged (plaintext) once writes start.
// Forward-only: `down()` must not delete admin-edited maps.
export class Migration20261103090000_customer_groups extends Migration {

  override name = 'Migration20261103090000';

  override up(): void {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'customer_groups:customer_credit_account',
      fields: [{ field: 'hold_reason' }],
    }));
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'customer_groups:customer_credit_ledger_entry',
      fields: [{ field: 'note' }],
    }));
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'customer_groups:customer_purchase_approval',
      fields: [{ field: 'buyer_decision_note' }, { field: 'merchant_decision_note' }],
    }));
  }

  override down(): void {}

}
