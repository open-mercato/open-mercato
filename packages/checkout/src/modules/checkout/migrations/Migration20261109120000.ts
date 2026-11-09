import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Backfill the checkout module's encryption maps for every pre-existing (tenant, org) scope that
// already has active encryption maps. `defaultEncryptionMaps` in `../encryption.ts` only reaches
// tenants created after this change (`auth:setup`) — a tenant that predates the checkout module has
// no map for any of its three entities, `encryptEntityPayload` no-ops, and checkout_transaction PII
// (customer_data, first/last name, email, phone, accepted_legal_consents, ip_address) plus the
// checkout_link/checkout_link_template gateway_settings are written as PLAINTEXT. Entity ids and
// fields are written literally (not imported from encryption.ts) so this migration keeps meaning the
// same thing even if the module's declared maps change later. `down()` stays empty: deleting by
// entity_id would also remove maps seeded at tenant creation or edited by admins in the UI and
// silently switch encryption off for that entity.
export class Migration20261109120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'checkout:checkout_link_template',
      fields: [{ field: 'gateway_settings' }],
    }));

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'checkout:checkout_link',
      fields: [{ field: 'gateway_settings' }],
    }));

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'checkout:checkout_transaction',
      fields: [
        { field: 'customer_data' },
        { field: 'first_name' },
        { field: 'last_name' },
        { field: 'email' },
        { field: 'phone' },
        { field: 'accepted_legal_consents' },
        { field: 'ip_address' },
      ],
    }));
  }

  override async down(): Promise<void> {}

}
