import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Issue #8893: `checkout:checkout_session` (email/phone/shipping_address/billing_address) is
// declared in encryption.ts but tenant encryption maps are only seeded at tenant creation
// (`auth:setup`). Every tenant that already existed before this column shipped has no map row
// for this entity, so `encryptEntityPayload` returns these fields unchanged (plaintext) once
// checkout sessions start writing them. Forward-only: `down()` must not delete admin-edited maps.
export class Migration20261103090000 extends Migration {

  override up(): void {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'checkout:checkout_session',
      fields: [
        { field: 'email' },
        { field: 'phone' },
        { field: 'shipping_address' },
        { field: 'billing_address' },
      ],
    }));
  }

  override down(): void {}

}
