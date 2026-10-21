import { Migration } from '@mikro-orm/migrations';

export class Migration20261019204611_transport_operations extends Migration {

  override name = 'Migration20261019204611';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transport_trip_schedules" add "cancellation_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transport_trip_schedules" drop column "cancellation_reason";`);
  }

}
