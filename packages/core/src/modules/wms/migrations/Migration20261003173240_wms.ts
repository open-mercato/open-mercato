import { Migration } from '@mikro-orm/migrations';

export class Migration20261003173240_wms extends Migration {

  override name = 'Migration20261003173240';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" drop constraint if exists "wms_sowa_warehouse_id_foreign";`);

    this.addSql(`alter table "wms_sales_order_warehouse_assignments" add constraint "wms_sales_order_warehouse_assignments_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);

    this.addSql(`alter table "wms_inventory_reservations" add "idempotency_key" text null;`);
    this.addSql(`create unique index "wms_inventory_reservations_idempotency_unique_idx" on "wms_inventory_reservations" ("organization_id", "idempotency_key") where idempotency_key is not null and deleted_at is null and status = 'active';`);

    this.addSql(`alter table "wms_inventory_movements" add "idempotency_key" text null;`);
    this.addSql(`create unique index "wms_inventory_movements_idempotency_unique_idx" on "wms_inventory_movements" ("organization_id", "idempotency_key") where idempotency_key is not null and deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_sales_order_warehouse_assignments" drop constraint if exists "wms_sales_order_warehouse_assignments_warehouse_id_foreign";`);

    this.addSql(`drop index "wms_inventory_reservations_idempotency_unique_idx";`);
    this.addSql(`alter table "wms_inventory_reservations" drop column "idempotency_key";`);

    this.addSql(`drop index "wms_inventory_movements_idempotency_unique_idx";`);
    this.addSql(`alter table "wms_inventory_movements" drop column "idempotency_key";`);

    this.addSql(`alter table "wms_sales_order_warehouse_assignments" add constraint "wms_sowa_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
  }

}
