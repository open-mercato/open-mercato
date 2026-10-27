import { Migration } from '@mikro-orm/migrations';

export class Migration20260428110546_wms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "wms_inventory_lots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "catalog_variant_id" uuid not null, "sku" text not null, "lot_number" text not null, "batch_number" text null, "manufactured_at" timestamptz null, "best_before_at" timestamptz null, "expires_at" timestamptz null, "status" text not null default 'available', primary key ("id"));`);
    this.addSql(`create unique index "wms_inventory_lots_variant_lot_unique_idx" on "wms_inventory_lots" ("organization_id", "catalog_variant_id", "lot_number") where deleted_at is null;`);
    this.addSql(`create index "wms_inventory_lots_variant_idx" on "wms_inventory_lots" ("catalog_variant_id");`);
    this.addSql(`create index "wms_inventory_lots_org_tenant_idx" on "wms_inventory_lots" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_product_inventory_profiles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "catalog_product_id" uuid not null, "catalog_variant_id" uuid null, "default_uom" text not null, "track_lot" boolean not null default false, "track_serial" boolean not null default false, "track_expiration" boolean not null default false, "default_strategy" text not null, "reorder_point" numeric(16,4) not null default '0', "safety_stock" numeric(16,4) not null default '0', primary key ("id"));`);
    this.addSql(`create unique index "wms_inventory_profiles_product_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_product_id") where deleted_at is null and catalog_variant_id is null;`);
    this.addSql(`create unique index "wms_inventory_profiles_variant_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_variant_id") where deleted_at is null and catalog_variant_id is not null;`);
    this.addSql(`create index "wms_inventory_profiles_org_tenant_idx" on "wms_product_inventory_profiles" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_warehouses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" text not null, "code" text not null, "is_active" boolean not null default true, "address_line1" text null, "city" text null, "postal_code" text null, "country" text null, "timezone" text null, primary key ("id"));`);
    this.addSql(`create unique index "wms_warehouses_org_code_unique_idx" on "wms_warehouses" ("organization_id", "code") where deleted_at is null;`);
    this.addSql(`create index "wms_warehouses_org_tenant_idx" on "wms_warehouses" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_inventory_reservations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity" numeric(16,4) not null, "source_type" text not null, "source_id" uuid not null, "expires_at" timestamptz null, "status" text not null default 'active', primary key ("id"));`);
    this.addSql(`create index "wms_inventory_reservations_status_idx" on "wms_inventory_reservations" ("organization_id", "warehouse_id", "catalog_variant_id", "status");`);
    this.addSql(`create index "wms_inventory_reservations_source_idx" on "wms_inventory_reservations" ("organization_id", "source_type", "source_id");`);
    this.addSql(`create index "wms_inventory_reservations_org_tenant_idx" on "wms_inventory_reservations" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_warehouse_locations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "code" text not null, "type" text not null, "parent_id" uuid null, "is_active" boolean not null default true, "capacity_units" numeric(16,4) null, "capacity_weight" numeric(16,4) null, "constraints" jsonb null, primary key ("id"));`);
    this.addSql(`create unique index "wms_warehouse_locations_warehouse_code_unique_idx" on "wms_warehouse_locations" ("warehouse_id", "code") where deleted_at is null;`);
    this.addSql(`create index "wms_warehouse_locations_parent_idx" on "wms_warehouse_locations" ("parent_id");`);
    this.addSql(`create index "wms_warehouse_locations_warehouse_idx" on "wms_warehouse_locations" ("warehouse_id");`);
    this.addSql(`create index "wms_warehouse_locations_org_tenant_idx" on "wms_warehouse_locations" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_inventory_movements" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "location_from_id" uuid null, "location_to_id" uuid null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity" numeric(16,4) not null, "type" text not null, "reference_type" text not null, "reference_id" uuid not null, "performed_by" uuid not null, "performed_at" timestamptz not null, "received_at" timestamptz not null, "reason" text null, primary key ("id"));`);
    this.addSql(`create index "wms_inventory_movements_warehouse_performed_at_idx" on "wms_inventory_movements" ("organization_id", "warehouse_id", "performed_at" desc) where deleted_at is null;`);
    this.addSql(`create index "wms_inventory_movements_reference_idx" on "wms_inventory_movements" ("organization_id", "reference_type", "reference_id");`);
    this.addSql(`create index "wms_inventory_movements_variant_received_at_idx" on "wms_inventory_movements" ("organization_id", "catalog_variant_id", "received_at" desc) where deleted_at is null;`);
    this.addSql(`create index "wms_inventory_movements_org_tenant_idx" on "wms_inventory_movements" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_inventory_balances" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "location_id" uuid not null, "catalog_variant_id" uuid not null, "lot_id" uuid null, "serial_number" text null, "quantity_on_hand" numeric(16,4) not null default '0', "quantity_reserved" numeric(16,4) not null default '0', "quantity_allocated" numeric(16,4) not null default '0', primary key ("id"));`);
    this.addSql(`create unique index "wms_inventory_balances_serial_unique_idx" on "wms_inventory_balances" ("organization_id", "warehouse_id", "location_id", "catalog_variant_id", "serial_number") where serial_number is not null and deleted_at is null;`);
    this.addSql(`create index "wms_inventory_balances_org_lot_idx" on "wms_inventory_balances" ("organization_id", "lot_id") where lot_id is not null and deleted_at is null;`);
    this.addSql(`create index "wms_inventory_balances_org_location_variant_idx" on "wms_inventory_balances" ("organization_id", "location_id", "catalog_variant_id");`);
    this.addSql(`create index "wms_inventory_balances_org_warehouse_variant_idx" on "wms_inventory_balances" ("organization_id", "warehouse_id", "catalog_variant_id");`);
    this.addSql(`create index "wms_inventory_balances_org_tenant_idx" on "wms_inventory_balances" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_warehouse_zones" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "code" text not null, "name" text not null, "priority" int not null default 0, primary key ("id"));`);
    this.addSql(`create unique index "wms_warehouse_zones_warehouse_code_unique_idx" on "wms_warehouse_zones" ("warehouse_id", "code") where deleted_at is null;`);
    this.addSql(`create index "wms_warehouse_zones_warehouse_idx" on "wms_warehouse_zones" ("warehouse_id");`);
    this.addSql(`create index "wms_warehouse_zones_org_tenant_idx" on "wms_warehouse_zones" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "wms_inventory_reservations" add constraint "wms_inventory_reservations_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
    this.addSql(`alter table "wms_inventory_reservations" add constraint "wms_inventory_reservations_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on delete set null;`);

    this.addSql(`alter table "wms_warehouse_locations" add constraint "wms_warehouse_locations_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
    this.addSql(`alter table "wms_warehouse_locations" add constraint "wms_warehouse_locations_parent_id_foreign" foreign key ("parent_id") references "wms_warehouse_locations" ("id") on delete set null;`);

    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_location_from_id_foreign" foreign key ("location_from_id") references "wms_warehouse_locations" ("id") on delete set null;`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_location_to_id_foreign" foreign key ("location_to_id") references "wms_warehouse_locations" ("id") on delete set null;`);
    this.addSql(`alter table "wms_inventory_movements" add constraint "wms_inventory_movements_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on delete set null;`);

    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_location_id_foreign" foreign key ("location_id") references "wms_warehouse_locations" ("id");`);
    this.addSql(`alter table "wms_inventory_balances" add constraint "wms_inventory_balances_lot_id_foreign" foreign key ("lot_id") references "wms_inventory_lots" ("id") on delete set null;`);

    this.addSql(`alter table "wms_warehouse_zones" add constraint "wms_warehouse_zones_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_inventory_reservations" drop constraint if exists "wms_inventory_reservations_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_lot_id_foreign";`);
    this.addSql(`alter table "wms_inventory_reservations" drop constraint if exists "wms_inventory_reservations_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_locations" drop constraint if exists "wms_warehouse_locations_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_zones" drop constraint if exists "wms_warehouse_zones_warehouse_id_foreign";`);
    this.addSql(`alter table "wms_warehouse_locations" drop constraint if exists "wms_warehouse_locations_parent_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_location_from_id_foreign";`);
    this.addSql(`alter table "wms_inventory_movements" drop constraint if exists "wms_inventory_movements_location_to_id_foreign";`);
    this.addSql(`alter table "wms_inventory_balances" drop constraint if exists "wms_inventory_balances_location_id_foreign";`);

    this.addSql(`drop table if exists "wms_warehouse_zones" cascade;`);
    this.addSql(`drop table if exists "wms_inventory_balances" cascade;`);
    this.addSql(`drop table if exists "wms_inventory_movements" cascade;`);
    this.addSql(`drop table if exists "wms_warehouse_locations" cascade;`);
    this.addSql(`drop table if exists "wms_inventory_reservations" cascade;`);
    this.addSql(`drop table if exists "wms_warehouses" cascade;`);
    this.addSql(`drop table if exists "wms_product_inventory_profiles" cascade;`);
    this.addSql(`drop table if exists "wms_inventory_lots" cascade;`);
  }

}
