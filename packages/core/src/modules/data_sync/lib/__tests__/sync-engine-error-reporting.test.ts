import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import type { DataSyncAdapter, ImportBatch } from '../adapter'
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

type Reported = {
  name: string
  message: string
  code?: string
  attributes?: Record<string, string | number | boolean | undefined>
}

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function runtimeStub() {
  const reported: Reported[] = []
  const runtime = {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: <T>(_carrier: unknown, _name: string, fn: () => T) => fn(),
    withSpan: <T>(_name: string, fn: (span: { setAttributes: () => void }) => T) => fn({ setAttributes: () => {} }),
    recordHttpDuration: () => {},
    reportError: (
      error: unknown,
      context?: { code?: string; attributes?: Record<string, string | number | boolean | undefined> },
    ) => {
      reported.push({
        name: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error),
        code: context?.code,
        attributes: context?.attributes,
      })
    },
    shutdown: async () => {},
  } as unknown as TelemetryRuntime
  return { runtime, reported }
}

function importAdapter(batch: ImportBatch): DataSyncAdapter {
  return {
    providerKey: 'akeneo',
    direction: 'import',
    supportedEntities: ['products'],
    getMapping: jest.fn(async () => ({
      entityType: 'products',
      fields: [],
      matchStrategy: 'externalId',
    })),
    streamImport: async function* () {
      yield batch
    },
  } as unknown as DataSyncAdapter
}

/** `finalCounts` is what the terminal `markStatus` CAS reports back for the run. */
function engineDeps(finalCounts: {
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
}) {
  const runningRun = {
    id: 'run-1',
    integrationId: 'sync_akeneo',
    entityType: 'products',
    direction: 'import',
    status: 'running',
    progressJobId: null,
  }
  const syncRunService = {
    getRun: jest.fn(async () => ({ ...runningRun, status: 'pending', cursor: null })),
    markStatus: jest
      .fn()
      .mockResolvedValueOnce(runningRun)
      .mockResolvedValueOnce({ ...runningRun, status: 'completed', batchesCompleted: 1, ...finalCounts }),
    updateCounts: jest.fn(async () => undefined),
    updateCursor: jest.fn(async () => undefined),
    commitBatchProgress: jest.fn(async () => undefined),
  } as unknown as SyncRunService

  const integrationLogService = { write: jest.fn(async () => undefined) } as unknown as IntegrationLogService

  return {
    syncRunService,
    integrationLogService,
    deps: {
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ apiUrl: 'https://example.test' })),
      } as unknown as CredentialsService,
      integrationLogService,
      progressService: {
        startJob: jest.fn(async () => undefined),
        isCancellationRequested: jest.fn(async () => false),
        getJob: jest.fn(async () => null),
        updateProgress: jest.fn(async () => undefined),
        completeJob: jest.fn(async () => undefined),
      } as unknown as ProgressService,
    },
  }
}

