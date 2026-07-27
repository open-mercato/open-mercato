import { Migration } from '@mikro-orm/migrations';

export class Migration20260625040000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_guardrail_sets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "capability" varchar(100) not null, "version" varchar(64) not null, "body" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_guardrail_sets_capability_idx" on "agent_guardrail_sets" ("organization_id", "capability");`);
    this.addSql(`create index "agent_guardrail_sets_tenant_org_idx" on "agent_guardrail_sets" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_guardrail_sets" add constraint "agent_guardrail_sets_version_uq" unique ("organization_id", "capability", "version");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_guardrail_sets" cascade;`);
  }

}
