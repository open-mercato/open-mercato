import { Migration } from '@mikro-orm/migrations';

export class Migration20260303195244 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "agent_governance_decision_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid null, "step_id" text null, "action_type" text not null, "target_entity" text not null, "target_id" text null, "policy_id" uuid null, "risk_band_id" uuid null, "risk_score" int null, "control_path" text not null, "input_evidence" jsonb not null, "approver_ids" jsonb not null, "exception_ids" jsonb not null, "write_set" jsonb null, "status" text not null, "error_code" text null, "harness_provider" text null, "immutable_hash" text not null, "supersedes_event_id" uuid null, "signature" text null, "created_at" timestamptz not null, constraint "agent_governance_decision_events_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_decision_events_signature_idx" on "agent_governance_decision_events" ("signature", "created_at");`);
    this.addSql(`create index "agent_governance_decision_events_run_idx" on "agent_governance_decision_events" ("run_id", "created_at");`);
    this.addSql(`create index "agent_governance_decision_events_scope_idx" on "agent_governance_decision_events" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_decision_events" add constraint "agent_governance_decision_events_hash_unique" unique ("immutable_hash");`);

    this.addSql(`create table "agent_governance_decision_entity_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "decision_event_id" uuid not null, "entity_type" text not null, "entity_id" text not null, "relationship_type" text not null, "created_at" timestamptz not null, constraint "agent_governance_decision_entity_links_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_decision_entity_links_entity_idx" on "agent_governance_decision_entity_links" ("entity_type", "entity_id");`);
    this.addSql(`create index "agent_governance_decision_entity_links_scope_idx" on "agent_governance_decision_entity_links" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_governance_decision_why_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "decision_event_id" uuid not null, "reason_type" text not null, "ref_id" text null, "summary" text null, "confidence" real null, "created_at" timestamptz not null, constraint "agent_governance_decision_why_links_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_decision_why_links_reason_idx" on "agent_governance_decision_why_links" ("reason_type", "ref_id");`);
    this.addSql(`create index "agent_governance_decision_why_links_scope_idx" on "agent_governance_decision_why_links" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_governance_playbooks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "policy_id" uuid null, "risk_band_id" uuid null, "trigger_type" text not null default 'manual', "schedule_cron" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "agent_governance_playbooks_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_playbooks_scope_idx" on "agent_governance_playbooks" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_playbooks" add constraint "agent_governance_playbooks_scope_name_unique" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "agent_governance_policies" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "default_mode" text not null default 'propose', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "agent_governance_policies_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_policies_scope_idx" on "agent_governance_policies" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_policies" add constraint "agent_governance_policies_scope_name_unique" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "agent_governance_precedent_index" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "decision_event_id" uuid not null, "signature" text not null, "summary" text null, "score" real not null default 0, "checksum" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_governance_precedent_index_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_precedent_index_signature_idx" on "agent_governance_precedent_index" ("signature", "score");`);
    this.addSql(`create index "agent_governance_precedent_index_scope_idx" on "agent_governance_precedent_index" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_governance_risk_bands" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "risk_level" text not null, "description" text null, "requires_approval" boolean not null default false, "fail_closed" boolean not null default false, "is_default" boolean not null default false, "min_score" int not null default 0, "max_score" int not null default 100, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "agent_governance_risk_bands_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_risk_bands_scope_idx" on "agent_governance_risk_bands" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_risk_bands" add constraint "agent_governance_risk_bands_scope_name_unique" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "agent_governance_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "playbook_id" uuid null, "policy_id" uuid null, "risk_band_id" uuid null, "status" text not null default 'queued', "autonomy_mode" text not null default 'propose', "action_type" text not null, "target_entity" text not null, "target_id" text null, "input_context" jsonb null, "output_summary" text null, "idempotency_key" text null, "pause_reason" text null, "started_at" timestamptz null, "completed_at" timestamptz null, "failed_at" timestamptz null, "terminated_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_governance_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_runs_status_idx" on "agent_governance_runs" ("status", "created_at");`);
    this.addSql(`create index "agent_governance_runs_scope_idx" on "agent_governance_runs" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_runs" add constraint "agent_governance_runs_scope_idempotency_key_unique" unique ("tenant_id", "organization_id", "idempotency_key");`);

    this.addSql(`create table "agent_governance_approval_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "decision_event_id" uuid null, "status" text not null default 'pending', "requested_by_user_id" uuid null, "reviewer_user_id" uuid null, "reason" text null, "review_comment" text null, "resolution_idempotency_key" text null, "requested_at" timestamptz not null, "reviewed_at" timestamptz null, "expires_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_governance_approval_tasks_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_approval_tasks_status_idx" on "agent_governance_approval_tasks" ("status", "created_at");`);
    this.addSql(`create index "agent_governance_approval_tasks_scope_idx" on "agent_governance_approval_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_approval_tasks" add constraint "agent_governance_approval_tasks_scope_resolution_idempotency_unique" unique ("tenant_id", "organization_id", "resolution_idempotency_key");`);

    this.addSql(`create table "agent_governance_run_steps" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "sequence_no" int not null, "action_type" text not null, "tool_name" text null, "is_irreversible" boolean not null default false, "status" text not null default 'pending', "input_json" jsonb null, "output_json" jsonb null, "error_code" text null, "started_at" timestamptz null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_governance_run_steps_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_run_steps_run_idx" on "agent_governance_run_steps" ("run_id", "sequence_no");`);
    this.addSql(`create index "agent_governance_run_steps_scope_idx" on "agent_governance_run_steps" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_run_steps" add constraint "agent_governance_run_steps_run_seq_unique" unique ("run_id", "sequence_no");`);

    this.addSql(`create table "agent_governance_skills" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "status" text not null default 'draft', "framework_json" jsonb null, "source_type" text not null default 'hybrid', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "agent_governance_skills_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_skills_scope_idx" on "agent_governance_skills" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_skills" add constraint "agent_governance_skills_scope_name_unique" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "agent_governance_skill_versions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "skill_id" uuid not null, "version_no" int not null, "diff_json" jsonb null, "validation_report_json" jsonb null, "promoted_by_user_id" uuid null, "promotion_idempotency_key" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "agent_governance_skill_versions_pkey" primary key ("id"));`);
    this.addSql(`create index "agent_governance_skill_versions_skill_idx" on "agent_governance_skill_versions" ("skill_id", "version_no");`);
    this.addSql(`create index "agent_governance_skill_versions_scope_idx" on "agent_governance_skill_versions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_governance_skill_versions" add constraint "agent_governance_skill_versions_scope_promotion_idempotency_unique" unique ("tenant_id", "organization_id", "promotion_idempotency_key");`);
    this.addSql(`alter table "agent_governance_skill_versions" add constraint "agent_governance_skill_versions_skill_version_unique" unique ("skill_id", "version_no");`);

    this.addSql(`alter table "agent_governance_decision_entity_links" add constraint "agent_governance_decision_entity_links_decision__4230b_foreign" foreign key ("decision_event_id") references "agent_governance_decision_events" ("id") on update cascade;`);

    this.addSql(`alter table "agent_governance_decision_why_links" add constraint "agent_governance_decision_why_links_decision_event_id_foreign" foreign key ("decision_event_id") references "agent_governance_decision_events" ("id") on update cascade;`);

    this.addSql(`alter table "agent_governance_approval_tasks" add constraint "agent_governance_approval_tasks_run_id_foreign" foreign key ("run_id") references "agent_governance_runs" ("id") on update cascade;`);

    this.addSql(`alter table "agent_governance_run_steps" add constraint "agent_governance_run_steps_run_id_foreign" foreign key ("run_id") references "agent_governance_runs" ("id") on update cascade;`);

    this.addSql(`alter table "agent_governance_skill_versions" add constraint "agent_governance_skill_versions_skill_id_foreign" foreign key ("skill_id") references "agent_governance_skills" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "agent_governance_decision_entity_links" drop constraint "agent_governance_decision_entity_links_decision__4230b_foreign";`);

    this.addSql(`alter table "agent_governance_decision_why_links" drop constraint "agent_governance_decision_why_links_decision_event_id_foreign";`);

    this.addSql(`alter table "agent_governance_approval_tasks" drop constraint "agent_governance_approval_tasks_run_id_foreign";`);

    this.addSql(`alter table "agent_governance_run_steps" drop constraint "agent_governance_run_steps_run_id_foreign";`);

    this.addSql(`alter table "agent_governance_skill_versions" drop constraint "agent_governance_skill_versions_skill_id_foreign";`);
  }

}
