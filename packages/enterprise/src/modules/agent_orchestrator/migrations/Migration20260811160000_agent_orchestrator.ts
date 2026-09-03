import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 2 of the triggered process model (`.ai/specs/enterprise/agent-orchestrator/
 * 2026-08-11-triggered-process-model.md` §Triggers become one declared list):
 * three unrelated entry mechanisms collapse into ONE declared
 * `agent_process_definitions.triggers` jsonb list.
 *
 * Ordering is load-bearing — every statement that READS a retired column runs
 * before the statement that drops it:
 *
 *  1. add `triggers` (default `'[]'`) and widen `triggered_by` to jsonb;
 *  2. migrate `schedule_cron` / `schedule_timezone` / `schedule_enabled` into a
 *     `{ kind: 'schedule' }` entry, and every `agent_task_event_triggers` row
 *     into an `{ kind: 'event' }` entry with `eventPattern`, the full `config`
 *     (`filterConditions` / `contextMapping` / `debounceMs` /
 *     `maxConcurrentInstances`), `priority` and `enabled` intact;
 *  3. synthesize a `{ kind: 'manual' }` entry on EVERY existing definition.
 *     Before this phase every definition could be started by hand; gating
 *     `/run` on a declared manual trigger without this backfill would silently
 *     remove run-now from all of them (spec §Phasing step 6);
 *  4. only then drop the retired columns, indexes and table.
 *
 * `triggered_by` carried the legacy string provenance (`user:<id>` /
 * `api_key:<id>` / `schedule:<id>` / `event:<name>`), which is NOT valid JSON —
 * a bare `::jsonb` cast would abort the migration on the first existing run row.
 * The `using` expression below parses each prefix into the `{ kind, ref? }`
 * object the entity now reads.
 *
 * Per the root rules this PR ships the migration plus the regenerated snapshot
 * and never runs `db:migrate`.
 */
