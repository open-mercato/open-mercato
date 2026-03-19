import { Migration } from '@mikro-orm/migrations';

export class Migration20260216151619 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "inbox_discrepancies" ("id" uuid not null default gen_random_uuid(), "proposal_id" uuid not null, "action_id" uuid null, "type" text not null, "severity" text not null, "description" text not null, "expected_value" text null, "found_value" text null, "resolved" boolean not null default false, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_discrepancies_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_discrepancies_proposal_id_index" on "inbox_discrepancies" ("proposal_id");`);

    this.addSql(`create table "inbox_emails" ("id" uuid not null default gen_random_uuid(), "message_id" text null, "content_hash" text null, "forwarded_by_address" text not null, "forwarded_by_name" text null, "to_address" text not null, "subject" text not null, "reply_to" text null, "in_reply_to" text null, "references" jsonb null, "raw_text" text null, "raw_html" text null, "cleaned_text" text null, "thread_messages" jsonb null, "detected_language" text null, "attachment_ids" jsonb null, "received_at" timestamptz not null, "status" text not null default 'received', "processing_error" text null, "is_active" boolean not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_emails_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_received_at_index" on "inbox_emails" ("organization_id", "tenant_id", "received_at");`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_status_index" on "inbox_emails" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "inbox_emails_organization_id_tenant_id_index" on "inbox_emails" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "inbox_emails" add constraint "inbox_emails_organization_id_tenant_id_content_hash_unique" unique ("organization_id", "tenant_id", "content_hash");`);
    this.addSql(`alter table "inbox_emails" add constraint "inbox_emails_organization_id_tenant_id_message_id_unique" unique ("organization_id", "tenant_id", "message_id");`);

    this.addSql(`create table "inbox_proposals" ("id" uuid not null default gen_random_uuid(), "inbox_email_id" uuid not null, "summary" text not null, "participants" jsonb not null, "confidence" numeric(3,2) not null, "detected_language" text null, "status" text not null default 'pending', "possibly_incomplete" boolean not null default false, "reviewed_by_user_id" uuid null, "reviewed_at" timestamptz null, "llm_model" text null, "llm_tokens_used" int null, "is_active" boolean not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_proposals_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_proposals_inbox_email_id_index" on "inbox_proposals" ("inbox_email_id");`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_status_index" on "inbox_proposals" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_index" on "inbox_proposals" ("organization_id", "tenant_id");`);

    this.addSql(`create table "inbox_proposal_actions" ("id" uuid not null default gen_random_uuid(), "proposal_id" uuid not null, "sort_order" int not null, "action_type" text not null, "description" text not null, "payload" jsonb not null, "status" text not null default 'pending', "confidence" numeric(3,2) not null, "required_feature" text null, "matched_entity_id" uuid null, "matched_entity_type" text null, "created_entity_id" uuid null, "created_entity_type" text null, "execution_error" text null, "executed_at" timestamptz null, "executed_by_user_id" uuid null, "is_active" boolean not null default true, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_proposal_actions_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_proposal_actions_organization_id_tenant_id_status_index" on "inbox_proposal_actions" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "inbox_proposal_actions_proposal_id_index" on "inbox_proposal_actions" ("proposal_id");`);

    this.addSql(`create table "inbox_settings" ("id" uuid not null default gen_random_uuid(), "inbox_address" text not null, "is_active" boolean not null default true, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_settings_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_settings_organization_id_tenant_id_index" on "inbox_settings" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "inbox_settings" add constraint "inbox_settings_inbox_address_unique" unique ("inbox_address");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inbox_proposal_actions" cascade;`);
    this.addSql(`drop table if exists "inbox_discrepancies" cascade;`);
    this.addSql(`drop table if exists "inbox_proposals" cascade;`);
    this.addSql(`drop table if exists "inbox_emails" cascade;`);
    this.addSql(`drop table if exists "inbox_settings" cascade;`);
  }

}
