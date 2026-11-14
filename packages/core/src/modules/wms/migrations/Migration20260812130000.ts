import { Migration } from '@mikro-orm/migrations'

export class Migration20260812130000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `create table "wms_putaway_tasks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "source_location_id" uuid not null, "target_location_id" uuid null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "quantity" numeric(16,4) not null, "status" text not null default 'open', "assigned_to" uuid null, "priority" int not null default 5, primary key ("id"));`,
    )
    this.addSql(
      `create index "wms_putaway_tasks_org_warehouse_status_priority_idx" on "wms_putaway_tasks" ("organization_id", "warehouse_id", "status", "priority");`,
    )
    this.addSql(
      `create index "wms_putaway_tasks_org_assigned_status_idx" on "wms_putaway_tasks" ("organization_id", "assigned_to", "status");`,
    )
    this.addSql(
      `create index "wms_putaway_tasks_org_tenant_idx" on "wms_putaway_tasks" ("organization_id", "tenant_id");`,
    )
    this.addSql(
      `alter table "wms_putaway_tasks" add constraint "wms_putaway_tasks_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "wms_putaway_tasks" drop constraint if exists "wms_putaway_tasks_warehouse_id_foreign";`,
    )
    this.addSql(`drop table if exists "wms_putaway_tasks" cascade;`)
  }
}
