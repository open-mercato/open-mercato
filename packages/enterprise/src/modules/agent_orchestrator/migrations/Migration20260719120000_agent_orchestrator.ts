import { Migration } from '@mikro-orm/migrations';

/**
 * Eval registry, phase 1 (spec 2026-07-19-agent-eval-workbench-and-gate).
 *
 * 1. `agent_eval_assertions.scorer_key` — splits the overloaded `key`, which had to
 *    serve as BOTH "which scorer runs" and "which assertion this is". Because
 *    `agent_eval_assertions_key_uq` allows one row per (org, appliesTo, key), the
 *    overload capped the catalog at one assertion per scorer per agent. The unique
 *    index is deliberately left untouched: `key` keeps its slug role.
 *
 *    Added nullable → backfilled → SET NOT NULL so it is safe on a populated table.
 *    The backfill `COALESCE(config->>'scorer', key)` is exactly the resolution rule
 *    the runtime already applied (`evalRuntimeService` read `config.scorer` first,
 *    then the key), so every existing row keeps its current behaviour.
 *
 * 2. `agent_eval_results.passed` becomes nullable — `null` means SKIPPED (no
 *    expected value, invalid config, unknown scorer). A skipped assertion is
 *    excluded from both score and pass aggregation; before this it had no
 *    representation and would have had to masquerade as a failure.
 */
export class Migration20260719120000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_eval_assertions" add column "scorer_key" varchar(100) null;`);
    // An `llm_judge` row's `key` was NEVER a scorer name — the seeded example is
    // `llm_judge_helpfulness` — because judge assertions were dispatched off the
    // `type` column, not by key lookup. Backfilling `key` verbatim would leave
    // those rows pointing at a scorer that does not exist, and the new write-time
    // validation would then 422 on something as innocent as the enable toggle.
    // The `type` column is the exact, general answer for them.
    this.addSql(`update "agent_eval_assertions"
      set "scorer_key" = case
        when "type" = 'llm_judge' then 'llm_judge'
        else coalesce("config"->>'scorer', "key")
      end
      where "scorer_key" is null;`);
    this.addSql(`alter table "agent_eval_assertions" alter column "scorer_key" set not null;`);
    this.addSql(`create index "agent_eval_assertions_scorer_idx" on "agent_eval_assertions" ("organization_id", "scorer_key");`);

    this.addSql(`alter table "agent_eval_results" alter column "passed" drop not null;`);
  }

  override down(): void | Promise<void> {
    // Rows written after the up-migration may legitimately hold `passed = null`;
    // they cannot be represented once the column is NOT NULL again. Drop them
    // rather than silently recording a skip as a failure.
    this.addSql(`delete from "agent_eval_results" where "passed" is null;`);
    this.addSql(`alter table "agent_eval_results" alter column "passed" set not null;`);

    this.addSql(`drop index if exists "agent_eval_assertions_scorer_idx";`);
    this.addSql(`alter table "agent_eval_assertions" drop column "scorer_key";`);
  }

}
