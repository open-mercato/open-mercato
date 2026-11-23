import { Migration } from '@mikro-orm/migrations';

export class Migration20261123144618_sales_invoices_gl_posting extends Migration {

  override name = 'Migration20261123144618';

  override up(): void | Promise<void> {
    this.addSql(`create table "sales_invoice_gl_postings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sales_invoice_id" uuid not null, "journal_entry_id" uuid not null, "contractor_id" uuid null, "posted_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "sales_invoice_gl_postings" add constraint "sales_invoice_gl_postings_scope_invoice_unique" unique ("organization_id", "tenant_id", "sales_invoice_id");`);

    this.addSql(`create table "sales_invoice_line_revenue_accounts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sales_invoice_line_id" uuid not null, "account_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "sales_invoice_line_revenue_accounts" add constraint "sales_invoice_line_revenue_accounts_scope_line_unique" unique ("organization_id", "tenant_id", "sales_invoice_line_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "sales_invoice_line_revenue_accounts" cascade;`);
    this.addSql(`drop table if exists "sales_invoice_gl_postings" cascade;`);
  }

}
