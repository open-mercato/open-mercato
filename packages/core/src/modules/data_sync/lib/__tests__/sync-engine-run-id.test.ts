import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import type { DataSyncAdapter } from '../adapter'
import type { SyncRunService } from '../sync-run-service'

const mockGetDataSyncAdapter = jest.fn()
const mockGetIntegration = jest.fn()
const mockEmitDataSyncEvent = jest.fn(async () => undefined)
const mockRefreshCoverageSnapshot = jest.fn(async () => undefined)

jest.mock('../adapter-registry', () => ({
  ...jest.requireActual('../adapter-registry'),
  getDataSyncAdapter: (...args: unknown[]) => mockGetDataSyncAdapter(...args),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
}))

jest.mock('../../events', () => ({
  emitDataSyncEvent: (...args: unknown[]) => mockEmitDataSyncEvent(...args),
}))

jest.mock('../../../query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: (...args: unknown[]) => mockRefreshCoverageSnapshot(...args),
}))

import { createSyncEngine } from '../sync-engine'
import { SyncRunOwnershipConflictError } from '../sync-run-service'

function createScope() {
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
  }
}

function createProgressService(): ProgressService {
  return {
    startJob: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => false),
    getJob: jest.fn(async () => null),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
  } as unknown as ProgressService
}

function createSyncRunService(run: Record<string, unknown>): SyncRunService {
  return {
    getRun: jest.fn(async () => run),
    markStatus: jest
      .fn()
      .mockResolvedValueOnce({
        ...run,
        status: 'running',
      })
      .mockResolvedValueOnce({
        ...run,
        status: 'completed',
        createdCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        batchesCompleted: 1,
      }),
    updateCounts: jest.fn(async () => undefined),
    updateCursor: jest.fn(async () => undefined),
    commitBatchProgress: jest.fn(async () => undefined),
  } as unknown as SyncRunService
}

