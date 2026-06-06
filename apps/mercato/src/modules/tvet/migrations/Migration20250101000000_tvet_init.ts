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

    this.addSql(`create table "tvet_unit_elements" ("id" uuid not null default gen_random_uuid(), "title" text not null, "competency_unit_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_unit_elements_pkey" primary key ("id"));`);
    this.addSql(`alter table "tvet_unit_elements" add constraint "tvet_unit_elements_competency_unit_id_foreign" foreign key ("competency_unit_id") references "tvet_competency_units" ("id") on update cascade;`);

    this.addSql(`create table "tvet_performance_criteria" ("id" uuid not null default gen_random_uuid(), "description" text not null, "unit_element_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_performance_criteria_pkey" primary key ("id"));`);
    this.addSql(`alter table "tvet_performance_criteria" add constraint "tvet_performance_criteria_unit_element_id_foreign" foreign key ("unit_element_id") references "tvet_unit_elements" ("id") on update cascade;`);

    this.addSql(`create table "tvet_class_groups" ("id" uuid not null default gen_random_uuid(), "name" text not null, "course_id" uuid not null, "trainer_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_class_groups_pkey" primary key ("id"));`);
    this.addSql(`alter table "tvet_class_groups" add constraint "tvet_class_groups_course_id_foreign" foreign key ("course_id") references "tvet_courses" ("id") on update cascade;`);

    this.addSql(`create table "tvet_enrollments" ("id" uuid not null default gen_random_uuid(), "trainee_id" uuid not null, "class_group_id" uuid not null, "status" text not null default 'active', "enrolled_at" timestamptz not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tvet_enrollments_pkey" primary key ("id"));`);
    this.addSql(`alter table "tvet_enrollments" add constraint "tvet_enrollments_trainee_id_foreign" foreign key ("trainee_id") references "tvet_trainees" ("id") on update cascade;`);
    this.addSql(`alter table "tvet_enrollments" add constraint "tvet_enrollments_class_group_id_foreign" foreign key ("class_group_id") references "tvet_class_groups" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tvet_enrollments" cascade;`);
    this.addSql(`drop table if exists "tvet_class_groups" cascade;`);
    this.addSql(`drop table if exists "tvet_performance_criteria" cascade;`);
    this.addSql(`drop table if exists "tvet_unit_elements" cascade;`);
    this.addSql(`drop table if exists "tvet_competency_units" cascade;`);
    this.addSql(`drop table if exists "tvet_occupational_standards" cascade;`);
    this.addSql(`drop table if exists "tvet_sectors" cascade;`);
    this.addSql(`drop table if exists "tvet_qualification_levels" cascade;`);
    this.addSql(`drop table if exists "tvet_courses" cascade;`);
    this.addSql(`drop table if exists "tvet_trainees" cascade;`);
  }

}
