import { Migration } from '@mikro-orm/migrations';

export class Migration20260419134235_ai_assistant extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ai_pending_actions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "agent_id" text not null, "tool_name" text not null, "conversation_id" text null, "target_entity_type" text null, "target_record_id" text null, "normalized_input" jsonb not null, "field_diff" jsonb not null default '[]', "records" jsonb null, "failed_records" jsonb null, "side_effects_summary" text null, "record_version" text null, "attachment_ids" jsonb not null default '[]', "idempotency_key" text not null, "created_by_user_id" uuid not null, "status" text not null, "queue_mode" text not null default 'inline', "execution_result" jsonb null, "created_at" timestamptz not null, "expires_at" timestamptz not null, "resolved_at" timestamptz null, "resolved_by_user_id" uuid null, constraint "ai_pending_actions_pkey" primary key ("id"));`);
    this.addSql(`create unique index "ai_pending_actions_tenant_org_idempotency_uq" on "ai_pending_actions" ("tenant_id", "organization_id", "idempotency_key") where "organization_id" is not null;`);
    this.addSql(`create unique index "ai_pending_actions_tenant_idem_null_org_uq" on "ai_pending_actions" ("tenant_id", "idempotency_key") where "organization_id" is null;`);
    this.addSql(`create index "ai_pending_actions_tenant_org_agent_status_idx" on "ai_pending_actions" ("tenant_id", "organization_id", "agent_id", "status");`);
    this.addSql(`create index "ai_pending_actions_tenant_org_status_expires_idx" on "ai_pending_actions" ("tenant_id", "organization_id", "status", "expires_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_pending_actions" cascade;`);
  }

}
