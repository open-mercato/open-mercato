import { Migration } from '@mikro-orm/migrations';

export class Migration20260930084704_marketing_automation extends Migration {

  override name = 'Migration20260930084704';

  override up(): void | Promise<void> {
    this.addSql(`create index "mkt_runs_subject_window_idx" on "marketing_campaign_runs" ("tenant_id", "organization_id", "subject_entity_id", "started_at");`);

    this.addSql(`create index "mkt_sends_run_step_idx" on "marketing_message_sends" ("run_id", "step_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "mkt_runs_subject_window_idx";`);

    this.addSql(`drop index "mkt_sends_run_step_idx";`);
  }

}
