import { reindexEntity } from '../lib/reindexer'
import { upsertIndexBatch, type UpsertIndexBatchResult } from '../lib/batch'
import { applyCoverageAdjustments, refreshCoverageSnapshot, writeCoverageCounts } from '../lib/coverage'
import { finalizeJob, prepareJob, updateJobProgress } from '../lib/jobs'
import { purgeOrphans } from '../lib/stale'
import { registerTenantGlobalEntityTypes, resetTenantGlobalEntityTypes } from '../lib/tenant-global'

jest.mock('../lib/batch', () => {
  const actual = jest.requireActual('../lib/batch')
  return { ...actual, upsertIndexBatch: jest.fn() }
})

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: jest.fn(async () => undefined),
  refreshCoverageSnapshot: jest.fn(async () => undefined),
  writeCoverageCounts: jest.fn(async () => undefined),
}))

jest.mock('../lib/jobs', () => ({
  prepareJob: jest.fn(async () => undefined),
  updateJobProgress: jest.fn(async () => undefined),
  finalizeJob: jest.fn(async () => undefined),
}))

jest.mock('../lib/stale', () => ({
  purgeOrphans: jest.fn(async () => undefined),
}))

/**
 * Where a tenant-scoped sweep FILES the rows of a declared platform-wide catalogue.
 *
 * `reindexer-tenant-scope-guard.test.ts` is the other half of the pair: it pins which
 * entity types a tenant-scoped sweep is allowed to touch at all. This file starts where
 * that one stops — the allowlisted type is swept, and the question is whose projection
 * it becomes.
 *
 * The answer is nobody's. The incremental path already files these rows under
 * `tenant_id = NULL`: `resolveQueryIndexRecordScope()` resolves a source table with
 * neither scope column to `kind: 'global'` and *requires* an explicitly null tenant and
 * organization (see `upsert-one-global-scope.test.ts`). The sweep used to disagree and
 * stamp the caller's tenant, and because `entity_indexes` is unique on
 * (entity_type, entity_id, organization_id_coalesced) — with no organization_id on these
 * tables either — there is exactly one row per record for the two writers to fight over.
 * The last tenant to reindex won it, and every other tenant's search hits lost their
 * presenter.
 *
 * What must NOT move is the job scope: it records who asked for the sweep, and two
 * tenants reindexing the catalogue have to remain two jobs rather than one blocking the
 * other behind the active-job guard.
 */

const mockUpsertIndexBatch = upsertIndexBatch as jest.MockedFunction<typeof upsertIndexBatch>
const mockApplyCoverageAdjustments = applyCoverageAdjustments as jest.MockedFunction<typeof applyCoverageAdjustments>
const mockRefreshCoverageSnapshot = refreshCoverageSnapshot as jest.MockedFunction<typeof refreshCoverageSnapshot>
const mockWriteCoverageCounts = writeCoverageCounts as jest.MockedFunction<typeof writeCoverageCounts>
const mockPrepareJob = prepareJob as jest.MockedFunction<typeof prepareJob>
const mockFinalizeJob = finalizeJob as jest.MockedFunction<typeof finalizeJob>
const mockPurgeOrphans = purgeOrphans as jest.MockedFunction<typeof purgeOrphans>

const TENANT = '0e40f2bf-a7ab-465c-8040-20abbd8ad398'
const CATALOGUE = 'feature_toggles:feature_toggle'
const SCOPED = 'example:todo'

/** `feature_toggles`: a shared catalogue with neither scope column. */
const TENANT_LESS_COLUMNS = ['id', 'code', 'description', 'default_value', 'created_at']
const TENANT_SCOPED_COLUMNS = ['id', 'tenant_id', 'organization_id', 'deleted_at']

function batchResult(partial: Partial<UpsertIndexBatchResult>): UpsertIndexBatchResult {
  return { attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0, ...partial }
}

/**
 * Fake Kysely for the reindex loop: answers the column probe, serves one page of records
 * and then an empty page, and records every DELETE it is asked to build so the pre-sweep
 * purge can be inspected.
 */
