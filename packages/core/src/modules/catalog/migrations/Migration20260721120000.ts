import { Migration } from '@mikro-orm/migrations'

export class Migration20260721120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column if not exists "omnibus_exempt" boolean not null default false;`)
    this.addSql(`alter table "catalog_products" add column if not exists "first_listed_at" timestamptz null;`)
    this.addSql(`alter table "catalog_product_variants" add column if not exists "omnibus_exempt" boolean null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_variants" drop column if exists "omnibus_exempt";`)
    this.addSql(`alter table "catalog_products" drop column if exists "first_listed_at";`)
    this.addSql(`alter table "catalog_products" drop column if exists "omnibus_exempt";`)
  }

}
