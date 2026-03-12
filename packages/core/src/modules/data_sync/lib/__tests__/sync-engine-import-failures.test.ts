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

describe('data sync engine import item failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('counts and logs failed import items without failing the run', async () => {
    const adapter: DataSyncAdapter = {
      providerKey: 'akeneo',
      direction: 'import',
      supportedEntities: ['products'],
      getMapping: jest.fn(async () => ({
        entityType: 'products',
        fields: [],
        matchStrategy: 'externalId',
      })),
      streamImport: async function* () {
        yield {
          items: [
            {
              externalId: 'product-1',
              action: 'failed',
              data: {
                errorMessage: 'Akeneo media file missing-image.jpg was not found',
                sourceProductUuid: 'product-1',
                sourceIdentifier: 'sku-1',
              },
            },
          ],
          cursor: 'cursor-1',
          hasMore: false,
          batchIndex: 0,
        }
      },
    }

    mockGetIntegration.mockReturnValue({ providerKey: 'akeneo' })
    mockGetDataSyncAdapter.mockReturnValue(adapter)

    const syncRunService = {
      getRun: jest.fn(async () => ({
        id: 'run-1',
        integrationId: 'sync_akeneo',
        entityType: 'products',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-1',
      })),
      markStatus: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'run-1',
          integrationId: 'sync_akeneo',
          entityType: 'products',
          direction: 'import',
          status: 'running',
          progressJobId: 'job-1',
        })
        .mockResolvedValueOnce({
          id: 'run-1',
          integrationId: 'sync_akeneo',
          entityType: 'products',
          direction: 'import',
          status: 'completed',
          progressJobId: 'job-1',
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          batchesCompleted: 1,
        }),
      updateCounts: jest.fn(async () => undefined),
      updateCursor: jest.fn(async () => undefined),
    } as unknown as SyncRunService

    const integrationCredentialsService = {
      resolve: jest.fn(async () => ({ apiUrl: 'https://example.test' })),
    } as unknown as CredentialsService

    const integrationLogService = {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService

    const progressService = {
      startJob: jest.fn(async () => undefined),
      isCancellationRequested: jest.fn(async () => false),
      updateProgress: jest.fn(async () => undefined),
      completeJob: jest.fn(async () => undefined),
    } as unknown as ProgressService

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService,
      integrationLogService,
      progressService,
    })

    await engine.runImport('run-1', 100, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })

    expect((syncRunService as any).updateCounts).toHaveBeenCalledWith('run-1', expect.objectContaining({
      failedCount: 1,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      batchesCompleted: 1,
    }), {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    expect((integrationLogService as any).write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_akeneo',
      runId: 'run-1',
      level: 'error',
      message: expect.stringContaining('Failed to import Akeneo product product-1'),
      payload: expect.objectContaining({
        errorMessage: 'Akeneo media file missing-image.jpg was not found',
        sourceProductUuid: 'product-1',
      }),
    }), {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    expect((syncRunService as any).markStatus).toHaveBeenLastCalledWith('run-1', 'completed', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    }, undefined)
  })

  it('tracks processed source records separately from emitted import items', async () => {
    const adapter: DataSyncAdapter = {
      providerKey: 'akeneo',
      direction: 'import',
      supportedEntities: ['products'],
      getMapping: jest.fn(async () => ({
        entityType: 'products',
        fields: [],
        matchStrategy: 'externalId',
      })),
      streamImport: async function* () {
        yield {
          items: [
            {
              externalId: 'product-1',
              action: 'create',
              data: { localProductId: 'prod-1' },
            },
            {
              externalId: 'product-1:default',
              action: 'create',
              data: { localVariantId: 'variant-1' },
            },
          ],
          processedCount: 1,
          totalEstimate: 1320,
          refreshCoverageEntityTypes: ['catalog:catalog_product', 'catalog:catalog_product_variant'],
          cursor: 'cursor-1',
          hasMore: false,
          batchIndex: 0,
        }
      },
    }

    mockGetIntegration.mockReturnValue({ providerKey: 'akeneo' })
    mockGetDataSyncAdapter.mockReturnValue(adapter)

    const syncRunService = {
      getRun: jest.fn(async () => ({
        id: 'run-2',
        integrationId: 'sync_akeneo',
        entityType: 'products',
        direction: 'import',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-2',
      })),
      markStatus: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'run-2',
          integrationId: 'sync_akeneo',
          entityType: 'products',
          direction: 'import',
          status: 'running',
          progressJobId: 'job-2',
        })
        .mockResolvedValueOnce({
          id: 'run-2',
          integrationId: 'sync_akeneo',
          entityType: 'products',
          direction: 'import',
          status: 'completed',
          progressJobId: 'job-2',
          createdCount: 2,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          batchesCompleted: 1,
        }),
      updateCounts: jest.fn(async () => undefined),
      updateCursor: jest.fn(async () => undefined),
    } as unknown as SyncRunService

    const integrationCredentialsService = {
      resolve: jest.fn(async () => ({ apiUrl: 'https://example.test' })),
    } as unknown as CredentialsService

    const integrationLogService = {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService

    const progressService = {
      startJob: jest.fn(async () => undefined),
      isCancellationRequested: jest.fn(async () => false),
      updateProgress: jest.fn(async () => undefined),
      completeJob: jest.fn(async () => undefined),
    } as unknown as ProgressService

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService,
      integrationLogService,
      progressService,
    })

    await engine.runImport('run-2', 100, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })

    expect((progressService as any).updateProgress).toHaveBeenCalledWith('job-2', {
      processedCount: 1,
      totalCount: 1320,
    }, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalledTimes(2)
    expect(mockRefreshCoverageSnapshot).toHaveBeenNthCalledWith(1, {}, {
      entityType: 'catalog:catalog_product',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockRefreshCoverageSnapshot).toHaveBeenNthCalledWith(2, {}, {
      entityType: 'catalog:catalog_product_variant',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
