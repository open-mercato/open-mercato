import { Migration } from '@mikro-orm/migrations';

export class Migration20251118094851 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" add column "default_media_id" uuid null, add column "default_media_url" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" drop column "default_media_id", drop column "default_media_url";`);
  }

}
