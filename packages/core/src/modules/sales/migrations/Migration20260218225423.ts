import { Migration } from '@mikro-orm/migrations';

export class Migration20260218225423 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quote_lines" add column "normalized_quantity" numeric(18,6) not null default '0', add column "normalized_unit" text null, add column "uom_snapshot" jsonb null;`);
    this.addSql(`update "sales_quote_lines" set "normalized_quantity" = coalesce("quantity", '0'), "normalized_unit" = "quantity_unit" where "uom_snapshot" is null;`);
    this.addSql(`create index "sales_quote_lines_normalized_idx" on "sales_quote_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);

    this.addSql(`alter table "sales_order_lines" add column "normalized_quantity" numeric(18,6) not null default '0', add column "normalized_unit" text null, add column "uom_snapshot" jsonb null;`);
    this.addSql(`update "sales_order_lines" set "normalized_quantity" = coalesce("quantity", '0'), "normalized_unit" = "quantity_unit" where "uom_snapshot" is null;`);
    this.addSql(`create index "sales_order_lines_normalized_idx" on "sales_order_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);

    this.addSql(`alter table "sales_invoice_lines" add column "normalized_quantity" numeric(18,6) not null default '0', add column "normalized_unit" text null, add column "uom_snapshot" jsonb null;`);
    this.addSql(`update "sales_invoice_lines" set "normalized_quantity" = coalesce("quantity", '0'), "normalized_unit" = "quantity_unit" where "uom_snapshot" is null;`);
    this.addSql(`create index "sales_invoice_lines_normalized_idx" on "sales_invoice_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);

    this.addSql(`alter table "sales_credit_memo_lines" add column "normalized_quantity" numeric(18,6) not null default '0', add column "normalized_unit" text null, add column "uom_snapshot" jsonb null;`);
    this.addSql(`update "sales_credit_memo_lines" set "normalized_quantity" = coalesce("quantity", '0'), "normalized_unit" = "quantity_unit" where "uom_snapshot" is null;`);
    this.addSql(`create index "sales_credit_memo_lines_normalized_idx" on "sales_credit_memo_lines" ("organization_id", "tenant_id", "normalized_unit", "normalized_quantity");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "sales_quote_lines_normalized_idx";`);
    this.addSql(`alter table "sales_quote_lines" drop column "normalized_quantity", drop column "normalized_unit", drop column "uom_snapshot";`);

    this.addSql(`drop index "sales_order_lines_normalized_idx";`);
    this.addSql(`alter table "sales_order_lines" drop column "normalized_quantity", drop column "normalized_unit", drop column "uom_snapshot";`);

    this.addSql(`drop index "sales_invoice_lines_normalized_idx";`);
    this.addSql(`alter table "sales_invoice_lines" drop column "normalized_quantity", drop column "normalized_unit", drop column "uom_snapshot";`);

    this.addSql(`drop index "sales_credit_memo_lines_normalized_idx";`);
    this.addSql(`alter table "sales_credit_memo_lines" drop column "normalized_quantity", drop column "normalized_unit", drop column "uom_snapshot";`);
  }

}
