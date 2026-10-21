import { Migration } from '@mikro-orm/migrations';

export class Migration20261019204309_fleet_operations extends Migration {

  override name = 'Migration20261019204309';

  override up(): void | Promise<void> {
    this.addSql(`create table "fleet_fuel_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "logged_at" timestamptz not null, "odometer" int null, "liters" numeric(12,3) not null default '0', "unit_price" numeric(12,4) not null default '0', "total_cost" numeric(18,4) not null default '0', "fuel_type" text not null default 'diesel', "station_name" text null, "full_tank" boolean not null default true, "driver_employee_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_fuel_logs_vehicle_idx" on "fleet_fuel_logs" ("organization_id", "vehicle_id", "logged_at");`);
    this.addSql(`create index "fleet_fuel_logs_scope_idx" on "fleet_fuel_logs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_insurance_policies" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "policy_number" text not null, "insurer_name" text not null, "coverage_type" text not null default 'comprehensive', "start_date" timestamptz not null, "end_date" timestamptz not null, "premium_amount" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "status" text not null default 'active', "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_insurance_policies_expiry_idx" on "fleet_insurance_policies" ("organization_id", "end_date", "status");`);
    this.addSql(`create index "fleet_insurance_policies_vehicle_idx" on "fleet_insurance_policies" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "fleet_insurance_policies_scope_idx" on "fleet_insurance_policies" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_maintenance_schedules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "name" text not null, "description" text null, "interval_type" text not null default 'odometer', "interval_odometer" int null, "interval_days" int null, "last_service_odometer" int null, "last_service_at" timestamptz null, "next_due_odometer" int null, "next_due_at" timestamptz null, "is_active" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_maintenance_schedules_due_idx" on "fleet_maintenance_schedules" ("organization_id", "is_active", "next_due_at");`);
    this.addSql(`create index "fleet_maintenance_schedules_vehicle_idx" on "fleet_maintenance_schedules" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "fleet_maintenance_schedules_scope_idx" on "fleet_maintenance_schedules" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_traffic_violations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "driver_employee_id" uuid null, "violation_number" text not null, "occurred_at" timestamptz not null, "location" text null, "description" text null, "fine_amount" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "status" text not null default 'open', "paid_at" timestamptz null, "payroll_deduction_requested" boolean not null default false, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_traffic_violations_status_idx" on "fleet_traffic_violations" ("organization_id", "status", "occurred_at");`);
    this.addSql(`create index "fleet_traffic_violations_vehicle_idx" on "fleet_traffic_violations" ("organization_id", "vehicle_id", "occurred_at");`);
    this.addSql(`create index "fleet_traffic_violations_scope_idx" on "fleet_traffic_violations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_work_orders" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "schedule_id" uuid null, "work_order_number" text not null, "title" text not null, "description" text null, "status" text not null default 'draft', "priority" text not null default 'normal', "type" text not null default 'corrective', "odometer" int null, "vendor_name" text null, "opened_at" timestamptz null, "started_at" timestamptz null, "completed_at" timestamptz null, "downtime_minutes" int null, "labor_cost" numeric(18,4) not null default '0', "parts_cost" numeric(18,4) not null default '0', "total_cost" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "fleet_work_orders_number_unique_idx" on "fleet_work_orders" ("organization_id", "tenant_id", "work_order_number") where deleted_at is null;`);
    this.addSql(`create index "fleet_work_orders_status_idx" on "fleet_work_orders" ("organization_id", "status", "opened_at");`);
    this.addSql(`create index "fleet_work_orders_vehicle_idx" on "fleet_work_orders" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "fleet_work_orders_scope_idx" on "fleet_work_orders" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_work_order_labor" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "work_order_id" uuid not null, "description" text not null, "hours" numeric(10,2) not null default '0', "rate" numeric(18,4) not null default '0', "total_cost" numeric(18,4) not null default '0', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_work_order_labor_order_idx" on "fleet_work_order_labor" ("organization_id", "work_order_id");`);
    this.addSql(`create index "fleet_work_order_labor_scope_idx" on "fleet_work_order_labor" ("tenant_id", "organization_id");`);

    this.addSql(`create table "fleet_work_order_parts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "work_order_id" uuid not null, "description" text not null, "part_number" text null, "quantity" numeric(18,4) not null default '1', "unit_cost" numeric(18,4) not null default '0', "total_cost" numeric(18,4) not null default '0', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_work_order_parts_order_idx" on "fleet_work_order_parts" ("organization_id", "work_order_id");`);
    this.addSql(`create index "fleet_work_order_parts_scope_idx" on "fleet_work_order_parts" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "fleet_work_order_parts";`);
    this.addSql(`drop table if exists "fleet_work_order_labor";`);
    this.addSql(`drop table if exists "fleet_work_orders";`);
    this.addSql(`drop table if exists "fleet_traffic_violations";`);
    this.addSql(`drop table if exists "fleet_maintenance_schedules";`);
    this.addSql(`drop table if exists "fleet_insurance_policies";`);
    this.addSql(`drop table if exists "fleet_fuel_logs";`);
  }

}
