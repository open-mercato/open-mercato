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

function createProgressService(overrides: Record<string, unknown> = {}): ProgressService {
  return {
    startJob: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => false),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
    touchJobHeartbeat: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as ProgressService
}

function createSyncRunService(run: Record<string, unknown>): SyncRunService {
  return {
    getRun: jest.fn(async () => run),
    markStatus: jest.fn(async (_runId: string, status: string) => ({ ...run, status })),
    commitBatchProgress: jest.fn(async () => undefined),
  } as unknown as SyncRunService
}

function buildEngine(params: {
  run: Record<string, unknown>
  adapter: DataSyncAdapter
  progressService: ProgressService
  syncRunService?: SyncRunService
}) {
  mockGetDataSyncAdapter.mockReturnValue(params.adapter)
  return createSyncEngine({
    em: {} as EntityManager,
    syncRunService: params.syncRunService ?? createSyncRunService(params.run),
    integrationCredentialsService: {
      resolve: jest.fn(async () => ({})),
    } as unknown as CredentialsService,
    integrationLogService: {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService,
    progressService: params.progressService,
  })
}

const baseImportRun = {
  id: 'run-hb-1',
  integrationId: 'sync_excel',
  entityType: 'customers.person',
  direction: 'import',
  status: 'pending',
  cursor: null,
  progressJobId: 'job-hb-1',
  createdCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  batchesCompleted: 0,
}

function importBatch(itemCount: number, batchIndex = 0) {
  return {
    items: Array.from({ length: itemCount }, (_value, index) => ({
      externalId: `record-${batchIndex}-${index}`,
      action: 'create' as const,
      data: {},
    })),
    cursor: `cursor-${batchIndex}`,
    hasMore: false,
    batchIndex,
  }
}

function importAdapter(streamImport: DataSyncAdapter['streamImport']): DataSyncAdapter {
  return {
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
}

describe('data sync engine heartbeats and resumed progress counts (GSM-314)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('heartbeats every 15s while a batch is being produced and stops when the stream ends', async () => {
    jest.useFakeTimers()
    const streamImport = jest.fn(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 50_000))
      yield importBatch(3)
    })
    const progressService = createProgressService()
    const engine = buildEngine({ run: baseImportRun, adapter: importAdapter(streamImport), progressService })

    const runPromise = engine.runImport('run-hb-1', 100, createScope())
    await jest.advanceTimersByTimeAsync(50_000)
    await runPromise

    const touch = progressService.touchJobHeartbeat as jest.Mock
    expect(touch).toHaveBeenCalledTimes(3)
    expect(touch).toHaveBeenCalledWith('job-hb-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
    })

    await jest.advanceTimersByTimeAsync(120_000)
    expect(touch).toHaveBeenCalledTimes(3)
  })

  it('runs to completion when the progress service does not implement touchJobHeartbeat', async () => {
    jest.useFakeTimers()
    const streamImport = jest.fn(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      yield importBatch(1)
    })
    const progressService = createProgressService({ touchJobHeartbeat: undefined })
    const engine = buildEngine({ run: baseImportRun, adapter: importAdapter(streamImport), progressService })

    const runPromise = engine.runImport('run-hb-1', 100, createScope())
    await jest.advanceTimersByTimeAsync(20_000)
    await expect(runPromise).resolves.toBeUndefined()
    expect(progressService.updateProgress).toHaveBeenCalled()
  })

  it('closes the adapter generator when cancellation exits the batch loop early', async () => {
    let generatorClosed = false
    const streamImport = jest.fn(async function* () {
      try {
        yield importBatch(1, 0)
        yield importBatch(1, 1)
      } finally {
        generatorClosed = true
      }
    })
    const progressService = createProgressService({
      isCancellationRequested: jest.fn(async () => true),
    })
    const engine = buildEngine({ run: baseImportRun, adapter: importAdapter(streamImport), progressService })

    await engine.runImport('run-hb-1', 100, createScope())

    expect(generatorClosed).toBe(true)
    expect(progressService.markCancelled).toHaveBeenCalledWith('job-hb-1', expect.objectContaining({ tenantId: 'tenant-1' }))
  })

  it('seeds the import progress counter from the run counters on redelivery', async () => {
    const resumedRun = {
      ...baseImportRun,
      status: 'running',
      createdCount: 40,
      updatedCount: 5,
      skippedCount: 5,
      failedCount: 0,
      batchesCompleted: 4,
    }
    const streamImport = jest.fn(async function* () {
      yield importBatch(10)
    })
    const progressService = createProgressService()
    const engine = buildEngine({ run: resumedRun, adapter: importAdapter(streamImport), progressService })

    await engine.runImport('run-hb-1', 100, createScope())

    expect(progressService.updateProgress).toHaveBeenCalledWith(
      'job-hb-1',
      expect.objectContaining({ processedCount: 60 }),
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
  })

  it('seeds the export progress counter from the run counters on redelivery', async () => {
    const resumedRun = {
      ...baseImportRun,
      id: 'run-hb-2',
      direction: 'export',
      status: 'running',
      createdCount: 0,
      updatedCount: 45,
      skippedCount: 3,
      failedCount: 2,
      batchesCompleted: 5,
      progressJobId: 'job-hb-2',
    }
    const streamExport = jest.fn(async function* () {
      yield {
        results: Array.from({ length: 10 }, (_value, index) => ({
          externalId: `record-${index}`,
          status: 'success' as const,
        })),
        cursor: 'cursor-0',
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
    const progressService = createProgressService()
    const engine = buildEngine({ run: resumedRun, adapter, progressService })

    await engine.runExport('run-hb-2', 100, createScope())

    expect(progressService.updateProgress).toHaveBeenCalledWith(
      'job-hb-2',
      expect.objectContaining({ processedCount: 60 }),
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
  })
})
