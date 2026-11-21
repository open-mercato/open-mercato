import { Migration } from '@mikro-orm/migrations';

export class Migration20260930144604_marketing_automation extends Migration {

  override name = 'Migration20260930144604';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_campaigns" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "is_enabled" boolean not null default false, "definition" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_campaigns_scope_deleted_idx" on "marketing_campaigns" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create index "mkt_campaigns_scope_enabled_idx" on "marketing_campaigns" ("tenant_id", "organization_id", "is_enabled");`);

    this.addSql(`create table "marketing_campaign_revisions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "version" int not null, "name" text not null, "definition" jsonb not null, "triggers" jsonb not null, "actor_id" text null, "note" text not null, "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_revisions_campaign_idx" on "marketing_campaign_revisions" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`alter table "marketing_campaign_revisions" add constraint "marketing_revisions_version_uniq" unique ("tenant_id", "organization_id", "campaign_id", "version");`);

    this.addSql(`create table "marketing_campaign_runs" ("id" uuid not null default gen_random_uuid(), "campaign_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid null, "trigger_event_id" text not null, "occurrence_key" text null, "variant_choices" jsonb null, "context" jsonb not null, "current_step_index" int not null default 0, "step_log" jsonb not null default '[]', "status" text not null default 'running', "resume_at" timestamptz null, "claimed_at" timestamptz null, "claim_token" uuid null, "attempts" int not null default 0, "last_error" text null, "next_retry_at" timestamptz null, "started_at" timestamptz not null default now(), "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_runs_subject_window_idx" on "marketing_campaign_runs" ("tenant_id", "organization_id", "subject_entity_id", "started_at");`);
    this.addSql(`create index "mkt_runs_scope_idx" on "marketing_campaign_runs" ("tenant_id", "organization_id", "status");`);
    this.addSql(`create index "mkt_runs_entry_idx" on "marketing_campaign_runs" ("campaign_id", "subject_entity_id", "status");`);
    this.addSql(`create index "mkt_runs_due_idx" on "marketing_campaign_runs" ("resume_at", "status");`);
    this.addSql(`create unique index "marketing_runs_occurrence_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "occurrence_key") where occurrence_key is not null;`);
    this.addSql(`create unique index "marketing_runs_active_subject_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "subject_entity_id") where subject_entity_id is not null and status in ('running', 'waiting', 'claimed');`);

    this.addSql(`create table "marketing_campaign_triggers" ("id" uuid not null default gen_random_uuid(), "campaign_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null default 'event', "event_id" text null, "schedule_value" text null, "reentry_after_days" int null, "sweep_source" text null, "sweep_params" jsonb null, "last_swept_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_triggers_kind_idx" on "marketing_campaign_triggers" ("tenant_id", "organization_id", "kind");`);
    this.addSql(`create index "mkt_triggers_lookup_idx" on "marketing_campaign_triggers" ("tenant_id", "organization_id", "event_id");`);
    this.addSql(`alter table "marketing_campaign_triggers" add constraint "mkt_triggers_campaign_event_uq" unique ("campaign_id", "event_id");`);

    this.addSql(`create table "marketing_consents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "channel" text not null, "state" text not null, "reason" text null, "source" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_consents" add constraint "marketing_consents_subject_channel_uniq" unique ("tenant_id", "organization_id", "subject_entity_id", "channel");`);

    this.addSql(`create table "marketing_consent_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "channel" text not null, "state" text not null, "reason" text null, "source" text not null, "campaign_id" uuid null, "occurred_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_consent_events_subject_idx" on "marketing_consent_events" ("tenant_id", "organization_id", "subject_entity_id");`);

    this.addSql(`create table "marketing_contact_preferences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "max_per_week" int null, "paused_until" timestamptz null, "locale" text null, "source" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_contact_preferences" add constraint "marketing_contact_preference_uniq" unique ("tenant_id", "organization_id", "subject_entity_id");`);

    this.addSql(`create table "marketing_content_blocks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "html" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_content_blocks_scope_idx" on "marketing_content_blocks" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create unique index "marketing_content_blocks_key_uniq" on "marketing_content_blocks" ("tenant_id", "organization_id", "key") where deleted_at is null;`);

    this.addSql(`create table "marketing_customer_score_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid null, "points" int not null, "reason" text null, "source" text not null, "campaign_id" uuid null, "run_id" uuid null, "step_id" text null, "rule_sequence" int null, "occurred_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create unique index "marketing_score_entry_rule_seq_uniq" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "subject_entity_id", "rule_sequence") where rule_sequence is not null;`);
    this.addSql(`create unique index "marketing_score_entry_step_uniq" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "run_id", "step_id") where run_id is not null;`);
    this.addSql(`create index "mkt_score_campaign_idx" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_score_subject_idx" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "subject_entity_id");`);

    this.addSql(`create table "marketing_dispatch_dead_letters" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid null, "source" text not null, "event_id" text null, "campaign_id" uuid null, "payload" jsonb not null, "error" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_dead_letters_created_idx" on "marketing_dispatch_dead_letters" ("created_at");`);

