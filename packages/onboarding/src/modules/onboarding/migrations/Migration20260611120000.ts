import { Migration } from '@mikro-orm/migrations';

export class Migration20260611120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" add column "preparation_claimed_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop column "preparation_claimed_at";`);
  }

}
