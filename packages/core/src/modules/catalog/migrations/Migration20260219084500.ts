import { Migration } from "@mikro-orm/migrations";

export class Migration20260219084500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "catalog_products" set "default_unit" = 'pc' where lower(btrim(coalesce("default_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "catalog_products" set "default_sales_unit" = 'pc' where lower(btrim(coalesce("default_sales_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "catalog_products" set "unit_price_reference_unit" = 'pc' where lower(btrim(coalesce("unit_price_reference_unit", ''))) = 'qty';`,
    );

    this.addSql(
      `delete from "catalog_product_unit_conversions" as legacy where lower(btrim(coalesce(legacy."unit_code", ''))) = 'qty' and exists (select 1 from "catalog_product_unit_conversions" as canonical where canonical."product_id" = legacy."product_id" and canonical."id" <> legacy."id" and lower(btrim(coalesce(canonical."unit_code", ''))) = 'pc');`,
    );
    this.addSql(
      `update "catalog_product_unit_conversions" set "unit_code" = 'pc' where lower(btrim(coalesce("unit_code", ''))) = 'qty';`,
    );
  }

  override async down(): Promise<void> {}
}
