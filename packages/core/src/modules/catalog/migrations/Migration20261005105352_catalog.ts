import { Migration } from '@mikro-orm/migrations';

const PRICE_ROW_INDEXES = [
  {
    name: 'catalog_product_variant_prices_customer_idx',
    definition: '("customer_id", "organization_id", "tenant_id") where "customer_id" is not null',
  },
  {
    name: 'catalog_product_variant_prices_customer_group_idx',
    definition: '("customer_group_id", "organization_id", "tenant_id") where "customer_group_id" is not null',
  },
  {
    name: 'catalog_product_variant_prices_product_lookup_idx',
    definition: '("product_id", "currency_code", "channel_id", "organization_id", "tenant_id")',
  },
] as const;

export class Migration20261005105352_catalog extends Migration {

  override name = 'Migration20261005105352';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    for (const index of PRICE_ROW_INDEXES) {
      this.addSql(`drop index concurrently if exists "${index.name}";`);
      this.addSql(`create index concurrently "${index.name}" on "catalog_product_variant_prices" ${index.definition};`);
    }
  }

  override down(): void | Promise<void> {
    for (const index of PRICE_ROW_INDEXES) {
      this.addSql(`drop index concurrently if exists "${index.name}";`);
    }
  }

}
