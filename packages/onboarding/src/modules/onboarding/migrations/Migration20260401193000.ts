import { Migration } from '@mikro-orm/migrations';

export class Migration20260401193000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" add column "preparation_completed_at" timestamptz null, add column "ready_email_sent_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop column "preparation_completed_at", drop column "ready_email_sent_at";`);
  }

}
