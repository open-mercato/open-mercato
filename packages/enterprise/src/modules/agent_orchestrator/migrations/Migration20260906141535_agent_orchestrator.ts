import { Migration } from '@mikro-orm/migrations'

/**
 * Current-state schema for `agent_orchestrator` — the RE-SQUASH the
 * business-process ↔ workflow unification calls for
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md`
 * §Migration: squash, do not stack).
 *
 * It replaces the module's previous four-file chain with one create-schema
 * migration regenerated from `data/entities.ts`, and therefore carries as plain
 * create-table DDL:
 *
 *  - `agent_process_definitions` → `process_definitions`, minus `target_type`,
 *    `target_agent_id`, `execution_principal_id` and `granted_features` (a
 *    process points at a workflow, and the WORKFLOW owns execution identity),
 *    plus `outcome_schema` and `ui_metadata`;
 *  - `agent_process_runs` DROPPED. It held a second execution lifecycle beside
 *    `workflow_instances`, which is the split this change exists to remove;
 *  - `agent_processes` → `process_instances`, absorbing what only the deleted
 *    ledger carried (definition id, `triggered_by`, `idempotency_key`, `input`,
 *    source entity, outcome, failure reason) plus `milestones_reached`. Its
 *    `process_instances_idempotency_uq` is the business-execution lock: one
 *    (definition, key) can never produce two workflow instances;
 *  - `agent_runs.process_id` → `workflow_instance_id`, plus `invocation_id` and
 *    the partial-unique `agent_runs_invocation_uq` over
 *    `(workflow_instance_id, step_id, invocation_id)` — an agent invocation now
 *    has an identity instead of being guessed from creation time.
 *
 * NO DATA MIGRATION is written from `agent_process_runs`: the branch is
 * unpublished, so the table is dropped rather than converted.
 *
 * WHAT DOES NOT SQUASH AWAY: the two `to_regclass`-guarded rewrites of CORE
 * `workflows` rows carried since W2. They touch tables this module does not own
 * and does not create, so a create-table statement cannot absorb them. They are
 * carried over verbatim below, are idempotent, and are no-ops on a fresh
 * database (the `like` predicate matches nothing).
 *
 * OPERATIONAL NOTE: a database that already ran the retired chain must drop and
 * re-initialise this module's tables. Per the root rules this change ships the
 * migration plus the regenerated snapshot and never runs `db:migrate`.
 */

