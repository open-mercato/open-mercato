import { Migration } from '@mikro-orm/migrations';

export class Migration20251207131955 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "step_instances" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_id" varchar(100) not null, "step_name" varchar(255) not null, "step_type" varchar(50) not null, "status" varchar(20) not null, "input_data" jsonb null, "output_data" jsonb null, "error_data" jsonb null, "entered_at" timestamptz null, "exited_at" timestamptz null, "execution_time_ms" int null, "retry_count" int not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "step_instances_pkey" primary key ("id"));`);
    this.addSql(`create index "step_instances_tenant_org_idx" on "step_instances" ("tenant_id", "organization_id");`);
    this.addSql(`create index "step_instances_step_id_idx" on "step_instances" ("step_id", "status");`);
    this.addSql(`create index "step_instances_workflow_instance_idx" on "step_instances" ("workflow_instance_id", "status");`);

    this.addSql(`create table "user_tasks" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_instance_id" uuid not null, "task_name" varchar(255) not null, "description" text null, "status" varchar(20) not null, "form_schema" jsonb null, "form_data" jsonb null, "assigned_to" varchar(255) null, "assigned_to_roles" text[] null, "claimed_by" varchar(255) null, "claimed_at" timestamptz null, "due_date" timestamptz null, "escalated_at" timestamptz null, "escalated_to" varchar(255) null, "completed_by" varchar(255) null, "completed_at" timestamptz null, "comments" text null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "user_tasks_pkey" primary key ("id"));`);
    this.addSql(`create index "user_tasks_tenant_org_idx" on "user_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`create index "user_tasks_status_due_date_idx" on "user_tasks" ("status", "due_date");`);
    this.addSql(`create index "user_tasks_status_assigned_idx" on "user_tasks" ("status", "assigned_to");`);
    this.addSql(`create index "user_tasks_workflow_instance_idx" on "user_tasks" ("workflow_instance_id");`);

    this.addSql(`create table "workflow_definitions" ("id" uuid not null default gen_random_uuid(), "workflow_id" varchar(100) not null, "workflow_name" varchar(255) not null, "description" text null, "version" int not null default 1, "definition" jsonb not null, "metadata" jsonb null, "enabled" boolean not null default true, "effective_from" timestamptz null, "effective_to" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "workflow_definitions_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_definitions_workflow_id_idx" on "workflow_definitions" ("workflow_id");`);
    this.addSql(`create index "workflow_definitions_tenant_org_idx" on "workflow_definitions" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_definitions_enabled_idx" on "workflow_definitions" ("enabled");`);
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_tenant_id_unique" unique ("workflow_id", "tenant_id");`);

    this.addSql(`create table "workflow_events" ("id" bigserial primary key, "workflow_instance_id" uuid not null, "step_instance_id" uuid null, "event_type" varchar(50) not null, "event_data" jsonb not null, "occurred_at" timestamptz not null, "user_id" varchar(255) null, "tenant_id" uuid not null, "organization_id" uuid not null);`);
    this.addSql(`create index "workflow_events_tenant_org_idx" on "workflow_events" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_events_event_type_idx" on "workflow_events" ("event_type", "occurred_at");`);
    this.addSql(`create index "workflow_events_instance_occurred_idx" on "workflow_events" ("workflow_instance_id", "occurred_at");`);

    this.addSql(`create table "workflow_instances" ("id" uuid not null default gen_random_uuid(), "definition_id" uuid not null, "workflow_id" varchar(100) not null, "version" int not null, "status" varchar(20) not null, "current_step_id" varchar(100) not null, "context" jsonb not null, "correlation_key" varchar(255) null, "metadata" jsonb null, "started_at" timestamptz not null, "completed_at" timestamptz null, "paused_at" timestamptz null, "cancelled_at" timestamptz null, "error_message" text null, "error_details" jsonb null, "retry_count" int not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "workflow_instances_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_instances_tenant_org_idx" on "workflow_instances" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_instances_current_step_idx" on "workflow_instances" ("current_step_id", "status");`);
    this.addSql(`create index "workflow_instances_status_tenant_idx" on "workflow_instances" ("status", "tenant_id");`);
    this.addSql(`create index "workflow_instances_correlation_key_idx" on "workflow_instances" ("correlation_key");`);
    this.addSql(`create index "workflow_instances_definition_status_idx" on "workflow_instances" ("definition_id", "status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "workflow_instances" cascade;`);
    this.addSql(`drop table if exists "workflow_events" cascade;`);
    this.addSql(`drop table if exists "workflow_definitions" cascade;`);
    this.addSql(`drop table if exists "user_tasks" cascade;`);
    this.addSql(`drop table if exists "step_instances" cascade;`);
  }
}
