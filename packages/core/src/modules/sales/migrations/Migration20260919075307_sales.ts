import { Migration } from '@mikro-orm/migrations';

// Tax provenance columns for spec .ai/specs/2026-09-19-pluggable-tax-providers.md.
//
// Every column is nullable with no default and no backfill, so this is additive
// and deployable without downtime. A row written before this migration keeps
// NULL in all five columns and the detail page reports that no tax provenance
// was recorded; nothing reads them as required. Rolling back is dropping the
// selection, not dropping these columns.
//
// sales_orders already carries tax_strategy_key and tax_info, and sales_quotes
// already carries tax_info, which is why the per-table column lists differ.
//
// The index on tax_transaction_ref resolves a document from a provider's
// transaction reference. It is partial on IS NOT NULL because the built in
// table-rates provider records no transaction: on an instance that never
// selects an external engine the index stays empty.
export class Migration20260919075307_sales extends Migration {

  override name = 'Migration20260919075307';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" add "tax_strategy_key" text null, add "tax_status" text null, add "tax_calculated_at" timestamptz null, add "tax_transaction_ref" text null;`);
    this.addSql(`create index "sales_quotes_tax_transaction_ref_idx" on "sales_quotes" ("organization_id", "tenant_id", "tax_transaction_ref") where "tax_transaction_ref" is not null;`);

    this.addSql(`alter table "sales_orders" add "tax_status" text null, add "tax_calculated_at" timestamptz null, add "tax_transaction_ref" text null;`);
    this.addSql(`create index "sales_orders_tax_transaction_ref_idx" on "sales_orders" ("organization_id", "tenant_id", "tax_transaction_ref") where "tax_transaction_ref" is not null;`);

    this.addSql(`alter table "sales_invoices" add "tax_strategy_key" text null, add "tax_info" jsonb null, add "tax_status" text null, add "tax_calculated_at" timestamptz null, add "tax_transaction_ref" text null;`);
    this.addSql(`create index "sales_invoices_tax_transaction_ref_idx" on "sales_invoices" ("organization_id", "tenant_id", "tax_transaction_ref") where "tax_transaction_ref" is not null;`);

    this.addSql(`alter table "sales_credit_memos" add "tax_strategy_key" text null, add "tax_info" jsonb null, add "tax_status" text null, add "tax_calculated_at" timestamptz null, add "tax_transaction_ref" text null;`);
    this.addSql(`create index "sales_credit_memos_tax_transaction_ref_idx" on "sales_credit_memos" ("organization_id", "tenant_id", "tax_transaction_ref") where "tax_transaction_ref" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "sales_credit_memos_tax_transaction_ref_idx";`);
    this.addSql(`alter table "sales_credit_memos" drop column "tax_strategy_key", drop column "tax_info", drop column "tax_status", drop column "tax_calculated_at", drop column "tax_transaction_ref";`);

    this.addSql(`drop index "sales_invoices_tax_transaction_ref_idx";`);
    this.addSql(`alter table "sales_invoices" drop column "tax_strategy_key", drop column "tax_info", drop column "tax_status", drop column "tax_calculated_at", drop column "tax_transaction_ref";`);

    this.addSql(`drop index "sales_orders_tax_transaction_ref_idx";`);
    this.addSql(`alter table "sales_orders" drop column "tax_status", drop column "tax_calculated_at", drop column "tax_transaction_ref";`);

    this.addSql(`drop index "sales_quotes_tax_transaction_ref_idx";`);
    this.addSql(`alter table "sales_quotes" drop column "tax_strategy_key", drop column "tax_status", drop column "tax_calculated_at", drop column "tax_transaction_ref";`);
  }

}
