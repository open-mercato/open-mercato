import { Migration } from '@mikro-orm/migrations';

// Change simulator tables (spec 2026-10-08-insights-change-simulator). They are created empty in
// this same transaction, so their indexes are built inline (no writer can be blocked yet).
export class Migration20261010130000_insights extends Migration {

  override name = 'Migration20261010130000';

  override up(): void | Promise<void> {
    this.addSql(`create table "insights_simulation_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "kind" text not null, "status" text not null default 'queued', "progress_job_id" uuid null, "requested_by_user_id" uuid not null, "input_json" jsonb not null, "inputs_hash" text not null, "artifact_kind" text not null, "artifact_id" text null, "artifact_version_json" jsonb null, "proposal_fingerprint" text not null, "window_from" timestamptz not null, "window_to" timestamptz not null, "budgets_json" jsonb not null, "fidelity" text null, "coverage_json" jsonb null, "result_json" jsonb null, "caveats" jsonb not null default '[]', "engine_version" int not null, "contribution_version" int not null, "error_code" text null, "created_at" timestamptz not null, "started_at" timestamptz null, "completed_at" timestamptz null, "expires_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "insights_simulation_runs_requester_idx" on "insights_simulation_runs" ("tenant_id", "organization_id", "requested_by_user_id", "created_at" desc);`);
    this.addSql(`create index "insights_simulation_runs_expires_idx" on "insights_simulation_runs" ("expires_at");`);
    this.addSql(`create index "insights_simulation_runs_active_idx" on "insights_simulation_runs" ("tenant_id", "requested_by_user_id") where "status" in ('queued', 'running');`);
    this.addSql(`create unique index "insights_simulation_runs_dedupe_unique" on "insights_simulation_runs" ("tenant_id", "organization_id", "kind", "inputs_hash") where "status" in ('queued', 'running', 'completed');`);

    this.addSql(`create table "insights_simulation_decisions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "decision" text not null, "decided_by_user_id" text not null, "artifact_kind" text not null, "artifact_id" text null, "artifact_updated_at_after" timestamptz null, "verified" boolean null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "insights_simulation_decisions_decider_idx" on "insights_simulation_decisions" ("tenant_id", "decided_by_user_id");`);
    this.addSql(`create index "insights_simulation_decisions_created_idx" on "insights_simulation_decisions" ("created_at");`);
    this.addSql(`alter table "insights_simulation_decisions" add constraint "insights_simulation_decisions_run_decision_unique" unique ("run_id", "decision");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "insights_simulation_decisions" cascade;`);
    this.addSql(`drop table if exists "insights_simulation_runs" cascade;`);
  }

}
