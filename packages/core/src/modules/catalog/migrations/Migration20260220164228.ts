import { Migration } from '@mikro-orm/migrations';

// Drop unused localized_content column — content is now managed via the translations system.
// Included in UoM branch for deployment convenience; this change is independent of UoM logic.
export class Migration20260220164228 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" drop column if exists "localized_content";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" add column if not exists "localized_content" jsonb null;`);
  }

}
