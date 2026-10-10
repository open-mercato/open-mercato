import { Migration } from '@mikro-orm/migrations';

export class Migration20261010045253_student_transport extends Migration {

  override name = 'Migration20261010045253';

  override up(): void | Promise<void> {
    this.addSql(`create table "student_subscription_sequences" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "current_value" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);

    this.addSql(`create table "subscription_plans" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "code" text null, "account_type" text not null default 'b2c', "duration" text not null default 'monthly', "price_two_way" numeric(18,4) not null default '0', "price_one_way" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "tax_rate" numeric(5,2) not null default '15', "is_active" boolean not null default true, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "subscription_plans" add constraint "subscription_plans_account_type_check" check ("account_type" in ('b2c', 'b2b'));`);
    this.addSql(`alter table "subscription_plans" add constraint "subscription_plans_duration_check" check ("duration" in ('monthly', 'quarterly', 'annual', 'custom_b2b_contract'));`);

    this.addSql(`create table "student_subscriptions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "subscription_number" text not null, "status" text not null default 'draft', "account_type" text not null default 'b2c', "direction" text not null default 'two_way', "duration" text not null default 'monthly', "plan_id" uuid null, "plan_snapshot" jsonb null, "customer_id" uuid not null, "customer_snapshot" jsonb not null, "school_customer_id" uuid null, "school_snapshot" jsonb null, "student_name" text not null, "student_grade" text null, "guardian_name" text null, "guardian_phone" text null, "pickup_point" text null, "dropoff_point" text null, "transport_route_id" uuid null, "route_snapshot" jsonb null, "vehicle_id" uuid null, "vehicle_snapshot" jsonb null, "driver_id" uuid null, "driver_snapshot" jsonb null, "start_date" date null, "end_date" date null, "period_price" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "tax_rate" numeric(5,2) not null default '15', "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "student_subscriptions" add constraint "student_subscriptions_status_check" check ("status" in ('draft', 'active', 'suspended', 'ended'));`);
    this.addSql(`alter table "student_subscriptions" add constraint "student_subscriptions_account_type_check" check ("account_type" in ('b2c', 'b2b'));`);
    this.addSql(`alter table "student_subscriptions" add constraint "student_subscriptions_direction_check" check ("direction" in ('two_way', 'one_way_pickup', 'one_way_drop'));`);
    this.addSql(`alter table "student_subscriptions" add constraint "student_subscriptions_duration_check" check ("duration" in ('monthly', 'quarterly', 'annual', 'custom_b2b_contract'));`);

    this.addSql(`create table "student_trip_attendance" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "subscription_id" uuid not null, "trip_date" date not null, "leg" text not null default 'pickup', "status" text not null default 'absent_unnotified', "recorded_at" timestamptz not null, "recorded_by" uuid null, "origin" text not null default 'staff', "vehicle_id" uuid null, "driver_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "student_trip_attendance" add constraint "student_trip_attendance_leg_check" check ("leg" in ('pickup', 'dropoff'));`);
    this.addSql(`alter table "student_trip_attendance" add constraint "student_trip_attendance_status_check" check ("status" in ('boarded', 'alighted', 'absent_notified', 'absent_unnotified'));`);
    this.addSql(`alter table "student_trip_attendance" add constraint "student_trip_attendance_origin_check" check ("origin" in ('staff', 'parent'));`);

    this.addSql(`alter table "student_subscriptions" add constraint "student_subscriptions_plan_id_foreign" foreign key ("plan_id") references "subscription_plans" ("id") on delete set null;`);

    this.addSql(`alter table "student_trip_attendance" add constraint "student_trip_attendance_subscription_id_foreign" foreign key ("subscription_id") references "student_subscriptions" ("id");`);

    // Partial unique indexes the ORM metadata cannot express: the subscription
    // number is unique among live rows, a plan code is unique per scope where it
    // is set, the sequence counter is one row per scope, and a child has exactly
    // one attendance row per day and leg — the invariant the board upserts into.
    this.addSql(`create unique index "student_subscriptions_number_unique_idx" on "student_subscriptions" ("organization_id", "tenant_id", "subscription_number") where deleted_at is null;`);
    this.addSql(`create unique index "subscription_plans_code_unique_idx" on "subscription_plans" ("organization_id", "tenant_id", "code") where deleted_at is null and code is not null;`);
    this.addSql(`create unique index "student_subscription_sequences_scope_unique_idx" on "student_subscription_sequences" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "student_trip_attendance_slot_unique_idx" on "student_trip_attendance" ("subscription_id", "trip_date", "leg") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "student_trip_attendance_slot_unique_idx";`);
    this.addSql(`drop index if exists "student_subscription_sequences_scope_unique_idx";`);
    this.addSql(`drop index if exists "subscription_plans_code_unique_idx";`);
    this.addSql(`drop index if exists "student_subscriptions_number_unique_idx";`);
    this.addSql(`alter table "student_trip_attendance" drop constraint if exists "student_trip_attendance_subscription_id_foreign";`);
    this.addSql(`alter table "student_subscriptions" drop constraint if exists "student_subscriptions_plan_id_foreign";`);
    this.addSql(`drop table if exists "student_trip_attendance" cascade;`);
    this.addSql(`drop table if exists "student_subscriptions" cascade;`);
    this.addSql(`drop table if exists "subscription_plans" cascade;`);
    this.addSql(`drop table if exists "student_subscription_sequences" cascade;`);
  }

}
