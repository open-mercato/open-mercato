import { Migration } from '@mikro-orm/migrations';

export class Migration20260607205834 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "inbox_settings" add column "webhook_secret" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "inbox_settings" drop column "webhook_secret";`);
  }

}
