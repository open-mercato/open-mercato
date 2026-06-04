import { Migration } from '@mikro-orm/migrations';

export class Migration20260526134719_communication_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "channel_thread_mappings" ("id" uuid not null default gen_random_uuid(), "external_conversation_id" uuid not null, "message_thread_id" uuid not null, "channel_id" uuid not null, "provider_key" text not null, "external_thread_ref" text not null, "assigned_user_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "channel_thread_mappings_thread_idx" on "channel_thread_mappings" ("message_thread_id", "tenant_id");`);
    this.addSql(`create index "channel_thread_mappings_ext_conv_idx" on "channel_thread_mappings" ("external_conversation_id", "tenant_id");`);
    this.addSql(`alter table "channel_thread_mappings" add constraint "channel_thread_mappings_ext_conv_uq" unique ("external_conversation_id", "tenant_id");`);

    this.addSql(`create table "communication_channels" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "channel_type" text not null, "display_name" text not null, "external_identifier" text null, "credentials_ref" uuid null, "capabilities" jsonb null, "is_active" boolean not null default true, "user_id" uuid null, "is_primary" boolean not null default false, "poll_interval_seconds" int null, "last_polled_at" timestamptz null, "status" text not null default 'connected', "last_error" text null, "channel_state" jsonb null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "communication_channels_tenant_type_active_idx" on "communication_channels" ("tenant_id", "channel_type", "is_active");`);
    this.addSql(`create index "communication_channels_tenant_provider_idx" on "communication_channels" ("tenant_id", "provider_key");`);
    this.addSql(`create unique index "communication_channels_one_primary_per_user_uq" on "communication_channels" ("user_id") where "is_primary" and "user_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "communication_channels_poll_due_idx" on "communication_channels" ("is_active", "last_polled_at") where "deleted_at" is null;`);
    this.addSql(`create index "communication_channels_user_lookup_idx" on "communication_channels" ("user_id", "channel_type", "deleted_at");`);

    this.addSql(`create table "external_conversations" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "external_conversation_id" text not null, "subject" text null, "contact_person_id" uuid null, "assigned_user_id" uuid null, "last_message_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "external_conversations_assigned_user_idx" on "external_conversations" ("assigned_user_id");`);
    this.addSql(`create index "external_conversations_contact_person_idx" on "external_conversations" ("contact_person_id");`);
    this.addSql(`create index "external_conversations_channel_idx" on "external_conversations" ("channel_id", "external_conversation_id");`);
    this.addSql(`alter table "external_conversations" add constraint "external_conversations_channel_external_uq" unique ("channel_id", "external_conversation_id");`);

    this.addSql(`create table "external_messages" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "conversation_id" uuid not null, "external_message_id" text not null, "direction" text not null, "sender_identifier" text null, "sender_display_name" text null, "provider_timestamp" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "external_messages_channel_external_idx" on "external_messages" ("channel_id", "external_message_id");`);
    this.addSql(`create index "external_messages_conversation_idx" on "external_messages" ("conversation_id");`);
    this.addSql(`alter table "external_messages" add constraint "external_messages_channel_external_uq" unique ("channel_id", "external_message_id");`);

    this.addSql(`create table "message_channel_links" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "external_conversation_id" uuid not null, "external_message_id" uuid null, "provider_key" text not null, "channel_type" text not null, "direction" text not null, "delivery_status" text not null default 'pending', "channel_payload" jsonb null, "channel_content_type" text null, "interactive_state" jsonb null, "channel_metadata" jsonb null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "message_channel_links_ext_msg_idx" on "message_channel_links" ("external_message_id");`);
    this.addSql(`create index "message_channel_links_ext_conv_idx" on "message_channel_links" ("external_conversation_id");`);
    this.addSql(`create index "message_channel_links_message_idx" on "message_channel_links" ("message_id");`);
    this.addSql(`alter table "message_channel_links" add constraint "message_channel_links_message_uq" unique ("message_id");`);

    this.addSql(`create table "message_reactions" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "emoji" text not null, "reacted_by_user_id" uuid null, "reacted_by_external_id" text null, "reacted_by_display_name" text null, "provider_key" text null, "external_reaction_id" text null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "message_reactions" add constraint "message_reactions_exactly_one_actor_chk" check (("reacted_by_user_id" is null) <> ("reacted_by_external_id" is null));`);
    this.addSql(`create index "message_reactions_message_emoji_idx" on "message_reactions" ("message_id", "emoji");`);
    this.addSql(`create index "message_reactions_message_idx" on "message_reactions" ("message_id");`);
    this.addSql(`create unique index "message_reactions_external_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_external_id") where "reacted_by_external_id" is not null;`);
    this.addSql(`create unique index "message_reactions_internal_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_user_id") where "reacted_by_user_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "message_reactions";`);
    this.addSql(`drop table if exists "message_channel_links";`);
    this.addSql(`drop table if exists "external_messages";`);
    this.addSql(`drop table if exists "external_conversations";`);
    this.addSql(`drop index if exists "communication_channels_user_lookup_idx";`);
    this.addSql(`drop index if exists "communication_channels_poll_due_idx";`);
    this.addSql(`drop index if exists "communication_channels_one_primary_per_user_uq";`);
    this.addSql(`drop table if exists "communication_channels";`);
    this.addSql(`drop table if exists "channel_thread_mappings";`);
  }

}
