/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import { SyncCursor, SyncRun } from '../../data/entities'
import type { DataSyncAdapter } from '../adapter'
import { createSyncRunService } from '../sync-run-service'
import type { SyncRunService } from '../sync-run-service'

const mockGetDataSyncAdapter = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findAndCountWithDecryption: jest.fn().mockResolvedValue([[], 0]),
}))

jest.mock('../adapter-registry', () => ({
  getDataSyncAdapter: (...args: unknown[]) => mockGetDataSyncAdapter(...args),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: () => ({ providerKey: 'dual-mode' }),
}))

jest.mock('../../events', () => ({
  emitDataSyncEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn(async () => undefined),
}))

import { createSyncEngine } from '../sync-engine'

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

const BACKFILL_ENTITY = 'catalog.product_backfill'
const FEED_ENTITY = 'catalog.product_feed'

type FakeRun = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: string
  cursor: string | null
  progressJobId: string | null
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  batchesCompleted: number
}

function buildRun(id: string, entityType: string): FakeRun {
  return {
    id,
    integrationId: 'sync_dual',
    entityType,
    direction: 'import',
    status: 'pending',
    cursor: null,
    progressJobId: null,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    batchesCompleted: 0,
  }
}

function buildFakeEm(runs: FakeRun[], cursorRows: Record<string, unknown>[]) {
  const em = {
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      if (entity === SyncCursor) cursorRows.push(row)
      return row
    }),
    nativeUpdate: jest.fn(async (_entity: unknown, where: { id: string }) => {
      const run = runs.find((candidate) => candidate.id === where.id)
      if (!run) return 0
      run.status = 'running'
      return 1
    }),
  }

  ;(findOneWithDecryption as jest.Mock).mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === SyncRun) {
      return Promise.resolve(runs.find((run) => run.id === where.id) ?? null)
    }
    if (entity === SyncCursor) {
      return Promise.resolve(
        cursorRows.find((row) => row.entityType === where.entityType && row.direction === where.direction) ?? null,
      )
    }
    return Promise.resolve(null)
  })

  return em
}

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'dual-mode',
    direction: 'import',
    supportedEntities: [BACKFILL_ENTITY, FEED_ENTITY],
    getMapping: jest.fn(async ({ entityType }) => ({
      entityType,
      matchStrategy: 'externalId' as const,
      fields: [],
    })),
    streamImport: jest.fn(async function* () {
      yield {
        items: [{ externalId: 'item-1', action: 'create' as const, data: {} }],
        cursor: 'committed-cursor',
        hasMore: false,
        batchIndex: 0,
      }
    }),
    ...overrides,
  }
}

function buildEngineDeps(em: unknown, syncRunService: SyncRunService) {
  return {
    em: em as EntityManager,
    syncRunService,
    integrationCredentialsService: {
      resolve: jest.fn(async () => ({ token: 'secret' })),
    } as unknown as CredentialsService,
    integrationLogService: {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService,
    integrationStateService: { upsert: jest.fn(async () => undefined) } as any,
    progressService: {
      startJob: jest.fn(async () => undefined),
      isCancellationRequested: jest.fn(async () => false),
      updateProgress: jest.fn(async () => undefined),
      completeJob: jest.fn(async () => undefined),
      failJob: jest.fn(async () => undefined),
      markCancelled: jest.fn(async () => undefined),
    } as unknown as ProgressService,
  }
}

describe('sync engine honours persistsSharedCursor per entity type', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes one shared cursor row when the adapter opts out for one of two entity types', async () => {
    const backfillRun = buildRun('run-backfill', BACKFILL_ENTITY)
    const feedRun = buildRun('run-feed', FEED_ENTITY)
    const cursorRows: Record<string, unknown>[] = []
    const em = buildFakeEm([backfillRun, feedRun], cursorRows)

    mockGetDataSyncAdapter.mockReturnValue(buildAdapter({
      persistsSharedCursor: (entityType: string) => entityType !== BACKFILL_ENTITY,
    }))

    const engine = createSyncEngine(buildEngineDeps(em, createSyncRunService(em as any)))

    await engine.runImport('run-backfill', 100, SCOPE)
    await engine.runImport('run-feed', 100, SCOPE)

    expect(backfillRun.cursor).toBe('committed-cursor')
    expect(feedRun.cursor).toBe('committed-cursor')
    expect(cursorRows).toHaveLength(1)
    expect(cursorRows[0]).toEqual(expect.objectContaining({
      entityType: FEED_ENTITY,
      cursor: 'committed-cursor',
    }))
  })

  it('writes the shared cursor row for adapters that do not implement the hook', async () => {
    const run = buildRun('run-legacy', BACKFILL_ENTITY)
    const cursorRows: Record<string, unknown>[] = []
    const em = buildFakeEm([run], cursorRows)

    mockGetDataSyncAdapter.mockReturnValue(buildAdapter())

    const engine = createSyncEngine(buildEngineDeps(em, createSyncRunService(em as any)))

    await engine.runImport('run-legacy', 100, SCOPE)

    expect(cursorRows).toHaveLength(1)
    expect(cursorRows[0]).toEqual(expect.objectContaining({ entityType: BACKFILL_ENTITY }))
  })

  it('passes the adapter verdict to commitBatchProgress on the export path', async () => {
    const run = { ...buildRun('run-export', BACKFILL_ENTITY), direction: 'export' as const }
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus: jest.fn(async () => ({ ...run, status: 'running' })),
      commitBatchProgress: jest.fn(async () => run),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(buildAdapter({
      direction: 'export',
      persistsSharedCursor: () => false,
      streamExport: jest.fn(async function* () {
        yield {
          results: [{ localId: 'local-1', status: 'success' as const }],
          cursor: 'export-cursor',
          hasMore: false,
          batchIndex: 0,
        }
      }),
    }))

    const engine = createSyncEngine(buildEngineDeps({}, syncRunService))

    await engine.runExport('run-export', 100, SCOPE)

    expect(syncRunService.commitBatchProgress).toHaveBeenCalledWith(
      'run-export',
      expect.any(Object),
      'export-cursor',
      SCOPE,
      { persistSharedCursor: false },
    )
  })
})
