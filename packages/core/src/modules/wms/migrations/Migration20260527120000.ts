import { Migration } from '@mikro-orm/migrations';

export class Migration20260527120000_wms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_warehouses" add column "is_primary" boolean not null default false;`);
    this.addSql(`create unique index "wms_warehouses_org_primary_unique_idx" on "wms_warehouses" ("organization_id") where deleted_at is null and is_primary = true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "wms_warehouses_org_primary_unique_idx";`);
    this.addSql(`alter table "wms_warehouses" drop column if exists "is_primary";`);
  }

}
