import type { AwilixContainer } from 'awilix'
import type { startDataSyncRun } from '@open-mercato/core/modules/data_sync/lib/start-run'
import { runAkeneoFirstImportSequence } from '../lib/first-import'

const mockStartDataSyncRun = jest.fn()
const mockEnqueue = jest.fn()

jest.mock('@open-mercato/core/modules/data_sync/lib/queue', () => ({
  getSyncQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

jest.mock('@open-mercato/core/modules/data_sync/lib/start-run', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/core/modules/data_sync/lib/start-run')>(
    '@open-mercato/core/modules/data_sync/lib/start-run',
  )
  return {
    ...actual,
    startDataSyncRun: (params: Parameters<typeof startDataSyncRun>[0]) => {
      mockStartDataSyncRun(params)
      return actual.startDataSyncRun(params)
    },
  }
})

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function buildHarness() {
  const progressService = {
    startJob: jest.fn(async () => undefined),
    createJob: jest.fn(async () => ({ id: 'run-job-1' })),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    getJob: jest.fn(async () => ({ totalCount: 1, processedCount: 1, progressPercent: 100 })),
  }
  const syncRunService = {
    findRunningOverlap: jest.fn(async () => null),
    createRun: jest.fn(async (input: { entityType: string; progressJobId: string | null }) => ({
      id: `run-${input.entityType}`,
      status: 'pending',
      progressJobId: input.progressJobId,
    })),
    getRun: jest.fn(async (runId: string) => ({ id: runId, status: 'completed', progressJobId: 'run-job-1' })),
  }
  const services: Record<string, unknown> = {
    em: { clear: jest.fn() },
    progressService,
    dataSyncRunService: syncRunService,
  }
  const container = { resolve: (token: string) => services[token] } as unknown as AwilixContainer
  return { container, progressService, syncRunService }
}

describe('Akeneo first import batch size', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates batch size resolution to the shared helper for every step', async () => {
    const { container, progressService, syncRunService } = buildHarness()

    await runAkeneoFirstImportSequence({ container, progressJobId: 'sequence-job-1', scope })

    expect(mockStartDataSyncRun).toHaveBeenCalledTimes(3)
    for (const [stepIndex, entityType] of ['categories', 'attributes', 'products'].entries()) {
      const [params] = mockStartDataSyncRun.mock.calls[stepIndex] as [Parameters<typeof startDataSyncRun>[0]]
      expect(params.input).toEqual({
        integrationId: 'sync_akeneo',
        entityType,
        direction: 'import',
        triggeredBy: scope.userId,
      })
      expect(params.scope).toEqual(scope)
      expect(syncRunService.findRunningOverlap).toHaveBeenNthCalledWith(stepIndex + 1, 'sync_akeneo', entityType, 'import', scope)
      expect(mockEnqueue).toHaveBeenNthCalledWith(stepIndex + 1, {
        runId: `run-${entityType}`,
        batchSize: 100,
        scope,
      })
    }
    expect(progressService.completeJob).toHaveBeenCalledWith('sequence-job-1', expect.any(Object), scope)
  })
})
