import { Migration } from '@mikro-orm/migrations'

export class Migration20260829090000_wms extends Migration {
  override up(): void {
    this.addSql(`
      alter table "wms_sales_order_warehouse_assignments"
        rename constraint "wms_sowa_pkey" to "wms_sales_order_warehouse_assignments_pkey";
    `)
    this.addSql(`
      alter table "wms_sales_order_warehouse_assignments"
        add constraint "wms_sales_order_warehouse_assignments_warehouse_id_foreign"
        foreign key ("warehouse_id") references "wms_warehouses" ("id");
    `)
  }

  override down(): void {
    this.addSql(`
      alter table "wms_sales_order_warehouse_assignments"
        drop constraint if exists "wms_sales_order_warehouse_assignments_warehouse_id_foreign";
    `)
    this.addSql(`
      alter table "wms_sales_order_warehouse_assignments"
        rename constraint "wms_sales_order_warehouse_assignments_pkey" to "wms_sowa_pkey";
    `)
  }
}