describe('data sync engine forwards run context to adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
  })

  it('passes runId and enriched mapping metadata to import adapters', async () => {
    const streamImport = jest.fn(async function* () {
      yield {
        items: [
          {
            externalId: 'lead-1',
            action: 'create',
            data: {},
          },
        ],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    })

    const adapter: DataSyncAdapter = {
      providerKey: 'excel',
      operationalTelemetry: true,
      direction: 'import',
      supportedEntities: ['customers.person'],
      getMapping: jest.fn(async () => ({
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        fields: [
          {
            externalField: 'Record Id',
            localField: 'person.externalId',
            mappingKind: 'external_id',
            dedupeRole: 'primary',
          },
          {
            externalField: 'Email',
            localField: 'person.primaryEmail',
            mappingKind: 'core',
            dedupeRole: 'secondary',
          },
        ],
      })),
      streamImport,
    }

    mockGetDataSyncAdapter.mockReturnValue(adapter)
    const integrationLogService = {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService
    const integrationStateService = {
      upsert: jest.fn(async () => undefined),
    }

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService: createSyncRunService({
        id: 'run-import-1',
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-import-1',
      }),
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService,
      integrationStateService: integrationStateService as any,
      progressService: createProgressService(),
    })

    await engine.runImport('run-import-1', 100, createScope())

    expect(streamImport).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'customers.person',
      runId: 'run-import-1',
      // A run with no persisted parameters still hands the adapter an object,
      // matching the documented StreamImportInput.parameters contract.
      parameters: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        fields: [
          {
            externalField: 'Record Id',
            localField: 'person.externalId',
            mappingKind: 'external_id',
            dedupeRole: 'primary',
          },
          {
            externalField: 'Email',
            localField: 'person.primaryEmail',
            mappingKind: 'core',
            dedupeRole: 'secondary',
          },
        ],
      },
    }))
    expect(integrationStateService.upsert).toHaveBeenCalledWith('sync_excel', expect.objectContaining({
      lastHealthStatus: 'degraded',
    }), createScope())
    expect(integrationStateService.upsert).toHaveBeenCalledWith('sync_excel', expect.objectContaining({
      lastHealthStatus: 'healthy',
    }), createScope())
    expect((integrationLogService as any).write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_excel',
      runId: 'run-import-1',
      message: 'Sync run started',
      payload: expect.objectContaining({
        operationalStatus: 'running',
      }),
    }), createScope())
    expect((integrationLogService as any).write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_excel',
      runId: 'run-import-1',
      message: 'Sync run completed',
      payload: expect.objectContaining({
        operationalStatus: 'completed',
      }),
    }), createScope())
  })

  it('does not write operational telemetry for adapters that do not opt in', async () => {
    const streamImport = jest.fn(async function* () {
      yield {
        items: [],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    })

    const adapter: DataSyncAdapter = {
      providerKey: 'generic',
      direction: 'import',
      supportedEntities: ['generic.entity'],
      getMapping: jest.fn(async () => ({
        entityType: 'generic.entity',
        matchStrategy: 'custom',
        fields: [],
      })),
      streamImport,
    }

    mockGetDataSyncAdapter.mockReturnValue(adapter)
    mockGetIntegration.mockReturnValue({ providerKey: 'generic' })
    const integrationLogService = {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService
    const integrationStateService = {
      upsert: jest.fn(async () => undefined),
    }

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService: createSyncRunService({
        id: 'run-import-generic',
        integrationId: 'generic',
        entityType: 'generic.entity',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: null,
      }),
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({})),
      } as unknown as CredentialsService,
      integrationLogService,
      integrationStateService: integrationStateService as any,
      progressService: createProgressService(),
    })

    await engine.runImport('run-import-generic', 100, createScope())

    expect(integrationStateService.upsert).not.toHaveBeenCalled()
    expect((integrationLogService as any).write).not.toHaveBeenCalled()
  })

  it('passes runId to export adapters', async () => {
    const streamExport = jest.fn(async function* () {
      yield {
        results: [
          {
            localId: 'person-1',
            status: 'success',
            externalId: 'lead-1',
          },
        ],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    })

    const adapter: DataSyncAdapter = {
      providerKey: 'excel',
      direction: 'export',
      supportedEntities: ['customers.person'],
      getMapping: jest.fn(async () => ({
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        fields: [],
      })),
      streamExport,
    }

    mockGetDataSyncAdapter.mockReturnValue(adapter)

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService: createSyncRunService({
        id: 'run-export-1',
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'export',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-export-1',
      }),
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService: {
        write: jest.fn(async () => undefined),
      } as unknown as IntegrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService: createProgressService(),
    })

    await engine.runExport('run-export-1', 100, createScope())

    expect(streamExport).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'customers.person',
      runId: 'run-export-1',
      parameters: {},
    }))
  })

  it('forwards the run parameters persisted at launch to the import adapter', async () => {
    const streamImport = jest.fn(async function* () {
      yield {
        items: [],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    })

    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'sync_excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      streamImport,
      getMapping: jest.fn(async () => ({
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        fields: [],
      })),
    })

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService: createSyncRunService({
        id: 'run-import-params',
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: null,
        parameters: { dryRun: true, startId: 900000 },
      }),
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({})),
      } as unknown as CredentialsService,
      integrationLogService: {
        write: jest.fn(async () => undefined),
      } as unknown as IntegrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService: createProgressService(),
    })

    await engine.runImport('run-import-params', 100, createScope())

    expect(streamImport).toHaveBeenCalledWith(expect.objectContaining({
      parameters: { dryRun: true, startId: 900000 },
    }))
  })

  it('does not cancel a progress job when a duplicate import worker sees a non-pending run', async () => {
    const streamImport = jest.fn(async function* () {
      yield {
        items: [],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    })
    const adapter: DataSyncAdapter = {
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      getMapping: jest.fn(async () => ({
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        fields: [],
      })),
      streamImport,
    }
    const progressService = createProgressService()
    const syncRunService = {
      getRun: jest.fn(async () => ({
        id: 'run-import-duplicate',
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-import-duplicate',
      })),
      markStatus: jest.fn(async () => null),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(adapter)

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService: {
        write: jest.fn(async () => undefined),
      } as unknown as IntegrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService,
    })

    await engine.runImport('run-import-duplicate', 100, createScope())

    expect(progressService.markCancelled).not.toHaveBeenCalled()
    expect(streamImport).not.toHaveBeenCalled()
  })

  it('resumes a running import from its committed cursor without duplicating an uncommitted batch', async () => {
    const persistedRecords = new Map([['product-2', { name: 'already written before restart' }]])
    const adapterUpsert = jest.fn((externalId: string, data: Record<string, unknown>) => {
      persistedRecords.set(externalId, data)
    })
    const streamImport = jest.fn(async function* () {
      adapterUpsert('product-2', { name: 'replayed after stalled-job recovery' })
      yield {
        items: [{ externalId: 'product-2', action: 'update', data: { name: 'replayed after stalled-job recovery' } }],
        cursor: 'checkpoint-2',
        hasMore: false,
        batchIndex: 3,
      }
    })
    const adapter: DataSyncAdapter = {
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['catalog.product'],
      getMapping: jest.fn(async () => ({
        entityType: 'catalog.product',
        matchStrategy: 'externalId',
        fields: [],
      })),
      streamImport,
    }
    const resumedRun = {
      id: 'run-import-resume',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'running' as const,
      cursor: 'checkpoint-1',
      batchesCompleted: 4,
      progressJobId: null,
    }
    const syncRunService = {
      getRun: jest.fn(async () => resumedRun),
      markStatus: jest
        .fn()
        .mockResolvedValueOnce(resumedRun)
        .mockResolvedValueOnce({ ...resumedRun, status: 'completed' }),
      commitBatchProgress: jest.fn(async () => resumedRun),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(adapter)
    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService: {
        write: jest.fn(async () => undefined),
      } as unknown as IntegrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService: createProgressService(),
    })

    await engine.runImport('run-import-resume', 100, createScope())

    expect(streamImport).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'checkpoint-1' }))
    expect(adapterUpsert).toHaveBeenCalledTimes(1)
    expect(persistedRecords.size).toBe(1)
    expect(persistedRecords.get('product-2')).toEqual({ name: 'replayed after stalled-job recovery' })
    expect((syncRunService as any).commitBatchProgress).toHaveBeenCalledWith(
      'run-import-resume',
      expect.objectContaining({ updatedCount: 1, batchesCompleted: 1 }),
      'checkpoint-2',
      createScope(),
      { expectedBatchesCompleted: 4, persistSharedCursor: true },
    )
  })
})

