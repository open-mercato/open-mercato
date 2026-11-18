import { Migration } from '@mikro-orm/migrations';

export class Migration20261111195427_property_management extends Migration {

  override name = 'Migration20261111195427';

  override up(): void | Promise<void> {
    this.addSql(`create table "property_management_bookings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "unit_id" uuid not null, "customer_company_id" uuid null, "booked_by_person_id" uuid not null, "customer_user_id" uuid null, "starts_at" timestamp not null, "ends_at" timestamp not null, "status" text not null, "hold_token" uuid null, "cancel_reason" text null, "unavailability_id" uuid null, "catalog_product_id" uuid not null, "product_name" text not null, "unit_price" numeric(16,4) not null, "quantity" int not null, "billing_unit" text not null, "total_amount" numeric(16,4) not null, "currency_code" text null, "sales_order_id" uuid null, "reminder_sent_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_bookings_building_idx" on "property_management_bookings" ("organization_id", "building_id", "starts_at");`);
    this.addSql(`create index "property_management_bookings_status_idx" on "property_management_bookings" ("organization_id", "status", "starts_at");`);
    this.addSql(`create index "property_management_bookings_customer_user_idx" on "property_management_bookings" ("organization_id", "customer_user_id", "starts_at");`);
    this.addSql(`create index "property_management_bookings_unit_starts_idx" on "property_management_bookings" ("organization_id", "unit_id", "starts_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "property_management_bookings" cascade;`);
  }

}
