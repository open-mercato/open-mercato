import { Migration } from '@mikro-orm/migrations';

export class Migration20260625020000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_context_bundles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "process_id" uuid null, "step_id" varchar(100) null, "capability" varchar(100) not null, "routed_sources" jsonb not null, "pruned_sources" jsonb null, "sources" jsonb not null, "token_budget" int not null, "tokens_used" int not null, "redaction_applied" jsonb null, "payload_ref" varchar(500) null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_context_bundles_run_idx" on "agent_context_bundles" ("agent_run_id");`);
    this.addSql(`create index "agent_context_bundles_tenant_org_idx" on "agent_context_bundles" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_context_bundles" cascade;`);
  }

}
