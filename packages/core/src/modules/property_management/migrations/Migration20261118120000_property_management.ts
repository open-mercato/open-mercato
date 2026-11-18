import { Migration } from '@mikro-orm/migrations';

export class Migration20261118120000_property_management extends Migration {

  override name = 'Migration20261118120000';

  override up(): void | Promise<void> {
    this.addSql(`create index "property_management_unit_product_periods_open_product_idx" on "property_management_unit_product_periods" ("organization_id", "catalog_product_id") where "valid_to" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "property_management_unit_product_periods_open_product_idx";`);
  }

}
