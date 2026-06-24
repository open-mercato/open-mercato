import { Migration } from '@mikro-orm/migrations';

export class Migration20260620090000_agent_orchestrator extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "agent_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "status" varchar(20) not null default 'running', "input" jsonb not null, "output" jsonb null, "result_kind" varchar(20) null, "error_message" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_runs_tenant_org_idx" on "agent_runs" ("tenant_id", "organization_id");`);
    this.addSql(`create index "agent_runs_agent_idx" on "agent_runs" ("organization_id", "agent_id");`);

    this.addSql(`create table "agent_proposals" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "run_id" uuid not null, "process_id" uuid null, "step_id" varchar(100) null, "payload" jsonb not null, "confidence" real null, "disposition" varchar(20) not null default 'pending', "disposition_by" varchar(100) null, "disposition_reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "agent_proposals_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_proposals_tenant_org_idx" on "agent_proposals" ("tenant_id", "organization_id");`);
    this.addSql(`create index "agent_proposals_run_idx" on "agent_proposals" ("organization_id", "run_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "agent_proposals" cascade;`);
    this.addSql(`drop table if exists "agent_runs" cascade;`);
  }

}
