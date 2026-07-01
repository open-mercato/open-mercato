import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import type { DataSyncAdapter } from '../adapter'
import type { SyncRunService } from '../sync-run-service'

const mockGetDataSyncAdapter = jest.fn()
const mockGetIntegration = jest.fn()
const mockEmitDataSyncEvent = jest.fn(async () => undefined)

jest.mock('../adapter-registry', () => ({
  getDataSyncAdapter: (...args: unknown[]) => mockGetDataSyncAdapter(...args),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
}))

jest.mock('../../events', () => ({
  emitDataSyncEvent: (...args: unknown[]) => mockEmitDataSyncEvent(...args),
}))

import { createSyncEngine } from '../sync-engine'

describe('data sync engine export item failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('counts and logs failed export items without failing the run', async () => {
    const adapter: DataSyncAdapter = {
      providerKey: 'magento_products',
      direction: 'export',
      supportedEntities: ['products'],
      getMapping: jest.fn(async () => ({
        entityType: 'products',
        fields: [],
        matchStrategy: 'externalId',
      })),
      streamExport: async function* () {
        yield {
          results: [
            {
              localId: 'product-1',
              externalId: 'SKU-1',
              status: 'error',
              error: 'Magento API request failed with status 400: {"message":"URL key for specified store already exists."}',
            },
          ],
          cursor: 'cursor-1',
          hasMore: false,
          batchIndex: 0,
        }
      },
    }

    mockGetIntegration.mockReturnValue({ providerKey: 'magento_products' })
    mockGetDataSyncAdapter.mockReturnValue(adapter)

    const syncRunService = {
      getRun: jest.fn(async () => ({
        id: 'run-1',
        integrationId: 'sync_magento',
        entityType: 'products',
        direction: 'export',
        status: 'pending',
        cursor: null,
        progressJobId: 'job-1',
      })),
      markStatus: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'run-1',
          integrationId: 'sync_magento',
          entityType: 'products',
          direction: 'export',
          status: 'running',
          progressJobId: 'job-1',
        })
        .mockResolvedValueOnce({
          id: 'run-1',
          integrationId: 'sync_magento',
          entityType: 'products',
          direction: 'export',
          status: 'completed',
          progressJobId: 'job-1',
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          batchesCompleted: 1,
        }),
      commitBatchProgress: jest.fn(async () => undefined),
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
      integrationStateService: {
        upsert: jest.fn(async () => undefined),
      } as any,
      progressService,
    })

    await engine.runExport('run-1', 100, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })

    expect((syncRunService as any).commitBatchProgress).toHaveBeenCalledWith('run-1', expect.objectContaining({
      failedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      batchesCompleted: 1,
    }), 'cursor-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    expect((integrationLogService as any).write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_magento',
      runId: 'run-1',
      level: 'error',
      message: expect.stringContaining('Failed to export item SKU-1 (id: product-1)'),
      payload: {
        summary: 'Magento API request failed with status 400: {"message":"URL key for specified store already exists."}',
      },
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
})