export class Migration20260906141535_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_context_bundles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "workflow_instance_id" uuid null, "step_id" varchar(100) null, "capability" varchar(100) not null, "routed_sources" jsonb not null, "pruned_sources" jsonb null, "sources" jsonb not null, "token_budget" int not null, "tokens_used" int not null, "redaction_applied" jsonb null, "payload_ref" varchar(500) null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_context_bundles_run_idx" on "agent_context_bundles" ("agent_run_id");`);
    this.addSql(`create index "agent_context_bundles_tenant_org_idx" on "agent_context_bundles" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_corrections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "workflow_instance_id" uuid null, "step_id" varchar(100) null, "agent_run_id" uuid null, "proposal_id" uuid not null, "corrected_by_user_id" uuid not null, "action" varchar(20) not null, "proposed_value" jsonb not null, "corrected_value" jsonb null, "reason" text not null, "eval_case_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_corrections_proposal_idx" on "agent_corrections" ("proposal_id");`);
    this.addSql(`create index "agent_corrections_run_idx" on "agent_corrections" ("agent_run_id");`);
    this.addSql(`create index "agent_corrections_tenant_org_idx" on "agent_corrections" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_delegation_grants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_principal_id" uuid not null, "agent_user_id" uuid not null, "delegator_user_id" uuid null, "scopes" jsonb not null, "expires_at" timestamptz null, "revoked_at" timestamptz null, "revoked_by_user_id" uuid null, "issuer" varchar(500) null, "subject" varchar(500) null, "audience" varchar(500) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_delegation_grants_principal_idx" on "agent_delegation_grants" ("organization_id", "agent_principal_id");`);
    this.addSql(`create index "agent_delegation_grants_tenant_org_idx" on "agent_delegation_grants" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_assertions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "key" varchar(100) not null, "scorer_key" varchar(100) not null, "title" varchar(200) not null, "description" text null, "applies_to" varchar(100) not null, "type" varchar(20) not null, "severity" varchar(20) not null, "config" jsonb null, "version" int not null default 1, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_assertions_scorer_idx" on "agent_eval_assertions" ("organization_id", "scorer_key");`);
    this.addSql(`create index "agent_eval_assertions_applies_idx" on "agent_eval_assertions" ("organization_id", "applies_to", "enabled");`);
    this.addSql(`create index "agent_eval_assertions_tenant_org_idx" on "agent_eval_assertions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_eval_assertions" add constraint "agent_eval_assertions_key_uq" unique ("organization_id", "applies_to", "key");`);

    this.addSql(`create table "agent_eval_cases" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "source_type" varchar(20) not null, "source_id" uuid not null, "agent_definition_id" varchar(100) not null, "name" varchar(200) null, "process_type" varchar(100) null, "input" jsonb not null, "input_key" varchar(64) null, "expected" jsonb null, "assertions" jsonb null, "status" varchar(20) not null default 'draft', "approved_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_cases_agent_input_key_idx" on "agent_eval_cases" ("organization_id", "agent_definition_id", "input_key");`);
    this.addSql(`create index "agent_eval_cases_agent_status_idx" on "agent_eval_cases" ("organization_id", "agent_definition_id", "status");`);
    this.addSql(`create index "agent_eval_cases_tenant_org_idx" on "agent_eval_cases" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_case_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "suite_run_id" uuid not null, "eval_case_id" uuid not null, "agent_run_id" uuid null, "trial_index" int not null default 0, "status" varchar(20) not null default 'pending', "score" real null, "passed" boolean null, "latency_ms" int null, "cost_minor" int null, "error_message" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_case_runs_case_idx" on "agent_eval_case_runs" ("eval_case_id", "created_at");`);
    this.addSql(`create index "agent_eval_case_runs_suite_idx" on "agent_eval_case_runs" ("suite_run_id", "created_at");`);
    this.addSql(`create index "agent_eval_case_runs_tenant_org_idx" on "agent_eval_case_runs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_results" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "assertion_id" uuid not null, "assertion_key" varchar(100) not null, "eval_case_run_id" uuid null, "matched_eval_case_id" uuid null, "passed" boolean null, "score" real null, "severity" varchar(20) not null, "evidence" jsonb null, "evaluated_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_results_matched_case_idx" on "agent_eval_results" ("matched_eval_case_id");`);
    this.addSql(`create index "agent_eval_results_case_run_idx" on "agent_eval_results" ("eval_case_run_id");`);
    this.addSql(`create index "agent_eval_results_assertion_idx" on "agent_eval_results" ("assertion_id");`);
    this.addSql(`create index "agent_eval_results_run_idx" on "agent_eval_results" ("agent_run_id");`);
    this.addSql(`create index "agent_eval_results_tenant_org_idx" on "agent_eval_results" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_suite_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_definition_id" varchar(100) not null, "release_id" uuid null, "trigger" varchar(20) not null, "status" varchar(20) not null default 'queued', "outcome" varchar(12) null, "judge_may_gate" boolean not null, "repeat_count" int not null default 1, "case_count" int not null, "error_count" int not null default 0, "eval_set_version" varchar(100) null, "pass_score" real null, "score_variance" real null, "safety_regressions" jsonb null, "baseline_suite_run_id" uuid null, "summary" jsonb null, "triggered_by" varchar(100) null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_suite_runs_release_idx" on "agent_eval_suite_runs" ("release_id", "created_at");`);
    this.addSql(`create index "agent_eval_suite_runs_agent_idx" on "agent_eval_suite_runs" ("organization_id", "agent_definition_id", "created_at");`);
    this.addSql(`create index "agent_eval_suite_runs_tenant_org_idx" on "agent_eval_suite_runs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_guardrail_checks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "proposal_id" uuid null, "guardrail_set_version" varchar(64) not null, "capability" varchar(100) not null, "phase" varchar(10) not null, "kind" varchar(30) not null, "result" varchar(10) not null default 'pass', "evidence" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_guardrail_checks_proposal_idx" on "agent_guardrail_checks" ("proposal_id");`);
    this.addSql(`create index "agent_guardrail_checks_run_idx" on "agent_guardrail_checks" ("agent_run_id", "created_at");`);
    this.addSql(`create index "agent_guardrail_checks_tenant_org_idx" on "agent_guardrail_checks" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_guardrail_sets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "capability" varchar(100) not null, "version" varchar(64) not null, "body" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_guardrail_sets_capability_idx" on "agent_guardrail_sets" ("organization_id", "capability");`);
    this.addSql(`create index "agent_guardrail_sets_tenant_org_idx" on "agent_guardrail_sets" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_guardrail_sets" add constraint "agent_guardrail_sets_version_uq" unique ("organization_id", "capability", "version");`);

    this.addSql(`create table "agent_metric_rollups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "window_start" timestamptz not null, "window_end" timestamptz not null, "computed_at" timestamptz not null, "metrics" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_metric_rollups_lookup_idx" on "agent_metric_rollups" ("organization_id", "agent_id", "window_start");`);
    this.addSql(`create index "agent_metric_rollups_tenant_org_idx" on "agent_metric_rollups" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_principals" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "agent_definition_id" varchar(100) not null, "role_id" uuid not null, "credential_mode" varchar(20) not null default 'internal', "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "agent_principals_org_agent_uq" on "agent_principals" ("organization_id", "agent_definition_id") where "deleted_at" is null;`);
    this.addSql(`create index "agent_principals_user_idx" on "agent_principals" ("user_id");`);
    this.addSql(`create index "agent_principals_tenant_org_idx" on "agent_principals" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_proposals" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "run_id" uuid not null, "workflow_instance_id" uuid null, "step_id" varchar(100) null, "user_task_id" uuid null, "payload" jsonb not null, "confidence" real null, "guard_results" jsonb null, "source" varchar(20) not null default 'runtime', "disposition" varchar(20) not null default 'pending', "disposition_by" varchar(100) null, "disposition_reason" text null, "selected_option_id" varchar(100) null, "auto_disposition_block" varchar(20) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_proposals_org_disposition_created_idx" on "agent_proposals" ("organization_id", "disposition", "created_at");`);
    this.addSql(`create index "agent_proposals_run_idx" on "agent_proposals" ("organization_id", "run_id");`);
    this.addSql(`create index "agent_proposals_tenant_org_idx" on "agent_proposals" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "source" varchar(20) not null default 'runtime', "parent_run_id" uuid null, "workflow_instance_id" uuid null, "step_id" varchar(100) null, "invocation_id" varchar(100) null, "proposal_id" uuid null, "agent_version" varchar(50) null, "model" varchar(100) null, "runtime" varchar(50) null, "external_run_id" varchar(200) null, "confidence" real null, "input_tokens" int null, "output_tokens" int null, "cost_minor" bigint null, "currency" varchar(3) null, "latency_ms" int null, "eval_score" real null, "eval_passed" boolean null, "golden_case_id" uuid null, "golden_passed" boolean null, "context_routing" jsonb null, "output_artifact_key" varchar(500) null, "human_confirmed_at" timestamptz null, "flagged_at" timestamptz null, "flagged_by" uuid null, "rerun_of_run_id" uuid null, "status" varchar(20) not null default 'running', "completed_at" timestamptz null, "input" jsonb not null, "output" jsonb null, "result_kind" varchar(20) null, "agent_type" varchar(20) null, "error_message" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "agent_runs_invocation_uq" on "agent_runs" ("workflow_instance_id", "step_id", "invocation_id") where "workflow_instance_id" is not null and "step_id" is not null and "invocation_id" is not null;`);
    this.addSql(`create index "agent_runs_eval_failed_idx" on "agent_runs" ("organization_id", "created_at") where "eval_passed" = false;`);
    this.addSql(`create index "agent_runs_org_status_created_idx" on "agent_runs" ("organization_id", "status", "created_at");`);
    this.addSql(`create index "agent_runs_agent_def_idx" on "agent_runs" ("agent_id", "created_at");`);
    this.addSql(`create index "agent_runs_agent_idx" on "agent_runs" ("organization_id", "agent_id");`);
    this.addSql(`create index "agent_runs_tenant_org_idx" on "agent_runs" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_runs" add constraint "agent_runs_runtime_external_uq" unique ("runtime", "external_run_id");`);

    this.addSql(`create table "agent_run_artifacts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "file_name" varchar(255) not null, "mime_type" varchar(150) not null, "file_size" int not null, "sha256" varchar(64) not null, "storage_key" varchar(500) not null, "caption" text null, "source" varchar(20) not null default 'agent_output', "promoted_attachment_id" uuid null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_run_artifacts_run_idx" on "agent_run_artifacts" ("organization_id", "run_id");`);
    this.addSql(`create index "agent_run_artifacts_tenant_org_idx" on "agent_run_artifacts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_run_artifacts" add constraint "agent_run_artifacts_run_sha_uq" unique ("run_id", "sha256", "file_name");`);

    this.addSql(`create table "agent_run_sessions" ("id" uuid not null default gen_random_uuid(), "session_token" varchar(100) not null, "agent_id" varchar(100) not null, "run_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "outcome" jsonb null, "status" varchar(20) not null default 'pending', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "agent_run_sessions" add constraint "agent_run_sessions_session_token_unique" unique ("session_token");`);
    this.addSql(`create index "agent_run_sessions_token_idx" on "agent_run_sessions" ("session_token");`);

    this.addSql(`create table "agent_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "icon" varchar(64) null, "tags" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_settings_tenant_org_idx" on "agent_settings" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_settings" add constraint "agent_settings_org_agent_uq" unique ("tenant_id", "organization_id", "agent_id");`);

    this.addSql(`create table "agent_spans" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "external_span_id" varchar(200) not null, "parent_span_id" uuid null, "sequence" int not null, "name" varchar(200) not null, "kind" varchar(20) not null, "started_at" timestamptz not null, "ended_at" timestamptz null, "duration_ms" int null, "status" varchar(20) not null default 'ok', "attributes" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_spans_run_idx" on "agent_spans" ("agent_run_id", "sequence");`);
    this.addSql(`create index "agent_spans_tenant_org_idx" on "agent_spans" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_spans" add constraint "agent_spans_run_external_uq" unique ("agent_run_id", "external_span_id");`);

    this.addSql(`create table "agent_tool_calls" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "span_id" uuid not null, "agent_run_id" uuid not null, "tool_name" varchar(200) not null, "request_summary" jsonb null, "response_summary" jsonb null, "request_artifact_key" varchar(500) null, "response_artifact_key" varchar(500) null, "status" varchar(20) not null default 'ok', "latency_ms" int null, "error_message" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_tool_calls_run_idx" on "agent_tool_calls" ("agent_run_id");`);
    this.addSql(`create index "agent_tool_calls_span_idx" on "agent_tool_calls" ("span_id");`);
    this.addSql(`create index "agent_tool_calls_tenant_org_idx" on "agent_tool_calls" ("tenant_id", "organization_id");`);

    this.addSql(`create table "process_definitions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" varchar(255) not null, "description" text null, "workflow_id" varchar(150) not null, "input_defaults" jsonb null, "input_schema" jsonb null, "outcome_schema" jsonb null, "triggers" jsonb null default '[]', "milestones" jsonb null default '[]', "ui_metadata" jsonb null, "enabled" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "process_definitions_triggers_gin" on "process_definitions" using gin ("triggers" jsonb_path_ops);`);
    this.addSql(`create index "process_definitions_workflow_idx" on "process_definitions" ("organization_id", "workflow_id");`);
    this.addSql(`create index "process_definitions_tenant_org_idx" on "process_definitions" ("tenant_id", "organization_id");`);

    this.addSql(`create table "process_instances" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "workflow_instance_id" uuid null, "process_definition_id" uuid null, "workflow_id" varchar(200) null, "workflow_version" varchar(50) null, "triggered_by" jsonb null, "idempotency_key" varchar(200) null, "input" jsonb null, "source_entity_type" varchar(100) null, "source_entity_id" uuid null, "subject_type" varchar(100) null, "subject_id" varchar(200) null, "subject_label" varchar(200) null, "subject_title" varchar(300) null, "subject_value_minor" bigint null, "subject_fraud" boolean null, "subject_facets" jsonb null, "status" varchar(30) not null default 'running', "current_stage" varchar(100) null, "milestones_reached" jsonb null default '[]', "agent_ids" jsonb null, "cost_minor" bigint null, "currency" varchar(3) null, "run_count" int not null default 0, "pending_proposal_count" int not null default 0, "outcome_type" varchar(150) null, "outcome_id" varchar(200) null, "outcome_label" varchar(200) null, "failure_reason" text null, "assignee_user_id" uuid null, "team_id" uuid null, "waiting_since" timestamptz null, "opened_at" timestamptz not null, "completed_at" timestamptz null, "last_activity_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "process_instances_idempotency_uq" on "process_instances" ("organization_id", "process_definition_id", "idempotency_key") where "idempotency_key" is not null;`);
    this.addSql(`create unique index "process_instances_workflow_instance_uq" on "process_instances" ("tenant_id", "organization_id", "workflow_instance_id") where "deleted_at" is null and "workflow_instance_id" is not null;`);
    this.addSql(`create index "process_instances_source_idx" on "process_instances" ("source_entity_type", "source_entity_id");`);
    this.addSql(`create index "process_instances_definition_idx" on "process_instances" ("process_definition_id", "created_at");`);
    this.addSql(`create index "process_instances_value_idx" on "process_instances" ("organization_id", "subject_value_minor");`);
    this.addSql(`create index "process_instances_status_idx" on "process_instances" ("organization_id", "status", "last_activity_at");`);
    this.addSql(`create index "process_instances_tenant_org_idx" on "process_instances" ("tenant_id", "organization_id");`);

    // ── Carried over from Migration20260811090000 (W2) ────────────────────────
    // Persisted author-written INVOKE_AGENT `outputMapping` dot-paths follow the
    // proposal envelope: `proposalPayload.actions[0]` moved under
    // `proposalPayload.options[0].actions`. The leading quote anchors the match
    // to the START of a JSON string value, so a key or a longer path that merely
    // CONTAINS the substring is left alone.
    //
    // ── Carried over from Migration20260811120000 (W2) ────────────────────────
    // `AGENT_OUTCOME_KINDS` is a PERSISTED vocabulary: an authored definition
    // stores `"outcomeKind": "informative"` on each outcome transition and binds
    // to an `outcome:informative` canvas handle. Without the rewrite an existing
    // canvas silently loses its route.
    //
    // Both reach core `workflows` tables from an enterprise migration, guarded by
    // `to_regclass` so an installation without the workflows module is a no-op.
    for (const table of ['workflow_definitions', 'workflow_definition_drafts']) {
      this.addSql(`
        do $$
        begin
          if to_regclass('public.${table}') is not null then
            update "${table}"
            set "definition" = replace(
              "definition"::text,
              '"proposalPayload.actions',
              '"proposalPayload.options[0].actions'
            )::jsonb
            where "definition"::text like '%"proposalPayload.actions%';
          end if;
        end $$;
      `);
      this.addSql(`
        do $$
        begin
          if to_regclass('public.${table}') is not null then
            update "${table}"
            set "definition" = replace(
              replace(
                "definition"::text,
                '"outcomeKind": "informative"',
                '"outcomeKind": "researcher"'
              ),
              '"outcome:informative"',
              '"outcome:researcher"'
            )::jsonb
            where "definition"::text like '%informative%';
          end if;
        end $$;
      `);
    }
  }


  /**
   * The inverse, in the only two parts that HAVE an inverse.
   *
   * The module's own tables are dropped wholesale, so their value rewrites need
   * no undoing — the rows go with them. The two rewrites of CORE `workflows`
   * rows do need undoing: those tables outlive this migration, and leaving a
   * vocabulary this module introduced behind in another module's data is exactly
   * the mess a `down()` exists to prevent. Both are `to_regclass`-guarded and
   * idempotent, like their forward halves.
   */
  override down(): void | Promise<void> {
    for (const table of ['workflow_definitions', 'workflow_definition_drafts']) {
      this.addSql(`
        do $$
        begin
          if to_regclass('public.${table}') is not null then
            update "${table}"
            set "definition" = replace(
              replace(
                "definition"::text,
                '"outcomeKind": "researcher"',
                '"outcomeKind": "informative"'
              ),
              '"outcome:researcher"',
              '"outcome:informative"'
            )::jsonb
            where "definition"::text like '%researcher%';
          end if;
        end $$;
      `);
      this.addSql(`
        do $$
        begin
          if to_regclass('public.${table}') is not null then
            update "${table}"
            set "definition" = replace(
              "definition"::text,
              '"proposalPayload.options[0].actions',
              '"proposalPayload.actions'
            )::jsonb
            where "definition"::text like '%"proposalPayload.options[0].actions%';
          end if;
        end $$;
      `);
    }

    this.addSql(`drop table if exists "agent_context_bundles" cascade;`);
    this.addSql(`drop table if exists "agent_corrections" cascade;`);
    this.addSql(`drop table if exists "agent_delegation_grants" cascade;`);
    this.addSql(`drop table if exists "agent_eval_assertions" cascade;`);
    this.addSql(`drop table if exists "agent_eval_case_runs" cascade;`);
    this.addSql(`drop table if exists "agent_eval_cases" cascade;`);
    this.addSql(`drop table if exists "agent_eval_results" cascade;`);
    this.addSql(`drop table if exists "agent_eval_suite_runs" cascade;`);
    this.addSql(`drop table if exists "agent_guardrail_checks" cascade;`);
    this.addSql(`drop table if exists "agent_guardrail_sets" cascade;`);
    this.addSql(`drop table if exists "agent_metric_rollups" cascade;`);
    this.addSql(`drop table if exists "agent_principals" cascade;`);
    this.addSql(`drop table if exists "agent_proposals" cascade;`);
    this.addSql(`drop table if exists "agent_run_artifacts" cascade;`);
    this.addSql(`drop table if exists "agent_run_sessions" cascade;`);
    this.addSql(`drop table if exists "agent_runs" cascade;`);
    this.addSql(`drop table if exists "agent_settings" cascade;`);
    this.addSql(`drop table if exists "agent_spans" cascade;`);
    this.addSql(`drop table if exists "agent_tool_calls" cascade;`);
    this.addSql(`drop table if exists "process_definitions" cascade;`);
    this.addSql(`drop table if exists "process_instances" cascade;`);
  }

}
