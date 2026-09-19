import { Migration } from '@mikro-orm/migrations';

export class Migration20260919102840_onboarding extends Migration {

  override name = 'Migration20260919102840';

  override up(): void | Promise<void> {
    this.addSql(`alter table "onboarding_requests" add "market_code" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "onboarding_requests" drop column "market_code";`);
  }

}
