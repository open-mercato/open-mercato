import { Migration } from '@mikro-orm/migrations';

export class Migration20261009220755_freight_operations extends Migration {

  override name = 'Migration20261009220755';

  override up(): void | Promise<void> {
    this.addSql(`alter table "freight_trip_abstracts" add "cancelled_at" timestamptz null, add "cancelled_by" uuid null, add "cancellation_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "freight_trip_abstracts" drop column "cancelled_at", drop column "cancelled_by", drop column "cancellation_reason";`);
  }

}
