import { Migration } from '@mikro-orm/migrations';

// Release 5, Step 3.5 (checkout §4.3, D-R5-19). `checkout_link_cart_templates` — merchant-
// defined lines that seed a cart on first visit, for a `checkoutType: 'simple_checkout'`
// link only. Additive: no existing table changes.
export class Migration20261027220000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "checkout_link_cart_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "link_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "name" text not null, "description" text null, "sku" text null, "quantity" int not null default 1, "unit_price_override" numeric(12,2) null, "currency_code" text not null, "image_url" text null, "is_quantity_editable" boolean not null default false, "sort_order" int not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "checkout_link_cart_templates_pkey" primary key ("id"));`);
    this.addSql(`create index "checkout_link_cart_templates_organization_id_tenant_id_deleted_at_index" on "checkout_link_cart_templates" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "checkout_link_cart_templates_link_id_sort_order_index" on "checkout_link_cart_templates" ("link_id", "sort_order");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_link_cart_templates" cascade;`);
  }

}
