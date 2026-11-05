import { Migration } from '@mikro-orm/migrations';

export class Migration20251124135129 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "customer_snapshot" jsonb null, add column "billing_address_id" uuid null, add column "shipping_address_id" uuid null, add column "billing_address_snapshot" jsonb null, add column "shipping_address_snapshot" jsonb null, add column "tax_info" jsonb null, add column "shipping_method_id" uuid null, add column "shipping_method_code" text null, add column "shipping_method_ref_id" uuid null, add column "delivery_window_id" uuid null, add column "delivery_window_code" text null, add column "delivery_window_ref_id" uuid null, add column "payment_method_id" uuid null, add column "payment_method_code" text null, add column "payment_method_ref_id" uuid null, add column "shipping_method_snapshot" jsonb null, add column "delivery_window_snapshot" jsonb null, add column "payment_method_snapshot" jsonb null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_shipping_method_ref_id_foreign" foreign key ("shipping_method_ref_id") references "sales_shipping_methods" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_delivery_window_ref_id_foreign" foreign key ("delivery_window_ref_id") references "sales_delivery_windows" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_payment_method_ref_id_foreign" foreign key ("payment_method_ref_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_orders" add column "customer_snapshot" jsonb null, add column "billing_address_snapshot" jsonb null, add column "shipping_address_snapshot" jsonb null, add column "tax_info" jsonb null, add column "delivery_window_snapshot" jsonb null, add column "shipping_method_code" text null, add column "delivery_window_code" text null, add column "payment_method_code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_shipping_method_ref_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_delivery_window_ref_id_foreign";`);
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_payment_method_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop column "customer_snapshot", drop column "billing_address_id", drop column "shipping_address_id", drop column "billing_address_snapshot", drop column "shipping_address_snapshot", drop column "tax_info", drop column "shipping_method_id", drop column "shipping_method_code", drop column "shipping_method_ref_id", drop column "delivery_window_id", drop column "delivery_window_code", drop column "delivery_window_ref_id", drop column "payment_method_id", drop column "payment_method_code", drop column "payment_method_ref_id", drop column "shipping_method_snapshot", drop column "delivery_window_snapshot", drop column "payment_method_snapshot";`);

    this.addSql(`alter table "sales_orders" drop column "customer_snapshot", drop column "billing_address_snapshot", drop column "shipping_address_snapshot", drop column "tax_info", drop column "delivery_window_snapshot", drop column "shipping_method_code", drop column "delivery_window_code", drop column "payment_method_code";`);
  }

}