export class Migration20260811160000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_process_definitions" add "triggers" jsonb null default '[]';`)
    this.addSql(`update "agent_process_definitions" set "triggers" = '[]'::jsonb where "triggers" is null;`)

    // 1. schedule_* → { kind: 'schedule', cron, timezone, enabled }
    this.addSql(`update "agent_process_definitions"
      set "triggers" = "triggers" || jsonb_build_array(jsonb_build_object(
        'kind', 'schedule',
        'cron', "schedule_cron",
        'timezone', coalesce("schedule_timezone", 'UTC'),
        'enabled', coalesce("schedule_enabled", true)
      ))
      where "schedule_cron" is not null and length(btrim("schedule_cron")) > 0;`)

    // 2. agent_task_event_triggers rows → { kind: 'event', eventPattern, config, priority, enabled }
    this.addSql(`update "agent_process_definitions" as "d"
      set "triggers" = "d"."triggers" || "t"."entries"
      from (
        select "process_definition_id",
               -- NOT jsonb_strip_nulls: it recurses, and a stored filter
               -- condition comparing against an explicit null would lose its
               -- value key - the exact silent config loss this phase exists to
               -- avoid. A null config stays a JSON null, which the schema accepts.
               jsonb_agg(jsonb_build_object(
                 'kind', 'event',
                 'eventPattern', "event_pattern",
                 'config', "config",
                 'priority', coalesce("priority", 0),
                 'enabled', coalesce("enabled", true)
               ) order by coalesce("priority", 0) desc, "created_at" asc) as "entries"
        from "agent_task_event_triggers"
        where "deleted_at" is null
        group by "process_definition_id"
      ) as "t"
      where "t"."process_definition_id" = "d"."id";`)

    // 3. The manual backfill — without it every existing definition silently loses run-now.
    this.addSql(`update "agent_process_definitions"
      set "triggers" = "triggers" || jsonb_build_array(jsonb_build_object(
        'kind', 'manual',
        'requireFeatures', '[]'::jsonb
      ))
      where not ("triggers" @> '[{"kind":"manual"}]'::jsonb);`)

    // 4. triggered_by: legacy `<kind>:<ref>` string → { kind, ref? }
    this.addSql(`alter table "agent_process_runs" alter column "triggered_by" type jsonb using (
      case
        when "triggered_by" like 'event:%'
          then jsonb_build_object('kind', 'event', 'ref', substring("triggered_by" from 7))
        when "triggered_by" like 'schedule:%'
          then jsonb_build_object('kind', 'schedule', 'ref', substring("triggered_by" from 10))
        when "triggered_by" like 'user:%'
          then jsonb_build_object('kind', 'manual', 'ref', substring("triggered_by" from 6))
        when "triggered_by" like 'api_key:%'
          then jsonb_build_object('kind', 'manual', 'ref', substring("triggered_by" from 9))
        else jsonb_build_object('kind', 'system', 'ref', "triggered_by")
      end
    );`)
    this.addSql(`alter table "agent_process_runs" alter column "triggered_by" drop not null;`)

    this.addSql(`create index "agent_process_definitions_triggers_gin" on "agent_process_definitions" using gin ("triggers" jsonb_path_ops);`)

    this.addSql(`alter table "agent_process_definitions" drop column "schedule_cron", drop column "schedule_enabled", drop column "schedule_timezone";`)
    this.addSql(`drop table if exists "agent_task_event_triggers" cascade;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`create table "agent_task_event_triggers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "process_definition_id" uuid not null, "event_pattern" varchar(255) not null, "config" jsonb null, "enabled" boolean not null default true, "priority" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`)
    this.addSql(`create index "agent_task_event_triggers_definition_idx" on "agent_task_event_triggers" ("process_definition_id");`)
    this.addSql(`create index "agent_task_event_triggers_tenant_org_idx" on "agent_task_event_triggers" ("tenant_id", "organization_id");`)

    this.addSql(`alter table "agent_process_definitions" add "schedule_cron" varchar(100) null, add "schedule_enabled" boolean not null default true, add "schedule_timezone" varchar(64) null;`)

    this.addSql(`insert into "agent_task_event_triggers" ("tenant_id", "organization_id", "process_definition_id", "event_pattern", "config", "enabled", "priority", "created_at", "updated_at")
      select "d"."tenant_id", "d"."organization_id", "d"."id",
             "e"->>'eventPattern',
             "e"->'config',
             coalesce(("e"->>'enabled')::boolean, true),
             coalesce(("e"->>'priority')::int, 0),
             now(), now()
      from "agent_process_definitions" as "d",
           lateral jsonb_array_elements(coalesce("d"."triggers", '[]'::jsonb)) as "e"
      where "e"->>'kind' = 'event' and "e"->>'eventPattern' is not null;`)

    this.addSql(`update "agent_process_definitions" as "d"
      set "schedule_cron" = "s"."cron",
          "schedule_timezone" = "s"."timezone",
          "schedule_enabled" = "s"."enabled"
      from (
        select "d2"."id",
               "e"->>'cron' as "cron",
               "e"->>'timezone' as "timezone",
               coalesce(("e"->>'enabled')::boolean, true) as "enabled"
        from "agent_process_definitions" as "d2",
             lateral jsonb_array_elements(coalesce("d2"."triggers", '[]'::jsonb)) as "e"
        where "e"->>'kind' = 'schedule'
      ) as "s"
      where "s"."id" = "d"."id";`)

    this.addSql(`alter table "agent_process_runs" alter column "triggered_by" type varchar(150) using (
      case
        when "triggered_by"->>'kind' = 'event' then 'event:' || coalesce("triggered_by"->>'ref', '')
        when "triggered_by"->>'kind' = 'schedule' then 'schedule:' || coalesce("triggered_by"->>'ref', 'cron')
        when "triggered_by"->>'kind' = 'manual' then 'user:' || coalesce("triggered_by"->>'ref', '')
        else coalesce("triggered_by"->>'ref', 'system')
      end
    );`)
    this.addSql(`update "agent_process_runs" set "triggered_by" = 'system' where "triggered_by" is null;`)
    this.addSql(`alter table "agent_process_runs" alter column "triggered_by" set not null;`)

    this.addSql(`drop index if exists "agent_process_definitions_triggers_gin";`)
    this.addSql(`alter table "agent_process_definitions" drop column "triggers";`)
  }

}