describe('data sync error reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'akeneo' })
    mockRefreshCoverageSnapshot.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetTelemetryRuntime()
  })

  it('gives every dead-lettered item a groupable code, from the adapter or the fallback', async () => {
    const { runtime } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockGetDataSyncAdapter.mockReturnValue(importAdapter({
      items: [
        {
          externalId: 'product-1',
          action: 'failed',
          data: { errorMessage: 'media file missing', errorCode: 'sync_akeneo.media_missing' },
        },
        {
          externalId: 'product-2',
          action: 'failed',
          data: { errorMessage: 'variant has no sku' },
        },
      ],
      cursor: 'cursor-1',
      hasMore: false,
      batchIndex: 0,
    } as unknown as ImportBatch))
    const { integrationLogService, deps } = engineDeps({
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 2,
    })

    await createSyncEngine(deps).runImport('run-1', 100, scope)

    const writes = (integrationLogService as unknown as { write: jest.Mock }).write.mock.calls
    expect(writes[0][0]).toMatchObject({
      level: 'error',
      code: 'sync_akeneo.media_missing',
      message: expect.stringContaining('product-1'),
    })
    expect(writes[1][0]).toMatchObject({
      level: 'error',
      code: 'data_sync.item_failed',
      message: expect.stringContaining('product-2'),
    })
  })

  it('reports one partial-failure summary for a run that completed with failures', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockGetDataSyncAdapter.mockReturnValue(importAdapter({
      items: [{ externalId: 'product-1', action: 'failed', data: { errorMessage: 'media file missing' } }],
      cursor: 'cursor-1',
      hasMore: false,
      batchIndex: 0,
    } as unknown as ImportBatch))
    const { deps } = engineDeps({ createdCount: 4, updatedCount: 2, skippedCount: 1, failedCount: 115 })

    await createSyncEngine(deps).runImport('run-1', 100, scope)

    const summaries = reported.filter((entry) => entry.code === 'data_sync.run_partial_failure')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      name: 'SyncRunPartialFailureError',
      message: 'Sync run completed with 115 failed item(s)',
    })
    expect(summaries[0].attributes).toMatchObject({
      'data_sync.run_id': 'run-1',
      'data_sync.integration_id': 'sync_akeneo',
      'data_sync.failed_count': 115,
      'data_sync.created_count': 4,
      'om.tenant_id': 'tenant-1',
      'om.organization_id': 'org-1',
    })
  })

  it('reports nothing extra for a clean run, and carries the counts on the event', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockGetDataSyncAdapter.mockReturnValue(importAdapter({
      items: [{ externalId: 'product-1', action: 'create', data: { localProductId: 'prod-1' } }],
      cursor: 'cursor-1',
      hasMore: false,
      batchIndex: 0,
    } as unknown as ImportBatch))
    const { deps } = engineDeps({ createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 })

    await createSyncEngine(deps).runImport('run-1', 100, scope)

    expect(reported).toHaveLength(0)
    expect(mockEmitDataSyncEvent).toHaveBeenCalledWith('data_sync.run.completed', expect.objectContaining({
      runId: 'run-1',
      createdCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    }))
  })

  it('reports a dropped coverage refresh instead of swallowing it', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockRefreshCoverageSnapshot.mockRejectedValueOnce(new Error('query index unavailable'))
    mockGetDataSyncAdapter.mockReturnValue(importAdapter({
      items: [{ externalId: 'product-1', action: 'create', data: { localProductId: 'prod-1' } }],
      refreshCoverageEntityTypes: ['catalog:catalog_product'],
      cursor: 'cursor-1',
      hasMore: false,
      batchIndex: 0,
    } as unknown as ImportBatch))
    const { deps } = engineDeps({ createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 })

    await createSyncEngine(deps).runImport('run-1', 100, scope)

    expect(reported).toEqual([
      expect.objectContaining({
        code: 'data_sync.coverage_refresh_failed',
        message: 'query index unavailable',
        attributes: expect.objectContaining({ entityType: 'catalog:catalog_product' }),
      }),
    ])
  })

  it('reports a run fault with a run code, whatever the adapter opted into', async () => {
    const { runtime } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'akeneo',
      direction: 'import',
      supportedEntities: ['products'],
      getMapping: jest.fn(async () => ({ entityType: 'products', fields: [], matchStrategy: 'externalId' })),
      streamImport: async function* () {
        throw new Error('Akeneo returned 500')
      },
    } as unknown as DataSyncAdapter)
    const { integrationLogService, deps } = engineDeps({
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    })

    await createSyncEngine(deps).runImport('run-1', 100, scope)

    const writes = (integrationLogService as unknown as { write: jest.Mock }).write.mock.calls
    expect(writes[0][0]).toMatchObject({
      level: 'error',
      code: 'data_sync.run_failed',
      message: 'Akeneo returned 500',
    })
  })

  it('codes a failed export item so it groups apart from an import failure', async () => {
    const { runtime } = runtimeStub()
    registerTelemetryRuntime(runtime)
    mockGetIntegration.mockReturnValue({ providerKey: 'magento_products' })
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'magento_products',
      direction: 'export',
      supportedEntities: ['products'],
      getMapping: jest.fn(async () => ({ entityType: 'products', fields: [], matchStrategy: 'externalId' })),
      streamExport: async function* () {
        yield {
          results: [{
            localId: 'product-1',
            externalId: 'SKU-1',
            status: 'error',
            error: 'Magento API request failed with status 400',
          }],
          cursor: 'cursor-1',
          hasMore: false,
          batchIndex: 0,
        }
      },
    } as unknown as DataSyncAdapter)
    const { integrationLogService, deps } = engineDeps({
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    })

    await createSyncEngine(deps).runExport('run-1', 100, scope)

    const writes = (integrationLogService as unknown as { write: jest.Mock }).write.mock.calls
    expect(writes[0][0]).toMatchObject({
      level: 'error',
      code: 'data_sync.export_item_failed',
      message: expect.stringContaining('SKU-1'),
    })
  })

  it('leaves the engine working with telemetry off', async () => {
    mockGetDataSyncAdapter.mockReturnValue(importAdapter({
      items: [{ externalId: 'product-1', action: 'failed', data: { errorMessage: 'media file missing' } }],
      cursor: 'cursor-1',
      hasMore: false,
      batchIndex: 0,
    } as unknown as ImportBatch))
    const { syncRunService, deps } = engineDeps({
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    })

    await expect(createSyncEngine(deps).runImport('run-1', 100, scope)).resolves.toBeUndefined()
    expect((syncRunService as unknown as { markStatus: jest.Mock }).markStatus).toHaveBeenLastCalledWith(
      'run-1',
      'completed',
      scope,
      undefined,
    )
  })
})
