import { Migration } from '@mikro-orm/migrations';

export class Migration20261127212933_customers extends Migration {

  override name = 'Migration20261127212933';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_deals" add "created_by_user_id" uuid null;`);

    this.addSql(`alter table "customer_entities" add "created_by_user_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_deals" drop column "created_by_user_id";`);

    this.addSql(`alter table "customer_entities" drop column "created_by_user_id";`);
  }

}
