import { Migration } from '@mikro-orm/migrations';

export class Migration20251028130956 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "code" text null, "status_entry_id" uuid null, "primary_currency_code" text null, "default_unit" text null, "channel_ids" jsonb null, "metadata" jsonb null, "is_configurable" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_products_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_products_org_tenant_idx" on "catalog_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "catalog_product_options" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int not null default 0, "is_required" boolean not null default false, "is_multiple" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_options_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_options_scope_idx" on "catalog_product_options" ("product_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_values" ("id" uuid not null default gen_random_uuid(), "option_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_option_values_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_option_values_scope_idx" on "catalog_product_option_values" ("option_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_code_unique" unique ("organization_id", "tenant_id", "option_id", "code");`);

    this.addSql(`create table "catalog_product_variants" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "sku" text null, "barcode" text null, "status_entry_id" text null, "is_default" boolean not null default false, "is_active" boolean not null default true, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variants_scope_idx" on "catalog_product_variants" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_sku_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_product_prices" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "currency_code" text not null, "kind" text not null default 'list', "min_quantity" int not null default 1, "max_quantity" int null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "metadata" jsonb null, "starts_at" timestamptz null, "ends_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_prices_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_prices_scope_idx" on "catalog_product_prices" ("variant_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "kind", "min_quantity");`);

    this.addSql(`create table "catalog_variant_option_values" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid not null, "option_value_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_variant_option_values_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_variant_option_values" add constraint "catalog_variant_option_values_unique" unique ("variant_id", "option_value_id");`);

    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_option_id_foreign" foreign key ("option_id") references "catalog_product_options" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_variant_option_values" add constraint "catalog_variant_option_values_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade;`);
    this.addSql(`alter table "catalog_variant_option_values" add constraint "catalog_variant_option_values_option_value_id_foreign" foreign key ("option_value_id") references "catalog_product_option_values" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_options" drop constraint "catalog_product_options_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variants" drop constraint "catalog_product_variants_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_option_values" drop constraint "catalog_product_option_values_option_id_foreign";`);

    this.addSql(`alter table "catalog_variant_option_values" drop constraint "catalog_variant_option_values_option_value_id_foreign";`);

    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_variant_id_foreign";`);

    this.addSql(`alter table "catalog_variant_option_values" drop constraint "catalog_variant_option_values_variant_id_foreign";`);

    this.addSql(`drop table if exists "catalog_products" cascade;`);

    this.addSql(`drop table if exists "catalog_product_options" cascade;`);

    this.addSql(`drop table if exists "catalog_product_option_values" cascade;`);

    this.addSql(`drop table if exists "catalog_product_variants" cascade;`);

    this.addSql(`drop table if exists "catalog_product_prices" cascade;`);

    this.addSql(`drop table if exists "catalog_variant_option_values" cascade;`);
  }

}