    this.addSql(`create table "marketing_inbound_hooks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "name" text not null, "revoked_at" timestamptz null, "received_count" int not null default 0, "last_received_at" timestamptz null, "last_outcome" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_inbound_hooks_campaign_idx" on "marketing_inbound_hooks" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_inbound_hooks_scope_idx" on "marketing_inbound_hooks" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`create table "marketing_job_runs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "campaign_id" uuid null, "started_at" timestamptz not null default now(), "finished_at" timestamptz null, "status" text not null default 'running', "counters" jsonb null, "error" text null, primary key ("id"));`);
    this.addSql(`create index "mkt_job_runs_kind_idx" on "marketing_job_runs" ("tenant_id", "organization_id", "kind", "started_at");`);

    this.addSql(`create table "marketing_message_sends" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid null, "run_id" uuid null, "step_id" text null, "subject_entity_id" uuid null, "channel" text not null, "status" text not null default 'sent', "suppression_reason" text null, "sent_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_sends_run_step_idx" on "marketing_message_sends" ("run_id", "step_id");`);
    this.addSql(`create index "mkt_sends_campaign_idx" on "marketing_message_sends" ("campaign_id", "sent_at");`);
    this.addSql(`create index "mkt_sends_subject_window_idx" on "marketing_message_sends" ("tenant_id", "organization_id", "subject_entity_id", "sent_at");`);

    this.addSql(`create table "marketing_message_send_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "run_id" uuid not null, "step_id" text not null, "send_id" uuid null, "type" text not null, "link_url" text null, "occurred_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_send_events_send_idx" on "marketing_message_send_events" ("send_id", "type");`);
    this.addSql(`create index "mkt_send_events_run_step_idx" on "marketing_message_send_events" ("tenant_id", "organization_id", "run_id", "step_id");`);
    this.addSql(`create index "mkt_send_events_campaign_idx" on "marketing_message_send_events" ("tenant_id", "organization_id", "campaign_id", "type");`);

    this.addSql(`create table "marketing_product_watches" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "sku" text not null, "currency_code" text not null, "watched_price_gross" text null, "notified_at" timestamptz null, "notified_count" int not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_product_watches_sku_idx" on "marketing_product_watches" ("tenant_id", "organization_id", "sku");`);
    this.addSql(`create unique index "marketing_product_watch_uniq" on "marketing_product_watches" ("tenant_id", "organization_id", "subject_entity_id", "sku") where deleted_at is null;`);

    this.addSql(`create table "marketing_referral_codes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "referrer_entity_id" uuid null, "code" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "marketing_referral_referrer_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "referrer_entity_id") where deleted_at is null;`);
    this.addSql(`create unique index "marketing_referral_code_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "code") where deleted_at is null;`);

    this.addSql(`create table "marketing_referral_redemptions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code_id" uuid not null, "referrer_entity_id" uuid null, "referred_entity_id" uuid null, "status" text not null default 'pending', "order_id" uuid null, "order_total" text null, "converted_at" timestamptz null, "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_referral_redemptions_status_idx" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "status");`);
    this.addSql(`create index "mkt_referral_redemptions_code_idx" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "code_id");`);
    this.addSql(`create unique index "marketing_referral_referred_uniq" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "referred_entity_id");`);

    this.addSql(`create table "marketing_score_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "expression" jsonb null, "points" int not null, "is_enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_score_rules_scope_idx" on "marketing_score_rules" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`create table "marketing_segments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "name" text not null, "description" text null, "expression" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_segments_scope_idx" on "marketing_segments" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create unique index "marketing_segments_slug_uniq" on "marketing_segments" ("tenant_id", "organization_id", "slug") where deleted_at is null;`);

    this.addSql(`create table "marketing_segment_snapshots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "segment_id" uuid not null, "day" text not null, "size" int not null, "qualifier" text not null, "taken_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_segment_snapshots_idx" on "marketing_segment_snapshots" ("tenant_id", "organization_id", "segment_id", "day");`);
    this.addSql(`alter table "marketing_segment_snapshots" add constraint "marketing_segment_snapshot_day_uniq" unique ("tenant_id", "organization_id", "segment_id", "day");`);

    this.addSql(`create table "marketing_subject_erasures" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "erased_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_subject_erasures" add constraint "marketing_subject_erasures_subject_uniq" unique ("tenant_id", "organization_id", "subject_entity_id");`);

    this.addSql(`create table "marketing_survey_prompts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid null, "campaign_id" uuid not null, "run_id" uuid not null, "step_id" text not null, "question" text not null, "score" int null, "comment" text null, "asked_at" timestamptz not null default now(), "sent_at" timestamptz null, "answered_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_survey_campaign_idx" on "marketing_survey_prompts" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_survey_subject_idx" on "marketing_survey_prompts" ("tenant_id", "organization_id", "subject_entity_id");`);
    this.addSql(`alter table "marketing_survey_prompts" add constraint "marketing_survey_prompts_step_uniq" unique ("tenant_id", "organization_id", "run_id", "step_id");`);

    this.addSql(`create table "marketing_value_boundaries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "boundaries" jsonb not null, "buyer_count" int not null default 0, "computed_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_value_boundaries" add constraint "mkt_value_boundaries_scope_uq" unique ("tenant_id", "organization_id");`);
  }

}
