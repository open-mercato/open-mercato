import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 4 of the triggered process model (`.ai/specs/enterprise/agent-orchestrator/
 * 2026-08-11-triggered-process-model.md` §Outcome): what a completed run
 * PRODUCED.
 *
 * A fourth file rather than an edit of the committed `Migration20260811150000`
 * (the squash), `…160000` (the trigger collapse) or `…170000` (milestones) —
 * all three have shipped and are untouched.
 *
 * Purely additive and nothing to backfill: the outcome is OPTIONAL BY DECISION
 * (a research or monitoring process produces nothing), so every existing run
 * legitimately carries none and the three columns stay null. Deriving one for
 * historical rows would be inventing a fact.
 *
 * FK-id + snapshot per `packages/core/AGENTS.md` § Cross-Module Coupling — the
 * label is a snapshot, there is deliberately no foreign key and no relation to
 * whatever module owns the produced record.
 *
 * Per the root rules this PR ships the migration plus the regenerated snapshot
 * and never runs `db:migrate`.
 */
export class Migration20260811180000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_process_runs" add "outcome_type" varchar(150) null, add "outcome_id" varchar(200) null, add "outcome_label" varchar(200) null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_process_runs" drop column "outcome_type", drop column "outcome_id", drop column "outcome_label";`)
  }

}
