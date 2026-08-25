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
 */
function createRecordingDb() {
  const statements: string[] = []
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === 'query') statements.push(event.query.sql)
    },
  })
  return { db, statements }
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

    const insert = statements.find((sql) => sql.startsWith('insert into "entity_index_coverage"'))
    expect(insert).toBeDefined()
    expect(insert).toContain('on conflict')
    // The conflict branch must add to the column's own value, not assign a precomputed total.
    expect(insert).toContain('"entity_index_coverage"."base_count" +')
    expect(insert).toContain('"entity_index_coverage"."indexed_count" +')
    expect(insert).toContain('"entity_index_coverage"."vector_indexed_count" +')
    // Clamped in SQL too, so a concurrent decrement can never drive a counter negative.
    expect(insert).toContain('greatest')
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

    const inserts = statements.filter((sql) => sql.startsWith('insert into "entity_index_coverage"'))
    expect(inserts).toHaveLength(1)
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
