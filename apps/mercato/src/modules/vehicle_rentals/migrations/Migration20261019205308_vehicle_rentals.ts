import { Migration } from '@mikro-orm/migrations';

export class Migration20261019205308_vehicle_rentals extends Migration {

  override name = 'Migration20261019205308';

  override up(): void | Promise<void> {
    this.addSql(`alter table "rental_contracts" add "sales_order_id" uuid null, add "sales_invoice_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "rental_contracts" drop column "sales_order_id", drop column "sales_invoice_id";`);
  }

}
