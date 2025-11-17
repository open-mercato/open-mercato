import { Migration } from '@mikro-orm/migrations';

export class Migration20251117165931 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "default_media_url" text null;`);
    this.addSql(`alter table "catalog_products" rename column "default_attachment_id" to "default_media_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "default_media_url";`);

    this.addSql(`alter table "catalog_products" rename column "default_media_id" to "default_attachment_id";`);
  }

}
