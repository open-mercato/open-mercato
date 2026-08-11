import { Migration } from '@mikro-orm/migrations'

/**
 * The proposal envelope becomes N ranked options (spec
 * `.ai/specs/enterprise/agent-orchestrator/2026-08-11-agent-taxonomy.md`, Phase 1).
 *
 * Three moves, in one migration because they are one wire change:
 *
 * 1. `selected_option_id` — which option a disposition chose — and
 *    `auto_disposition_block` — why an auto-approval that cleared its threshold was
 *    still held for a human. The latter is its OWN column: `disposition_reason` is
 *    the operator's text and overloading it would corrupt the override signal evals
 *    read.
 * 2. Backfill `payload` from `{ actions, confidence, rationale }` to
 *    `{ options: [{ id: 'primary', label, actions, confidence }], rationale }`.
 *    A stored proposal whose `actions` is `[]` becomes `options: []` — the
 *    "nothing proposed" case — NOT an option that would fail `actions.min(1)`.
 * 3. Rewrite persisted `INVOKE_AGENT.outputMapping` dot-paths: an author-written
 *    `proposalPayload.actions[0].payload.x` resolves to `undefined` the moment
 *    `actions` moves under `options`, which is the cost this spec refuses to
 *    assume away. The rewrite matches the single-implicit-option backfill exactly.
 *
 * Step 3 reaches a core `workflows` table from an enterprise migration, which is
 * unavoidable: the paths were written against THIS module's envelope and only this
 * change invalidates them. It is guarded by `to_regclass` so an installation without
 * the workflows module is a no-op rather than a failure.
 */
export class Migration20260811090000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_proposals" add "selected_option_id" varchar(100) null;`);
    this.addSql(`alter table "agent_proposals" add "auto_disposition_block" varchar(20) null;`);

    // Backfill: one implicit option per proposal that actually proposed something.
    this.addSql(`
      update "agent_proposals"
      set "payload" = jsonb_strip_nulls(
        jsonb_build_object(
          'options',
          jsonb_build_array(
            jsonb_strip_nulls(
              jsonb_build_object(
                'id', 'primary',
                'label', left(coalesce("agent_id", 'Proposal'), 120),
                'actions', "payload" -> 'actions',
                'confidence', case
                  when jsonb_typeof("payload" -> 'confidence') = 'number'
                    then least(greatest(("payload" ->> 'confidence')::numeric, 0), 1)
                  else null
                end
              )
            )
          ),
          'rationale', case
            when jsonb_typeof("payload" -> 'rationale') = 'string'
              then to_jsonb(left("payload" ->> 'rationale', 2000))
            else null
          end
        )
      )
      where jsonb_typeof("payload" -> 'options') is null
        and jsonb_typeof("payload" -> 'actions') = 'array'
        and jsonb_array_length("payload" -> 'actions') > 0;
    `);

    // An empty action list was never a plan — it is the empty option set.
    this.addSql(`
      update "agent_proposals"
      set "payload" = jsonb_strip_nulls(
        jsonb_build_object(
          'options', '[]'::jsonb,
          'rationale', case
            when jsonb_typeof("payload" -> 'rationale') = 'string'
              then to_jsonb(left("payload" ->> 'rationale', 2000))
            else null
          end
        )
      )
      where jsonb_typeof("payload" -> 'options') is null
        and jsonb_typeof("payload" -> 'actions') = 'array'
        and jsonb_array_length("payload" -> 'actions') = 0;
    `);

    // Persisted author-written outputMapping dot-paths follow the payload.
    // The leading quote anchors the match to the START of a JSON string value, so a
    // key or a longer path that merely CONTAINS the substring is left alone.
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
              "definition"::text,
              '"proposalPayload.options[0].actions',
              '"proposalPayload.actions'
            )::jsonb
            where "definition"::text like '%"proposalPayload.options[0].actions%';
          end if;
        end $$;
      `);
    }

    this.addSql(`
      update "agent_proposals"
      set "payload" = jsonb_strip_nulls(
        jsonb_build_object(
          'actions', coalesce("payload" -> 'options' -> 0 -> 'actions', '[]'::jsonb),
          'confidence', "payload" -> 'options' -> 0 -> 'confidence',
          'rationale', "payload" -> 'rationale'
        )
      )
      where jsonb_typeof("payload" -> 'options') = 'array';
    `);

    this.addSql(`alter table "agent_proposals" drop column "auto_disposition_block";`);
    this.addSql(`alter table "agent_proposals" drop column "selected_option_id";`);
  }

}
