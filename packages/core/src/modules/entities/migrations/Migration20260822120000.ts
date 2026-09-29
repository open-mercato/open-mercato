import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Backfill the phone_calls encryption maps for every pre-existing (tenant, org) scope that already
// has active encryption maps. Encryption maps are seeded only at tenant creation (`entities
// seed-encryption`), so a tenant that predates the phone_calls module has no map for either of its
// entities, `encryptEntityPayload` no-ops, and caller/destination numbers plus the untouched Tillio
// payload are written as PLAINTEXT, both in the base tables and in the query index doc. Restricting
// the insert to scopes that ALREADY have maps mirrors what seed-encryption does and correctly skips
// tenants with encryption disabled (which have no maps at all). Idempotent via the NOT EXISTS guard,
// so re-runs are a no-op and it stays consistent with the runtime `upsertEncryptionMapSpecs` helper.
// Same shape as the `devices:user_device` backfill in Migration20260722120000.
export class Migration20260822120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'phone_calls:phone_call',
      fields: [{ field: 'raw_snapshot' }, { field: 'provider_facts' }, { field: 'recording_url' }],
    }));

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'phone_calls:phone_call_participant',
      fields: [{ field: 'phone_number' }, { field: 'display_name' }, { field: 'email' }],
    }));
  }

  override async down(): Promise<void> {
    // Reverts the feature's encryption maps. phone_calls maps have no source other than this module,
    // so deleting them all returns the schema to its pre-feature state.
    this.addSql(`delete from "encryption_maps" where "entity_id" in ('phone_calls:phone_call', 'phone_calls:phone_call_participant');`);
  }

}
