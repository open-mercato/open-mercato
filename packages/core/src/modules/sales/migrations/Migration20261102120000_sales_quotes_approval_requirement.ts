import { Migration } from '@mikro-orm/migrations';

export class Migration20261102120000_sales_quotes_approval_requirement extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" add column if not exists "approval_requirement" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" drop column if exists "approval_requirement";`);
  }

}
