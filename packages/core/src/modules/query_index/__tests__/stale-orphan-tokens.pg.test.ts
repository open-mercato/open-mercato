/**
 * Behavioural cover for the reindex orphan-token sweep (#6072) against a real PostgreSQL.
 *
 * The sibling `stale-orphan-tokens.test.ts` pins the SQL the sweep compiles; this suite pins
 * what PostgreSQL then does with it — `is not distinct from` across NULL scopes, the
 * correlated anti-join, `hashtext` partitioning and the transaction boundary are exactly the
 * places where a plausible-looking predicate silently deletes searchable tokens for live
 * records, and `search_tokens` backs every module's list search.
 *
 * Gated on OM_QUERY_INDEX_PG_URL (or the pre-existing OM_COUNT_CAP_PG_URL) — a throwaway
 * database, since the suite creates and drops its own tables. Run it with, for example:
 *
 *   docker run -d --rm --name om-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54372:5432 postgres:18-alpine
 *   OM_QUERY_INDEX_PG_URL=postgres://postgres:postgres@127.0.0.1:54372/om \
 *     yarn workspace @open-mercato/core jest stale-orphan-tokens.pg
 */
import { Kysely, PostgresDialect, sql } from 'kysely'
import { purgeOrphans } from '../lib/stale'

const PG_URL = process.env.OM_QUERY_INDEX_PG_URL ?? process.env.OM_COUNT_CAP_PG_URL
const maybe = PG_URL ? describe : describe.skip

const ENTITY = 'orphancheck:todo'
const OTHER_ENTITY = 'orphancheck:other'
const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

const STARTED_AT = new Date('2026-09-01T00:00:00Z')
const BEFORE = new Date('2026-08-01T00:00:00Z')
const AFTER = new Date('2026-09-02T00:00:00Z')

const BASE = { entityType: ENTITY, partitionIndex: null, partitionCount: null, startedAt: STARTED_AT }

