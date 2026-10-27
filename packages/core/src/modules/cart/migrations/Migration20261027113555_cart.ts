import { Migration } from '@mikro-orm/migrations';

export class Migration20261027113555_cart extends Migration {

  override name = 'Migration20261027113555';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cart_lines" alter column "discount_total_net" type numeric using ("discount_total_net"::numeric);`);
    this.addSql(`alter table "cart_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "cart_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "cart_promotion_applications" alter column "amount_gross" type numeric using ("amount_gross"::numeric);`);
    this.addSql(`alter table "cart_promotion_applications" alter column "amount_net" type numeric using ("amount_net"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cart_lines" alter column "unit_price_net" type numeric(16,4) using ("unit_price_net"::numeric(16,4));`);
    this.addSql(`alter table "cart_lines" alter column "unit_price_gross" type numeric(16,4) using ("unit_price_gross"::numeric(16,4));`);
    this.addSql(`alter table "cart_lines" alter column "discount_total_net" type numeric(16,4) using ("discount_total_net"::numeric(16,4));`);

    this.addSql(`alter table "cart_promotion_applications" alter column "amount_net" type numeric(16,4) using ("amount_net"::numeric(16,4));`);
    this.addSql(`alter table "cart_promotion_applications" alter column "amount_gross" type numeric(16,4) using ("amount_gross"::numeric(16,4));`);
  }

}
