import { Migration } from '@mikro-orm/migrations';

export class Migration20261112235012_property_management extends Migration {

  override name = 'Migration20261112235012';

  override up(): void | Promise<void> {
    this.addSql(`create index "property_management_bookings_sweep_idx" on "property_management_bookings" ("organization_id", "status", "ends_at", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "property_management_bookings_sweep_idx";`);
  }

}
