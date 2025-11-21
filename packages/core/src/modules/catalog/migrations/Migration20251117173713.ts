import { Migration } from '@mikro-orm/migrations';

export class Migration20251117173713 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_variant_prices" add column "tax_amount" numeric(16,4) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_variant_prices" drop column "tax_amount";`);
  }

}
