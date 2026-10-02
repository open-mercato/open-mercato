import { Migration } from '@mikro-orm/migrations'

export class Migration20260822130000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_asns" add column "source_key" text null;`)
    this.addSql(
      `create unique index "wms_asns_org_source_key_unique_idx" on "wms_asns" ("organization_id", "source_key") where source_key is not null and deleted_at is null;`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "wms_asns_org_source_key_unique_idx";`)
    this.addSql(`alter table "wms_asns" drop column if exists "source_key";`)
  }
}
