import { Migration } from '@mikro-orm/migrations';

export class Migration20260419100521_ai_assistant extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ai_agent_prompt_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "version" int not null, "sections" jsonb not null, "notes" text null, "created_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "ai_agent_prompt_overrides_pkey" primary key ("id"));`);
    this.addSql(`create index "ai_agent_prompt_overrides_tenant_org_agent_version_idx" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version" desc);`);
    this.addSql(`create index "ai_agent_prompt_overrides_tenant_agent_idx" on "ai_agent_prompt_overrides" ("tenant_id", "agent_id");`);
    this.addSql(`alter table "ai_agent_prompt_overrides" add constraint "ai_agent_prompt_overrides_tenant_org_agent_version_uq" unique ("tenant_id", "organization_id", "agent_id", "version");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_agent_prompt_overrides" cascade;`);
  }

}
