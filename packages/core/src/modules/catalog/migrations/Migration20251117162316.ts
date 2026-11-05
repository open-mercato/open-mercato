import { Migration } from '@mikro-orm/migrations';

export class Migration20251117162316 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "default_attachment_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "default_attachment_id";`);
  }

}
