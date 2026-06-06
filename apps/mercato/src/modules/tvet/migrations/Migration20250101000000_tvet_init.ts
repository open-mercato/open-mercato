import { Migration } from '@mikro-orm/migrations';

export class Migration20250101000000_tvet_init extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "tvet_trainees" ("id" uuid not null default gen_random_uuid(), "name" text not null, "email" text not null, "admission_number" text not null, "upi_number" text null, "kcse_index" text null, "course_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_trainees_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_trainees_email_unique" on "tvet_trainees" ("email");`);
    this.addSql(`create unique index "tvet_trainees_admission_number_unique" on "tvet_trainees" ("admission_number");`);
    this.addSql(`create index "tvet_trainees_admission_number_organization_id_tenant_id_index" on "tvet_trainees" ("admission_number", "organization_id", "tenant_id");`);

    this.addSql(`create table "tvet_courses" ("id" uuid not null default gen_random_uuid(), "name" text not null, "code" text not null, "level" text not null, "duration_months" int not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_courses_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_courses_code_unique" on "tvet_courses" ("code");`);

    this.addSql(`create table "tvet_qualification_levels" ("id" uuid not null default gen_random_uuid(), "name" text not null, "level" int not null, "description" text not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_qualification_levels_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_qualification_levels_name_unique" on "tvet_qualification_levels" ("name");`);
    this.addSql(`create unique index "tvet_qualification_levels_level_unique" on "tvet_qualification_levels" ("level");`);

    this.addSql(`create table "tvet_sectors" ("id" uuid not null default gen_random_uuid(), "name" text not null, "code" text not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_sectors_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_sectors_name_unique" on "tvet_sectors" ("name");`);

    this.addSql(`create table "tvet_occupational_standards" ("id" uuid not null default gen_random_uuid(), "title" text not null, "code" text not null, "qualification_level_id" uuid not null, "sector_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_occupational_standards_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_occupational_standards_code_unique" on "tvet_occupational_standards" ("code");`);
    this.addSql(`alter table "tvet_occupational_standards" add constraint "tvet_occupational_standards_qualification_level_id_foreign" foreign key ("qualification_level_id") references "tvet_qualification_levels" ("id") on update cascade;`);
    this.addSql(`alter table "tvet_occupational_standards" add constraint "tvet_occupational_standards_sector_id_foreign" foreign key ("sector_id") references "tvet_sectors" ("id") on update cascade;`);

    this.addSql(`create table "tvet_competency_units" ("id" uuid not null default gen_random_uuid(), "title" text not null, "code" text not null, "unit_type" text not null, "credit_value" int not null, "occupational_standard_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_competency_units_pkey" primary key ("id"));`);
    this.addSql(`create unique index "tvet_competency_units_code_unique" on "tvet_competency_units" ("code");`);
    this.addSql(`alter table "tvet_competency_units" add constraint "tvet_competency_units_occupational_standard_id_foreign" foreign key ("occupational_standard_id") references "tvet_occupational_standards" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tvet_competency_units" cascade;`);
    this.addSql(`drop table if exists "tvet_occupational_standards" cascade;`);
    this.addSql(`drop table if exists "tvet_sectors" cascade;`);
    this.addSql(`drop table if exists "tvet_qualification_levels" cascade;`);
    this.addSql(`drop table if exists "tvet_courses" cascade;`);
    this.addSql(`drop table if exists "tvet_trainees" cascade;`);
  }

}
