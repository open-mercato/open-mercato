import { Migration } from '@mikro-orm/migrations';

export class Migration20260326135612 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "staff_time_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "staff_member_id" uuid not null, "date" date not null, "duration_minutes" int not null default 0, "started_at" timestamptz null, "ended_at" timestamptz null, "notes" text null, "time_project_id" uuid null, "customer_id" uuid null, "deal_id" uuid null, "order_id" uuid null, "source" text check ("source" in ('manual', 'timer', 'kiosk', 'mobile')) not null default 'manual', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_time_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_time_entries_project_date_idx" on "staff_time_entries" ("organization_id", "time_project_id", "date");`);
    this.addSql(`create index "staff_time_entries_member_date_idx" on "staff_time_entries" ("organization_id", "staff_member_id", "date");`);
    this.addSql(`create index "staff_time_entries_tenant_org_idx" on "staff_time_entries" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_entry_segments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_entry_id" uuid not null, "started_at" timestamptz not null, "ended_at" timestamptz null, "segment_type" text check ("segment_type" in ('work', 'break')) not null default 'work', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_time_entry_segments_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_time_entry_segments_entry_idx" on "staff_time_entry_segments" ("time_entry_id");`);
    this.addSql(`create index "staff_time_entry_segments_tenant_org_idx" on "staff_time_entry_segments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "customer_id" uuid null, "code" text not null, "description" text null, "project_type" text null, "status" text check ("status" in ('active', 'on_hold', 'completed')) not null default 'active', "owner_user_id" uuid null, "cost_center" text null, "start_date" date null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_time_projects_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_time_projects_code_unique_idx" on "staff_time_projects" ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "staff_time_projects_tenant_org_idx" on "staff_time_projects" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_project_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_project_id" uuid not null, "staff_member_id" uuid not null, "role" text null, "status" text check ("status" in ('active', 'inactive')) not null default 'active', "assigned_start_date" date not null, "assigned_end_date" date null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_time_project_members_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_time_project_members_unique_idx" on "staff_time_project_members" ("organization_id", "tenant_id", "time_project_id", "staff_member_id");`);
    this.addSql(`create index "staff_time_project_members_member_idx" on "staff_time_project_members" ("organization_id", "staff_member_id");`);
    this.addSql(`create index "staff_time_project_members_project_idx" on "staff_time_project_members" ("organization_id", "time_project_id");`);
    this.addSql(`create index "staff_time_project_members_tenant_org_idx" on "staff_time_project_members" ("tenant_id", "organization_id");`);
  }

}
