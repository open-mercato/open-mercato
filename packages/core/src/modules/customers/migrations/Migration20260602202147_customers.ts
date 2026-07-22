import { Migration } from '@mikro-orm/migrations';

export class Migration20260602202147_customers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_settings" add "dictionary_sort_modes" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_settings" drop column "dictionary_sort_modes";`);
  }

}
