import { Migration } from '@mikro-orm/migrations';

export class Migration20260623153336_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_corrections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_id" uuid null, "step_id" varchar(100) null, "agent_run_id" uuid null, "proposal_id" uuid not null, "corrected_by_user_id" uuid not null, "action" varchar(20) not null, "proposed_value" jsonb not null, "corrected_value" jsonb null, "reason" text not null, "eval_case_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_corrections_proposal_idx" on "agent_corrections" ("proposal_id");`);
    this.addSql(`create index "agent_corrections_run_idx" on "agent_corrections" ("agent_run_id");`);
    this.addSql(`create index "agent_corrections_tenant_org_idx" on "agent_corrections" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_cases" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "source_type" varchar(20) not null, "source_id" uuid not null, "agent_definition_id" varchar(100) not null, "process_type" varchar(100) null, "input" jsonb not null, "expected" jsonb null, "assertions" jsonb null, "status" varchar(20) not null default 'draft', "approved_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_cases_agent_status_idx" on "agent_eval_cases" ("organization_id", "agent_definition_id", "status");`);
    this.addSql(`create index "agent_eval_cases_tenant_org_idx" on "agent_eval_cases" ("tenant_id", "organization_id");`);
  }

}