function createFakeDb(table: string, columns: string[], rows: Array<{ id: string }>) {
  const pages = [rows, []]
  const deletes: Array<{ table: string; predicates: string[] }> = []

  const chainFor = (target: string): any => {
    let isPageQuery = false
    const selected: string[] = []
    const chain: any = {
      select: (columnsArg: unknown) => {
        for (const column of Array.isArray(columnsArg) ? columnsArg : [columnsArg]) selected.push(String(column))
        return chain
      },
      selectAll: () => { isPageQuery = true; return chain },
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      groupBy: () => chain,
      set: () => chain,
      execute: async () => {
        if (target === 'information_schema.columns') return columns.map((column_name) => ({ column_name }))
        if (target.startsWith(table)) return pages.shift() ?? []
        return []
      },
      executeTakeFirst: async () => {
        if (target.startsWith(table) && !isPageQuery) return { count: rows.length }
        // Two different queries hit `entity_index_jobs`: the active-job guard, which
        // must find nothing, and the started-at lookup, which must. They are told
        // apart by the column each one selects.
        if (target === 'entity_index_jobs') {
          return selected.some((column) => column.includes('started_at'))
            ? { started_at: new Date('2026-08-01T00:00:00Z') }
            : undefined
        }
        return undefined
      },
    }
    return chain
  }

  const deleteChainFor = (target: string): any => {
    const record = { table: target, predicates: [] as string[] }
    deletes.push(record)
    const chain: any = {
      where: (arg: unknown) => {
        // The tenant/organization predicates are raw `is not distinct from` fragments;
        // kysely's RawBuilder keeps its parameters on the compiled node, so the bound
        // values are read back rather than the SQL text.
        const parameters = (arg as { toOperationNode?: () => unknown })?.toOperationNode
          ? JSON.stringify((arg as { toOperationNode: () => unknown }).toOperationNode())
          : String(arg)
        record.predicates.push(parameters)
        return chain
      },
      execute: async () => undefined,
    }
    return chain
  }

  const db: any = {
    selectFrom: (target: unknown) => chainFor(String(target)),
    insertInto: (target: unknown) => chainFor(String(target)),
    updateTable: (target: unknown) => chainFor(String(target)),
    deleteFrom: (target: unknown) => deleteChainFor(String(target)),
  }
  return { db, deletes }
}

function makeEm(entityType: string, table: string, columns: string[], rows: Array<{ id: string }>) {
  const { db, deletes } = createFakeDb(table, columns, rows)
  const em: any = {
    getKysely: () => db,
    // Every entity type below resolves to a table named after its class, so the real
    // `resolveRegisteredEntityTableName` runs instead of being mocked.
    getMetadata: () => ({
      find: () => ({ tableName: table }),
      getAll: () => [{ tableName: table }],
    }),
  }
  void entityType
  return { em, deletes }
}

/** The `scopeOverrides` argument `reindexEntity` hands to `upsertIndexBatch`. */
function stampedScope() {
  return mockUpsertIndexBatch.mock.calls[0]?.[3]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 1, written: 1 }))
  resetTenantGlobalEntityTypes()
})

afterAll(() => {
  resetTenantGlobalEntityTypes()
})

