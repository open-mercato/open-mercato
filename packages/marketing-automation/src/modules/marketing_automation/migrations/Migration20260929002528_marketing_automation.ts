import { Migration } from '@mikro-orm/migrations';

export class Migration20260929002528_marketing_automation extends Migration {

  override name = 'Migration20260929002528';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_contact_preferences" add "locale" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_contact_preferences" drop column "locale";`);
  }

}
