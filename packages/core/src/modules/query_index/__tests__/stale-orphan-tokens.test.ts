/**
 * Pins the token half of the reindex orphan sweep (#6072). `purgeOrphans` used to delete
 * only `entity_indexes` rows, so every record a rebuild stopped covering kept a queryable
 * `search_tokens` row with no presenter, and token-only orphans from earlier runs survived
 * every later rebuild.
 *
 * The assertions read the SQL actually compiled against a PostgreSQL dialect, because the
 * things that can go wrong here are predicates, not call counts: a token sweep driven by
 * `created_at` instead of the anti-join would delete tokens for live records, and a scope
 * predicate that drifts from the projection sweep would cross an organization boundary.
 */
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { purgeOrphans } from '../lib/stale'

const STARTED_AT = new Date('2026-09-01T00:00:00Z')

type Recorder = {
  db: Kysely<any>
  statements: CompiledQuery[]
  transactions: string[]
}

function makeDb(options?: { failOn?: RegExp; tokensTableMissing?: boolean }): Recorder {
  const statements: CompiledQuery[] = []
  const transactions: string[] = []

  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => undefined,
        acquireConnection: async () => ({
          executeQuery: async (compiled: CompiledQuery) => {
            statements.push(compiled)
            if (options?.failOn?.test(compiled.sql)) throw new Error('[internal] token delete failed')
            if (compiled.sql.includes('information_schema')) {
              return { rows: options?.tokensTableMissing ? [] : [{ one: 1 }], numAffectedRows: BigInt(0) }
            }
            return { rows: [], numAffectedRows: BigInt(0) }
          },
          streamQuery: async function* () { /* not used */ },
        }),
        beginTransaction: async () => { transactions.push('begin') },
        commitTransaction: async () => { transactions.push('commit') },
        rollbackTransaction: async () => { transactions.push('rollback') },
        releaseConnection: async () => undefined,
        destroy: async () => undefined,
      }),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  return { db, statements, transactions }
}

const projectionDelete = (statements: CompiledQuery[]) =>
  statements.find((entry) => entry.sql.startsWith('delete from "entity_indexes"'))

const tokenDelete = (statements: CompiledQuery[]) =>
  statements.find((entry) => entry.sql.startsWith('delete from "search_tokens"'))

const BASE = {
  entityType: 'example:todo',
  partitionIndex: null,
  partitionCount: null,
  startedAt: STARTED_AT,
}

