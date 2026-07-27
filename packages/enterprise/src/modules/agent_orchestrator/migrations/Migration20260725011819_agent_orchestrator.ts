import { Migration } from '@mikro-orm/migrations';

/**
 * Golden input-match eval plane (spec 2026-07-25-continuous-online-eval-and-golden-match):
 * - `agent_eval_cases.input_key` — canonical-hash match key for a golden case's input.
 * - `agent_eval_results.matched_eval_case_id` — links an online verdict to the golden
 *   case it was scored against (online golden-match plane).
 * - `agent_runs.golden_case_id` / `golden_passed` — the matched golden + its gate verdict.
 */
export class Migration20260725011819_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_eval_cases" add "input_key" varchar(64) null;`);
    this.addSql(`create index "agent_eval_cases_agent_input_key_idx" on "agent_eval_cases" ("organization_id", "agent_definition_id", "input_key");`);

    this.addSql(`alter table "agent_eval_results" add "matched_eval_case_id" uuid null;`);
    this.addSql(`create index "agent_eval_results_matched_case_idx" on "agent_eval_results" ("matched_eval_case_id");`);

    this.addSql(`alter table "agent_runs" add "golden_case_id" uuid null, add "golden_passed" boolean null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "agent_eval_cases_agent_input_key_idx";`);
    this.addSql(`alter table "agent_eval_cases" drop column "input_key";`);

    this.addSql(`drop index "agent_eval_results_matched_case_idx";`);
    this.addSql(`alter table "agent_eval_results" drop column "matched_eval_case_id";`);

    this.addSql(`alter table "agent_runs" drop column "golden_case_id", drop column "golden_passed";`);
  }

}
