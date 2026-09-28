import { Migration } from '@mikro-orm/migrations';

export class Migration20260928192446_marketing_automation extends Migration {

  override name = 'Migration20260928192446';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_campaign_runs" add "variant_choices" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_campaign_runs" drop column "variant_choices";`);
  }

}
