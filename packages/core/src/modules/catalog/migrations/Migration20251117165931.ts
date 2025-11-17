import { Migration } from '@mikro-orm/migrations';

export class Migration20251117165931 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "default_media_url" text null;`);
    this.addSql(`alter table "catalog_products" rename column "default_attachment_id" to "default_media_id";`);
    this.addSql(`alter table "catalog_product_variants" add column "default_media_id" uuid null;`);
    this.addSql(`alter table "catalog_product_variants" add column "default_media_url" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "default_media_url";`);

    this.addSql(`alter table "catalog_products" rename column "default_media_id" to "default_attachment_id";`);
    this.addSql(`alter table "catalog_product_variants" drop column "default_media_id";`);
    this.addSql(`alter table "catalog_product_variants" drop column "default_media_url";`);
  }

}
