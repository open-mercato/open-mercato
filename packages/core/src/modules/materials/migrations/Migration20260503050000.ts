import { Migration } from '@mikro-orm/migrations'

export class Migration20260503050000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create table "material_catalog_product_links" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_id" uuid not null,
      "catalog_product_id" uuid not null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)
    this.addSql(`create unique index "material_catalog_product_links_material_unique" on "material_catalog_product_links" ("material_id") where deleted_at is null;`)
    this.addSql(`create unique index "material_catalog_product_links_product_unique" on "material_catalog_product_links" ("catalog_product_id") where deleted_at is null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_catalog_product_links" cascade;`)
  }
}
