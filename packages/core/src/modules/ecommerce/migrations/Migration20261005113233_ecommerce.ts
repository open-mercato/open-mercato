import { Migration } from '@mikro-orm/migrations';

export class Migration20261005113233_ecommerce extends Migration {

  override name = 'Migration20261005113233';

  override up(): void | Promise<void> {
    this.addSql(`create table "ecommerce_stores" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "slug" text not null, "status" text not null default 'draft', "default_locale" text not null, "supported_locales" jsonb not null, "default_currency_code" text not null, "is_primary" boolean not null default false, "settings" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ecommerce_stores_org_primary_unique" on "ecommerce_stores" ("organization_id") where "is_primary" and "deleted_at" is null;`);
    this.addSql(`create unique index "ecommerce_stores_tenant_slug_unique" on "ecommerce_stores" ("tenant_id", "slug") where "deleted_at" is null;`);
    this.addSql(`create unique index "ecommerce_stores_tenant_code_unique" on "ecommerce_stores" ("tenant_id", "code") where "deleted_at" is null;`);
    this.addSql(`create index "ecommerce_stores_tenant_org_idx" on "ecommerce_stores" ("tenant_id", "organization_id");`);

    this.addSql(`create table "ecommerce_store_channel_bindings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "sales_channel_id" uuid not null, "price_kind_id" uuid null, "assortment_scope" jsonb null, "price_sort_fallback" text not null default 'approximate', "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ecommerce_store_channel_bindings_store_default_unique" on "ecommerce_store_channel_bindings" ("store_id") where "is_default" and "deleted_at" is null;`);
    this.addSql(`create index "ecommerce_store_channel_bindings_store_idx" on "ecommerce_store_channel_bindings" ("store_id");`);
    this.addSql(`create index "ecommerce_store_channel_bindings_tenant_org_idx" on "ecommerce_store_channel_bindings" ("tenant_id", "organization_id");`);

    this.addSql(`create table "ecommerce_store_domain_bindings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "domain_mapping_id" uuid not null, "path_prefix" text null, "is_primary" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ecommerce_store_domain_bindings_store_primary_unique" on "ecommerce_store_domain_bindings" ("store_id") where "is_primary" and "deleted_at" is null;`);
    this.addSql(`create unique index "ecommerce_store_domain_bindings_mapping_prefix_unique" on "ecommerce_store_domain_bindings" ("domain_mapping_id", coalesce("path_prefix", '')) where "deleted_at" is null;`);
    this.addSql(`create index "ecommerce_store_domain_bindings_store_idx" on "ecommerce_store_domain_bindings" ("store_id");`);
    this.addSql(`create index "ecommerce_store_domain_bindings_tenant_org_idx" on "ecommerce_store_domain_bindings" ("tenant_id", "organization_id");`);
  }

}
