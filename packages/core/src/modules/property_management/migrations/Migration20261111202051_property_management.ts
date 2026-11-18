import { Migration } from '@mikro-orm/migrations';

export class Migration20261111202051_property_management extends Migration {

  override name = 'Migration20261111202051';

  override up(): void | Promise<void> {
    this.addSql(`create table "property_management_opening_hours" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "weekday" int not null, "opens_at" time not null, "closes_at" time not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "property_management_opening_hours_building_idx" on "property_management_opening_hours" ("organization_id", "building_id");`);
    this.addSql(`alter table "property_management_opening_hours" add constraint "property_management_opening_hours_weekday_unique" unique ("building_id", "weekday");`);

    this.addSql(`create table "property_management_unavailabilities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "building_id" uuid not null, "subject_type" text not null, "subject_id" uuid not null, "reason_entry_id" uuid null, "reason_text" text not null, "starts_at" timestamp not null, "ends_at" timestamp null, "ended_at" timestamp null, "cancelled_booking_count" int not null default 0, "apply_status" text not null default 'applied', "progress_job_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_unavailabilities_building_idx" on "property_management_unavailabilities" ("organization_id", "building_id", "starts_at");`);
    this.addSql(`create index "property_management_unavailabilities_subject_idx" on "property_management_unavailabilities" ("organization_id", "subject_type", "subject_id", "starts_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "property_management_unavailabilities" cascade;`);
    this.addSql(`drop table if exists "property_management_opening_hours" cascade;`);
  }

}
