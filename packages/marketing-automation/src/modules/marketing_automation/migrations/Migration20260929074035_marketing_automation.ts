import { Migration } from '@mikro-orm/migrations';

export class Migration20260929074035_marketing_automation extends Migration {

  override name = 'Migration20260929074035';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_survey_prompts" add "sent_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_survey_prompts" drop column "sent_at";`);
  }

}
