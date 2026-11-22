import { Migration } from '@mikro-orm/migrations';

export class Migration20261121193634_freight_operations extends Migration {

  override name = 'Migration20261121193634';

  override up(): void | Promise<void> {
    this.addSql(`alter table "freight_orders" add "source" text not null default 'staff', add "submitted_at" timestamptz null;`);
    this.addSql(`alter table "freight_orders" add constraint "freight_orders_source_check" check ("source" in ('staff', 'customer_portal'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "freight_orders" drop constraint if exists "freight_orders_source_check";`);
    this.addSql(`alter table "freight_orders" drop column "source", drop column "submitted_at";`);
  }

}
