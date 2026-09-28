import { Migration } from '@mikro-orm/migrations';

export class Migration20260928180941_marketing_automation extends Migration {

  override name = 'Migration20260928180941';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_campaign_runs" add "occurrence_key" text null;`);
    this.addSql(`create unique index "marketing_runs_occurrence_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "occurrence_key") where occurrence_key is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "marketing_runs_occurrence_uniq";`);
    this.addSql(`alter table "marketing_campaign_runs" drop column "occurrence_key";`);
  }

}
