import { Migration } from '@mikro-orm/migrations';

export class Migration20260623072052_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_spans" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "external_span_id" varchar(200) not null, "parent_span_id" uuid null, "sequence" int not null, "name" varchar(200) not null, "kind" varchar(20) not null, "started_at" timestamptz not null, "ended_at" timestamptz null, "duration_ms" int null, "status" varchar(20) not null default 'ok', "attributes" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_spans_run_idx" on "agent_spans" ("agent_run_id", "sequence");`);
    this.addSql(`create index "agent_spans_tenant_org_idx" on "agent_spans" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_spans" add constraint "agent_spans_run_external_uq" unique ("agent_run_id", "external_span_id");`);

    this.addSql(`create table "agent_tool_calls" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "span_id" uuid not null, "agent_run_id" uuid not null, "tool_name" varchar(200) not null, "request_summary" jsonb null, "response_summary" jsonb null, "request_artifact_key" varchar(500) null, "response_artifact_key" varchar(500) null, "status" varchar(20) not null default 'ok', "latency_ms" int null, "error_message" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_tool_calls_run_idx" on "agent_tool_calls" ("agent_run_id");`);
    this.addSql(`create index "agent_tool_calls_span_idx" on "agent_tool_calls" ("span_id");`);
    this.addSql(`create index "agent_tool_calls_tenant_org_idx" on "agent_tool_calls" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "agent_runs" add "process_id" uuid null, add "step_id" varchar(100) null, add "proposal_id" uuid null, add "agent_version" varchar(50) null, add "model" varchar(100) null, add "runtime" varchar(50) null, add "external_run_id" varchar(200) null, add "confidence" real null, add "input_tokens" int null, add "output_tokens" int null, add "cost_minor" bigint null, add "currency" varchar(3) null, add "latency_ms" int null, add "eval_score" real null, add "eval_passed" boolean null, add "context_routing" jsonb null, add "output_artifact_key" varchar(500) null, add "human_confirmed_at" timestamptz null, add "deleted_at" timestamptz null;`);
    this.addSql(`create index "agent_runs_agent_def_idx" on "agent_runs" ("agent_id", "created_at");`);
    this.addSql(`alter table "agent_runs" add constraint "agent_runs_runtime_external_uq" unique ("runtime", "external_run_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "agent_runs_agent_def_idx";`);
    this.addSql(`alter table "agent_runs" drop constraint if exists "agent_runs_runtime_external_uq";`);
    this.addSql(`alter table "agent_runs" drop column "process_id", drop column "step_id", drop column "proposal_id", drop column "agent_version", drop column "model", drop column "runtime", drop column "external_run_id", drop column "confidence", drop column "input_tokens", drop column "output_tokens", drop column "cost_minor", drop column "currency", drop column "latency_ms", drop column "eval_score", drop column "eval_passed", drop column "context_routing", drop column "output_artifact_key", drop column "human_confirmed_at", drop column "deleted_at";`);
  }

}
