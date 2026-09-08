import { Migration } from '@mikro-orm/migrations';

export class Migration20260706120000_notifications_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "notifications" add column "channels" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "notifications" drop column "channels";`);
  }

}
