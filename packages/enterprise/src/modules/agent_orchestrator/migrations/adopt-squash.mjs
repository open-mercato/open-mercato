/**
 * Adopt the agent_orchestrator migration squash on a database that already ran
 * the 26 pre-squash migrations.
 *
 * The squash (`Migration20260811150000_agent_orchestrator`) is a single
 * create-everything migration. On a fresh database it is correct and `db:migrate`
 * just works. On a database that already holds this module it cannot run at all —
 * the first `create table` fails on a relation that already exists — and the
 * module's migration table has no row saying the squash is done, so `db:migrate`
 * retries it forever.
 *
 * The spec's risk table said such a database "drops and re-initialises". That is
 * fine for a scratch DB and wrong for one holding real runs. This script is the
 * third option: apply the DELTA the squash represents over the old 26, then
 * record the squash as applied so `db:migrate` moves on to the migrations that
 * come after it.
 *
 * The delta is exactly:
 *   1. the W1 Phase 1 rename (tables, FK column, indexes, constraints)
 *   2. the W2 columns  (selected_option_id, auto_disposition_block, agent_type)
 *   3. the W2 data rewrites (result_kind vocabulary, proposal envelope,
 *      persisted workflow outcomeKind)
 *
 * The five tables/columns the old snapshot never recorded — agent_eval_case_runs,
 * agent_eval_suite_runs, agent_eval_results.eval_case_run_id, agent_proposals.source,
 * agent_runs.source — already exist physically; the snapshot forgot them, the
 * migrations did not. Nothing to do for those.
 *
 * Idempotent, transactional, and refuses to act on a database it does not
 * recognise. Run once:
 *
 *   node packages/enterprise/src/modules/agent_orchestrator/migrations/adopt-squash.mjs
 *   yarn db:migrate
 *
 * Pass --dry-run to print what it would do and roll back.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const SQUASH = 'Migration20260811150000_agent_orchestrator'
const MIGRATION_TABLE = 'mikro_orm_migrations_agent_orchestrator'
const DRY_RUN = process.argv.includes('--dry-run')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const envPath = path.join(repoRoot, 'apps/mercato/.env')

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('DATABASE_URL='))
  if (!line) throw new Error('[internal] DATABASE_URL not set and not found in apps/mercato/.env')
  return line.slice('DATABASE_URL='.length).trim()
}

const log = (message) => console.log(`  ${message}`)

async function tableExists(client, name) {
  const result = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`,
    [name],
  )
  return result.rowCount > 0
}

async function columnExists(client, table, column) {
  const result = await client.query(
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  )
  return result.rowCount > 0
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() })
  await client.connect()

  try {
    // ── Refuse to act on a database this script does not understand ──────────
    if (!(await tableExists(client, MIGRATION_TABLE))) {
      log(`No ${MIGRATION_TABLE} — this database has never run this module. Just run: yarn db:migrate`)
      return
    }
    const applied = (await client.query(`select name from ${MIGRATION_TABLE}`)).rows.map((row) => row.name)
    const recorded = applied.includes(SQUASH)
    // NOT an early return. Every step below is independently idempotent, so a
    // re-run repairs a partial adoption — which is exactly what a first version
    // of this script needed and did not have: it renamed the FK on the runs
    // table, missed the one on the event-trigger table, and then refused to run
    // again because the squash was already recorded.
    if (recorded) log('squash already recorded — checking for anything left undone')
    const hasOldTables = await tableExists(client, 'agent_task_definitions')
    const hasNewTables = await tableExists(client, 'agent_process_definitions')
    if (!hasOldTables && !hasNewTables) {
      log('Neither the old nor the new tables exist — this is a fresh install. Just run: yarn db:migrate')
      return
    }
    if (!hasOldTables && hasNewTables && !recorded) {
      log('Tables are already renamed but the squash is unrecorded — recording it only.')
    }

    console.log(`\nAdopting the squash over ${applied.length} existing migrations${DRY_RUN ? ' (DRY RUN)' : ''}\n`)
    await client.query('begin')

    // ── 1. The W1 Phase 1 rename ────────────────────────────────────────────
    if (hasOldTables) {
      log('renaming agent_task_definitions → agent_process_definitions')
      await client.query(`alter table "agent_task_definitions" rename to "agent_process_definitions"`)
      await client.query(`alter index "agent_task_definitions_pkey" rename to "agent_process_definitions_pkey"`)
      await client.query(`alter index "agent_task_definitions_target_idx" rename to "agent_process_definitions_target_idx"`)
      await client.query(`alter index "agent_task_definitions_tenant_org_idx" rename to "agent_process_definitions_tenant_org_idx"`)

      log('renaming agent_task_runs → agent_process_runs')
      await client.query(`alter table "agent_task_runs" rename to "agent_process_runs"`)
      if (await columnExists(client, 'agent_process_runs', 'task_definition_id')) {
        await client.query(`alter table "agent_process_runs" rename column "task_definition_id" to "process_definition_id"`)
      }
      for (const [from, to] of [
        ['agent_task_runs_pkey', 'agent_process_runs_pkey'],
        ['agent_task_runs_definition_idx', 'agent_process_runs_definition_idx'],
        ['agent_task_runs_idempotency_uq', 'agent_process_runs_idempotency_uq'],
        ['agent_task_runs_source_idx', 'agent_process_runs_source_idx'],
        ['agent_task_runs_tenant_org_idx', 'agent_process_runs_tenant_org_idx'],
      ]) {
        await client.query(`alter index if exists "${from}" rename to "${to}"`)
      }
    }

    // The event-trigger table's FK renamed with everything else in W1 Phase 1.
    // Its own rename is separate from the runs table's and was missed once.
    if (await columnExists(client, 'agent_task_event_triggers', 'task_definition_id')) {
      log('renaming agent_task_event_triggers.task_definition_id → process_definition_id')
      await client.query(
        `alter table "agent_task_event_triggers" rename column "task_definition_id" to "process_definition_id"`,
      )
    }

    // ── 2. The W2 columns ───────────────────────────────────────────────────
    log('adding the option-envelope columns')
    await client.query(`alter table "agent_proposals" add column if not exists "selected_option_id" varchar(100) null`)
    await client.query(`alter table "agent_proposals" add column if not exists "auto_disposition_block" varchar(20) null`)
    await client.query(`alter table "agent_runs" add column if not exists "agent_type" varchar(20) null`)

    // ── 3. The W2 data rewrites ─────────────────────────────────────────────
    // Vocabulary. `actionable` collapsed to one runtime kind, `proposal` — the
    // authoring split lives on agent_type, not here.
    const researcher = await client.query(
      `update "agent_runs" set "result_kind" = 'researcher' where "result_kind" = 'informative'`,
    )
    const proposal = await client.query(
      `update "agent_runs" set "result_kind" = 'proposal' where "result_kind" = 'actionable'`,
    )
    log(`result_kind: ${researcher.rowCount} → researcher, ${proposal.rowCount} → proposal`)

    // The envelope. A proposal with an empty action list becomes `options: []`
    // — "nothing proposed" — never an option that would fail `actions.min(1)`.
    const envelope = await client.query(`
      update "agent_proposals"
      set "payload" = jsonb_strip_nulls(jsonb_build_object(
        'options',
        case
          when jsonb_typeof("payload" -> 'actions') = 'array'
               and jsonb_array_length("payload" -> 'actions') > 0
          then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'id', 'primary',
            'label', left(coalesce("agent_id", 'Proposal'), 120),
            'actions', "payload" -> 'actions',
            'confidence', case
              when jsonb_typeof("payload" -> 'confidence') = 'number'
                then least(greatest(("payload" ->> 'confidence')::numeric, 0), 1)
              else null end
          )))
          else '[]'::jsonb
        end,
        'rationale', case
          when jsonb_typeof("payload" -> 'rationale') = 'string'
            then to_jsonb(left("payload" ->> 'rationale', 2000))
          else null end
      ))
      where "payload" ? 'actions'
    `)
    log(`proposal envelope: ${envelope.rowCount} rewritten`)

    // Persisted workflow vocabulary. Core tables, so guarded — an install
    // without the workflows module is a no-op rather than a failure.
    //
    // The predicate matches exactly what the replacements change. A looser
    // `like '%informative%'` also matches human-authored prose — a real
    // definition here is named "Ocena ryzyka — approved / informative
    // (default)" — which would rewrite the row to itself, report a misleading
    // count, and never converge on a re-run. An author's label is not a wire
    // value and is never rewritten.
    for (const table of ['workflow_definitions', 'workflow_definition_drafts']) {
      if (!(await tableExists(client, table))) continue
      const rewritten = await client.query(`
        update "${table}"
        set "definition" = replace(
              replace("definition"::text, '"outcomeKind": "informative"', '"outcomeKind": "researcher"'),
              '"outcome:informative"', '"outcome:researcher"'
            )::jsonb
        where "definition"::text like '%"outcomeKind": "informative"%'
           or "definition"::text like '%"outcome:informative"%'
      `)
      log(`${table}: ${rewritten.rowCount} definitions rewritten`)
    }

    // ── 4. Record the squash ────────────────────────────────────────────────
    if (recorded) {
      log('squash row already present — left as is')
    } else {
      await client.query(`insert into ${MIGRATION_TABLE} ("name", "executed_at") values ($1, now())`, [SQUASH])
      log(`recorded ${SQUASH} as applied`)
    }

    if (DRY_RUN) {
      await client.query('rollback')
      console.log('\nDRY RUN — rolled back. Re-run without --dry-run to apply.\n')
    } else {
      await client.query('commit')
      console.log('\nAdopted. Now run: yarn db:migrate\n')
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

await main()
