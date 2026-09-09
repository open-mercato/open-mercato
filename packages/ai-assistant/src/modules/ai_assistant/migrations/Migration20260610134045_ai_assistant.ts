import { Migration } from '@mikro-orm/migrations';

export class Migration20260610134045_ai_assistant extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "ai_moderation_flags" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "user_id" text not null, "provider_id" text not null, "model_id" text not null, "categories" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ai_moderation_flags_tenant_user_idx" on "ai_moderation_flags" ("tenant_id", "user_id");`);
    this.addSql(`create index "ai_moderation_flags_tenant_created_idx" on "ai_moderation_flags" ("tenant_id", "created_at");`);

    this.addSql(`alter table "ai_agent_runtime_overrides" add "input_moderation" boolean null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "input_moderation";`);

    this.addSql(`drop index "ai_moderation_flags_tenant_created_idx";`);
    this.addSql(`drop index "ai_moderation_flags_tenant_user_idx";`);
    this.addSql(`drop table if exists "ai_moderation_flags" cascade;`);
  }

}
