import { Migration } from '@mikro-orm/migrations';

export class Migration20261027150215_property_management extends Migration {

  override name = 'Migration20261027150215';

  override up(): void | Promise<void> {
    this.addSql(`create table "property_management_buildings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "address" text not null, "status" text not null default 'active', "archived_at" timestamptz null, "opening_hours_enabled" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_buildings_scope_idx" on "property_management_buildings" ("organization_id", "tenant_id");`);
    this.addSql(`create index "property_management_buildings_org_status_idx" on "property_management_buildings" ("organization_id", "status");`);

    this.addSql(`create table "property_management_building_managers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "property_management_building_managers_user_idx" on "property_management_building_managers" ("organization_id", "user_id");`);
    this.addSql(`alter table "property_management_building_managers" add constraint "property_management_building_managers_unique" unique ("building_id", "user_id");`);

    this.addSql(`create table "property_management_common_areas" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "floor_id" uuid not null, "name" text not null, "kind" text not null, "x" numeric(7,2) not null, "y" numeric(7,2) not null, "width" numeric(7,2) not null, "depth" numeric(7,2) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_common_areas_building_idx" on "property_management_common_areas" ("organization_id", "building_id");`);
    this.addSql(`create index "property_management_common_areas_floor_idx" on "property_management_common_areas" ("organization_id", "floor_id");`);

    this.addSql(`create table "property_management_floors" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "number" int not null, "name" text not null, "size_x" numeric(7,2) not null, "size_y" numeric(7,2) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "property_management_floors_number_unique" on "property_management_floors" ("building_id", "number") where "deleted_at" is null;`);
    this.addSql(`create index "property_management_floors_building_idx" on "property_management_floors" ("organization_id", "building_id");`);

    this.addSql(`create table "property_management_product_uses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "catalog_product_id" uuid not null, "use" text not null, "billing_unit" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "property_management_product_uses" add constraint "property_management_product_uses_product_unique" unique ("organization_id", "catalog_product_id");`);

    this.addSql(`create table "property_management_spaces" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "floor_id" uuid not null, "name" text not null, "purpose" text null, "x" numeric(7,2) not null, "y" numeric(7,2) not null, "width" numeric(7,2) not null, "depth" numeric(7,2) not null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_spaces_building_idx" on "property_management_spaces" ("organization_id", "building_id");`);
    this.addSql(`create index "property_management_spaces_floor_idx" on "property_management_spaces" ("organization_id", "floor_id");`);

    this.addSql(`create table "property_management_units" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "floor_id" uuid not null, "space_id" uuid not null, "name" text not null, "catalog_category_id" uuid not null, "catalog_product_id" uuid not null, "x" numeric(7,2) not null, "y" numeric(7,2) not null, "width" numeric(7,2) not null, "depth" numeric(7,2) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_units_building_idx" on "property_management_units" ("organization_id", "building_id");`);
    this.addSql(`create index "property_management_units_product_idx" on "property_management_units" ("organization_id", "catalog_product_id");`);
    this.addSql(`create index "property_management_units_space_idx" on "property_management_units" ("organization_id", "space_id");`);
    this.addSql(`create index "property_management_units_floor_idx" on "property_management_units" ("organization_id", "floor_id");`);

    this.addSql(`create table "property_management_unit_product_periods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "unit_id" uuid not null, "catalog_product_id" uuid not null, "product_name" text not null, "use" text not null, "billing_unit" text not null, "price_amount" numeric(16,4) null, "currency_code" text null, "price_kind_id" uuid null, "valid_from" timestamptz not null, "valid_to" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "property_management_unit_product_periods_open_unique" on "property_management_unit_product_periods" ("unit_id") where "valid_to" is null;`);
    this.addSql(`create index "property_management_unit_product_periods_unit_idx" on "property_management_unit_product_periods" ("organization_id", "unit_id", "valid_from");`);
  }

}
