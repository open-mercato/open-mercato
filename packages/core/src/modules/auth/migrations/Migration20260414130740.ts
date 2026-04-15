import { Migration } from '@mikro-orm/migrations';

export class Migration20260414130740 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "accessibility_preferences" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "accessibility_preferences";`);
  }

}
