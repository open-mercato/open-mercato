import { Migration } from '@mikro-orm/migrations';

export class Migration20261122042552_freight_operations extends Migration {

  override name = 'Migration20261122042552';

  override up(): void | Promise<void> {
    this.addSql(`create table "freight_driver_ratings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "trip_id" uuid null, "driver_id" uuid not null, "customer_id" uuid not null, "rating" int not null, "comment" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "freight_driver_ratings_order_unique_idx" on "freight_driver_ratings" ("organization_id", "tenant_id", "order_id") where deleted_at is null;`);
    this.addSql(`create index "freight_driver_ratings_driver_idx" on "freight_driver_ratings" ("organization_id", "driver_id");`);
    this.addSql(`create index "freight_driver_ratings_tenant_org_idx" on "freight_driver_ratings" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "freight_driver_ratings" cascade;`);
  }

}
