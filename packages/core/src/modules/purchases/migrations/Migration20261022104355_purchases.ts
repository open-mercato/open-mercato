import { Migration } from '@mikro-orm/migrations';

export class Migration20261022104355_purchases extends Migration {

  override name = 'Migration20261022104355';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchases_bills" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "purchase_order_id" uuid not null, "vendor_bill_number" text not null, "bill_date" timestamptz not null, "status" text not null default 'draft', "matching_status" text not null default 'pending', "exception_notes" text null, "total_net" numeric(16,4) not null default '0.0000', "total_gross" numeric(16,4) not null default '0.0000', primary key ("id"));`);
    this.addSql(`create index "purchases_bills_match_idx" on "purchases_bills" ("matching_status");`);
    this.addSql(`create index "purchases_bills_status_idx" on "purchases_bills" ("status");`);
    this.addSql(`create index "purchases_bills_order_idx" on "purchases_bills" ("purchase_order_id");`);
    this.addSql(`create index "purchases_bills_scope_idx" on "purchases_bills" ("organization_id", "tenant_id");`);

    this.addSql(`create table "purchases_bill_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "bill_id" uuid not null, "order_line_id" uuid null, "product_id" uuid null, "product_description" text not null, "quantity" numeric(16,4) not null default '1.0000', "unit_price_net" numeric(16,4) not null default '0.0000', "subtotal_net" numeric(16,4) not null default '0.0000', primary key ("id"));`);
    this.addSql(`create index "purchases_bill_lines_bill_idx" on "purchases_bill_lines" ("bill_id");`);
    this.addSql(`create index "purchases_bill_lines_scope_idx" on "purchases_bill_lines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "purchases_reordering_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "product_id" uuid not null, "warehouse_id" uuid null, "min_quantity" numeric(16,4) not null default '0.0000', "max_quantity" numeric(16,4) not null default '0.0000', "quantity_multiple" numeric(16,4) not null default '1.0000', "preferred_vendor_id" uuid null, "is_active" boolean not null default true, primary key ("id"));`);
    this.addSql(`create index "purchases_reordering_rules_wh_idx" on "purchases_reordering_rules" ("warehouse_id");`);
    this.addSql(`create index "purchases_reordering_rules_product_idx" on "purchases_reordering_rules" ("product_id");`);
    this.addSql(`create index "purchases_reordering_rules_scope_idx" on "purchases_reordering_rules" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "purchases_bills" add constraint "purchases_bills_purchase_order_id_foreign" foreign key ("purchase_order_id") references "purchases_orders" ("id");`);

    this.addSql(`alter table "purchases_bill_lines" add constraint "purchases_bill_lines_bill_id_foreign" foreign key ("bill_id") references "purchases_bills" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchases_bill_lines" drop constraint if exists "purchases_bill_lines_bill_id_foreign";`);
  }

}
