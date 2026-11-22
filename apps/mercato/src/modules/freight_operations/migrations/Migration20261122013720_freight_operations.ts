import { Migration } from '@mikro-orm/migrations';

export class Migration20261122013720_freight_operations extends Migration {

  override name = 'Migration20261122013720';

  override up(): void | Promise<void> {
    this.addSql(`create table "freight_driver_alerts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "driver_id" uuid not null, "trip_id" uuid null, "order_id" uuid null, "kind" text not null default 'sos', "latitude" numeric(10,7) null, "longitude" numeric(10,7) null, "note" text null, "created_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "freight_driver_alerts_driver_idx" on "freight_driver_alerts" ("organization_id", "driver_id", "created_at");`);
    this.addSql(`create index "freight_driver_alerts_tenant_org_idx" on "freight_driver_alerts" ("tenant_id", "organization_id");`);

    this.addSql(`create table "freight_driver_rest_breaks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "driver_id" uuid not null, "trip_id" uuid null, "started_at" timestamptz not null, "ended_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "freight_driver_rest_breaks_driver_idx" on "freight_driver_rest_breaks" ("organization_id", "driver_id", "ended_at");`);
    this.addSql(`create index "freight_driver_rest_breaks_tenant_org_idx" on "freight_driver_rest_breaks" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "freight_driver_alerts" add constraint "freight_driver_alerts_kind_check" check ("kind" in ('sos'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "freight_driver_rest_breaks" cascade;`);
    this.addSql(`drop table if exists "freight_driver_alerts" cascade;`);
  }

}
