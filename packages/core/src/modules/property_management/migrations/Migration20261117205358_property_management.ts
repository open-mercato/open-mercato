import { Migration } from '@mikro-orm/migrations';

export class Migration20261117205358_property_management extends Migration {

  override name = 'Migration20261117205358';

  override up(): void | Promise<void> {
    this.addSql(`create index "property_management_sales_operations_lease_idx" on "property_management_sales_operations" ("organization_id", "lease_id", "status");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "property_management_sales_operations_lease_idx";`);
  }

}