describe('a tenant-scoped sweep of a declared platform-wide catalogue', () => {
  it('files the projection under the null tenant instead of the caller\'s', async () => {
    const { em } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    await reindexEntity(em, { entityType: CATALOGUE, tenantId: TENANT, organizationId: null })

    // No `tenantId` key at all: `upsertIndexRow` writes `tenant_id: args.tenantId ?? null`,
    // so an absent override is the null stamp.
    expect(stampedScope()).toEqual({})
  })

  it('files it under the null tenant for a module-registered catalogue too', async () => {
    registerTenantGlobalEntityTypes('billing:plan')
    const { em } = makeEm('billing:plan', 'plans', TENANT_LESS_COLUMNS, [{ id: 'plan-1' }])

    await reindexEntity(em, { entityType: 'billing:plan', tenantId: TENANT, organizationId: null })

    expect(stampedScope()).toEqual({})
  })

  it('keeps the JOB under the caller\'s tenant, so concurrent sweeps stay separate jobs', async () => {
    const { em } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    await reindexEntity(em, { entityType: CATALOGUE, tenantId: TENANT, organizationId: null })

    expect(mockPrepareJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: CATALOGUE, tenantId: TENANT }),
      'reindexing',
      expect.anything(),
    )
    expect(mockFinalizeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT }),
      expect.anything(),
    )
  })

  it('purges orphans under the null tenant, matching where the rows were written', async () => {
    // A purge that kept the caller's tenant would scan a scope this run never wrote to,
    // so a deleted catalogue row would keep its projection forever.
    const { em } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    await reindexEntity(em, { entityType: CATALOGUE, tenantId: TENANT, organizationId: null })

    expect(mockPurgeOrphans).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: CATALOGUE, tenantId: null }),
    )
  })

  it('accounts coverage against the null tenant, so indexed_count lands where the rows are', async () => {
    const { em } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    const result = await reindexEntity(em, {
      entityType: CATALOGUE,
      tenantId: TENANT,
      organizationId: null,
    })

    expect(mockApplyCoverageAdjustments).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ entityType: CATALOGUE, tenantId: null })],
    )
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: CATALOGUE, tenantId: null }),
    )
    expect(result.tenantScopes).toEqual([null])
  })

  it('reports the null tenant in the reset-coverage baseline as well', async () => {
    const { em } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    await reindexEntity(em, {
      entityType: CATALOGUE,
      tenantId: TENANT,
      organizationId: null,
      force: true,
      resetCoverage: true,
    })

    expect(mockWriteCoverageCounts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: CATALOGUE, tenantId: null }),
      expect.anything(),
    )
  })

  it('binds the pre-sweep force purge to the null tenant', async () => {
    const { em, deletes } = makeEm(CATALOGUE, 'feature_toggles', TENANT_LESS_COLUMNS, [{ id: 'toggle-1' }])

    await reindexEntity(em, {
      entityType: CATALOGUE,
      tenantId: TENANT,
      organizationId: null,
      force: true,
      resetCoverage: true,
    })

    const purge = deletes.find((entry) => entry.table === 'entity_indexes')
    expect(purge).toBeDefined()
    // The caller's tenant must appear in no predicate of the purge; if it did, the purge
    // would delete a scope this run does not rebuild.
    expect(purge!.predicates.join('|')).not.toContain(TENANT)
  })
})

describe('an ordinary tenant-scoped entity is untouched', () => {
  it('still stamps the caller\'s tenant', async () => {
    const { em } = makeEm(SCOPED, 'todos', TENANT_SCOPED_COLUMNS, [{ id: 'todo-1' }])

    await reindexEntity(em, { entityType: SCOPED, tenantId: TENANT, organizationId: 'org-1' })

    expect(stampedScope()).toEqual({ tenantId: TENANT, orgId: 'org-1' })
  })

  it('still purges orphans under the caller\'s tenant', async () => {
    const { em } = makeEm(SCOPED, 'todos', TENANT_SCOPED_COLUMNS, [{ id: 'todo-1' }])

    await reindexEntity(em, { entityType: SCOPED, tenantId: TENANT, organizationId: 'org-1' })

    expect(mockPurgeOrphans).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT }),
    )
  })

  it('is unaffected by a catalogue declaration for a different entity type', async () => {
    registerTenantGlobalEntityTypes(CATALOGUE)
    const { em } = makeEm(SCOPED, 'todos', TENANT_SCOPED_COLUMNS, [{ id: 'todo-1' }])

    await reindexEntity(em, { entityType: SCOPED, tenantId: TENANT, organizationId: 'org-1' })

    expect(stampedScope()).toEqual({ tenantId: TENANT, orgId: 'org-1' })
  })
})
