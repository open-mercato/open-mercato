import { Migration } from '@mikro-orm/migrations';

export class Migration20260719135404_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_eval_case_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "suite_run_id" uuid not null, "eval_case_id" uuid not null, "agent_run_id" uuid null, "trial_index" int not null default 0, "status" varchar(20) not null default 'pending', "score" real null, "passed" boolean null, "latency_ms" int null, "cost_minor" int null, "error_message" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_case_runs_case_idx" on "agent_eval_case_runs" ("eval_case_id", "created_at");`);
    this.addSql(`create index "agent_eval_case_runs_suite_idx" on "agent_eval_case_runs" ("suite_run_id", "created_at");`);
    this.addSql(`create index "agent_eval_case_runs_tenant_org_idx" on "agent_eval_case_runs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "agent_eval_suite_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_definition_id" varchar(100) not null, "release_id" uuid null, "trigger" varchar(20) not null, "status" varchar(20) not null default 'queued', "outcome" varchar(12) null, "judge_may_gate" boolean not null, "repeat_count" int not null default 1, "case_count" int not null, "error_count" int not null default 0, "eval_set_version" varchar(100) null, "pass_score" real null, "score_variance" real null, "safety_regressions" jsonb null, "baseline_suite_run_id" uuid null, "summary" jsonb null, "triggered_by" varchar(100) null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_suite_runs_release_idx" on "agent_eval_suite_runs" ("release_id", "created_at");`);
    this.addSql(`create index "agent_eval_suite_runs_agent_idx" on "agent_eval_suite_runs" ("organization_id", "agent_definition_id", "created_at");`);
    this.addSql(`create index "agent_eval_suite_runs_tenant_org_idx" on "agent_eval_suite_runs" ("tenant_id", "organization_id");`);

    // Nullable: null marks an ONLINE-plane result (inline at trace ingest, where
    // there is no eval case), so every pre-existing row stays valid.
    this.addSql(`alter table "agent_eval_results" add "eval_case_run_id" uuid null;`);
    this.addSql(`create index "agent_eval_results_case_run_idx" on "agent_eval_results" ("eval_case_run_id");`);

    // Defaulted so every pre-existing proposal keeps its current meaning. `eval`
    // marks a proposal produced by a replay: a real record of what the agent
    // proposed, but never routed to the operator caseload and never disposed.
    this.addSql(`alter table "agent_proposals" add "source" varchar(20) not null default 'runtime';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "agent_eval_results_case_run_idx";`);
    this.addSql(`alter table "agent_eval_results" drop column "eval_case_run_id";`);

    this.addSql(`alter table "agent_proposals" drop column "source";`);

    // The generator omitted these: dropping only the columns would leave both new
    // tables orphaned after a rollback.
    this.addSql(`drop table if exists "agent_eval_case_runs";`);
    this.addSql(`drop table if exists "agent_eval_suite_runs";`);
  }

}
