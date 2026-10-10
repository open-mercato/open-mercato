import { Migration } from '@mikro-orm/migrations';

// Process X-Ray tables. They are created empty in this same transaction, so their indexes are
// built inline: a CREATE INDEX on an empty, not-yet-visible table blocks no writer, and keeping
// it transactional means a failed deploy leaves no half-created schema behind.
export class Migration20261008180752_insights extends Migration {

  override name = 'Migration20261008180752';

  override up(): void | Promise<void> {
    this.addSql(`create table "insights_automation_suggestions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_key" text not null, "signature_hash" text not null, "trigger_json" jsonb not null, "condition_json" jsonb null, "followups_json" jsonb not null, "support" int not null, "confidence" real not null, "lift" real not null, "distinct_actor_count" int not null, "status" text not null default 'open', "draftable" boolean not null default false, "not_draftable_reason" text null, "drafted_artifact_id" uuid null, "computed_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "insights_automation_suggestions_status_idx" on "insights_automation_suggestions" ("tenant_id", "organization_id", "status");`);
    this.addSql(`alter table "insights_automation_suggestions" add constraint "insights_automation_suggestions_signature_unique" unique ("tenant_id", "organization_id", "signature_hash");`);

    this.addSql(`create table "insights_process_cases" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_key" text not null, "case_kind" text not null, "case_id" uuid not null, "started_at" timestamptz not null, "last_activity_at" timestamptz not null, "ended_at" timestamptz null, "status" text not null, "event_count" int not null, "rework_count" int not null, "distinct_actor_count" int not null, "automated_share" real not null, "variant_hash" text not null, "variant_keys" jsonb not null, "dimensions" jsonb not null, "truncated" boolean not null default false, "recomputed_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "insights_process_cases_variant_idx" on "insights_process_cases" ("tenant_id", "organization_id", "process_key", "variant_hash");`);
    this.addSql(`create index "insights_process_cases_activity_idx" on "insights_process_cases" ("tenant_id", "organization_id", "process_key", "last_activity_at");`);
    this.addSql(`create index "insights_process_cases_retention_idx" on "insights_process_cases" ("tenant_id", "organization_id", "last_activity_at");`);
    this.addSql(`alter table "insights_process_cases" add constraint "insights_process_cases_case_unique" unique ("tenant_id", "organization_id", "process_key", "case_id");`);

    this.addSql(`create table "insights_process_cursors" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "last_created_at" timestamptz null, "last_log_id" uuid null, "state_watermark" timestamptz null, "state_last_log_id" uuid null, "scan_id" uuid null, "scan_kind" text null, "scan_from" timestamptz null, "scan_until" timestamptz null, "scan_after_created_at" timestamptz null, "scan_after_log_id" uuid null, "scan_progress_job_id" uuid null, "scan_processed_count" bigint not null default '0', "scan_started_at" timestamptz null, "scan_updated_at" timestamptz null, "scan_chain_id" uuid null, "actor_key_fingerprint" text null, "last_reconciled_at" timestamptz null, "last_full_reconciled_at" timestamptz null, "last_pruned_at" timestamptz null, "lease_owner" text null, "lease_token" bigint not null default '0', "lease_until" timestamptz null, "contract_hashes" jsonb null, "pending_rebuild_keys" jsonb not null default '[]', "scan_process_keys" jsonb null, "contract_changed_at" timestamptz null, "contract_change" jsonb null, "coverage_from" timestamptz null, "history_scanned_at" timestamptz null, "undecryptable_rows" bigint not null default '0', "overlap_timeouts" bigint not null default '0', "last_overlap_timeout_at" timestamptz null, "status" text not null default 'idle', "last_run_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "insights_process_cursors" add constraint "insights_process_cursors_scope_unique" unique ("tenant_id", "organization_id");`);

    this.addSql(`create table "insights_process_erasures" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "replacement" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "insights_process_erasures" add constraint "insights_process_erasures_user_unique" unique ("tenant_id", "user_id");`);

    this.addSql(`create table "insights_process_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_key" text not null, "case_kind" text not null, "case_id" uuid not null, "activity_key" text not null, "activity_kind" text not null, "occurred_at" timestamptz not null, "source_log_id" uuid not null, "seq" int not null, "actor_pseudonym" text null, "actor_role_ids" text[] null, "actor_team_id" uuid null, "cause_kind" text not null, "cause_id" text null, "via_sync_run" boolean not null default false, "followup_field" text null, "followup_value" text null, "voided" boolean not null default false, "voided_by_log_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "insights_process_events_actor_idx" on "insights_process_events" ("tenant_id", "actor_pseudonym");`);
    this.addSql(`create index "insights_process_events_value_idx" on "insights_process_events" ("tenant_id", "organization_id", "process_key", "followup_field", "followup_value");`);
    this.addSql(`create index "insights_process_events_window_idx" on "insights_process_events" ("tenant_id", "organization_id", "process_key", "occurred_at");`);
    this.addSql(`create index "insights_process_events_case_idx" on "insights_process_events" ("tenant_id", "organization_id", "process_key", "case_id", "occurred_at");`);
    this.addSql(`create index "insights_process_events_occurred_idx" on "insights_process_events" ("tenant_id", "organization_id", "occurred_at");`);
    this.addSql(`alter table "insights_process_events" add constraint "insights_process_events_source_unique" unique ("source_log_id", "process_key", "seq");`);

    this.addSql(`create table "insights_process_rollups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_key" text not null, "window_key" text not null, "window_start" timestamptz not null, "window_end" timestamptz not null, "computed_at" timestamptz not null, "metrics" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "insights_process_rollups" add constraint "insights_process_rollups_window_unique" unique ("tenant_id", "organization_id", "process_key", "window_key", "window_start");`);

    this.addSql(`create table "insights_process_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "enabled" boolean not null default true, "retention_days" int not null default 365, "k_anonymity" int not null default 10, "debounce_seconds" int not null default 120, "individuals_enabled" boolean not null default false, "time_zone" text not null default 'UTC', "conformance_workflow_id" uuid null, "activity_step_map" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "insights_process_settings" add constraint "insights_process_settings_scope_unique" unique ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "insights_process_settings" cascade;`);
    this.addSql(`drop table if exists "insights_process_rollups" cascade;`);
    this.addSql(`drop table if exists "insights_process_events" cascade;`);
    this.addSql(`drop table if exists "insights_process_erasures" cascade;`);
    this.addSql(`drop table if exists "insights_process_cursors" cascade;`);
    this.addSql(`drop table if exists "insights_process_cases" cascade;`);
    this.addSql(`drop table if exists "insights_automation_suggestions" cascade;`);
  }

}
