import { Migration } from '@mikro-orm/migrations';

export class Migration20260218202649 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ecommerce_carts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "token" uuid not null, "status" text not null default 'active', "currency_code" text not null, "locale" text null, "converted_order_id" uuid null, "metadata" jsonb null, "expires_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), constraint "ecommerce_carts_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_carts_org_tenant_store_idx" on "ecommerce_carts" ("tenant_id", "store_id");`);
    this.addSql(`alter table "ecommerce_carts" add constraint "ecommerce_carts_token_unique" unique ("token");`);

    this.addSql(`create table "ecommerce_cart_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "cart_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "quantity" int not null default 1, "unit_price_net" numeric(19,4) null, "unit_price_gross" numeric(19,4) null, "currency_code" text null, "title_snapshot" text null, "sku_snapshot" text null, "image_url_snapshot" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), constraint "ecommerce_cart_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_cart_lines_cart_idx" on "ecommerce_cart_lines" ("cart_id");`);
  }

}
