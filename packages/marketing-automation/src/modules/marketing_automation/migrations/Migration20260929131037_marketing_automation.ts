import { Migration } from '@mikro-orm/migrations';

export class Migration20260929131037_marketing_automation extends Migration {

  override name = 'Migration20260929131037';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_customer_score_entries" alter column "subject_entity_id" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_customer_score_entries" alter column "subject_entity_id" set not null;`);
  }

}
