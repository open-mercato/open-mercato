import { Migration } from '@mikro-orm/migrations';

export class Migration20260616132848_sales extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_quote_lines" add "service_id" uuid null;`);

    this.addSql(`alter table "sales_order_lines" add "service_id" uuid null;`);

    this.addSql(`alter table "sales_invoice_lines" add "service_id" uuid null;`);

    this.addSql(`alter table "sales_credit_memo_lines" add "kind" text not null default 'product', add "service_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_credit_memo_lines" drop column "kind", drop column "service_id";`);

    this.addSql(`alter table "sales_invoice_lines" drop column "service_id";`);

    this.addSql(`alter table "sales_order_lines" drop column "service_id";`);

    this.addSql(`alter table "sales_quote_lines" drop column "service_id";`);
  }

}
