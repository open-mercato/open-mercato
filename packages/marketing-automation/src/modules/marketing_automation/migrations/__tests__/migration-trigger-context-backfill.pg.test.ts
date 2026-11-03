/**
 * Behavioural cover for `Migration20261002110000_marketing_trigger_context`'s backfill: moving a
 * real `context -> 'trigger'` object into its own `trigger_context` column and stripping the
 * plaintext key out of `context`, then reversing both on `down()`. The migration's own test only
 * pins the SQL text — nothing before this ran that SQL against a real PostgreSQL to prove the
 * backfill actually moves the data the way `lib/run-context.ts` (a later phase) depends on.
 *
 * Gated on OM_MARKETING_AUTOMATION_PG_URL — a throwaway database, since the suite creates and
 * drops its own table. See active-run-occurrence-constraints.pg.test.ts for how to run it.
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Migration20261002110000_marketing_trigger_context } from '../Migration20261002110000_marketing_trigger_context'

const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL
const maybe = PG_URL ? describe : describe.skip

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002110000_marketing_trigger_context.prototype,
  ) as Migration20261002110000_marketing_trigger_context
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (statement: string) => statements.push(statement),
  })
  await migration[direction]()
  return statements
}

maybe('Migration20261002110000_marketing_trigger_context against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>

  beforeAll(async () => {
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    await sql`create table if not exists marketing_campaign_runs (
      id uuid not null default gen_random_uuid(),
      context jsonb not null
    )`.execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists marketing_campaign_runs`.execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate table marketing_campaign_runs`.execute(db)
    // Every test starts pre-up(): down() assumes trigger_context already exists.
    await sql`alter table marketing_campaign_runs drop column if exists trigger_context`.execute(db)
  })

  const insertRun = async (context: Record<string, unknown>): Promise<string> => {
    const result = await sql<{ id: string }>`
      insert into marketing_campaign_runs (id, context)
      values (gen_random_uuid(), ${JSON.stringify(context)}::jsonb)
      returning id
    `.execute(db)
    return result.rows[0].id
  }

  const loadRow = async (id: string) => {
    const result = await sql<{ context: unknown; trigger_context: unknown }>`
      select context, trigger_context from marketing_campaign_runs where id = ${id}::uuid
    `.execute(db)
    return result.rows[0]
  }

  const runUp = async () => {
    for (const statement of await collectSql('up')) await sql.raw(statement).execute(db)
  }

  const runDown = async () => {
    for (const statement of await collectSql('down')) await sql.raw(statement).execute(db)
  }

  it('up() moves a real trigger object into trigger_context and strips it from context', async () => {
    const id = await insertRun({
      trigger: { eventId: 'sales.order.created', amount: 42 },
      subjectEntityId: 'cust-1',
    })

    await runUp()

    const row = await loadRow(id)
    expect(row.trigger_context).toEqual({ eventId: 'sales.order.created', amount: 42 })
    expect(row.context).toEqual({ subjectEntityId: 'cust-1' })
  })

  it('up() leaves a row with no trigger key untouched', async () => {
    const id = await insertRun({ subjectEntityId: 'cust-2' })

    await runUp()

    const row = await loadRow(id)
    expect(row.trigger_context).toBeNull()
    expect(row.context).toEqual({ subjectEntityId: 'cust-2' })
  })

  it('up() leaves a row whose trigger is an empty object untouched', async () => {
    const id = await insertRun({ trigger: {}, subjectEntityId: 'cust-3' })

    await runUp()

    const row = await loadRow(id)
    expect(row.trigger_context).toBeNull()
    expect(row.context).toEqual({ trigger: {}, subjectEntityId: 'cust-3' })
  })

  it('down() merges trigger_context back into context and drops the column', async () => {
    const id = await insertRun({ subjectEntityId: 'cust-4' })
    await runUp()
    await sql`update marketing_campaign_runs set trigger_context = ${JSON.stringify({ eventId: 'sales.order.created' })}::json where id = ${id}::uuid`.execute(db)

    await runDown()

    const columnStillExists = await sql<{ exists: boolean }>`
      select exists (
        select 1 from information_schema.columns
        where table_name = 'marketing_campaign_runs' and column_name = 'trigger_context'
      ) as exists
    `.execute(db)
    expect(columnStillExists.rows[0].exists).toBe(false)

    const row = await sql<{ context: unknown }>`
      select context from marketing_campaign_runs where id = ${id}::uuid
    `.execute(db)
    expect(row.rows[0].context).toEqual({ subjectEntityId: 'cust-4', trigger: { eventId: 'sales.order.created' } })
  })
})
