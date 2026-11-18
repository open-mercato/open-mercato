import { Migration } from '@mikro-orm/migrations';

export class Migration20261112225910_property_management extends Migration {

  override name = 'Migration20261112225910';

  override up(): void | Promise<void> {
    this.addSql(`create index "property_management_bookings_unavailability_idx" on "property_management_bookings" ("organization_id", "unavailability_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "property_management_bookings_unavailability_idx";`);
  }

}
