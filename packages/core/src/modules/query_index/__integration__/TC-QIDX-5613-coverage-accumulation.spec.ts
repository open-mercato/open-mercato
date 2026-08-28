import { expect, test } from '@playwright/test'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * TC-QIDX-5613: `applyCoverageAdjustments` must accumulate, in every scope it stores.
 *
 * The unit suite compiles the adjustment against Kysely's `DummyDriver`, so it asserts the
 * text of the statement and never executes it — which is why it stayed green through the
 * defect this spec exists for. `entity_index_coverage_scope_idx` is a plain `UNIQUE`
 * constraint and Postgres treats NULLs in one as distinct, so an
 * `INSERT … ON CONFLICT (entity_type, tenant_id, organization_id, with_deleted)` never took
 * its conflict branch for a scope whose tenant is NULL: every adjustment inserted a fresh row
 * carrying only its own delta, and the duplicate prune then deleted the accumulated one. The
 * counter was overwritten instead of incremented, `hasGap` reported a phantom index gap, and
 * the engine scheduled a spurious full reindex.
 *
 * Only a real database can tell the two apart, so this drives the real function against one
 * and asserts the resulting counters — sequentially, and then with overlapping calls, which is
 * the composition property the change claims.
 *
 * The rows belong to a throwaway `entity_type` unique to this run, so nothing here touches the
 * coverage of an entity the rest of the suite reads.
 */

const TENANT = '5613a5a1-0000-4000-8000-000000000001'
const ORGANIZATION = '5613a5a1-0000-4000-8000-000000000002'
const ORGANIZATION_CONCURRENT = '5613a5a1-0000-4000-8000-000000000003'
const ORG_PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

type CountsRow = { base_count: number; indexed_count: number; row_count: number }

test.describe('TC-QIDX-5613: coverage counters accumulate in every scope', () => {
  let db: Kysely<any>
  let entityType: string

  test.beforeAll(() => {
    db = new Kysely<any>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: resolveIntegrationDatabaseUrl() }) }),
    })
    entityType = `qidx_5613:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  })

  test.afterAll(async () => {
    if (!db) return
    await sql`delete from entity_index_coverage where entity_type = ${entityType}`.execute(db)
    await db.destroy()
  })

  // `applyCoverageAdjustments` only needs the Kysely handle off the EntityManager, so the
  // spec can exercise the real write path without booting the ORM.
  const em = () => ({ getKysely: () => db }) as any

  const adjust = (scope: { tenantId: string | null; organizationId: string | null }) =>
    applyCoverageAdjustments(
      em(),
      createCoverageAdjustments({ entityType, ...scope, baseDelta: 1, indexDelta: 1 })
    )

  const read = async (scope: { tenantId: string | null; organizationId: string | null }) => {
    // Read the scope the way the table stores it: a NULL organization is normalized to the
    // placeholder, so both spellings must be accepted or the assertion would miss a row that
    // the writer legitimately created under the other one.
    const row = await sql<CountsRow>`
      select coalesce(sum(base_count), 0)::int as base_count,
             coalesce(sum(indexed_count), 0)::int as indexed_count,
             count(*)::int as row_count
        from entity_index_coverage
       where entity_type = ${entityType}
         and with_deleted = false
         and tenant_id is not distinct from ${scope.tenantId}::uuid
         and (organization_id is not distinct from ${scope.organizationId}::uuid
              or organization_id = ${scope.organizationId ?? ORG_PLACEHOLDER}::uuid)
    `.execute(db)
    return row.rows[0]!
  }

  for (const [label, scope] of [
    ['tenant and organization scoped', { tenantId: TENANT, organizationId: ORGANIZATION }],
    ['null tenant', { tenantId: null, organizationId: ORGANIZATION }],
    ['null tenant and null organization', { tenantId: null, organizationId: null }],
  ] as const) {
    test(`accumulates sequential adjustments for a ${label} scope`, async () => {
      for (let i = 0; i < 3; i += 1) await adjust(scope)

      const counts = await read(scope)
      expect(counts.base_count, `three +1 base adjustments must total 3 (${label})`).toBe(3)
      expect(counts.indexed_count, `three +1 index adjustments must total 3 (${label})`).toBe(3)
      expect(counts.row_count, `the scope must hold exactly one coverage row (${label})`).toBe(1)
    })
  }

  test('composes overlapping adjustments instead of letting one overwrite the other', async () => {
    const scope = { tenantId: null, organizationId: ORGANIZATION_CONCURRENT }

    // Create the row first. The insert branch is the one window the unique constraint cannot
    // close for a NULL tenant, and it is not what this assertion is about — the claim under
    // test is that adjustments to an existing counter compose.
    await adjust(scope)
    const before = await read(scope)

    await Promise.all(Array.from({ length: 5 }, () => adjust(scope)))

    const after = await read(scope)
    expect(
      after.base_count - before.base_count,
      'five overlapping +1 adjustments must add 5, not collapse to the last one'
    ).toBe(5)
    expect(after.row_count, 'overlapping adjustments must not fan out into duplicate rows').toBe(1)
  })
})
