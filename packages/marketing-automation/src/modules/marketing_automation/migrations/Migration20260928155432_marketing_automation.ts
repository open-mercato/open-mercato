import { Migration } from '@mikro-orm/migrations';

export class Migration20260928155432_marketing_automation extends Migration {

  override name = 'Migration20260928155432';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_campaign_triggers" add "last_swept_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_campaign_triggers" drop column "last_swept_at";`);
  }

}
