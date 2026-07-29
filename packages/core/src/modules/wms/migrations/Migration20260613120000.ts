import { Migration } from '@mikro-orm/migrations'

export class Migration20260613120000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_inventory_movements" add column "idempotency_key" text null;`)
    this.addSql(`alter table "wms_inventory_reservations" add column "idempotency_key" text null;`)
    this.addSql(
      `create unique index "wms_inventory_movements_idempotency_unique_idx" on "wms_inventory_movements" ("organization_id", "idempotency_key") where idempotency_key is not null and deleted_at is null;`,
    )
    this.addSql(
      `create unique index "wms_inventory_reservations_idempotency_unique_idx" on "wms_inventory_reservations" ("organization_id", "idempotency_key") where idempotency_key is not null and deleted_at is null and status = 'active';`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "wms_inventory_reservations_idempotency_unique_idx";`)
    this.addSql(`drop index if exists "wms_inventory_movements_idempotency_unique_idx";`)
    this.addSql(`alter table "wms_inventory_reservations" drop column if exists "idempotency_key";`)
    this.addSql(`alter table "wms_inventory_movements" drop column if exists "idempotency_key";`)
  }
}
