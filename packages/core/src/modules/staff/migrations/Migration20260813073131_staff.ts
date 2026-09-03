import { Migration } from '@mikro-orm/migrations';

export class Migration20260813073131_staff extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "staff_time_entry_tags" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "tag_id" uuid not null, "time_entry_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_entry_tags_unique_idx" on "staff_time_entry_tags" ("tag_id", "time_entry_id");`);
    this.addSql(`create index "staff_time_entry_tags_entry_idx" on "staff_time_entry_tags" ("organization_id", "time_entry_id");`);
    this.addSql(`create index "staff_time_entry_tags_tenant_org_idx" on "staff_time_entry_tags" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_reports" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "customer_id" uuid not null, "customer_snapshot" jsonb null, "reference" text not null, "title" text not null, "period_kind" text not null default 'month', "period_from" date not null, "period_to" date not null, "currency_code" text not null, "grouping" text not null default 'project_task', "nonbillable_mode" text not null default 'separate', "include_already_reported" boolean not null default false, "show_rates" boolean not null default true, "rounding_unit_minutes" int not null default 0, "rounding_direction" text not null default 'up', "status" text not null default 'draft', "total_billable_minutes" int null, "total_nonbillable_minutes" int null, "total_amount" numeric(14,2) null, "closed_at" timestamptz null, "closed_by_user_id" uuid null, "created_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_reports_reference_unique_idx" on "staff_time_reports" ("organization_id", "tenant_id", "reference") where "deleted_at" is null;`);
    this.addSql(`create index "staff_time_reports_status_idx" on "staff_time_reports" ("organization_id", "status", "period_from");`);
    this.addSql(`create index "staff_time_reports_customer_idx" on "staff_time_reports" ("organization_id", "customer_id");`);
    this.addSql(`create index "staff_time_reports_tenant_org_idx" on "staff_time_reports" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_report_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "report_id" uuid not null, "time_entry_id" uuid not null, "frozen_raw_minutes" int not null default 0, "frozen_rounded_minutes" int not null default 0, "frozen_rate_amount" numeric(14,4) null, "frozen_currency_code" text not null, "frozen_amount" numeric(14,2) null, "frozen_is_billable" boolean not null default true, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_report_entries_unique_idx" on "staff_time_report_entries" ("report_id", "time_entry_id");`);
    this.addSql(`create index "staff_time_report_entries_entry_idx" on "staff_time_report_entries" ("organization_id", "time_entry_id");`);
    this.addSql(`create index "staff_time_report_entries_tenant_org_idx" on "staff_time_report_entries" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_report_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "report_id" uuid not null, "event_type" text not null, "reason" text null, "actor_user_id" uuid null, "metadata" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "staff_time_report_events_report_idx" on "staff_time_report_events" ("organization_id", "report_id", "created_at");`);
    this.addSql(`create index "staff_time_report_events_tenant_org_idx" on "staff_time_report_events" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_report_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "report_id" uuid not null, "time_project_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_report_projects_unique_idx" on "staff_time_report_projects" ("report_id", "time_project_id");`);
    this.addSql(`create index "staff_time_report_projects_project_idx" on "staff_time_report_projects" ("organization_id", "time_project_id");`);
    this.addSql(`create index "staff_time_report_projects_tenant_org_idx" on "staff_time_report_projects" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_tags" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_tags_slug_unique_idx" on "staff_time_tags" ("organization_id", "tenant_id", "slug") where "deleted_at" is null;`);
    this.addSql(`create index "staff_time_tags_tenant_org_idx" on "staff_time_tags" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_project_id" uuid not null, "parent_task_id" uuid null, "task_status_id" uuid not null, "sequence_number" int not null default 0, "reference" text not null, "title" text not null, "description" text null, "assignee_staff_member_id" uuid null, "position" int not null default 0, "created_by_user_id" uuid null, "closed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_tasks_reference_unique_idx" on "staff_time_tasks" ("organization_id", "tenant_id", "reference") where "deleted_at" is null;`);
    this.addSql(`create unique index "staff_time_tasks_sequence_unique_idx" on "staff_time_tasks" ("organization_id", "tenant_id", "time_project_id", "sequence_number") where "deleted_at" is null;`);
    this.addSql(`create index "staff_time_tasks_assignee_idx" on "staff_time_tasks" ("organization_id", "assignee_staff_member_id");`);
    this.addSql(`create index "staff_time_tasks_parent_idx" on "staff_time_tasks" ("organization_id", "parent_task_id");`);
    this.addSql(`create index "staff_time_tasks_board_idx" on "staff_time_tasks" ("organization_id", "time_project_id", "task_status_id", "position");`);
    this.addSql(`create index "staff_time_tasks_tenant_org_idx" on "staff_time_tasks" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_task_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "body" text not null, "author_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "staff_time_task_comments_task_idx" on "staff_time_task_comments" ("organization_id", "task_id", "created_at");`);
    this.addSql(`create index "staff_time_task_comments_tenant_org_idx" on "staff_time_task_comments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_task_statuses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "time_project_id" uuid not null, "name" text not null, "slug" text not null, "color" text null, "position" int not null default 0, "is_default" boolean not null default false, "is_done" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_task_statuses_slug_unique_idx" on "staff_time_task_statuses" ("organization_id", "tenant_id", "time_project_id", "slug") where "deleted_at" is null;`);
    this.addSql(`create index "staff_time_task_statuses_project_idx" on "staff_time_task_statuses" ("organization_id", "time_project_id", "position");`);
    this.addSql(`create index "staff_time_task_statuses_tenant_org_idx" on "staff_time_task_statuses" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_time_task_tags" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "tag_id" uuid not null, "task_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "staff_time_task_tags_unique_idx" on "staff_time_task_tags" ("tag_id", "task_id");`);
    this.addSql(`create index "staff_time_task_tags_task_idx" on "staff_time_task_tags" ("organization_id", "task_id");`);
    this.addSql(`create index "staff_time_task_tags_tenant_org_idx" on "staff_time_task_tags" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "staff_time_reports" add constraint "staff_time_reports_period_kind_check" check ("period_kind" in ('week', 'month', 'year', 'custom'));`);
    this.addSql(`alter table "staff_time_reports" add constraint "staff_time_reports_grouping_check" check ("grouping" in ('project_task', 'project_person', 'project_day'));`);
    this.addSql(`alter table "staff_time_reports" add constraint "staff_time_reports_nonbillable_mode_check" check ("nonbillable_mode" in ('separate', 'exclude'));`);
    this.addSql(`alter table "staff_time_reports" add constraint "staff_time_reports_status_check" check ("status" in ('draft', 'closed'));`);

    this.addSql(`alter table "staff_time_report_events" add constraint "staff_time_report_events_event_type_check" check ("event_type" in ('closed', 'unlocked', 'exported'));`);

    this.addSql(`alter table "staff_time_entries" add "task_id" uuid null, add "is_billable" boolean not null default true, add "rounded_minutes" int null, add "rate_override_amount" numeric(14,4) null, add "rate_currency_code" text null, add "locked_report_id" uuid null, add "locked_at" timestamptz null;`);
    this.addSql(`create index "staff_time_entries_locked_report_idx" on "staff_time_entries" ("organization_id", "locked_report_id");`);
    this.addSql(`create index "staff_time_entries_member_overlap_idx" on "staff_time_entries" ("organization_id", "staff_member_id", "date", "started_at");`);
    this.addSql(`create index "staff_time_entries_task_idx" on "staff_time_entries" ("organization_id", "task_id");`);

    this.addSql(`alter table "staff_time_projects" add "customer_snapshot" jsonb null, add "hourly_rate" numeric(14,4) null, add "currency_code" text null, add "billable_by_default" boolean not null default true, add "budget_kind" text not null default 'none', add "budget_value" numeric(14,4) null, add "budget_warn_at_percent" int not null default 80, add "budget_alerted_at_percent" int null;`);
    this.addSql(`alter table "staff_time_projects" add constraint "staff_time_projects_budget_kind_check" check ("budget_kind" in ('none', 'hours', 'amount'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "staff_time_entry_tags" cascade;`);
    this.addSql(`drop table if exists "staff_time_report_entries" cascade;`);
    this.addSql(`drop table if exists "staff_time_report_events" cascade;`);
    this.addSql(`drop table if exists "staff_time_report_projects" cascade;`);
    this.addSql(`drop table if exists "staff_time_reports" cascade;`);
    this.addSql(`drop table if exists "staff_time_task_tags" cascade;`);
    this.addSql(`drop table if exists "staff_time_tags" cascade;`);
    this.addSql(`drop table if exists "staff_time_task_comments" cascade;`);
    this.addSql(`drop table if exists "staff_time_tasks" cascade;`);
    this.addSql(`drop table if exists "staff_time_task_statuses" cascade;`);

    this.addSql(`drop index "staff_time_entries_locked_report_idx";`);
    this.addSql(`drop index "staff_time_entries_member_overlap_idx";`);
    this.addSql(`drop index "staff_time_entries_task_idx";`);
    this.addSql(`alter table "staff_time_entries" drop column "task_id", drop column "is_billable", drop column "rounded_minutes", drop column "rate_override_amount", drop column "rate_currency_code", drop column "locked_report_id", drop column "locked_at";`);

    this.addSql(`alter table "staff_time_projects" drop constraint if exists "staff_time_projects_budget_kind_check";`);
    this.addSql(`alter table "staff_time_projects" drop column "customer_snapshot", drop column "hourly_rate", drop column "currency_code", drop column "billable_by_default", drop column "budget_kind", drop column "budget_value", drop column "budget_warn_at_percent", drop column "budget_alerted_at_percent";`);
  }

}
