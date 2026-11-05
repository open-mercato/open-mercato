import { Migration } from '@mikro-orm/migrations';

export class Migration20251126121722 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_settings" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "deleted_at";`);
  }

}
