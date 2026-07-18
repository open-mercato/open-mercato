import { Migration } from '@mikro-orm/migrations';

export class Migration20260718123959_production extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "production_boms" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "version" int not null, "status" text not null default 'draft', "valid_from" timestamptz null, "valid_to" timestamptz null, "name" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_boms_tenant_org_idx" on "production_boms" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_boms" add constraint "production_boms_scope_version_unique" unique ("tenant_id", "organization_id", "product_id", "variant_id", "version");`);
    this.addSql(`alter table "production_boms" add constraint "production_boms_status_check" check ("status" in ('draft', 'active', 'archived'));`);

    this.addSql(`create table "production_bom_items" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "bom_id" uuid not null, "component_product_id" uuid not null, "component_variant_id" uuid null, "qty_per_unit" numeric(18,6) not null, "uom" text not null, "scrap_factor" numeric(8,6) not null default 0, "is_phantom" boolean not null default false, "operation_sequence" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_bom_items_bom_idx" on "production_bom_items" ("bom_id");`);
    this.addSql(`create index "production_bom_items_tenant_org_idx" on "production_bom_items" ("tenant_id", "organization_id");`);

    this.addSql(`create table "production_planning_params" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "procurement" text not null, "lead_time_days" int not null default 0, "min_lot" numeric(18,6) not null default 0, "lot_multiple" numeric(18,6) not null default 0, "safety_stock" numeric(18,6) not null default 0, "backflush" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_planning_params_tenant_org_idx" on "production_planning_params" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_planning_params" add constraint "production_planning_params_scope_unique" unique ("tenant_id", "organization_id", "product_id", "variant_id");`);
    this.addSql(`alter table "production_planning_params" add constraint "production_planning_params_procurement_check" check ("procurement" in ('make', 'buy'));`);

    this.addSql(`create table "production_routings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "version" int not null, "status" text not null default 'draft', "name" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_routings_tenant_org_idx" on "production_routings" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_routings" add constraint "production_routings_scope_version_unique" unique ("tenant_id", "organization_id", "product_id", "variant_id", "version");`);
    this.addSql(`alter table "production_routings" add constraint "production_routings_status_check" check ("status" in ('draft', 'active', 'archived'));`);

    this.addSql(`create table "production_routing_operations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "routing_id" uuid not null, "sequence" int not null, "name" text not null, "work_center_id" uuid not null, "setup_time_minutes" numeric(12,2) not null default 0, "run_time_per_unit_seconds" numeric(12,4) not null default 0, "is_reporting_point" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_routing_operations_routing_idx" on "production_routing_operations" ("routing_id", "sequence");`);
    this.addSql(`create index "production_routing_operations_tenant_org_idx" on "production_routing_operations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "production_work_centers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "kind" text not null, "cost_rate_per_hour" numeric(18,4) not null, "parallel_stations" int not null default 1, "efficiency_factor" numeric(8,4) not null default 1, "availability_rule_set_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_work_centers_tenant_org_idx" on "production_work_centers" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_work_centers" add constraint "production_work_centers_kind_check" check ("kind" in ('machine', 'manual', 'line', 'subcontractor'));`);
  }

}
