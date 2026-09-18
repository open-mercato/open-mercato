import { Migration } from '@mikro-orm/migrations';

export class Migration20260710133207_onboarding extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "onboarding_requests" add "email_hash" text null;`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_hash_unique" unique ("email_hash");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop constraint if exists "onboarding_requests_email_hash_unique";`);
    this.addSql(`alter table "onboarding_requests" drop column "email_hash";`);
  }

}
