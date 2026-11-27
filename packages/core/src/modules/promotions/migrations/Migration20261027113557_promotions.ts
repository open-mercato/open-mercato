import { Migration } from '@mikro-orm/migrations';

export class Migration20261027113557_promotions extends Migration {

  override name = 'Migration20261027113557';

  override up(): void | Promise<void> {
    this.addSql(`alter table "promotions" alter column "max_budget" type numeric using ("max_budget"::numeric);`);

    this.addSql(`alter table "promotion_usages" alter column "total_discount_amount" type numeric using ("total_discount_amount"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "promotion_usages" alter column "total_discount_amount" type numeric(16,2) using ("total_discount_amount"::numeric(16,2));`);

    this.addSql(`alter table "promotions" alter column "max_budget" type numeric(16,2) using ("max_budget"::numeric(16,2));`);
  }

}
