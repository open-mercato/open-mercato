import { Migration } from '@mikro-orm/migrations';

export class Migration20251126125305 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_settings" add column "order_customer_editable_statuses" jsonb null, add column "order_address_editable_statuses" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "order_customer_editable_statuses", drop column "order_address_editable_statuses";`);
  }

}
