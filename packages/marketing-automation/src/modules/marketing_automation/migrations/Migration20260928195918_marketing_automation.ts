import { Migration } from '@mikro-orm/migrations';

export class Migration20260928195918_marketing_automation extends Migration {

  override name = 'Migration20260928195918';

  override up(): void | Promise<void> {
    this.addSql(`create unique index "marketing_runs_active_subject_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "subject_entity_id") where subject_entity_id is not null and status in ('running', 'waiting', 'claimed');`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "marketing_runs_active_subject_uniq";`);
  }

}
