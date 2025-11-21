import { Migration } from '@mikro-orm/migrations';

export class Migration20251115204549 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_price_kinds" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "title" text not null, "display_mode" text not null default 'excluding-tax', "currency_code" text null, "is_promotion" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_price_kinds_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_price_kinds_scope_idx" on "catalog_price_kinds" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`alter table "catalog_product_prices" add column "price_kind_id" uuid null;`);

    this.addSql(`alter table "catalog_product_prices" alter column "kind" set default 'regular';`);
    this.addSql(`alter table "catalog_product_prices" alter column "price_kind_id" set not null;`);
    this.addSql(`alter table "catalog_product_prices" drop constraint if exists "catalog_product_prices_unique";`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_price_kind_id_foreign" foreign key ("price_kind_id") references "catalog_price_kinds" ("id") on update cascade;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "price_kind_id", "min_quantity");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_prices" drop constraint if exists "catalog_product_prices_unique";`);
    this.addSql(`alter table "catalog_product_prices" drop constraint if exists "catalog_product_prices_price_kind_id_foreign";`);
    this.addSql(`alter table "catalog_product_prices" alter column "kind" set default 'list';`);

    this.addSql(`alter table "catalog_product_prices" drop column "price_kind_id";`);
    this.addSql(`drop table if exists "catalog_price_kinds";`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "kind", "min_quantity");`);
  }

}
