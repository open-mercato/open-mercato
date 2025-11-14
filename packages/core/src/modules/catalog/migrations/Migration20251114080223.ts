import { Migration } from '@mikro-orm/migrations';

export class Migration20251114080223 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_offers" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "channel_id" uuid not null, "title" text not null, "description" text null, "localized_content" jsonb null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_offers_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_offers_scope_idx" on "catalog_offers" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_offers" add constraint "catalog_offers_product_channel_unique" unique ("product_id", "organization_id", "tenant_id", "channel_id");`);

    this.addSql(`alter table "catalog_offers" add constraint "catalog_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_variant_id_foreign";`);

    this.addSql(`alter table "catalog_products" add column "attribute_values" jsonb null;`);
    this.addSql(`alter table "catalog_products" rename column "channel_ids" to "attribute_schema";`);

    this.addSql(`alter table "catalog_product_options" add column "input_type" text not null default 'select', add column "input_config" jsonb null;`);

    this.addSql(`alter table "catalog_product_variants" add column "attribute_schema" jsonb null, add column "attribute_values" jsonb null;`);

    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_unique";`);

    this.addSql(`alter table "catalog_product_prices" add column "product_id" uuid null, add column "offer_id" uuid null, add column "channel_id" uuid null, add column "user_id" uuid null, add column "user_group_id" uuid null, add column "customer_id" uuid null, add column "customer_group_id" uuid null;`);
    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" drop default;`);
    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" type uuid using ("variant_id"::text::uuid);`);
    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" drop not null;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_offer_id_foreign" foreign key ("offer_id") references "catalog_offers" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "catalog_product_prices_product_scope_idx" on "catalog_product_prices" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter index "catalog_product_prices_scope_idx" rename to "catalog_product_prices_variant_scope_idx";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_offer_id_foreign";`);

    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_product_id_foreign";`);
    this.addSql(`alter table "catalog_product_prices" drop constraint "catalog_product_prices_variant_id_foreign";`);

    this.addSql(`alter table "catalog_products" drop column "attribute_values";`);

    this.addSql(`alter table "catalog_products" rename column "attribute_schema" to "channel_ids";`);

    this.addSql(`alter table "catalog_product_options" drop column "input_type", drop column "input_config";`);

    this.addSql(`alter table "catalog_product_variants" drop column "attribute_schema", drop column "attribute_values";`);

    this.addSql(`drop index "catalog_product_prices_product_scope_idx";`);
    this.addSql(`alter table "catalog_product_prices" drop column "product_id", drop column "offer_id", drop column "channel_id", drop column "user_id", drop column "user_group_id", drop column "customer_id", drop column "customer_group_id";`);

    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" drop default;`);
    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" type uuid using ("variant_id"::text::uuid);`);
    this.addSql(`alter table "catalog_product_prices" alter column "variant_id" set not null;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade;`);
    this.addSql(`alter table "catalog_product_prices" add constraint "catalog_product_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "kind", "min_quantity");`);
    this.addSql(`alter index "catalog_product_prices_variant_scope_idx" rename to "catalog_product_prices_scope_idx";`);
  }

}
