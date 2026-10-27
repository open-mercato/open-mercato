import { Migration } from '@mikro-orm/migrations';

export class Migration20260817081500_onboarding extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop constraint if exists "onboarding_requests_email_unique";`);
    this.addSql(`create index if not exists "onboarding_requests_email_idx" on "onboarding_requests" ("email");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "onboarding_requests_email_idx";`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_unique" unique ("email");`);
  }

}
