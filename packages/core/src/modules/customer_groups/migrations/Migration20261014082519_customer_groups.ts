import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082519_customer_groups extends Migration {

  override name = 'Migration20261014082519';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" alter column "approval_required_above" type numeric using ("approval_required_above"::numeric);`);
    this.addSql(`alter table "customer_group_terms" alter column "default_credit_limit" type numeric using ("default_credit_limit"::numeric);`);
    this.addSql(`alter table "customer_group_terms" alter column "min_order_value" type numeric using ("min_order_value"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" alter column "default_credit_limit" type numeric(16,2) using ("default_credit_limit"::numeric(16,2));`);
    this.addSql(`alter table "customer_group_terms" alter column "approval_required_above" type numeric(16,2) using ("approval_required_above"::numeric(16,2));`);
    this.addSql(`alter table "customer_group_terms" alter column "min_order_value" type numeric(16,2) using ("min_order_value"::numeric(16,2));`);
  }

}
