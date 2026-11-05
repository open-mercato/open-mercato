import { Migration } from '@mikro-orm/migrations';

export class Migration20260129082610 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" add column "processing_started_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop column "processing_started_at";`);
  }

}
