import { Migration } from '@mikro-orm/migrations';

export class Migration20261019192930_financial extends Migration {

  override name = 'Migration20261019192930';

  override up(): void | Promise<void> {
    this.addSql(`create table "ap_payments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vendor_id" uuid not null, "payment_number" text not null, "payment_date" date not null, "currency_code" text not null, "gross_amount" numeric(18,4) not null default '0', "withholding_code" text null, "withholding_amount" numeric(18,4) not null default '0', "net_amount" numeric(18,4) not null default '0', "method" text not null default 'bank_transfer', "reference" text null, "status" text not null default 'posted', "posted_entry_id" uuid null, "notes" text null, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ap_payments_number_unique_idx" on "ap_payments" ("organization_id", "tenant_id", "payment_number") where deleted_at is null;`);
    this.addSql(`create index "ap_payments_vendor_idx" on "ap_payments" ("organization_id", "vendor_id");`);
    this.addSql(`create index "ap_payments_tenant_org_idx" on "ap_payments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "ap_payment_allocations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "payment_id" uuid not null, "invoice_id" uuid not null, "amount" numeric(18,4) not null default '0', "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ap_payment_allocations_invoice_idx" on "ap_payment_allocations" ("invoice_id");`);
    this.addSql(`create index "ap_payment_allocations_payment_idx" on "ap_payment_allocations" ("payment_id");`);

    this.addSql(`create table "ap_vendors" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "name_ar" text null, "vat_number" text null, "cr_number" text null, "email" text null, "phone" text null, "country_code" text null, "is_active" boolean not null default true, "notes" text null, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ap_vendors_code_unique_idx" on "ap_vendors" ("organization_id", "tenant_id", "code") where deleted_at is null;`);
    this.addSql(`create index "ap_vendors_tenant_org_idx" on "ap_vendors" ("tenant_id", "organization_id");`);

    this.addSql(`create table "ap_vendor_invoices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vendor_id" uuid not null, "internal_number" text not null, "vendor_invoice_number" text null, "issue_date" date not null, "due_date" date null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "withholding_code" text null, "withholding_amount" numeric(18,4) not null default '0', "status" text not null default 'draft', "posted_entry_id" uuid null, "posted_at" timestamptz null, "notes" text null, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ap_vendor_invoices_number_unique_idx" on "ap_vendor_invoices" ("organization_id", "tenant_id", "internal_number") where deleted_at is null;`);
    this.addSql(`create index "ap_vendor_invoices_due_idx" on "ap_vendor_invoices" ("organization_id", "due_date");`);
    this.addSql(`create index "ap_vendor_invoices_status_idx" on "ap_vendor_invoices" ("organization_id", "status");`);
    this.addSql(`create index "ap_vendor_invoices_vendor_idx" on "ap_vendor_invoices" ("organization_id", "vendor_id");`);
    this.addSql(`create index "ap_vendor_invoices_tenant_org_idx" on "ap_vendor_invoices" ("tenant_id", "organization_id");`);

    this.addSql(`create table "ap_vendor_invoice_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "invoice_id" uuid not null, "line_number" int not null default 0, "description" text not null, "expense_account_id" uuid not null, "quantity" numeric(18,4) not null default '1', "unit_price_net" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "tax_code" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ap_vendor_invoice_lines_invoice_idx" on "ap_vendor_invoice_lines" ("invoice_id");`);

    this.addSql(`alter table "ap_payments" add constraint "ap_payments_method_check" check ("method" in ('bank_transfer', 'cheque', 'cash'));`);
    this.addSql(`alter table "ap_payments" add constraint "ap_payments_status_check" check ("status" in ('posted', 'void'));`);

    this.addSql(`alter table "ap_vendor_invoices" add constraint "ap_vendor_invoices_status_check" check ("status" in ('draft', 'posted', 'paid', 'void'));`);
  }

}
