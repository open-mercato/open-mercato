import { Migration } from '@mikro-orm/migrations'

export class Migration20251117134301 extends Migration {

  override async up(): Promise<void> {
    this.addSql('alter table "catalog_product_prices" rename to "catalog_product_variant_prices";')
    this.addSql('alter index "catalog_product_prices_product_scope_idx" rename to "catalog_product_variant_prices_product_scope_idx";')
    this.addSql('alter index "catalog_product_prices_variant_scope_idx" rename to "catalog_product_variant_prices_variant_scope_idx";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_pkey" to "catalog_product_variant_prices_pkey";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_unique" to "catalog_product_variant_prices_unique";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_variant_id_foreign" to "catalog_product_variant_prices_variant_id_foreign";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_product_id_foreign" to "catalog_product_variant_prices_product_id_foreign";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_offer_id_foreign" to "catalog_product_variant_prices_offer_id_foreign";')
    this.addSql('alter table "catalog_product_variant_prices" rename constraint "catalog_product_prices_price_kind_id_foreign" to "catalog_product_variant_prices_price_kind_id_foreign";')

    this.addSql('alter table "catalog_variant_option_values" rename to "catalog_product_variant_option_values";')
    this.addSql('alter table "catalog_product_variant_option_values" rename constraint "catalog_variant_option_values_pkey" to "catalog_product_variant_option_values_pkey";')
    this.addSql('alter table "catalog_product_variant_option_values" rename constraint "catalog_variant_option_values_unique" to "catalog_product_variant_option_values_unique";')
    this.addSql('alter table "catalog_product_variant_option_values" rename constraint "catalog_variant_option_values_variant_id_foreign" to "catalog_product_variant_option_values_variant_id_foreign";')
    this.addSql('alter table "catalog_product_variant_option_values" rename constraint "catalog_variant_option_values_option_value_id_foreign" to "catalog_product_variant_option_values_option_value_id_foreign";')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "catalog_product_variant_prices" rename to "catalog_product_prices";')
    this.addSql('alter index "catalog_product_variant_prices_product_scope_idx" rename to "catalog_product_prices_product_scope_idx";')
    this.addSql('alter index "catalog_product_variant_prices_variant_scope_idx" rename to "catalog_product_prices_variant_scope_idx";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_pkey" to "catalog_product_prices_pkey";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_unique" to "catalog_product_prices_unique";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_variant_id_foreign" to "catalog_product_prices_variant_id_foreign";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_product_id_foreign" to "catalog_product_prices_product_id_foreign";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_offer_id_foreign" to "catalog_product_prices_offer_id_foreign";')
    this.addSql('alter table "catalog_product_prices" rename constraint "catalog_product_variant_prices_price_kind_id_foreign" to "catalog_product_prices_price_kind_id_foreign";')

    this.addSql('alter table "catalog_product_variant_option_values" rename to "catalog_variant_option_values";')
    this.addSql('alter table "catalog_variant_option_values" rename constraint "catalog_product_variant_option_values_pkey" to "catalog_variant_option_values_pkey";')
    this.addSql('alter table "catalog_variant_option_values" rename constraint "catalog_product_variant_option_values_unique" to "catalog_variant_option_values_unique";')
    this.addSql('alter table "catalog_variant_option_values" rename constraint "catalog_product_variant_option_values_variant_id_foreign" to "catalog_variant_option_values_variant_id_foreign";')
    this.addSql('alter table "catalog_variant_option_values" rename constraint "catalog_product_variant_option_values_option_value_id_foreign" to "catalog_variant_option_values_option_value_id_foreign";')
  }

}
