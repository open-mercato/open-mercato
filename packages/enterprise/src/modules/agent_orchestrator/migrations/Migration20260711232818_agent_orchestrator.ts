import { Migration } from '@mikro-orm/migrations';

export class Migration20260711232818_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_task_definitions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" varchar(255) not null, "description" text null, "target_type" varchar(20) not null, "target_agent_id" varchar(150) null, "target_workflow_id" varchar(150) null, "input_defaults" jsonb null, "input_schema" jsonb null, "execution_principal_id" uuid null, "granted_features" jsonb null, "schedule_cron" varchar(100) null, "schedule_timezone" varchar(64) null, "schedule_enabled" boolean not null default true, "enabled" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_task_definitions_target_idx" on "agent_task_definitions" ("organization_id", "target_type");`);
    this.addSql(`create index "agent_task_definitions_tenant_org_idx" on "agent_task_definitions" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_task_event_triggers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_definition_id" uuid not null, "event_pattern" varchar(255) not null, "config" jsonb null, "enabled" boolean not null default true, "priority" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_task_event_triggers_definition_idx" on "agent_task_event_triggers" ("task_definition_id");`);
    this.addSql(`create index "agent_task_event_triggers_tenant_org_idx" on "agent_task_event_triggers" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_task_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_definition_id" uuid not null, "target_type" varchar(20) not null, "target_agent_id" varchar(150) null, "target_workflow_id" varchar(150) null, "status" varchar(20) not null default 'running', "agent_run_id" uuid null, "workflow_instance_id" uuid null, "input" jsonb not null, "source_entity_type" varchar(100) null, "source_entity_id" uuid null, "triggered_by" varchar(150) not null, "idempotency_key" varchar(200) null, "started_at" timestamptz null, "completed_at" timestamptz null, "failure_reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "agent_task_runs_idempotency_uq" on "agent_task_runs" ("organization_id", "task_definition_id", "idempotency_key") where "idempotency_key" is not null;`);
    this.addSql(`create index "agent_task_runs_source_idx" on "agent_task_runs" ("source_entity_type", "source_entity_id");`);
    this.addSql(`create index "agent_task_runs_definition_idx" on "agent_task_runs" ("task_definition_id", "created_at");`);
    this.addSql(`create index "agent_task_runs_tenant_org_idx" on "agent_task_runs" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_task_runs";`);
    this.addSql(`drop table if exists "agent_task_event_triggers";`);
    this.addSql(`drop table if exists "agent_task_definitions";`);
  }

}
