import { Migration } from '@mikro-orm/migrations';

export class Migration20260410190007 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_invoice_lines" add column "name" text null, add column "sku" text null;`);

    this.addSql(`alter table "sales_credit_memos" add column "reason" text null;`);

    this.addSql(`alter table "sales_credit_memo_lines" add column "name" text null, add column "sku" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_invoice_lines" drop column "name", drop column "sku";`);

    this.addSql(`alter table "sales_credit_memos" drop column "reason";`);

    this.addSql(`alter table "sales_credit_memo_lines" drop column "name", drop column "sku";`);
  }

}
