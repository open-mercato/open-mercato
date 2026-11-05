import { Migration } from '@mikro-orm/migrations';

export class Migration20260105105740 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "exchange_rates" add column "type" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "exchange_rates" drop column "type";`);
  }

}
