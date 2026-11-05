import { Migration } from '@mikro-orm/migrations';

export class Migration20260129082610 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "notifications" add column if not exists "title_key" text null, add column if not exists "body_key" text null, add column if not exists "title_variables" jsonb null, add column if not exists "body_variables" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "notifications" drop column if exists "title_key", drop column if exists "body_key", drop column if exists "title_variables", drop column if exists "body_variables";`);
  }

}
