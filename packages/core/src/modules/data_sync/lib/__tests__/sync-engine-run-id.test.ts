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
})
