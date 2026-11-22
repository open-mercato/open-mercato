import { Migration } from '@mikro-orm/migrations';

export class Migration20261122015141_transport_operations extends Migration {

  override name = 'Migration20261122015141';

  override up(): void | Promise<void> {
    this.addSql(`create table "transport_vehicle_positions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "driver_id" uuid null, "trip_id" uuid null, "latitude" numeric(10,7) not null, "longitude" numeric(10,7) not null, "speed_kph" numeric(6,2) null, "heading" numeric(6,2) null, "recorded_at" timestamptz not null, "source" text not null default 'manual', "raw" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "transport_vehicle_positions_vehicle_time_idx" on "transport_vehicle_positions" ("organization_id", "vehicle_id", "recorded_at");`);
    this.addSql(`create index "transport_vehicle_positions_tenant_org_idx" on "transport_vehicle_positions" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transport_vehicle_positions" cascade;`);
  }

}
