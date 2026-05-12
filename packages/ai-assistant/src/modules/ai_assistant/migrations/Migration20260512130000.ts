import { Migration } from '@mikro-orm/migrations'

export class Migration20260512130000_ai_agent_runtime_override_picker_allowlist extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "allowed_override_providers" jsonb null;`)
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "allowed_override_models_by_provider" jsonb not null default '{}';`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column if exists "allowed_override_providers";`)
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column if exists "allowed_override_models_by_provider";`)
  }
}
