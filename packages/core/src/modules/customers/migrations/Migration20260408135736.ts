import { Migration } from '@mikro-orm/migrations'

export class Migration20260408135736 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "customer_interactions" add column "duration_minutes" int null, add column "location" text null, add column "all_day" boolean null, add column "recurrence_rule" text null, add column "recurrence_end" timestamptz null, add column "participants" jsonb null, add column "reminder_minutes" int null, add column "visibility" text null;',
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "customer_interactions" drop column "duration_minutes", drop column "location", drop column "all_day", drop column "recurrence_rule", drop column "recurrence_end", drop column "participants", drop column "reminder_minutes", drop column "visibility";',
    )
  }
}
