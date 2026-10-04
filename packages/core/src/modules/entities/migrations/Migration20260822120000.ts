import { Migration } from '@mikro-orm/migrations';

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
    this.addSql(`
      insert into "encryption_maps" ("id", "entity_id", "tenant_id", "organization_id", "fields_json", "is_active", "created_at", "updated_at")
      select gen_random_uuid(), 'phone_calls:phone_call', src."tenant_id", src."organization_id", '[{"field":"raw_snapshot"},{"field":"provider_facts"},{"field":"recording_url"}]'::jsonb, true, now(), now()
      from (
        select distinct "tenant_id", "organization_id"
        from "encryption_maps"
        where "is_active" = true and "deleted_at" is null
      ) src
      where not exists (
        select 1 from "encryption_maps" existing
        where existing."entity_id" = 'phone_calls:phone_call'
          and existing."tenant_id" is not distinct from src."tenant_id"
          and existing."organization_id" is not distinct from src."organization_id"
          and existing."deleted_at" is null
      );
    `);

    this.addSql(`
      insert into "encryption_maps" ("id", "entity_id", "tenant_id", "organization_id", "fields_json", "is_active", "created_at", "updated_at")
      select gen_random_uuid(), 'phone_calls:phone_call_participant', src."tenant_id", src."organization_id", '[{"field":"phone_number"},{"field":"display_name"},{"field":"email"}]'::jsonb, true, now(), now()
      from (
        select distinct "tenant_id", "organization_id"
        from "encryption_maps"
        where "is_active" = true and "deleted_at" is null
      ) src
      where not exists (
        select 1 from "encryption_maps" existing
        where existing."entity_id" = 'phone_calls:phone_call_participant'
          and existing."tenant_id" is not distinct from src."tenant_id"
          and existing."organization_id" is not distinct from src."organization_id"
          and existing."deleted_at" is null
      );
    `);
  }

  override async down(): Promise<void> {
    // Reverts the feature's encryption maps. phone_calls maps have no source other than this module,
    // so deleting them all returns the schema to its pre-feature state.
    this.addSql(`delete from "encryption_maps" where "entity_id" in ('phone_calls:phone_call', 'phone_calls:phone_call_participant');`);
  }

}
