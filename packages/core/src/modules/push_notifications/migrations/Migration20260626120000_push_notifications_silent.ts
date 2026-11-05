import { Migration } from '@mikro-orm/migrations';

export class Migration20260626120000_push_notifications_silent extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "push_notification_deliveries" add column "silent" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "push_notification_deliveries" drop column "silent";`);
  }

}
