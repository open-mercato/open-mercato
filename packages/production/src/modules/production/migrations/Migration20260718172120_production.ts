import { Migration } from '@mikro-orm/migrations';

export class Migration20260718172120_production extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "production_orders" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" int not null, "product_id" uuid not null, "variant_id" uuid null, "qty_planned" numeric(18,6) not null, "uom" text not null, "due_date" timestamptz null, "priority" int not null default 0, "status" text not null default 'draft', "source_type" text not null default 'manual', "source_id" uuid null, "bom_version_id" uuid null, "routing_version_id" uuid null, "released_at" timestamptz null, "qty_completed" numeric(18,6) not null default 0, "qty_scrapped" numeric(18,6) not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_orders_tenant_org_idx" on "production_orders" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_orders" add constraint "production_orders_scope_number_unique" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "production_order_materials" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "operation_sequence" int null, "component_product_id" uuid not null, "component_variant_id" uuid null, "qty_required" numeric(18,6) not null, "uom" text not null, "scrap_factor" numeric(8,6) not null default 0, "qty_issued" numeric(18,6) not null default 0, "source_bom_item_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_order_materials_order_idx" on "production_order_materials" ("order_id");`);
    this.addSql(`create index "production_order_materials_tenant_org_idx" on "production_order_materials" ("tenant_id", "organization_id");`);

    this.addSql(`create table "production_order_operations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "sequence" int not null, "name" text not null, "work_center_id" uuid not null, "setup_time_minutes" numeric(12,2) not null default 0, "run_time_per_unit_seconds" numeric(12,4) not null default 0, "is_reporting_point" boolean not null default false, "status" text not null default 'pending', "qty_good" numeric(18,6) not null default 0, "qty_scrap" numeric(18,6) not null default 0, "source_operation_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_order_operations_order_idx" on "production_order_operations" ("order_id", "sequence");`);
    this.addSql(`create index "production_order_operations_tenant_org_idx" on "production_order_operations" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "production_orders" add constraint "production_orders_status_check" check ("status" in ('draft', 'planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled'));`);
    this.addSql(`alter table "production_orders" add constraint "production_orders_source_type_check" check ("source_type" in ('sales_order', 'mrp', 'manual'));`);

    this.addSql(`alter table "production_order_operations" add constraint "production_order_operations_status_check" check ("status" in ('pending', 'in_progress', 'done'));`);
  }

}
