import { Migration } from '@mikro-orm/migrations';

export class Migration20260821164741_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_model_usages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "agent_id" varchar(100) not null, "runtime" varchar(50) not null, "provider_id" varchar(100) not null, "model_id" varchar(200) not null, "data_location" varchar(200) null, "retention_policy" varchar(500) null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_model_usages_provider_model_idx" on "agent_model_usages" ("organization_id", "provider_id", "model_id");`);
    this.addSql(`create index "agent_model_usages_tenant_org_idx" on "agent_model_usages" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_model_usages" add constraint "agent_model_usages_run_provider_model_uq" unique ("agent_run_id", "provider_id", "model_id");`);
  }

}
