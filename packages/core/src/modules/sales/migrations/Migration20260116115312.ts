import { Migration } from '@mikro-orm/migrations';

export class Migration20260116115312 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_document_sequences" add column "deleted_at" timestamptz null;`);

    this.addSql(`alter table "sales_quote_adjustments" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_document_sequences" drop column "deleted_at";`);

    this.addSql(`alter table "sales_quote_adjustments" drop column "deleted_at";`);
  }

}
