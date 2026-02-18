import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "staff_teams" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_teams_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_teams_tenant_org_idx" on "staff_teams" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "display_name" text not null, "description" text null, "user_id" uuid null, "role_ids" jsonb not null default '[]', "tags" jsonb not null default '[]', "availability_rule_set_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_team_members_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_members_tenant_org_idx" on "staff_team_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_leave_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "member_id" uuid not null, "start_date" timestamptz not null, "end_date" timestamptz not null, "timezone" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "unavailability_reason_entry_id" uuid null, "unavailability_reason_value" text null, "note" text null, "decision_comment" text null, "submitted_by_user_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_leave_requests_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_leave_requests_status_idx" on "staff_leave_requests" ("status", "tenant_id", "organization_id");`);
    this.addSql(`create index "staff_leave_requests_member_idx" on "staff_leave_requests" ("member_id");`);
    this.addSql(`create index "staff_leave_requests_tenant_org_idx" on "staff_leave_requests" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "member_id" uuid not null, constraint "staff_team_member_activities_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_activities_member_occurred_created_idx" on "staff_team_member_activities" ("member_id", "occurred_at", "created_at");`);
    this.addSql(`create index "staff_team_member_activities_tenant_org_idx" on "staff_team_member_activities" ("tenant_id", "organization_id");`);
    this.addSql(`create index "staff_team_member_activities_member_idx" on "staff_team_member_activities" ("member_id");`);

    this.addSql(`create table "staff_team_member_addresses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text null, "purpose" text null, "company_name" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" real null, "longitude" real null, "is_primary" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "member_id" uuid not null, constraint "staff_team_member_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_addresses_tenant_org_idx" on "staff_team_member_addresses" ("tenant_id", "organization_id");`);
    this.addSql(`create index "staff_team_member_addresses_member_idx" on "staff_team_member_addresses" ("member_id");`);

    this.addSql(`create table "staff_team_member_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "member_id" uuid not null, constraint "staff_team_member_comments_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_comments_tenant_org_idx" on "staff_team_member_comments" ("tenant_id", "organization_id");`);
    this.addSql(`create index "staff_team_member_comments_member_idx" on "staff_team_member_comments" ("member_id");`);

    this.addSql(`create table "staff_team_member_job_histories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "company_name" text null, "description" text null, "start_date" timestamptz not null, "end_date" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "member_id" uuid not null, constraint "staff_team_member_job_histories_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_job_histories_member_start_idx" on "staff_team_member_job_histories" ("member_id", "start_date");`);
    this.addSql(`create index "staff_team_member_job_histories_tenant_org_idx" on "staff_team_member_job_histories" ("tenant_id", "organization_id");`);
    this.addSql(`create index "staff_team_member_job_histories_member_idx" on "staff_team_member_job_histories" ("member_id");`);

    this.addSql(`create table "staff_team_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "staff_team_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_roles_tenant_org_idx" on "staff_team_roles" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "staff_leave_requests" add constraint "staff_leave_requests_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade;`);

    this.addSql(`alter table "staff_team_member_activities" add constraint "staff_team_member_activities_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade;`);

    this.addSql(`alter table "staff_team_member_addresses" add constraint "staff_team_member_addresses_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade;`);

    this.addSql(`alter table "staff_team_member_comments" add constraint "staff_team_member_comments_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade;`);

    this.addSql(`alter table "staff_team_member_job_histories" add constraint "staff_team_member_job_histories_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "staff_leave_requests" drop constraint "staff_leave_requests_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_activities" drop constraint "staff_team_member_activities_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_addresses" drop constraint "staff_team_member_addresses_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_comments" drop constraint "staff_team_member_comments_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_job_histories" drop constraint "staff_team_member_job_histories_member_id_foreign";`);
  }

}
