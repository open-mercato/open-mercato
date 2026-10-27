import { Migration } from '@mikro-orm/migrations';

export class Migration20260626140000_notifications_type_category_silent extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "notification_types" add column "category" text null;`);
    this.addSql(`alter table "notification_types" add column "silent" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "notification_types" drop column "silent";`);
    this.addSql(`alter table "notification_types" drop column "category";`);
  }

}
