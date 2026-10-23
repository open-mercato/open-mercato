import { Migration } from '@mikro-orm/migrations';

export class Migration20261022101717_purchases extends Migration {

  override name = 'Migration20261022101717';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchases_receipts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "purchase_order_id" uuid not null, "receipt_number" text not null, "status" text not null default 'ready', "warehouse_id" uuid null, "is_backorder" boolean not null default false, "backorder_of_id" uuid null, "received_date" timestamptz null, "notes" text null, primary key ("id"));`);
    this.addSql(`create index "purchases_receipts_status_idx" on "purchases_receipts" ("status");`);
    this.addSql(`create index "purchases_receipts_order_idx" on "purchases_receipts" ("purchase_order_id");`);
    this.addSql(`create index "purchases_receipts_scope_idx" on "purchases_receipts" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "purchases_receipts" add constraint "purchases_receipts_number_unique" unique ("organization_id", "tenant_id", "receipt_number");`);

    this.addSql(`create table "purchases_receipt_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "receipt_id" uuid not null, "order_line_id" uuid not null, "product_id" uuid null, "product_description" text not null, "quantity_expected" numeric(16,4) not null, "quantity_done" numeric(16,4) not null default '0.0000', primary key ("id"));`);
    this.addSql(`create index "purchases_receipt_lines_receipt_idx" on "purchases_receipt_lines" ("receipt_id");`);
    this.addSql(`create index "purchases_receipt_lines_scope_idx" on "purchases_receipt_lines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "purchases_vendor_pricelists" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "vendor_id" uuid not null, "name" text not null, "currency_code" text not null default 'PLN', "is_active" boolean not null default true, primary key ("id"));`);
    this.addSql(`create index "purchases_vendor_pricelists_vendor_idx" on "purchases_vendor_pricelists" ("vendor_id");`);
    this.addSql(`create index "purchases_vendor_pricelists_scope_idx" on "purchases_vendor_pricelists" ("organization_id", "tenant_id");`);

    this.addSql(`create table "purchases_vendor_pricelist_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "pricelist_id" uuid not null, "product_id" uuid not null, "vendor_product_code" text null, "min_quantity" numeric(16,4) not null default '1.0000', "price" numeric(16,4) not null, "lead_time_days" int not null default 0, "valid_from" timestamptz null, "valid_to" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "purchases_pricelist_items_pricelist_idx" on "purchases_vendor_pricelist_items" ("pricelist_id");`);
    this.addSql(`create index "purchases_pricelist_items_product_idx" on "purchases_vendor_pricelist_items" ("product_id");`);
    this.addSql(`create index "purchases_pricelist_items_scope_idx" on "purchases_vendor_pricelist_items" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "purchases_receipts" add constraint "purchases_receipts_purchase_order_id_foreign" foreign key ("purchase_order_id") references "purchases_orders" ("id");`);

    this.addSql(`alter table "purchases_receipt_lines" add constraint "purchases_receipt_lines_receipt_id_foreign" foreign key ("receipt_id") references "purchases_receipts" ("id");`);

    this.addSql(`alter table "purchases_vendor_pricelist_items" add constraint "purchases_vendor_pricelist_items_pricelist_id_foreign" foreign key ("pricelist_id") references "purchases_vendor_pricelists" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchases_receipt_lines" drop constraint if exists "purchases_receipt_lines_receipt_id_foreign";`);
    this.addSql(`alter table "purchases_vendor_pricelist_items" drop constraint if exists "purchases_vendor_pricelist_items_pricelist_id_foreign";`);
  }

}
