import { Migration } from '@mikro-orm/migrations';

export class Migration20260928175058_customers extends Migration {

  override name = 'Migration20260928175058_customers';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_dictionary_entries" add "activity_type_behavior" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_dictionary_entries" drop column "activity_type_behavior";`);
  }

}
