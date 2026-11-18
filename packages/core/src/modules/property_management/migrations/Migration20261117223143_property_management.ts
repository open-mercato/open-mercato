import { Migration } from '@mikro-orm/migrations';

export class Migration20261117223143_property_management extends Migration {

  override name = 'Migration20261117223143';

  override up(): void | Promise<void> {
    this.addSql(`create index "property_management_leases_sweep_idx" on "property_management_leases" ("organization_id", "status", "ends_on", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "property_management_leases_sweep_idx";`);
  }

}
