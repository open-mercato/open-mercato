import { Migration } from '@mikro-orm/migrations';

export class Migration20260930110235_customers extends Migration {

  override name = 'Migration20260930110235';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_interactions" add "timezone" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_interactions" drop column "timezone";`);
  }

}
