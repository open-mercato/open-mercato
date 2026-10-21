import { Migration } from '@mikro-orm/migrations';

export class Migration20261019205308_student_transport extends Migration {

  override name = 'Migration20261019205308';

  override up(): void | Promise<void> {
    this.addSql(`alter table "student_subscriptions" add "sales_order_id" uuid null, add "sales_invoice_id" uuid null, add "last_invoiced_period_from" date null, add "last_invoiced_period_to" date null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "student_subscriptions" drop column "sales_order_id", drop column "sales_invoice_id", drop column "last_invoiced_period_from", drop column "last_invoiced_period_to";`);
  }

}
