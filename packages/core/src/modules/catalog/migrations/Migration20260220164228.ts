import { Migration } from '@mikro-orm/migrations';

export class Migration20260220164228 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" drop column "localized_content";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" add column "localized_content" jsonb null;`);
  }

}
