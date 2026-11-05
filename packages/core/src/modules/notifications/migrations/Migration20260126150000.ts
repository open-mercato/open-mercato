import { Migration } from '@mikro-orm/migrations'

export class Migration20260126150000 extends Migration {
  async up(): Promise<void> {
    // Add i18n support fields to notifications table
    this.addSql(`
      alter table "notifications"
      add column if not exists "title_key" text,
      add column if not exists "body_key" text,
      add column if not exists "title_variables" jsonb,
      add column if not exists "body_variables" jsonb;
    `)

    // Add comments for clarity
    this.addSql(`
      comment on column "notifications"."title_key" is 'i18n key for notification title';
    `)
    this.addSql(`
      comment on column "notifications"."body_key" is 'i18n key for notification body';
    `)
    this.addSql(`
      comment on column "notifications"."title_variables" is 'Variables for i18n interpolation in title';
    `)
    this.addSql(`
      comment on column "notifications"."body_variables" is 'Variables for i18n interpolation in body';
    `)
  }

  async down(): Promise<void> {
    // Remove i18n support fields
    this.addSql(`
      alter table "notifications"
      drop column if exists "title_key",
      drop column if exists "body_key",
      drop column if exists "title_variables",
      drop column if exists "body_variables";
    `)
  }
}
