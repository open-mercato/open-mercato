import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ecommerce_stores" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "slug" text not null, "status" text not null default 'draft', "default_locale" text not null, "supported_locales" jsonb not null default '[]', "default_currency_code" text not null, "is_primary" boolean not null default false, "settings" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ecommerce_stores_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_stores_tenant_slug_idx" on "ecommerce_stores" ("tenant_id", "slug");`);
    this.addSql(`create index "ecommerce_stores_org_tenant_idx" on "ecommerce_stores" ("organization_id", "tenant_id");`);

    this.addSql(`create table "ecommerce_store_channel_bindings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "sales_channel_id" uuid not null, "price_kind_id" uuid null, "catalog_scope" jsonb null, "is_default" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ecommerce_store_channel_bindings_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_store_channel_bindings_store_idx" on "ecommerce_store_channel_bindings" ("store_id");`);

    this.addSql(`create table "ecommerce_store_domains" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "host" text not null, "is_primary" boolean not null default false, "tls_mode" text not null default 'platform', "verification_status" text not null default 'pending', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ecommerce_store_domains_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_store_domains_store_idx" on "ecommerce_store_domains" ("store_id");`);
    this.addSql(`alter table "ecommerce_store_domains" add constraint "ecommerce_store_domains_host_unique" unique ("host");`);
  }

}
