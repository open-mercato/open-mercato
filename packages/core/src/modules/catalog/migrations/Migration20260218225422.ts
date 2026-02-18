import { Migration } from '@mikro-orm/migrations';

export class Migration20260218225422 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_product_unit_conversions" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "unit_code" text not null, "to_base_factor" numeric(24,12) not null, "sort_order" int not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_unit_conversions_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_unit_conversions_scope_idx" on "catalog_product_unit_conversions" ("organization_id", "tenant_id", "product_id");`);
    this.addSql(`alter table "catalog_product_unit_conversions" add constraint "catalog_product_unit_conversions_unique" unique ("product_id", "unit_code");`);

    this.addSql(`alter table "catalog_product_unit_conversions" add constraint "catalog_product_unit_conversions_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_products" add column "default_sales_unit" text null, add column "default_sales_unit_quantity" numeric(18,6) not null default '1', add column "uom_rounding_scale" smallint not null default 4, add column "uom_rounding_mode" text not null default 'half_up', add column "unit_price_enabled" boolean not null default false, add column "unit_price_reference_unit" text null, add column "unit_price_base_quantity" numeric(18,6) null;`);
    this.addSql(`update "catalog_products" set "default_sales_unit" = "default_unit" where "default_sales_unit" is null and "default_unit" is not null;`);
    this.addSql(`update "catalog_products" set "default_sales_unit_quantity" = '1' where "default_sales_unit_quantity" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "catalog_product_unit_conversions" cascade;`);
    this.addSql(`alter table "catalog_products" drop column "default_sales_unit", drop column "default_sales_unit_quantity", drop column "uom_rounding_scale", drop column "uom_rounding_mode", drop column "unit_price_enabled", drop column "unit_price_reference_unit", drop column "unit_price_base_quantity";`);
  }

}
