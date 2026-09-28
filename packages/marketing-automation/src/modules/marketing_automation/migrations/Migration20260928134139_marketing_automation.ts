import { Migration } from '@mikro-orm/migrations';

export class Migration20260928134139_marketing_automation extends Migration {

  override name = 'Migration20260928134139';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_campaigns" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "is_enabled" boolean not null default false, "definition" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_campaigns_scope_deleted_idx" on "marketing_campaigns" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create index "mkt_campaigns_scope_enabled_idx" on "marketing_campaigns" ("tenant_id", "organization_id", "is_enabled");`);

    this.addSql(`create table "marketing_campaign_runs" ("id" uuid not null default gen_random_uuid(), "campaign_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid null, "trigger_event_id" text not null, "context" jsonb not null, "current_step_index" int not null default 0, "step_log" jsonb not null default '[]', "status" text not null default 'running', "resume_at" timestamptz null, "claimed_at" timestamptz null, "claim_token" uuid null, "attempts" int not null default 0, "last_error" text null, "next_retry_at" timestamptz null, "started_at" timestamptz not null default now(), "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_runs_scope_idx" on "marketing_campaign_runs" ("tenant_id", "organization_id", "status");`);
    this.addSql(`create index "mkt_runs_entry_idx" on "marketing_campaign_runs" ("campaign_id", "subject_entity_id", "status");`);
    this.addSql(`create index "mkt_runs_due_idx" on "marketing_campaign_runs" ("resume_at", "status");`);

    this.addSql(`create table "marketing_campaign_triggers" ("id" uuid not null default gen_random_uuid(), "campaign_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null default 'event', "event_id" text null, "schedule_value" text null, "reentry_after_days" int null, "sweep_source" text null, "sweep_params" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_triggers_kind_idx" on "marketing_campaign_triggers" ("tenant_id", "organization_id", "kind");`);
    this.addSql(`create index "mkt_triggers_lookup_idx" on "marketing_campaign_triggers" ("tenant_id", "organization_id", "event_id");`);
    this.addSql(`alter table "marketing_campaign_triggers" add constraint "mkt_triggers_campaign_event_uq" unique ("campaign_id", "event_id");`);

    this.addSql(`create table "marketing_dispatch_dead_letters" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid null, "source" text not null, "event_id" text null, "campaign_id" uuid null, "payload" jsonb not null, "error" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_dead_letters_created_idx" on "marketing_dispatch_dead_letters" ("created_at");`);

    this.addSql(`create table "marketing_message_sends" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid null, "run_id" uuid null, "step_id" text null, "subject_entity_id" uuid null, "channel" text not null, "to_address" text null, "status" text not null default 'sent', "suppression_reason" text null, "sent_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_sends_campaign_idx" on "marketing_message_sends" ("campaign_id", "sent_at");`);
    this.addSql(`create index "mkt_sends_subject_window_idx" on "marketing_message_sends" ("tenant_id", "organization_id", "subject_entity_id", "sent_at");`);
  }

}
