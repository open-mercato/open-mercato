import {
  Kysely,
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { replaceSearchTokensForBatch } from '../lib/search-tokens'

// A real Kysely backed by the DummyDriver: every query is COMPILED to SQL (the step that used to
// overflow the call stack) but executed as a no-op, so the test needs no database.
function makeCompilingDb(): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

describe('replaceSearchTokensForBatch — large batch delete (regression)', () => {
  const prevEnabled = process.env.OM_SEARCH_ENABLED
  const prevPartials = process.env.OM_SEARCH_ENABLE_PARTIAL

  beforeAll(() => {
    process.env.OM_SEARCH_ENABLED = 'true'
    // Keep the generated token set small so the test is fast; the regression is in the DELETE, whose
    // size depends on record×field count, not on how many tokens each field yields.
    process.env.OM_SEARCH_ENABLE_PARTIAL = 'false'
  })

  afterAll(() => {
    if (prevEnabled === undefined) delete process.env.OM_SEARCH_ENABLED
    else process.env.OM_SEARCH_ENABLED = prevEnabled
    if (prevPartials === undefined) delete process.env.OM_SEARCH_ENABLE_PARTIAL
    else process.env.OM_SEARCH_ENABLE_PARTIAL = prevPartials
  })

  it('compiles the delete for a large record×field batch without overflowing the call stack', async () => {
    // 200 records × 60 fields = ~12k (entity_id, field) pairs. The previous implementation deleted
    // existing tokens by a nested `eb.or(pairs.map(([id, field]) => eb.and([...])))`, whose expression
    // tree is deep enough to throw "Maximum call stack size exceeded" while Kysely compiles the SQL —
    // and batch.ts swallowed it, silently losing every token in the batch. The fix deletes by
    // `entity_id IN (ids)` instead. Regression guard: this call must resolve, not throw a RangeError.
    const payloads = Array.from({ length: 200 }, (_, recordIdx) => ({
      entityType: 'sales:sales_order',
      recordId: `order-${recordIdx}`,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      doc: Object.fromEntries(
        Array.from({ length: 60 }, (_, fieldIdx) => [`field_${fieldIdx}`, `order ${recordIdx} field ${fieldIdx} value`]),
      ),
    }))

    await expect(replaceSearchTokensForBatch(makeCompilingDb(), payloads)).resolves.toBeUndefined()
  })
})
