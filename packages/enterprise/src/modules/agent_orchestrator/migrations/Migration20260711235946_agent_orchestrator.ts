import { Migration } from '@mikro-orm/migrations';

export class Migration20260711235946_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table if not exists "agent_processes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_id" uuid not null, "workflow_id" varchar(200) null, "workflow_version" varchar(50) null, "subject_type" varchar(100) null, "subject_id" varchar(200) null, "subject_label" varchar(200) null, "subject_title" varchar(300) null, "subject_value_minor" bigint null, "subject_fraud" boolean null, "subject_facets" jsonb null, "status" varchar(30) not null default 'running', "current_stage" varchar(100) null, "agent_ids" jsonb null, "cost_minor" bigint null, "currency" varchar(3) null, "run_count" int not null default 0, "pending_proposal_count" int not null default 0, "assignee_user_id" uuid null, "team_id" uuid null, "waiting_since" timestamptz null, "opened_at" timestamptz not null, "last_activity_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index if not exists "agent_processes_org_process_uq" on "agent_processes" ("tenant_id", "organization_id", "process_id") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "agent_processes_value_idx" on "agent_processes" ("organization_id", "subject_value_minor");`);
    this.addSql(`create index if not exists "agent_processes_status_idx" on "agent_processes" ("organization_id", "status", "last_activity_at");`);
    this.addSql(`create index if not exists "agent_processes_tenant_org_idx" on "agent_processes" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_processes";`);
  }

}
