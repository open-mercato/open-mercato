import { Migration } from '@mikro-orm/migrations';

export class Migration20260324100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" add column "marketing_consent" boolean null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop column "marketing_consent";`);
  }

}
