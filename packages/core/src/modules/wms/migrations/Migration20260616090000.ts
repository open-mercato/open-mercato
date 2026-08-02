import { Migration } from '@mikro-orm/migrations'

export class Migration20260616090000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_inventory_movements" add column "reason_code" text null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_inventory_movements" drop column if exists "reason_code";`)
  }
}
