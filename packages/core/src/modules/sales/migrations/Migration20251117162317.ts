import { Migration } from '@mikro-orm/migrations';

export class Migration20251117162317 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_tax_rates" add column "is_default" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_tax_rates" drop column "is_default";`);
  }

}
