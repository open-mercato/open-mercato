import { Migration } from '@mikro-orm/migrations'

export class Migration20260822120000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_putaway_tasks" add column "putaway_key" text null;`)
    // Exclude cancelled so cancel-without-clearing-key (legacy rows) cannot block
    // ASN receive recreate; cancel also nulls putaway_key in the command path.
    this.addSql(
      `create unique index "wms_putaway_tasks_org_putaway_key_unique_idx" on "wms_putaway_tasks" ("organization_id", "putaway_key") where putaway_key is not null and deleted_at is null and status <> 'cancelled';`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "wms_putaway_tasks_org_putaway_key_unique_idx";`)
    this.addSql(`alter table "wms_putaway_tasks" drop column if exists "putaway_key";`)
  }
}
