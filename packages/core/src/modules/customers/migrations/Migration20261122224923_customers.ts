import { Migration } from '@mikro-orm/migrations';

export class Migration20261122224923_customers extends Migration {

  override name = 'Migration20261122224923_customers';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_interactions" alter column "entity_id" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_interactions" alter column "entity_id" set not null;`);
  }

}
