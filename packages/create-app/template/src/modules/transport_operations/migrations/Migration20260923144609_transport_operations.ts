import { Migration } from '@mikro-orm/migrations';

export class Migration20260923144609_transport_operations extends Migration {

  override name = 'Migration20260923144609';

  override up(): void | Promise<void> {
    this.addSql(`create table "transport_drivers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid null, "full_name" text not null, "national_id" text not null, "license_number" text not null, "license_expiry" date not null, "phone" text not null, "status" text not null default 'available', "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "transport_drivers_license_unique_idx" on "transport_drivers" ("organization_id", "tenant_id", "license_number");`);
    this.addSql(`create index "transport_drivers_national_id_unique_idx" on "transport_drivers" ("organization_id", "tenant_id", "national_id");`);
    this.addSql(`create index "transport_drivers_status_idx" on "transport_drivers" ("organization_id", "status");`);
    this.addSql(`create index "transport_drivers_tenant_org_idx" on "transport_drivers" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "transport_drivers" add constraint "transport_drivers_status_check" check ("status" in ('available', 'on_trip', 'on_leave', 'suspended'));`);

    this.addSql(`create table "transport_routes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "start_location" text not null, "end_location" text not null, "estimated_duration_minutes" int not null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "transport_routes_code_unique_idx" on "transport_routes" ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "transport_routes_tenant_org_idx" on "transport_routes" ("tenant_id", "organization_id");`);

    this.addSql(`create table "transport_trip_schedules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "route_id" uuid not null, "vehicle_id" uuid not null, "driver_id" uuid not null, "scheduled_start_time" timestamptz not null, "scheduled_end_time" timestamptz not null, "actual_start_time" timestamptz null, "actual_end_time" timestamptz null, "status" text not null default 'scheduled', "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "transport_trip_schedules_start_idx" on "transport_trip_schedules" ("organization_id", "scheduled_start_time");`);
    this.addSql(`create index "transport_trip_schedules_driver_idx" on "transport_trip_schedules" ("organization_id", "driver_id");`);
    this.addSql(`create index "transport_trip_schedules_vehicle_idx" on "transport_trip_schedules" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "transport_trip_schedules_route_idx" on "transport_trip_schedules" ("organization_id", "route_id");`);
    this.addSql(`create index "transport_trip_schedules_status_idx" on "transport_trip_schedules" ("organization_id", "status");`);
    this.addSql(`create index "transport_trip_schedules_tenant_org_idx" on "transport_trip_schedules" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "transport_trip_schedules" add constraint "transport_trip_schedules_status_check" check ("status" in ('scheduled', 'in_progress', 'completed', 'cancelled'));`);

    this.addSql(`create table "transport_vehicles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "plate_number" text not null, "vin" text not null, "make" text not null, "model" text not null, "year" int not null, "capacity" int not null, "status" text not null default 'active', "telematics_device_id" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "transport_vehicles_vin_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "vin");`);
    this.addSql(`create index "transport_vehicles_plate_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "plate_number");`);
    this.addSql(`create index "transport_vehicles_status_idx" on "transport_vehicles" ("organization_id", "status");`);
    this.addSql(`create index "transport_vehicles_tenant_org_idx" on "transport_vehicles" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "transport_vehicles" add constraint "transport_vehicles_status_check" check ("status" in ('active', 'maintenance', 'out_of_service'));`);
  }

}
