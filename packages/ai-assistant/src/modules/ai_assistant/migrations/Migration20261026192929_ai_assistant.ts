import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';
import { defaultEncryptionMaps } from '../encryption';

const AGENT_RUN_ENCRYPTED_ENTITY_IDS = new Set([
  'ai_assistant:ai_agent_run',
  'ai_assistant:ai_agent_run_step',
  'ai_assistant:ai_agent_run_tool_call',
]);

export class Migration20261026192929_ai_assistant extends Migration {

  override name = 'Migration20261026192929';

  override up(): void | Promise<void> {
    this.addSql(`create table "ai_agent_runs" ("id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid null, "api_key_id" uuid null, "agent_id" text not null, "module_id" text not null, "agent_version" text null, "agent_definition_hash" text not null, "prompt_override_id" uuid null, "prompt_override_version" int null, "execution_mode" text not null, "channel" text not null, "conversation_id" text null, "turn_id" uuid not null, "correlation_id" text null, "provider_id" text not null, "model_id" text not null, "base_url_host" text null, "model_params" jsonb not null, "effective_mutation_policy" text not null, "tool_names" text[] not null, "status" text not null, "stop_reason" text null, "finish_reason" text null, "input_tokens" int not null, "output_tokens" int not null, "cached_input_tokens" int null, "reasoning_tokens" int null, "step_count" int not null, "tool_call_count" int not null, "duration_ms" int not null, "started_at" timestamptz not null, "completed_at" timestamptz not null, "input_text" text null, "output_text" text null, "content_truncated" boolean not null, "system_prompt_hash" text not null, "system_prompt" text null, "citations" jsonb null, "error_code" text null, "error_message" text null, "capture_level" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "ai_agent_runs_tenant_correlation_idx" on "ai_agent_runs" ("tenant_id", "correlation_id");`);
    this.addSql(`create index "ai_agent_runs_tenant_user_created_idx" on "ai_agent_runs" ("tenant_id", "user_id", "created_at");`);
    this.addSql(`create index "ai_agent_runs_tenant_agent_created_idx" on "ai_agent_runs" ("tenant_id", "agent_id", "created_at");`);
    this.addSql(`create index "ai_agent_runs_tenant_conversation_created_idx" on "ai_agent_runs" ("tenant_id", "conversation_id", "created_at");`);
    this.addSql(`create index "ai_agent_runs_tenant_org_created_idx" on "ai_agent_runs" ("tenant_id", "organization_id", "created_at" desc);`);

    this.addSql(`create table "ai_agent_run_steps" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "run_id" uuid not null, "step_index" int not null, "model_id" text not null, "finish_reason" text not null, "input_tokens" int not null, "output_tokens" int not null, "text" text null, "text_truncated" boolean not null, "ended_at" timestamptz not null, "duration_ms" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "ai_agent_run_steps" add constraint "ai_agent_run_steps_run_step_uq" unique ("run_id", "step_index");`);

    this.addSql(`create table "ai_agent_run_tool_calls" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "run_id" uuid not null, "step_index" int not null, "call_index" int not null, "tool_call_id" text null, "tool_name" text not null, "is_mutation" boolean not null, "pending_action_id" uuid null, "arg_keys" text[] not null, "args" jsonb null, "result" jsonb null, "args_truncated" boolean not null, "result_truncated" boolean not null, "result_bytes" int not null, "error_code" text null, "error_message" text null, "duration_ms" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ai_agent_run_tool_calls_tenant_tool_created_idx" on "ai_agent_run_tool_calls" ("tenant_id", "tool_name", "created_at");`);
    this.addSql(`alter table "ai_agent_run_tool_calls" add constraint "ai_agent_run_tool_calls_run_step_call_uq" unique ("run_id", "step_index", "call_index");`);

    for (const map of defaultEncryptionMaps) {
      if (!AGENT_RUN_ENCRYPTED_ENTITY_IDS.has(map.entityId)) continue;
      this.addSql(buildEncryptionMapBackfillSql(map));
    }
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ai_agent_run_tool_calls" cascade;`);
    this.addSql(`drop table if exists "ai_agent_run_steps" cascade;`);
    this.addSql(`drop table if exists "ai_agent_runs" cascade;`);
  }

}
