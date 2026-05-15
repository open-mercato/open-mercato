import { Migration } from '@mikro-orm/migrations'

export class Migration20260503000000 extends Migration {
  override up(): void | Promise<void> {
    // ── materials (master) ────────────────────────────────────────────────────
    this.addSql(`create table "materials" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "description" text null,
      "kind" text not null,
      "lifecycle_state" text not null default 'draft',
      "replacement_material_id" uuid null,
      "base_unit_id" uuid null,
      "is_purchasable" boolean not null default true,
      "is_sellable" boolean not null default false,
      "is_stockable" boolean not null default true,
      "is_producible" boolean not null default false,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)

    this.addSql(`create index "materials_org_tenant_kind_idx" on "materials" ("organization_id", "tenant_id", "kind");`)
    this.addSql(`create index "materials_org_tenant_lifecycle_idx" on "materials" ("organization_id", "tenant_id", "lifecycle_state");`)
    this.addSql(`create unique index "materials_org_code_unique" on "materials" ("organization_id", "code") where deleted_at is null;`)

    // ── material_sales_profiles (1:1 child, optional) ─────────────────────────
    this.addSql(`create table "material_sales_profiles" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_id" uuid not null,
      "gtin" text null,
      "commodity_code" text null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)

    this.addSql(`create unique index "material_sales_profiles_material_unique" on "material_sales_profiles" ("material_id") where deleted_at is null;`)
    this.addSql(`create unique index "material_sales_profiles_org_gtin_unique" on "material_sales_profiles" ("organization_id", "gtin") where gtin is not null and deleted_at is null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_sales_profiles" cascade;`)
    this.addSql(`drop table if exists "materials" cascade;`)
  }
}
