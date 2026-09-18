/**
 * The engine drives adapter streams by hand (so each batch can own a root span)
 * instead of with `for await`. `for await` closed the iterator on every early
 * exit, which is what runs an adapter generator's `finally` — its connection
 * teardown, its temp-file cleanup. These tests pin that behaviour so the
 * hand-rolled loop can never quietly regress it.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import type { SyncRunService } from '../sync-run-service'

const mockGetDataSyncAdapter = jest.fn()
const mockGetIntegration = jest.fn()
const mockEmitDataSyncEvent = jest.fn(async () => undefined)

jest.mock('../adapter-registry', () => ({
  getDataSyncAdapter: (...args: unknown[]) => mockGetDataSyncAdapter(...args),
  // Mirrors the real helper: the engine resolves the provider key through the
  // integration registry, falling back to the integration id. Omitting it here
  // made every case in this suite throw once the engine started calling it.
  resolveProviderKey: (integrationId: string) => mockGetIntegration(integrationId)?.providerKey ?? integrationId,
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
}))

jest.mock('../../events', () => ({
  emitDataSyncEvent: (...args: unknown[]) => mockEmitDataSyncEvent(...args),
}))

jest.mock('../../../query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn(async () => undefined),
}))

import { createSyncEngine } from '../sync-engine'
import { SyncRunOwnershipConflictError } from '../sync-run-service'

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

const baseRun = {
  id: 'run-1',
  integrationId: 'integration-1',
  entityType: 'customers',
  direction: 'import' as const,
  status: 'pending',
  cursor: null,
  progressJobId: 'job-1',
  batchesCompleted: 0,
}

function importStream(onClose: () => void) {
  return (async function* () {
    try {
      let index = 0
      for (;;) {
        yield { items: [], cursor: `cursor-${index}`, hasMore: true, batchIndex: index }
        index += 1
      }
    } finally {
      onClose()
    }
  })()
}

function createEngine(overrides: {
  syncRunService?: Partial<SyncRunService>
  progressService?: Partial<ProgressService>
}) {
  const syncRunService = {
    getRun: jest.fn(async () => ({ ...baseRun })),
    markStatus: jest.fn(async (_id: string, status: string) => ({ ...baseRun, status })),
    commitBatchProgress: jest.fn(async () => undefined),
    ...overrides.syncRunService,
  } as unknown as SyncRunService

  const progressService = {
    startJob: jest.fn(async () => undefined),
    getJob: jest.fn(async () => null),
    isCancellationRequested: jest.fn(async () => false),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
    ...overrides.progressService,
  } as unknown as ProgressService

  const engine = createSyncEngine({
    em: {} as EntityManager,
    syncRunService,
    integrationCredentialsService: {
      resolve: jest.fn(async () => ({ token: 'secret' })),
    } as unknown as CredentialsService,
    integrationLogService: { write: jest.fn(async () => undefined) } as unknown as IntegrationLogService,
    integrationStateService: { upsert: jest.fn(async () => undefined) } as never,
    progressService,
  })

  return { engine, syncRunService, progressService }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
})

describe('sync engine closes adapter streams on every exit path', () => {
  it('closes the stream and finalizes when the run is cancelled mid-import', async () => {
    const closed = jest.fn()
    mockGetDataSyncAdapter.mockReturnValue({
      getMapping: jest.fn(async () => ({ entityType: 'customers', fields: [], matchStrategy: 'externalId' })),
      streamImport: jest.fn(() => importStream(closed)),
    })

    const { engine, syncRunService, progressService } = createEngine({
      progressService: {
        // Runs, commits one batch, then the user cancels.
        isCancellationRequested: jest
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValue(true),
      },
    })

    await engine.runImport('run-1', 100, scope)

    expect(closed).toHaveBeenCalledTimes(1)
    expect(syncRunService.markStatus).toHaveBeenCalledWith('run-1', 'cancelled', scope, undefined)
    expect(progressService.markCancelled).toHaveBeenCalled()
  })

  it('closes the stream and finalizes as failed when a batch commit throws', async () => {
    const closed = jest.fn()
    mockGetDataSyncAdapter.mockReturnValue({
      getMapping: jest.fn(async () => ({ entityType: 'customers', fields: [], matchStrategy: 'externalId' })),
      streamImport: jest.fn(() => importStream(closed)),
    })

    const { engine, syncRunService } = createEngine({
      syncRunService: {
        commitBatchProgress: jest.fn(async () => {
          throw new Error('commit blew up')
        }),
      },
    })

    await engine.runImport('run-1', 100, scope)

    expect(closed).toHaveBeenCalledTimes(1)
    expect(syncRunService.markStatus).toHaveBeenCalledWith('run-1', 'failed', scope, 'commit blew up')
  })

  it('closes the stream when it yields the run to a concurrent worker', async () => {
    const closed = jest.fn()
    mockGetDataSyncAdapter.mockReturnValue({
      getMapping: jest.fn(async () => ({ entityType: 'customers', fields: [], matchStrategy: 'externalId' })),
      streamImport: jest.fn(() => importStream(closed)),
    })

    const { engine, syncRunService } = createEngine({
      syncRunService: {
        commitBatchProgress: jest.fn(async () => {
          throw new SyncRunOwnershipConflictError(1)
        }),
      },
    })

    await engine.runImport('run-1', 100, scope)

    expect(closed).toHaveBeenCalledTimes(1)
    // A displaced worker stays silent — it must not finalize a run another
    // worker is still advancing.
    expect(syncRunService.markStatus).not.toHaveBeenCalledWith('run-1', 'failed', scope, expect.anything())
  })
})
