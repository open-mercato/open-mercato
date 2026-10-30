/**
 * Behavioural cover for the two partial unique indexes `Migration20260930144604_marketing_automation`
 * creates on `marketing_campaign_runs` — `marketing_runs_active_subject_uniq` and
 * `marketing_runs_occurrence_uniq`. Both back real concurrency guarantees the module's `lib/runs.ts`
 * (a later phase) depends on: a subject can have at most one concurrently live run per campaign, and
 * a delivered occurrence can create at most one run. Nothing exercised either constraint against a
 * real PostgreSQL before this.
 *
 * Gated on OM_MARKETING_AUTOMATION_PG_URL — a throwaway database, since the suite creates and drops
 * its own table. Run it with, for example:
 *
 *   docker run -d --rm --name om-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54372:5432 postgres:18-alpine
 *   OM_MARKETING_AUTOMATION_PG_URL=postgres://postgres:postgres@127.0.0.1:54372/om \
 *     yarn workspace @open-mercato/marketing-automation jest active-run-occurrence-constraints.pg
 */
import { Kysely, PostgresDialect, sql } from 'kysely'

const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CAMPAIGN = '33333333-3333-4333-8333-333333333333'

maybe('marketing_campaign_runs partial unique indexes against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>

  beforeAll(async () => {
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    await sql`create table if not exists marketing_campaign_runs (
      id uuid not null default gen_random_uuid(),
      campaign_id uuid not null,
      organization_id uuid not null,
      tenant_id uuid not null,
      subject_entity_id uuid null,
      trigger_event_id text not null,
      occurrence_key text null,
      status text not null default 'running',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (id)
    )`.execute(db)
    await sql`create unique index marketing_runs_occurrence_uniq on marketing_campaign_runs
      (tenant_id, organization_id, campaign_id, occurrence_key) where occurrence_key is not null`
      .execute(db)
    await sql`create unique index marketing_runs_active_subject_uniq on marketing_campaign_runs
      (tenant_id, organization_id, campaign_id, subject_entity_id)
      where subject_entity_id is not null and status in ('running', 'waiting', 'claimed')`
      .execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists marketing_campaign_runs`.execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate table marketing_campaign_runs`.execute(db)
  })

  const insertRun = (overrides: {
    subjectEntityId?: string | null
    occurrenceKey?: string | null
    status?: string
  }) =>
    sql`insert into marketing_campaign_runs
      (campaign_id, organization_id, tenant_id, subject_entity_id, trigger_event_id, occurrence_key, status)
      values (
        ${CAMPAIGN}::uuid, ${ORG}::uuid, ${TENANT}::uuid,
        ${overrides.subjectEntityId ?? null}::uuid,
        'trigger.event',
        ${overrides.occurrenceKey ?? null},
        ${overrides.status ?? 'running'}
      )`.execute(db)

  it('rejects a second run for the same campaign + occurrence key', async () => {
    await insertRun({ occurrenceKey: 'occ-1' })

    await expect(insertRun({ occurrenceKey: 'occ-1' })).rejects.toThrow(/duplicate key value/)
  })

  it('allows two runs with different occurrence keys', async () => {
    await insertRun({ occurrenceKey: 'occ-1' })

    await expect(insertRun({ occurrenceKey: 'occ-2' })).resolves.toBeDefined()
  })

  it('allows unlimited runs with a null occurrence key', async () => {
    await insertRun({ occurrenceKey: null })

    await expect(insertRun({ occurrenceKey: null })).resolves.toBeDefined()
  })

  it('rejects a second concurrently-live run for the same subject + campaign', async () => {
    await insertRun({ subjectEntityId: CAMPAIGN, status: 'running' })

    await expect(insertRun({ subjectEntityId: CAMPAIGN, status: 'waiting' })).rejects.toThrow(
      /duplicate key value/,
    )
  })

  it('allows a new run for the same subject once the prior one is no longer active', async () => {
    await insertRun({ subjectEntityId: CAMPAIGN, status: 'completed' })

    await expect(insertRun({ subjectEntityId: CAMPAIGN, status: 'running' })).resolves.toBeDefined()
  })

  it('allows a new run for the same subject once the prior one failed', async () => {
    await insertRun({ subjectEntityId: CAMPAIGN, status: 'failed' })

    await expect(insertRun({ subjectEntityId: CAMPAIGN, status: 'claimed' })).resolves.toBeDefined()
  })
})
