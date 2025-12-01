import { Migration } from '@mikro-orm/migrations';

export class Migration20251201164458 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "tax_rate_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "tax_rate_id";`);
  }

}
