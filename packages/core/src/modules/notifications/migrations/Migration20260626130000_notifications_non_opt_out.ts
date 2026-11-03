import { Migration } from '@mikro-orm/migrations';

export class Migration20260626130000_notifications_non_opt_out extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "notification_types" add column "non_opt_out" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "notification_types" drop column "non_opt_out";`);
  }

}
