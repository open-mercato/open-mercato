import { Migration } from '@mikro-orm/migrations';

export class Migration20260919122258_catalog extends Migration {

  override name = 'Migration20260919122258';

  override up(): void | Promise<void> {
    this.addSql(`alter table "catalog_products" add "tax_code" text null, add "is_taxable" boolean not null default true;`);

    this.addSql(`alter table "catalog_product_variants" add "tax_code" text null, add "is_taxable" boolean not null default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "catalog_product_variants" drop column "tax_code", drop column "is_taxable";`);

    this.addSql(`alter table "catalog_products" drop column "tax_code", drop column "is_taxable";`);
  }

}
