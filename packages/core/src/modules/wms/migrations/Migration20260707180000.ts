import { Migration } from '@mikro-orm/migrations'

export class Migration20260707180000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `alter table "wms_inventory_balances" add column "quantity_available" numeric(16,4) generated always as ("quantity_on_hand" - "quantity_reserved" - "quantity_allocated") stored not null;`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_inventory_balances" drop column if exists "quantity_available";`)
  }
}