describe('data sync engine fences cursor commits against a concurrent delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
  })

  function createImportAdapter(batches: Array<{ cursor: string; batchIndex: number }>): DataSyncAdapter {
    return {
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['catalog.product'],
      getMapping: jest.fn(async () => ({
        entityType: 'catalog.product',
        matchStrategy: 'externalId',
        fields: [],
      })),
      streamImport: jest.fn(async function* () {
        for (const batch of batches) {
          yield {
            items: [{ externalId: `product-${batch.batchIndex}`, action: 'create', data: {} }],
            cursor: batch.cursor,
            hasMore: batch.batchIndex < batches.length,
            batchIndex: batch.batchIndex,
          }
        }
      }),
    }
  }

  function buildEngine(syncRunService: SyncRunService) {
    return createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService: {
        write: jest.fn(async () => undefined),
      } as unknown as IntegrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService: createProgressService(),
    })
  }

  it('chains each commit to the batch count it last committed, so a stale delivery cannot skip a window', async () => {
    const run = {
      id: 'run-chain',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'pending' as const,
      cursor: null,
      batchesCompleted: 0,
      progressJobId: null,
    }
    const commitBatchProgress = jest.fn(async () => run)
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus: jest.fn(async () => ({ ...run, status: 'running' })),
      commitBatchProgress,
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(
      createImportAdapter([
        { cursor: 'c1', batchIndex: 1 },
        { cursor: 'c2', batchIndex: 2 },
      ]),
    )

    await buildEngine(syncRunService).runImport('run-chain', 100, createScope())

    expect(commitBatchProgress.mock.calls.map((call) => [call[2], call[4]?.expectedBatchesCompleted])).toEqual([
      ['c1', 0],
      ['c2', 1],
    ])
  })

  it('chains on the batch count even when the adapter repeats a cursor between batches', async () => {
    const run = {
      id: 'run-repeat',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'pending' as const,
      cursor: null,
      batchesCompleted: 0,
      progressJobId: null,
    }
    const commitBatchProgress = jest.fn(async () => run)
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus: jest.fn(async () => ({ ...run, status: 'running' })),
      commitBatchProgress,
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(
      createImportAdapter([
        { cursor: 'same', batchIndex: 1 },
        { cursor: 'same', batchIndex: 2 },
      ]),
    )

    await buildEngine(syncRunService).runImport('run-repeat', 100, createScope())

    expect(commitBatchProgress.mock.calls.map((call) => call[4]?.expectedBatchesCompleted)).toEqual([0, 1])
  })

  it('yields the run instead of failing it when another worker already advanced it', async () => {
    const run = {
      id: 'run-conflict',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'running' as const,
      cursor: 'checkpoint-1',
      batchesCompleted: 1,
      progressJobId: null,
    }
    const markStatus = jest.fn(async () => ({ ...run, status: 'running' }))
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus,
      commitBatchProgress: jest.fn(async () => {
        throw new SyncRunOwnershipConflictError('run-conflict', 1)
      }),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(createImportAdapter([{ cursor: 'checkpoint-2', batchIndex: 1 }]))

    await buildEngine(syncRunService).runImport('run-conflict', 100, createScope())

    const requestedStatuses = markStatus.mock.calls.map((call) => call[1])
    expect(requestedStatuses).not.toContain('failed')
    expect(requestedStatuses).not.toContain('completed')
  })

  it('does not report a failure for a run another delivery already completed', async () => {
    const run = {
      id: 'run-displaced',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'running' as const,
      cursor: 'checkpoint-5',
      batchesCompleted: 5,
      progressJobId: 'job-displaced',
    }
    // The winning delivery finalized the run while this one was still streaming,
    // so `markStatus` refuses `completed -> failed` and returns the row as it
    // stands. Nothing downstream may fire off that refusal.
    const markStatus = jest.fn(async (_runId: string, status: string) => (
      status === 'running'
        ? { ...run, status: 'running' }
        : { ...run, status: 'completed' }
    ))
    const progressService = createProgressService()
    const integrationLogService = {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus,
      commitBatchProgress: jest.fn(async () => run),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue({
      ...createImportAdapter([]),
      streamImport: jest.fn(async function* () {
        throw new Error('upstream timed out after the run was taken over')
      }),
    })

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ uploadId: 'upload-1' })),
      } as unknown as CredentialsService,
      integrationLogService,
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService,
    })

    await engine.runImport('run-displaced', 100, createScope())

    expect(markStatus).toHaveBeenCalledWith('run-displaced', 'failed', createScope(), expect.any(String))
    expect(progressService.failJob).not.toHaveBeenCalled()
    expect(mockEmitDataSyncEvent.mock.calls.map((call) => call[0])).not.toContain('data_sync.run.failed')
  })

  it('marks a resumed run as such so consumers can tell a restart from a start', async () => {
    const run = {
      id: 'run-resumed-event',
      integrationId: 'sync_excel',
      entityType: 'catalog.product',
      direction: 'import' as const,
      status: 'running' as const,
      cursor: 'checkpoint-1',
      batchesCompleted: 1,
      progressJobId: null,
    }
    const syncRunService = {
      getRun: jest.fn(async () => run),
      markStatus: jest.fn(async (_runId: string, status: string) => ({ ...run, status })),
      commitBatchProgress: jest.fn(async () => run),
    } as unknown as SyncRunService

    mockGetDataSyncAdapter.mockReturnValue(createImportAdapter([]))

    await buildEngine(syncRunService).runImport('run-resumed-event', 100, createScope())

    expect(mockEmitDataSyncEvent).toHaveBeenCalledWith(
      'data_sync.run.started',
      expect.objectContaining({ resumed: true }),
    )
  })
})
