import { Migration } from '@mikro-orm/migrations';

// Make device identity organization-aware: replace the (tenant, user, device) active-unique index
// with (tenant, org, user, device). organization_id is nullable, so coalesce null to the nil UUID —
// otherwise Postgres treats NULLs as distinct and would allow duplicate null-org rows for the same
// (tenant, user, device). Split out as its own migration so existing databases that already ran the
// table-creation migration pick up the new index instead of silently keeping the old one.
export class Migration20260630120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "user_devices_tenant_user_device_active_unique";`);
    this.addSql(`create unique index "user_devices_tenant_org_user_device_active_unique" on "user_devices" ("tenant_id", coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid), "user_id", "device_id") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "user_devices_tenant_org_user_device_active_unique";`);
    this.addSql(`create unique index "user_devices_tenant_user_device_active_unique" on "user_devices" ("tenant_id", "user_id", "device_id") where deleted_at is null;`);
  }

}
