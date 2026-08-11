import { Migration } from '@mikro-orm/migrations'

/**
 * Agent taxonomy (spec `.ai/specs/enterprise/agent-orchestrator/2026-08-11-agent-taxonomy.md`,
 * Phase 3): the declared agent type, and the `informative` → `researcher` rename.
 *
 * 1. `agent_runs.agent_type` — the AUTHORING fact stamped on the run record. Nullable:
 *    runs that predate the declaration, and agents that never make one, have none.
 * 2. `agent_runs.result_kind` values move with the union: `informative` → `researcher`,
 *    `actionable` → `proposal`.
 * 3. **The graph-edge rewrite.** `AGENT_OUTCOME_KINDS` is a PERSISTED vocabulary: an
 *    authored workflow definition stores `"outcomeKind": "informative"` on each outcome
 *    transition, and the canvas source handle it binds to is `outcome:informative`.
 *    Without this rewrite an existing canvas silently loses its route — the transition
 *    keeps claiming a kind the platform no longer defines, so `readTransitionOutcomeKind`
 *    returns null and the run falls through to the node's error directive.
 *
 *    Both the `outcomeKind` value and the `outcome:` handle id are rewritten, in
 *    definitions AND per-user drafts, because either can carry the old string. The reach
 *    into core `workflows` tables is guarded by `to_regclass` exactly as
 *    Migration20260811090000 guards its own, so an installation without the workflows
 *    module is a no-op rather than a failure.
 */
export class Migration20260811120000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" add "agent_type" varchar(20) null;`);

    this.addSql(`update "agent_runs" set "result_kind" = 'researcher' where "result_kind" = 'informative';`);
    this.addSql(`update "agent_runs" set "result_kind" = 'proposal' where "result_kind" = 'actionable';`);

    for (const table of ['workflow_definitions', 'workflow_definition_drafts']) {
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
    }

    this.addSql(`update "agent_runs" set "result_kind" = 'informative' where "result_kind" = 'researcher';`);
    this.addSql(`update "agent_runs" set "result_kind" = 'actionable' where "result_kind" = 'proposal';`);

    this.addSql(`alter table "agent_runs" drop column "agent_type";`);
  }

}
