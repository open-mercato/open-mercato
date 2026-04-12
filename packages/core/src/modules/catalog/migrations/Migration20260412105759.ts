import { Migration } from '@mikro-orm/migrations';

export class Migration20260412105759 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_variants" add column "default_media_id" uuid null, add column "default_media_url" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_variants" drop column "default_media_id", drop column "default_media_url";`);
  }

}
