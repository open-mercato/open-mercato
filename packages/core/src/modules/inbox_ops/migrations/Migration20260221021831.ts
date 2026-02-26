import { Migration } from '@mikro-orm/migrations';

export class Migration20260221021831 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "inbox_proposals" add column "working_language" text null, add column "translations" jsonb null;`);

    this.addSql(`alter table "inbox_settings" add column "working_language" text not null default 'en';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "inbox_proposals" drop column "working_language", drop column "translations";`);

    this.addSql(`alter table "inbox_settings" drop column "working_language";`);
  }

}
