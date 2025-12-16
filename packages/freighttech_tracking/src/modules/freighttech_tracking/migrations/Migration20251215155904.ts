import { Migration } from '@mikro-orm/migrations';

export class Migration20251215155904 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "freighttech_tracking_settings" add column "api_base_url" text not null default '';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "freighttech_tracking_settings" drop column "api_base_url";`);
  }

}
