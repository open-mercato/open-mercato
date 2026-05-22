import { Migration } from '@mikro-orm/migrations';

export class Migration20260508140000_ai_agent_runtime_overrides extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ai_agent_runtime_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" varchar(128) null, "provider_id" varchar(64) null, "model_id" varchar(256) null, "base_url" varchar(2048) null, "updated_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ai_agent_runtime_overrides_pkey" primary key ("id"));`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_org_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id", "agent_id") where "deleted_at" is null and "organization_id" is not null and "agent_id" is not null;`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id", "agent_id") where "deleted_at" is null and "organization_id" is null and "agent_id" is not null;`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_null_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id") where "deleted_at" is null and "organization_id" is null and "agent_id" is null;`);
    this.addSql(`create unique index "ai_agent_runtime_overrides_tenant_org_null_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id") where "deleted_at" is null and "organization_id" is not null and "agent_id" is null;`);
    this.addSql(`create index "ai_agent_runtime_overrides_tenant_idx" on "ai_agent_runtime_overrides" ("tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_agent_runtime_overrides" cascade;`);
  }

}
