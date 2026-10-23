import { Migration } from '@mikro-orm/migrations';

export class Migration20261015120000_catalog extends Migration {

  override name = 'Migration20261015120000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "catalog_products" add column if not exists "omnibus_exempt" boolean not null default false, add column if not exists "first_listed_at" timestamptz null;`);
    this.addSql(`alter table "catalog_product_variants" add column if not exists "omnibus_exempt" boolean null;`);
    this.addSql(`update "catalog_products" set "first_listed_at" = "created_at" where "first_listed_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "catalog_product_variants" drop column if exists "omnibus_exempt";`);
    this.addSql(`alter table "catalog_products" drop column if exists "first_listed_at", drop column if exists "omnibus_exempt";`);
  }

}
