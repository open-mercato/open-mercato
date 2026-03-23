import { Migration } from '@mikro-orm/migrations';

export class Migration20260307040100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_activities" add column "due_at" timestamptz null, add column "reminder_at" timestamptz null, add column "reminder_sent" boolean not null default false, add column "is_overdue" boolean not null default false, add column "assigned_to_user_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_activities" drop column "due_at", drop column "reminder_at", drop column "reminder_sent", drop column "is_overdue", drop column "assigned_to_user_id";`);
  }

}
