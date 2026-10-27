import { Migration } from '@mikro-orm/migrations';

export class Migration20260706124120_phone_calls extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "phone_calls" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "provider_key" text not null, "integration_id" text null, "external_call_id" text not null, "external_conversation_id" text null, "direction" text not null, "status" text not null, "started_at" timestamptz null, "answered_at" timestamptz null, "ended_at" timestamptz null, "duration_seconds" int null, "recording_url" text null, "recording_attachment_id" uuid null, "active_transcript_version_id" uuid null, "active_summary_version_id" uuid null, "communication_projection_id" uuid null, "provider_facts" jsonb null, "raw_snapshot" jsonb null, "ingest_status" text not null default 'pending', "last_ingested_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "phone_calls_communication_projection_id_idx" on "phone_calls" ("communication_projection_id") where "communication_projection_id" is not null;`);
    this.addSql(`create index "phone_calls_org_status_idx" on "phone_calls" ("organization_id", "status");`);
    this.addSql(`create index "phone_calls_org_started_at_idx" on "phone_calls" ("organization_id", "started_at");`);
    this.addSql(`create index "phone_calls_org_tenant_idx" on "phone_calls" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "phone_calls" add constraint "phone_calls_provider_external_scope_uq" unique ("provider_key", "external_call_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "phone_call_participants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "phone_call_id" uuid not null, "provider_participant_id" text null, "role" text not null, "phone_number" text null, "display_name" text null, "email" text null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "phone_call_participants_org_tenant_idx" on "phone_call_participants" ("organization_id", "tenant_id");`);
    this.addSql(`create index "phone_call_participants_call_idx" on "phone_call_participants" ("phone_call_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "phone_call_participants";`);
    this.addSql(`drop table if exists "phone_calls";`);
  }

}
