import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Backfill the `devices:user_device` encryption map for every pre-existing (tenant, org) scope that
// already has active encryption maps. The devices push-token feature adds a new encrypted entity, but
// encryption maps are seeded only at tenant creation (`entities seed-encryption`) — so without this an
// existing tenant that upgrades has no map for the device entity, `encryptEntityPayload` no-ops, and
// `push_token` is written as PLAINTEXT. Restricting the insert to scopes that ALREADY have maps mirrors
// what seed-encryption does and correctly skips tenants with encryption disabled (which have no maps at
// all). Idempotent via the NOT EXISTS guard, so it matches the runtime `upsertEncryptionMapSpecs` helper
// and the `devices.seed-push-token-encryption-map` upgrade action; re-runs are a no-op.
export class Migration20260722120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'devices:user_device',
      fields: [{ field: 'push_token' }],
    }));
  }

  override async down(): Promise<void> {
    // Reverts the feature's encryption map. `devices:user_device` maps have no source other than this
    // feature, so deleting them all returns the schema to its pre-feature state.
    this.addSql(`delete from "encryption_maps" where "entity_id" = 'devices:user_device';`);
  }

}
