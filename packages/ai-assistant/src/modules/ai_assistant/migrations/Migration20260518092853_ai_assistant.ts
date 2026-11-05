import { Migration } from '@mikro-orm/migrations';

/**
 * Server-side AI chat conversation storage.
 *
 * Adds the three additive tables introduced by spec
 * `2026-05-05-ai-chat-server-side-conversation-storage`:
 * - `ai_chat_conversations`: durable session record per `(tenant, org, owner)`.
 * - `ai_chat_conversation_participants`: per-user membership, prepares for sharing.
 * - `ai_chat_messages`: append-only transcript with idempotent `client_message_id`.
 */
export class Migration20260518092853_ai_assistant extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ai_chat_conversations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "agent_id" text not null, "owner_user_id" uuid not null, "title" text null, "status" text not null default 'open', "visibility" text not null default 'private', "page_context" jsonb null, "last_message_at" timestamptz null, "imported_from_local_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "ai_chat_conversations_tenant_org_deleted_idx" on "ai_chat_conversations" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create index "ai_chat_conversations_tenant_org_owner_agent_idx" on "ai_chat_conversations" ("tenant_id", "organization_id", "owner_user_id", "agent_id", "status", "last_message_at");`);
    this.addSql(`create unique index "ai_chat_conversations_tenant_conv_null_org_uq" on "ai_chat_conversations" ("tenant_id", "conversation_id") where "organization_id" is null and "deleted_at" is null;`);
    this.addSql(`create unique index "ai_chat_conversations_tenant_org_conv_uq" on "ai_chat_conversations" ("tenant_id", "organization_id", "conversation_id") where "organization_id" is not null and "deleted_at" is null;`);

    this.addSql(`create table "ai_chat_conversation_participants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "user_id" uuid not null, "role" text not null default 'owner', "last_read_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ai_chat_conv_participants_tenant_org_user_conv_idx" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "user_id", "conversation_id");`);
    this.addSql(`create unique index "ai_chat_conv_participants_tenant_conv_user_null_org_uq" on "ai_chat_conversation_participants" ("tenant_id", "conversation_id", "user_id") where "organization_id" is null;`);
    this.addSql(`create unique index "ai_chat_conv_participants_tenant_org_conv_user_uq" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id") where "organization_id" is not null;`);

    this.addSql(`create table "ai_chat_messages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "conversation_id" text not null, "client_message_id" text null, "role" text not null, "content" text not null, "ui_parts" jsonb null, "attachment_ids" jsonb null, "files_metadata" jsonb null, "model" text null, "metadata" jsonb null, "created_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "ai_chat_messages_tenant_org_deleted_idx" on "ai_chat_messages" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create index "ai_chat_messages_tenant_org_conv_created_idx" on "ai_chat_messages" ("tenant_id", "organization_id", "conversation_id", "created_at");`);
    this.addSql(`create unique index "ai_chat_messages_tenant_conv_client_id_null_org_uq" on "ai_chat_messages" ("tenant_id", "conversation_id", "client_message_id") where "organization_id" is null and "client_message_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "ai_chat_messages_tenant_org_conv_client_id_uq" on "ai_chat_messages" ("tenant_id", "organization_id", "conversation_id", "client_message_id") where "organization_id" is not null and "client_message_id" is not null and "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_chat_messages" cascade;`);
    this.addSql(`drop table if exists "ai_chat_conversation_participants" cascade;`);
    this.addSql(`drop table if exists "ai_chat_conversations" cascade;`);
  }

}
