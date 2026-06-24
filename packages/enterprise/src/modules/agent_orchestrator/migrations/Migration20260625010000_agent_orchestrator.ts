import { Migration } from '@mikro-orm/migrations';

export class Migration20260625010000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_guardrail_checks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "proposal_id" uuid null, "guardrail_set_version" varchar(64) not null, "capability" varchar(100) not null, "phase" varchar(10) not null, "kind" varchar(30) not null, "result" varchar(10) not null default 'pass', "evidence" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_guardrail_checks_proposal_idx" on "agent_guardrail_checks" ("proposal_id");`);
    this.addSql(`create index "agent_guardrail_checks_run_idx" on "agent_guardrail_checks" ("agent_run_id", "created_at");`);
    this.addSql(`create index "agent_guardrail_checks_tenant_org_idx" on "agent_guardrail_checks" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "agent_proposals" add column "guard_results" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_proposals" drop column "guard_results";`);

    this.addSql(`drop table if exists "agent_guardrail_checks" cascade;`);
  }

}
