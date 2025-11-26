import { Migration } from '@mikro-orm/migrations';

export class Migration20251126122735 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_document_addresses" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_document_addresses" drop column "deleted_at";`);
  }

}
