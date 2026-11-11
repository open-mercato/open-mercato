import { Migration } from '@mikro-orm/migrations'

export class Migration20261029120000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_putaway_tasks" add column "serial_number" text null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_putaway_tasks" drop column if exists "serial_number";`)
  }
}
