import { Migration } from '@mikro-orm/migrations';

// Simplify the device active-unique index: replace the nil-UUID coalesce sentinel with a native
// NULLS NOT DISTINCT clause (Postgres 15+). Both express the same intent — dedupe null-org rows for
// the same (tenant, user, device) — but NULLS NOT DISTINCT drops the magic sentinel entirely.
export class Migration20260721120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "user_devices_tenant_org_user_device_active_unique";`);
    this.addSql(`create unique index "user_devices_tenant_org_user_device_active_unique" on "user_devices" ("tenant_id", "organization_id", "user_id", "device_id") nulls not distinct where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "user_devices_tenant_org_user_device_active_unique";`);
    this.addSql(`create unique index "user_devices_tenant_org_user_device_active_unique" on "user_devices" ("tenant_id", coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid), "user_id", "device_id") where deleted_at is null;`);
  }

}
