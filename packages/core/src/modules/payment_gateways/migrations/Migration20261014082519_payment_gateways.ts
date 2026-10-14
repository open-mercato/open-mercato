import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082519_payment_gateways extends Migration {

  override name = 'Migration20261014082519';

  override up(): void | Promise<void> {
    this.addSql(`alter table "gateway_payment_operations" alter column "reserved_amount" type numeric using ("reserved_amount"::numeric);`);

    this.addSql(`alter table "gateway_transactions" alter column "amount" type numeric using ("amount"::numeric);`);
    this.addSql(`alter table "gateway_transactions" alter column "captured_amount" type numeric using ("captured_amount"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "gateway_payment_operations" alter column "reserved_amount" type numeric(18,4) using ("reserved_amount"::numeric(18,4));`);

    this.addSql(`alter table "gateway_transactions" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);
    this.addSql(`alter table "gateway_transactions" alter column "captured_amount" type numeric(18,4) using ("captured_amount"::numeric(18,4));`);
  }

}
