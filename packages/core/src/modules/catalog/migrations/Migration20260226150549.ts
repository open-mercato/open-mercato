import { Migration } from '@mikro-orm/migrations';

export class Migration20260226150549 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_price_history_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "price_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "offer_id" uuid null, "channel_id" uuid null, "price_kind_id" uuid not null, "price_kind_code" text not null, "currency_code" text not null, "unit_price_net" numeric(14,4) null, "unit_price_gross" numeric(14,4) null, "tax_rate" numeric(6,4) null, "tax_amount" numeric(14,4) null, "min_quantity" int null, "max_quantity" int null, "starts_at" timestamptz null, "ends_at" timestamptz null, "recorded_at" timestamptz not null, "change_type" text not null, "source" text not null, "is_announced" boolean null, "idempotency_key" text null, "metadata" jsonb null, constraint "catalog_price_history_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_price_history_price_id_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "price_id");`);
    this.addSql(`create index "catalog_price_history_offer_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "offer_id", "price_kind_id", "currency_code", "recorded_at");`);
    this.addSql(`create index "catalog_price_history_variant_channel_scoped_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "variant_id", "channel_id", "price_kind_id", "currency_code", "recorded_at");`);
    this.addSql(`create index "catalog_price_history_variant_channel_agnostic_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "variant_id", "price_kind_id", "currency_code", "recorded_at");`);
    this.addSql(`create index "catalog_price_history_product_channel_scoped_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "product_id", "channel_id", "price_kind_id", "currency_code", "recorded_at");`);
    this.addSql(`create index "catalog_price_history_product_channel_agnostic_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "product_id", "price_kind_id", "currency_code", "recorded_at");`);

    this.addSql(`alter table "catalog_products" add column "omnibus_exempt" boolean not null default false, add column "first_listed_at" timestamptz null;`);

    this.addSql(`alter table "catalog_product_variants" add column "omnibus_exempt" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "omnibus_exempt", drop column "first_listed_at";`);

    this.addSql(`alter table "catalog_product_variants" drop column "omnibus_exempt";`);
  }

}
