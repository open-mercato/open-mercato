import { Migration } from '@mikro-orm/migrations';

export class Migration20260929083000_customer_groups extends Migration {

  override name = 'Migration20260929083000';

  override up(): void | Promise<void> {
    // `allow_purchase_on_account` becomes nullable like every other terms field, so a
    // group's terms row can leave it unset (`null`) and inherit it from the parent
    // chain / tenant default. Existing values are kept as stored.
    this.addSql(`alter table "customer_group_terms" alter column "allow_purchase_on_account" drop default;`);
    this.addSql(`alter table "customer_group_terms" alter column "allow_purchase_on_account" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`update "customer_group_terms" set "allow_purchase_on_account" = false where "allow_purchase_on_account" is null;`);
    this.addSql(`alter table "customer_group_terms" alter column "allow_purchase_on_account" set default false;`);
    this.addSql(`alter table "customer_group_terms" alter column "allow_purchase_on_account" set not null;`);
  }

}
