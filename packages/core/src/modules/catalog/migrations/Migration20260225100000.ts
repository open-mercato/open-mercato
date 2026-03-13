import { Migration } from '@mikro-orm/migrations'

export class Migration20260225100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "omnibus_exempt" boolean not null default false;`)
    this.addSql(`alter table "catalog_products" add column "first_listed_at" timestamptz null;`)
    this.addSql(`alter table "catalog_product_variants" add column "omnibus_exempt" boolean null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "omnibus_exempt";`)
    this.addSql(`alter table "catalog_products" drop column "first_listed_at";`)
    this.addSql(`alter table "catalog_product_variants" drop column "omnibus_exempt";`)
  }

}
