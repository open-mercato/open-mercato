import { Migration } from '@mikro-orm/migrations'

/**
 * External agent invocation, phase 2 (`.ai/specs/enterprise/agent-orchestrator/
 * next/2026-08-12-external-agent-invocation-analysis.md` §5.5): the durable
 * correlation between a SUSPENDED agent run and the external provider that will
 * answer it minutes later.
 *
 * A fifth file rather than an edit of the committed `Migration20260811150000`
 * (the squash), `…160000` (the trigger collapse), `…170000` (milestones) or
 * `…180000` (run outcomes) — all four have shipped and are untouched.
 *
 * Purely additive: one new table, nothing to backfill. No existing run was ever
 * suspended, so there is no historical row this correlation could describe.
 *
 * Three constraints carry the design's safety properties:
 *  - `agent_external_runs_token_uq` — the callback token is SINGLE USE, and the
 *    column stores a SHA-256 hex digest only. The plaintext token goes to the
 *    provider and is never persisted, so a database read cannot forge a callback
 *    (§7 risk R3).
 *  - `agent_external_runs_deadline_idx` — the sweep that stops risk R2 probes
 *    (`organization_id`, `status`, `expires_at`); a call nobody answers must never
 *    leave a workflow parked forever.
 *  - `agent_external_runs_connector_external_uq` — a provider run id is unique
 *    within the provider ACCOUNT, not globally, so idempotency is scoped by org +
 *    connector. `external_run_id` is nullable until the provider answers, and
 *    Postgres treats NULLs as distinct, so this behaves as a partial unique
 *    without needing an expression index.
 *
 * Per the root rules this PR ships the migration plus the regenerated snapshot
 * and never runs `db:migrate`.
 */
export class Migration20260812100000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_external_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "agent_id" varchar(100) not null, "connector_id" varchar(100) not null, "callback_token_hash" varchar(64) not null, "external_run_id" varchar(200) null, "process_id" uuid null, "step_id" varchar(100) null, "signal_name" varchar(150) null, "status" varchar(20) not null default 'pending', "expires_at" timestamptz not null, "request_payload" jsonb null, "result_payload" jsonb null, "failure_reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`)
    this.addSql(`create index "agent_external_runs_deadline_idx" on "agent_external_runs" ("organization_id", "status", "expires_at");`)
    this.addSql(`create index "agent_external_runs_run_idx" on "agent_external_runs" ("run_id");`)
    this.addSql(`create index "agent_external_runs_tenant_org_idx" on "agent_external_runs" ("tenant_id", "organization_id");`)
    this.addSql(`alter table "agent_external_runs" add constraint "agent_external_runs_connector_external_uq" unique ("organization_id", "connector_id", "external_run_id");`)
    this.addSql(`alter table "agent_external_runs" add constraint "agent_external_runs_token_uq" unique ("callback_token_hash");`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_external_runs" cascade;`)
  }

}
