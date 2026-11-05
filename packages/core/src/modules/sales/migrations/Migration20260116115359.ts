import { Migration } from '@mikro-orm/migrations';

export class Migration20260116115359 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_notes" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_notes" drop column "deleted_at";`);
  }

}
