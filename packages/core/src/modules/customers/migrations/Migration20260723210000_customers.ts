import { Migration } from '@mikro-orm/migrations';

export class Migration20260723210000_customers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_deal_people" add "is_primary" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_deal_people" drop column "is_primary";`);
  }

}
