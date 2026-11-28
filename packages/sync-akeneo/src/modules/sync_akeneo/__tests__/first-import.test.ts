import type { AwilixContainer } from 'awilix'
import type { startDataSyncRun } from '@open-mercato/core/modules/data_sync/lib/start-run'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AKENEO_FIRST_IMPORT_QUEUE, runAkeneoFirstImportSequence } from '../lib/first-import'
import handleFirstImport from '../workers/first-import'

const mockStartDataSyncRun = jest.fn()
const mockEnqueue = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))

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
const disabledMessage = 'sync_akeneo.firstImport.integrationDisabled'

function buildHarness() {
  const progressService = {
    startJob: jest.fn(async () => undefined),
    createJob: jest.fn(async () => ({ id: 'run-job-1' })),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
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
  const integrationStateService = { isEnabled: jest.fn(async () => true) }
  const services: Record<string, unknown> = {
    em: { clear: jest.fn() },
    progressService,
    dataSyncRunService: syncRunService,
    integrationStateService,
  }
  const container = { resolve: (token: string) => services[token] } as AwilixContainer
  return { container, progressService, syncRunService, integrationStateService }
}

describe('Akeneo first import sequence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates batch size resolution to the shared helper for every step', async () => {
    const { container, progressService, syncRunService, integrationStateService } = buildHarness()

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
      expect(integrationStateService.isEnabled).toHaveBeenNthCalledWith(stepIndex + 1, 'sync_akeneo', scope)
      expect(syncRunService.findRunningOverlap).toHaveBeenNthCalledWith(stepIndex + 1, 'sync_akeneo', entityType, 'import', scope)
      expect(mockEnqueue).toHaveBeenNthCalledWith(stepIndex + 1, {
        runId: `run-${entityType}`,
        batchSize: 100,
        scope,
      })
    }
    expect(progressService.completeJob).toHaveBeenCalledWith('sequence-job-1', expect.any(Object), scope)
  })

  it.each([
    { name: 'before the worker starts', enabledChecks: [false], expectedRuns: 0 },
    { name: 'between steps', enabledChecks: [true, false], expectedRuns: 1 },
  ])('stops the queued sequence without a retry when disabled $name', async ({ enabledChecks, expectedRuns }) => {
    const { container, progressService, syncRunService, integrationStateService } = buildHarness()
    for (const enabled of enabledChecks) {
      integrationStateService.isEnabled.mockResolvedValueOnce(enabled)
    }
    jest.mocked(createRequestContainer).mockResolvedValue(
      container as Awaited<ReturnType<typeof createRequestContainer>>,
    )
    const progressJobId = 'sequence-job-1'

    await expect(handleFirstImport(
      { id: 'queue-job-1', createdAt: new Date(0).toISOString(), payload: { progressJobId, scope } },
      { jobId: 'queue-job-1', attemptNumber: 1, queueName: AKENEO_FIRST_IMPORT_QUEUE, resolve: container.resolve },
    )).resolves.toBeUndefined()

    expect(integrationStateService.isEnabled).toHaveBeenLastCalledWith('sync_akeneo', scope)
    expect(syncRunService.findRunningOverlap).toHaveBeenCalledTimes(expectedRuns)
    expect(syncRunService.createRun).toHaveBeenCalledTimes(expectedRuns)
    expect(mockEnqueue).toHaveBeenCalledTimes(expectedRuns)
    expect(progressService.failJob).toHaveBeenCalledWith(progressJobId, { errorMessage: disabledMessage }, scope)
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })
})
