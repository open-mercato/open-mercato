import { Migration } from '@mikro-orm/migrations';

export class Migration20260213181243 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "messages" ("id" uuid not null default gen_random_uuid(), "type" text not null default 'default', "thread_id" uuid null, "parent_message_id" uuid null, "sender_user_id" uuid not null, "subject" text not null, "body" text not null, "body_format" text not null default 'text', "priority" text not null default 'normal', "status" text not null default 'draft', "is_draft" boolean not null default true, "sent_at" timestamptz null, "action_data" jsonb null, "action_result" jsonb null, "action_taken" text null, "action_taken_by_user_id" uuid null, "action_taken_at" timestamptz null, "send_via_email" boolean not null default false, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "visibility" text null, "source_entity_type" text null, "source_entity_id" uuid null, "external_email" text null, "external_name" text null, "external_email_sent_at" timestamptz null, "external_email_failed_at" timestamptz null, "external_email_error" text null, constraint "messages_pkey" primary key ("id"));`);
    this.addSql(`create index "messages_tenant_idx" on "messages" ("tenant_id", "organization_id");`);
    this.addSql(`create index "messages_type_idx" on "messages" ("type", "tenant_id");`);
    this.addSql(`create index "messages_thread_idx" on "messages" ("thread_id");`);
    this.addSql(`create index "messages_sender_idx" on "messages" ("sender_user_id", "sent_at");`);

    this.addSql(`create table "message_access_tokens" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "recipient_user_id" uuid not null, "token" text not null, "expires_at" timestamptz not null, "used_at" timestamptz null, "use_count" int not null default 0, "created_at" timestamptz not null, constraint "message_access_tokens_pkey" primary key ("id"));`);
    this.addSql(`alter table "message_access_tokens" add constraint "message_access_tokens_token_unique" unique ("token");`);
    this.addSql(`create index "message_access_tokens_message_idx" on "message_access_tokens" ("message_id");`);
    this.addSql(`create index "message_access_tokens_token_idx" on "message_access_tokens" ("token");`);

    this.addSql(`create table "message_objects" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "entity_module" text not null, "entity_type" text not null, "entity_id" uuid not null, "action_required" boolean not null default false, "action_type" text null, "action_label" text null, "entity_snapshot" jsonb null, "created_at" timestamptz not null, constraint "message_objects_pkey" primary key ("id"));`);
    this.addSql(`create index "message_objects_entity_idx" on "message_objects" ("entity_type", "entity_id");`);
    this.addSql(`create index "message_objects_message_idx" on "message_objects" ("message_id");`);

    this.addSql(`create table "message_recipients" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "recipient_user_id" uuid not null, "recipient_type" text not null default 'to', "status" text not null default 'unread', "read_at" timestamptz null, "archived_at" timestamptz null, "deleted_at" timestamptz null, "email_sent_at" timestamptz null, "email_delivered_at" timestamptz null, "email_opened_at" timestamptz null, "email_failed_at" timestamptz null, "email_error" text null, "created_at" timestamptz not null, constraint "message_recipients_pkey" primary key ("id"));`);
    this.addSql(`alter table "message_recipients" add constraint "message_recipients_message_user_unique" unique ("message_id", "recipient_user_id");`);
    this.addSql(`create index "message_recipients_message_idx" on "message_recipients" ("message_id");`);
    this.addSql(`create index "message_recipients_user_idx" on "message_recipients" ("recipient_user_id", "status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_recipients" cascade;`);
    this.addSql(`drop table if exists "message_objects" cascade;`);
    this.addSql(`drop table if exists "message_access_tokens" cascade;`);
    this.addSql(`drop table if exists "messages" cascade;`);
  }

}
