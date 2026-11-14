import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082519_catalog extends Migration {

  override name = 'Migration20261014082519';

  override up(): void | Promise<void> {
    this.addSql(`alter table "catalog_price_history_entries" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "catalog_price_history_entries" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "catalog_price_history_entries" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "catalog_product_variant_prices" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "catalog_product_variant_prices" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "catalog_product_variant_prices" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "catalog_price_history_entries" alter column "unit_price_net" type numeric(16,4) using ("unit_price_net"::numeric(16,4));`);
    this.addSql(`alter table "catalog_price_history_entries" alter column "unit_price_gross" type numeric(16,4) using ("unit_price_gross"::numeric(16,4));`);
    this.addSql(`alter table "catalog_price_history_entries" alter column "tax_amount" type numeric(16,4) using ("tax_amount"::numeric(16,4));`);

    this.addSql(`alter table "catalog_product_variant_prices" alter column "unit_price_net" type numeric(16,4) using ("unit_price_net"::numeric(16,4));`);
    this.addSql(`alter table "catalog_product_variant_prices" alter column "unit_price_gross" type numeric(16,4) using ("unit_price_gross"::numeric(16,4));`);
    this.addSql(`alter table "catalog_product_variant_prices" alter column "tax_amount" type numeric(16,4) using ("tax_amount"::numeric(16,4));`);
  }

}
