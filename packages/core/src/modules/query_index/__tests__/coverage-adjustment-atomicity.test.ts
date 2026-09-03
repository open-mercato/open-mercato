import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'

/**
 * `entity_index_coverage` carries one hot row per (entity type, tenant, organization), and
 * every indexed write adjusts it. Computing the new totals in JavaScript — read the row, add
 * the delta, write the total back — makes two overlapping adjustments read the same row and
 * write the same total, so one is silently lost and coverage drifts below the real count
 * (#5604). These tests pin the adjustment to a single statement that increments in SQL.
 *
 * A real Kysely instance on `DummyDriver` compiles the queries without a database, so the
 * assertions are about the SQL actually sent rather than about a hand-written fake's shape.
 *
 * What this file can and cannot prove: `DummyDriver` answers every statement with no rows, so
 * it pins the *shape* of what is sent and nothing about the counters that come back. It
 * therefore cannot catch a statement that is well-formed but matches the wrong rows — which is
 * exactly how the NULL-tenant conflict-target defect survived the first version of this suite.
 * `__integration__/TC-QIDX-5613-coverage-accumulation.spec.ts` asserts the resulting totals
 * against a real Postgres; the two are complements, not alternatives.
 */
function createRecordingDb() {
  const statements: string[] = []
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = []
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level !== 'query') return
      statements.push(event.query.sql)
      queries.push({ sql: event.query.sql, parameters: event.query.parameters })
    },
  })
  return { db, statements, queries }
}

function createEm(db: Kysely<any>) {
  return { getKysely: () => db } as any
}

const scope = {
  entityType: 'catalog:product',
  tenantId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
}

describe('applyCoverageAdjustments (#5604)', () => {
  it('increments the stored counters in SQL instead of reading them first', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 1 })
    )

    const update = statements.find((sql) => sql.startsWith('update "entity_index_coverage"'))
    expect(update).toBeDefined()
    // The SET clause must add to the column's own value, not assign a precomputed total.
    expect(update).toContain('"base_count" +')
    expect(update).toContain('"indexed_count" +')
    expect(update).toContain('"vector_indexed_count" +')
    // Clamped in SQL too, so a concurrent decrement can never drive a counter negative.
    expect(update).toContain('greatest')
  })

  it('matches a null-tenant scope explicitly rather than through a conflict target', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, tenantId: null, baseDelta: 1, indexDelta: 1 })
    )

    // `entity_index_coverage_scope_idx` is a plain UNIQUE constraint and Postgres treats NULLs
    // in one as distinct, so `on conflict (…, tenant_id, …)` can never fire for this scope. The
    // incrementing statement has to find the row by a NULL-aware predicate of its own.
    const update = statements.find((sql) => sql.startsWith('update "entity_index_coverage"'))
    expect(update).toBeDefined()
    expect(update).toContain('"tenant_id" is null')
    expect(update).toContain('"base_count" +')
  })

  it('serializes a missing null-tenant scope and retries the update before inserting', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, tenantId: null, baseDelta: 1, indexDelta: 1 })
    )

    const updateIndexes = statements.flatMap((statement, index) => (
      statement.startsWith('update "entity_index_coverage"') ? [index] : []
    ))
    const lockIndex = statements.findIndex((statement) => statement.includes('pg_advisory_xact_lock'))
    const insertIndex = statements.findIndex((statement) => statement.startsWith('insert into "entity_index_coverage"'))
    expect(updateIndexes).toHaveLength(2)
    expect(lockIndex).toBeGreaterThan(updateIndexes[0]!)
    expect(updateIndexes[1]).toBeGreaterThan(lockIndex)
    expect(insertIndex).toBeGreaterThan(updateIndexes[1]!)
  })

  it('initializes multiple scopes in a stable order to avoid cross-transaction deadlocks', async () => {
    const { db, queries } = createRecordingDb()

    await applyCoverageAdjustments(createEm(db), [
      ...createCoverageAdjustments({
        ...scope,
        entityType: 'query_index:z_scope',
        tenantId: null,
        baseDelta: 1,
        indexDelta: 1,
      }),
      ...createCoverageAdjustments({
        ...scope,
        entityType: 'query_index:a_scope',
        tenantId: null,
        baseDelta: 1,
        indexDelta: 1,
      }),
    ], { trx: db })

    const lockKeys = queries
      .filter((query) => query.sql.includes('pg_advisory_xact_lock'))
      .map((query) => query.parameters[0])
    expect(lockKeys).toEqual([
      'query_index:a_scope|__null_tenant__|22222222-2222-2222-2222-222222222222|active_only',
      'query_index:z_scope|__null_tenant__|22222222-2222-2222-2222-222222222222|active_only',
    ])
  })

  it('reuses an ambient EntityManager transaction instead of opening a nested one', async () => {
    const { db, statements } = createRecordingDb()

    // `em.getKysely()` returns the EntityManager's transaction context inside
    // `em.transactional(...)`, and Kysely's `Transaction` throws on `.transaction()`. Opening
    // one unconditionally for the rowless nullable-tenant branch therefore turned a caller that
    // was already transactional — the exact state that branch wants — into a hard failure.
    await db.transaction().execute(async (trx) => {
      await applyCoverageAdjustments(
        createEm(trx),
        createCoverageAdjustments({ ...scope, tenantId: null, baseDelta: 1, indexDelta: 1 })
      )
    })

    // The ambient transaction still scopes the advisory lock, so the initialization guard is
    // kept rather than traded away for the fix.
    expect(statements.filter((sql) => sql.includes('pg_advisory_xact_lock'))).toHaveLength(1)
    expect(statements.filter((sql) => sql.startsWith('update "entity_index_coverage"'))).toHaveLength(2)
  })

  it('does not read the coverage row before writing it', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 0 })
    )

    const readsCoverage = statements.some(
      (sql) => sql.startsWith('select') && sql.includes('"entity_index_coverage"')
    )
    expect(readsCoverage).toBe(false)
  })

  it('sends one incrementing statement per scope when adjustments are aggregated', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(createEm(db), [
      ...createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 1 }),
      ...createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 1 }),
      ...createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 1 }),
    ])

    const updates = statements.filter((sql) => sql.startsWith('update "entity_index_coverage"'))
    expect(updates).toHaveLength(1)
  })

  it('falls back to an incrementing insert when the scope has no row yet', async () => {
    const { db, statements } = createRecordingDb()

    // `DummyDriver` returns no rows for the update, which is exactly the "scope not stored yet"
    // case: the insert then has to seed the row and still increment on conflict, so a racing
    // first adjustment for a scope the constraint *can* see is not lost either.
    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, baseDelta: 1, indexDelta: 1 })
    )

    const insert = statements.find((sql) => sql.startsWith('insert into "entity_index_coverage"'))
    expect(insert).toBeDefined()
    expect(insert).toContain('on conflict')
    expect(insert).toContain('"entity_index_coverage"."base_count" +')
    expect(insert).toContain('greatest')
  })

  it('skips the database entirely when every delta cancels out', async () => {
    const { db, statements } = createRecordingDb()

    await applyCoverageAdjustments(
      createEm(db),
      createCoverageAdjustments({ ...scope, baseDelta: 0, indexDelta: 0 })
    )

    expect(statements).toHaveLength(0)
  })
})
