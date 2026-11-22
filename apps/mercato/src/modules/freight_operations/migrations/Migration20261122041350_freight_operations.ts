import { Migration } from '@mikro-orm/migrations';

export class Migration20261122041350_freight_operations extends Migration {

  override name = 'Migration20261122041350';

  override up(): void | Promise<void> {
    this.addSql(`alter table "freight_orders" add "tracking_token" text null;`);
    this.addSql(`create unique index "freight_orders_tracking_token_unique_idx" on "freight_orders" ("tracking_token") where tracking_token is not null and deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "freight_orders_tracking_token_unique_idx";`);
    this.addSql(`alter table "freight_orders" drop column "tracking_token";`);
  }

}
