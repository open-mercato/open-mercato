import { Migration } from '@mikro-orm/migrations';

export class Migration20261122013721_transport_operations extends Migration {

  override name = 'Migration20261122013721';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transport_drivers" add "user_id" uuid null;`);
    this.addSql(`create unique index "transport_drivers_user_unique_idx" on "transport_drivers" ("organization_id", "tenant_id", "user_id") where user_id is not null and deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "transport_drivers_user_unique_idx";`);
    this.addSql(`alter table "transport_drivers" drop column "user_id";`);
  }

}
