import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 3 of the triggered process model (`.ai/specs/enterprise/agent-orchestrator/
 * 2026-08-11-triggered-process-model.md` §Milestones): the authored, ordered
 * business stages of a process.
 *
 * A third file rather than an edit of the committed `Migration20260811150000`
 * (the squash) or `…160000` (the trigger collapse) — both have shipped and are
 * untouched.
 *
 * Purely additive: one nullable jsonb column defaulting to `'[]'`, matching the
 * `triggers` column added by the previous phase. Existing definitions come out
 * with an empty milestone list, which renders exactly the pre-Phase-3 stage
 * stepper. There is nothing to backfill — milestones are authored, never
 * derived from a step graph.
 *
 * Per the root rules this PR ships the migration plus the regenerated snapshot
 * and never runs `db:migrate`.
 */
export class Migration20260811170000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_process_definitions" add "milestones" jsonb null default '[]';`)
    this.addSql(`update "agent_process_definitions" set "milestones" = '[]'::jsonb where "milestones" is null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_process_definitions" drop column "milestones";`)
  }

}
