import { Migration } from '@mikro-orm/migrations';

export class Migration20260709120000_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" add "order_number" text null, add "awaiting_staff_reply" boolean not null default false;`);
    this.addSql(`
      do $$ begin
        if to_regclass('sales_orders') is not null then
          update "warranty_claims" wc
          set "order_number" = so."order_number"
          from "sales_orders" so
          where wc."order_id" = so."id"
            and wc."order_number" is null
            and so."order_number" is not null;
        end if;
      end $$;
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" drop column "order_number", drop column "awaiting_staff_reply";`);
  }

}