describe('purgeOrphans sweeps orphaned search tokens', () => {
  it('deletes orphan tokens in the same transaction as the projections', async () => {
    const { db, statements, transactions } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' })

    expect(projectionDelete(statements)).toBeDefined()
    expect(tokenDelete(statements)).toBeDefined()
    // Order matters: the anti-join must see the projections already gone, otherwise a
    // record's own stale projection vouches for its own stale tokens.
    expect(statements.indexOf(projectionDelete(statements)!))
      .toBeLessThan(statements.indexOf(tokenDelete(statements)!))
    expect(transactions).toEqual(['begin', 'commit'])
  })

  // The whole point of the fix: a record is an orphan because its projection is gone, not
  // because its tokens are old. `replaceSearchTokensForBatch` skips unchanged records, so a
  // current record keeps tokens older than `startedAt` — sweeping on the timestamp alone
  // would make live records unfindable.
  it('keys the sweep on a surviving-projection anti-join, not on the timestamp alone', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' })

    const sql = tokenDelete(statements)!.sql
    expect(sql).toContain('not exists')
    expect(sql).toContain('from entity_indexes')
    expect(sql).toContain('surviving.entity_id = search_tokens.entity_id')
    expect(sql).toContain('surviving.tenant_id is not distinct from search_tokens.tenant_id')
    expect(sql).toContain('surviving.organization_id is not distinct from search_tokens.organization_id')
  })

  it('still bounds the sweep to tokens written before the run started', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' })

    const token = tokenDelete(statements)!
    expect(token.sql).toContain('"created_at" <')
    expect(token.parameters).toEqual(expect.arrayContaining([STARTED_AT]))
  })

  it('mirrors the projection sweep scope null-safely', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' })

    const token = tokenDelete(statements)!
    expect(token.sql).toContain('tenant_id is not distinct from')
    expect(token.sql).toContain('organization_id is not distinct from')
    expect(token.parameters).toEqual(expect.arrayContaining(['example:todo', 't1', 'o1']))
  })

  // An explicit `null` scope means "the global/unscoped rows"; an omitted scope means "every
  // scope". Collapsing the two would let a tenant-scoped run sweep another tenant's tokens.
  it('distinguishes an explicit null scope from an omitted one', async () => {
    // Anchored on the bound parameter so the anti-join's own `is not distinct from`
    // comparisons — which name columns on both sides — cannot satisfy the match.
    const boundTenantScope = /\btenant_id is not distinct from \$\d+/
    const boundOrgScope = /\borganization_id is not distinct from \$\d+/

    const explicit = makeDb()
    await purgeOrphans(explicit.db, { ...BASE, tenantId: null, organizationId: null })
    const explicitToken = tokenDelete(explicit.statements)!
    expect(explicitToken.sql).toMatch(boundTenantScope)
    expect(explicitToken.sql).toMatch(boundOrgScope)
    expect(explicitToken.parameters).toEqual(expect.arrayContaining([null]))

    const omitted = makeDb()
    await purgeOrphans(omitted.db, { ...BASE })
    const omittedToken = tokenDelete(omitted.statements)!
    expect(omittedToken.sql).not.toMatch(boundTenantScope)
    expect(omittedToken.sql).not.toMatch(boundOrgScope)
  })

  it('restricts the sweep to the partition being rebuilt', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', partitionIndex: 3, partitionCount: 5 })

    const token = tokenDelete(statements)!
    expect(token.sql).toMatch(/mod\(abs\(hashtext\(entity_id::text\)\), \$\d+\) = \$\d+/)
    expect(token.parameters).toEqual(expect.arrayContaining([5, 3]))
  })

  it('leaves an unpartitioned sweep scope-wide', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1' })

    expect(tokenDelete(statements)!.sql).not.toContain('hashtext')
  })

  // A record the run failed to write has no fresh projection, so the anti-join would happily
  // strip its tokens — turning a write failure into an unsearchable record.
  it('preserves tokens for records excluded from the purge', async () => {
    const { db, statements } = makeDb()

    await purgeOrphans(db, { ...BASE, tenantId: 't1', excludeRecordIds: ['rec-1', 'rec-2'] })

    const token = tokenDelete(statements)!
    expect(token.sql).toContain('"entity_id" not in')
    expect(token.parameters).toEqual(expect.arrayContaining(['rec-1', 'rec-2']))
  })

  // `entity_indexes` ships in an earlier migration (Migration20251030150038) than
  // `search_tokens` (Migration20251212084132), so this code can legitimately run against a
  // database that has the projection table and not the token table. Sweeping unconditionally
  // there would throw 42P01 and — inside the shared transaction — roll back the projection
  // purge that used to succeed, breaking every reindex during a rolling deploy.
  it('skips the token sweep when search_tokens does not exist, and still purges projections', async () => {
    const { db, statements, transactions } = makeDb({ tokensTableMissing: true })

    await purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' })

    expect(projectionDelete(statements)).toBeDefined()
    expect(tokenDelete(statements)).toBeUndefined()
    expect(transactions).toEqual(['begin', 'commit'])
  })

  it('rolls the projection delete back when the token delete fails', async () => {
    const { db, statements, transactions } = makeDb({ failOn: /^delete from "search_tokens"/ })

    await expect(purgeOrphans(db, { ...BASE, tenantId: 't1', organizationId: 'o1' }))
      .rejects.toThrow('token delete failed')

    expect(projectionDelete(statements)).toBeDefined()
    expect(transactions).toEqual(['begin', 'rollback'])
  })
})
