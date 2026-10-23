import { Migration } from '@mikro-orm/migrations';

export class Migration20261022095815_purchases extends Migration {

  override name = 'Migration20261022095815';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchases_document_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "document_kind" text not null, "current_value" int not null default 0, primary key ("id"));`);
    this.addSql(`create index "purchases_docseq_scope_idx" on "purchases_document_sequences" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "purchases_document_sequences" add constraint "purchases_docseq_kind_unique" unique ("organization_id", "tenant_id", "document_kind");`);

    this.addSql(`create table "purchases_orders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "order_number" text not null, "status" text not null default 'draft_rfq', "vendor_id" uuid not null, "vendor_name" text null, "buyer_id" uuid null, "order_date" timestamptz not null, "expected_arrival_date" timestamptz null, "currency_code" text not null default 'PLN', "exchange_rate" numeric(16,6) not null default '1.000000', "payment_term_id" uuid null, "incoterm" text null, "approval_status" text not null default 'not_required', "invoice_status" text not null default 'no', "delivery_status" text not null default 'pending', "control_policy" text not null default 'on_received', "subtotal_net" numeric(16,4) not null default '0.0000', "total_tax" numeric(16,4) not null default '0.0000', "total_gross" numeric(16,4) not null default '0.0000', "notes" text null, primary key ("id"));`);
    this.addSql(`create index "purchases_orders_vendor_idx" on "purchases_orders" ("vendor_id");`);
    this.addSql(`create index "purchases_orders_status_idx" on "purchases_orders" ("status");`);
    this.addSql(`create index "purchases_orders_scope_idx" on "purchases_orders" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "purchases_orders" add constraint "purchases_orders_number_scope_idx" unique ("organization_id", "tenant_id", "order_number");`);

    this.addSql(`create table "purchases_order_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "purchase_order_id" uuid not null, "product_id" uuid null, "vendor_product_code" text null, "product_description" text not null, "quantity_ordered" numeric(16,4) not null default '1.0000', "quantity_received" numeric(16,4) not null default '0.0000', "quantity_billed" numeric(16,4) not null default '0.0000', "unit_price_net" numeric(16,4) not null default '0.0000', "tax_rate_percent" numeric(5,2) not null default '23.00', "subtotal_net" numeric(16,4) not null default '0.0000', "total_tax" numeric(16,4) not null default '0.0000', "total_gross" numeric(16,4) not null default '0.0000', "expected_delivery_date" timestamptz null, "sort_order" int not null default 0, primary key ("id"));`);
    this.addSql(`create index "purchases_order_lines_product_idx" on "purchases_order_lines" ("product_id");`);
    this.addSql(`create index "purchases_order_lines_order_idx" on "purchases_order_lines" ("purchase_order_id");`);
    this.addSql(`create index "purchases_order_lines_scope_idx" on "purchases_order_lines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "purchases_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "approval_threshold_amount" numeric(16,4) not null default '10000.0000', "approval_threshold_currency" text not null default 'PLN', "double_validation_enabled" boolean not null default true, "default_control_policy" text not null default 'on_received', "auto_create_receipt_on_confirm" boolean not null default true, primary key ("id"));`);
    this.addSql(`create index "purchases_settings_scope_idx" on "purchases_settings" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "purchases_order_lines" add constraint "purchases_order_lines_purchase_order_id_foreign" foreign key ("purchase_order_id") references "purchases_orders" ("id");`);
  }

}
