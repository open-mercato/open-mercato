import { Migration } from '@mikro-orm/migrations';

export class Migration20260701120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "user_devices" add column "locale" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "user_devices" drop column "locale";`);
  }

}
