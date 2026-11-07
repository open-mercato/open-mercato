import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Issue #8893: this module's three encryption maps (message body, participant displayName,
// proposal rejectionReason) are declared in encryption.ts, but tenant encryption maps are only
// seeded at tenant creation (`auth:setup`). Every tenant that already existed before this module
// shipped has no map row for these entities, so `encryptEntityPayload` returns these fields
// unchanged (plaintext) once writes start. Forward-only: `down()` must not delete admin-edited maps.
export class Migration20261103090000_assisted_selling extends Migration {

  override name = 'Migration20261103090000';

  override up(): void {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'assisted_selling:assisted_selling_message',
      fields: [{ field: 'body' }],
    }));
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'assisted_selling:assisted_selling_participant',
      fields: [{ field: 'displayName' }],
    }));
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'assisted_selling:assisted_selling_proposal',
      fields: [{ field: 'rejectionReason' }],
    }));
  }

  override down(): void {}

}
