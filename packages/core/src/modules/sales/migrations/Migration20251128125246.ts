import { Migration } from '@mikro-orm/migrations';

export class Migration20251128125246 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "totals_snapshot" jsonb null;`);

    this.addSql(`alter table "sales_orders" add column "totals_snapshot" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop column "totals_snapshot";`);

    this.addSql(`alter table "sales_orders" drop column "totals_snapshot";`);
  }

}