maybe('purgeOrphans orphan-token sweep against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let db: Kysely<any>

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg')
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: PG_URL }) }) })
    await sql`create table if not exists entity_indexes (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id text not null,
      organization_id uuid,
      tenant_id uuid,
      doc jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )`.execute(db)
    await sql`create table if not exists search_tokens (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id text not null,
      organization_id uuid,
      tenant_id uuid,
      field text not null,
      token_hash text not null,
      token text,
      created_at timestamptz not null default now()
    )`.execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists search_tokens`.execute(db)
    await sql`drop table if exists entity_indexes`.execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`truncate table entity_indexes, search_tokens`.execute(db)
  })

  type Scope = { tenantId?: string | null; organizationId?: string | null }

  const addProjection = async (
    recordId: string,
    scope: Scope,
    options?: { updatedAt?: Date; deletedAt?: Date; entityType?: string },
  ) => {
    await sql`insert into entity_indexes (entity_type, entity_id, organization_id, tenant_id, updated_at, deleted_at)
      values (
        ${options?.entityType ?? ENTITY},
        ${recordId},
        ${scope.organizationId ?? null}::uuid,
        ${scope.tenantId ?? null}::uuid,
        ${options?.updatedAt ?? BEFORE},
        ${options?.deletedAt ?? null}
      )`.execute(db)
  }

  const addToken = async (
    recordId: string,
    scope: Scope,
    options?: { createdAt?: Date; entityType?: string },
  ) => {
    await sql`insert into search_tokens (entity_type, entity_id, organization_id, tenant_id, field, token_hash, created_at)
      values (
        ${options?.entityType ?? ENTITY},
        ${recordId},
        ${scope.organizationId ?? null}::uuid,
        ${scope.tenantId ?? null}::uuid,
        'name',
        ${`hash-${recordId}`},
        ${options?.createdAt ?? BEFORE}
      )`.execute(db)
  }

  const tokenIds = async (): Promise<string[]> => {
    const rows = await sql<{ entity_id: string }>`
      select entity_id from search_tokens order by entity_type, entity_id
    `.execute(db)
    return rows.rows.map((row) => row.entity_id)
  }

  const projectionIds = async (): Promise<string[]> => {
    const rows = await sql<{ entity_id: string }>`
      select entity_id from entity_indexes order by entity_type, entity_id
    `.execute(db)
    return rows.rows.map((row) => row.entity_id)
  }

  it('removes tokens whose projection the same run just purged', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addProjection('gone', scope)
    await addToken('gone', scope)

    await purgeOrphans(db, { ...BASE, ...scope })

    expect(await projectionIds()).toEqual([])
    expect(await tokenIds()).toEqual([])
  })

  it('removes historical token-only orphans that never had a projection', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addToken('never-had-one', scope)

    await purgeOrphans(db, { ...BASE, ...scope })

    expect(await tokenIds()).toEqual([])
  })

  // The regression the timestamp-only sweep would cause. `replaceSearchTokensForBatch`
  // returns early for a record whose tokens are unchanged, so a perfectly current record
  // carries tokens older than the run that just refreshed its projection.
  it('keeps tokens of a covered record whose tokens predate the run', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addProjection('live', scope, { updatedAt: AFTER })
    await addToken('live', scope, { createdAt: BEFORE })

    await purgeOrphans(db, { ...BASE, ...scope })

    expect(await projectionIds()).toEqual(['live'])
    expect(await tokenIds()).toEqual(['live'])
  })

  it('keeps tokens whose projection is only soft-deleted', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addProjection('soft', scope, { updatedAt: AFTER, deletedAt: AFTER })
    await addToken('soft', scope)

    await purgeOrphans(db, { ...BASE, ...scope })

    expect(await tokenIds()).toEqual(['soft'])
  })

  it('leaves another organization untouched', async () => {
    await addToken('orphan-a', { tenantId: TENANT, organizationId: ORG_A })
    await addToken('orphan-b', { tenantId: TENANT, organizationId: ORG_B })

    await purgeOrphans(db, { ...BASE, tenantId: TENANT, organizationId: ORG_A })

    expect(await tokenIds()).toEqual(['orphan-b'])
  })

  it('leaves another tenant untouched', async () => {
    await addToken('orphan-t1', { tenantId: TENANT })
    await addToken('orphan-t2', { tenantId: OTHER_TENANT })

    await purgeOrphans(db, { ...BASE, tenantId: TENANT })

    expect(await tokenIds()).toEqual(['orphan-t2'])
  })

  it('leaves another entity type untouched', async () => {
    await addToken('orphan', { tenantId: TENANT, organizationId: ORG_A })
    await addToken('orphan', { tenantId: TENANT, organizationId: ORG_A }, { entityType: OTHER_ENTITY })

    await purgeOrphans(db, { ...BASE, tenantId: TENANT, organizationId: ORG_A })

    expect((await sql<{ entity_type: string }>`select entity_type from search_tokens`.execute(db)).rows)
      .toEqual([{ entity_type: OTHER_ENTITY }])
  })

  // An explicit null scope addresses the global rows; it must not reach a scoped row, and a
  // scoped run must not reach the global one.
  it('treats an explicit null scope as its own partition of the table', async () => {
    await addToken('global', { tenantId: null, organizationId: null })
    await addToken('scoped', { tenantId: TENANT, organizationId: ORG_A })

    await purgeOrphans(db, { ...BASE, tenantId: null, organizationId: null })

    expect(await tokenIds()).toEqual(['scoped'])
  })

  it('sweeps every scope when the scope is omitted', async () => {
    await addToken('global', { tenantId: null, organizationId: null })
    await addToken('scoped', { tenantId: TENANT, organizationId: ORG_A })

    await purgeOrphans(db, { ...BASE })

    expect(await tokenIds()).toEqual([])
  })

  it('preserves tokens for records the run failed to write', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addToken('failed', scope)
    await addToken('dropped', scope)

    await purgeOrphans(db, { ...BASE, ...scope, excludeRecordIds: ['failed'] })

    expect(await tokenIds()).toEqual(['failed'])
  })

  // A batch writes tokens before the matching projection, so a concurrent writer can leave a
  // token that momentarily has no presenter. The cutoff keeps the sweep off it.
  it('preserves tokens written at or after the run started', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addToken('concurrent', scope, { createdAt: AFTER })
    await addToken('stale', scope, { createdAt: BEFORE })

    await purgeOrphans(db, { ...BASE, ...scope })

    expect(await tokenIds()).toEqual(['concurrent'])
  })

  it('restricts the sweep to the partition being rebuilt', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    const ids = ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6']
    for (const id of ids) await addToken(id, scope)

    const partitioned = await sql<{ entity_id: string; part: number }>`
      select entity_id, mod(abs(hashtext(entity_id::text)), 3) as part from search_tokens
    `.execute(db)
    const inPartitionZero = partitioned.rows.filter((row) => Number(row.part) === 0).map((row) => row.entity_id)
    const outsidePartitionZero = partitioned.rows.filter((row) => Number(row.part) !== 0).map((row) => row.entity_id)
    // A fixture that lands entirely on one side would assert nothing about partitioning.
    expect(inPartitionZero.length).toBeGreaterThan(0)
    expect(outsidePartitionZero.length).toBeGreaterThan(0)

    await purgeOrphans(db, { ...BASE, ...scope, partitionIndex: 0, partitionCount: 3 })

    expect((await tokenIds()).sort()).toEqual(outsidePartitionZero.sort())
  })

  it('is idempotent across repeated runs', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addProjection('live', scope, { updatedAt: AFTER })
    await addToken('live', scope)
    await addToken('orphan', scope)

    await purgeOrphans(db, { ...BASE, ...scope })
    const afterFirst = await tokenIds()
    await purgeOrphans(db, { ...BASE, ...scope })

    expect(afterFirst).toEqual(['live'])
    expect(await tokenIds()).toEqual(afterFirst)
  })

  it('rolls the projection delete back when the token delete fails', async () => {
    const scope = { tenantId: TENANT, organizationId: ORG_A }
    await addProjection('gone', scope)
    await addToken('gone', scope)
    await sql`create function orphancheck_block_delete() returns trigger as $$
      begin raise exception 'token delete blocked'; end;
    $$ language plpgsql`.execute(db)
    await sql`create trigger orphancheck_block_delete before delete on search_tokens
      for each row execute function orphancheck_block_delete()`.execute(db)

    try {
      await expect(purgeOrphans(db, { ...BASE, ...scope })).rejects.toThrow(/token delete blocked/)
      expect(await projectionIds()).toEqual(['gone'])
      expect(await tokenIds()).toEqual(['gone'])
    } finally {
      await sql`drop trigger orphancheck_block_delete on search_tokens`.execute(db)
      await sql`drop function orphancheck_block_delete()`.execute(db)
    }
  })
})
