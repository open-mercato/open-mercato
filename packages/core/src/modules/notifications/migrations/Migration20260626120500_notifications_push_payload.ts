import { Migration } from '@mikro-orm/migrations';

export class Migration20260626120500_notifications_push_payload extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "notifications" add column "data" jsonb null;`);
    this.addSql(`alter table "notifications" add column "push_options" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "notifications" drop column "push_options";`);
    this.addSql(`alter table "notifications" drop column "data";`);
  }

}
