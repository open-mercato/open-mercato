import { Migration } from '@mikro-orm/migrations';

export class Migration20261016134622_customers extends Migration {

  override name = 'Migration20261016134622';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_addresses" add "recipient_name" text null, add "phone" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_addresses" drop column "recipient_name", drop column "phone";`);
  }

}
