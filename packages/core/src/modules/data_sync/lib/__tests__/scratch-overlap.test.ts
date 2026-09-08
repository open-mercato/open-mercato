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
  resolveProviderKey: (integrationId: string) => mockGetIntegration(integrationId)?.providerKey ?? integrationId,
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

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }
const baseImportRun = {
  id: 'run-hb-1', integrationId: 'sync_excel', entityType: 'customers.person',
  direction: 'import', status: 'pending', cursor: null, progressJobId: 'job-hb-1',
  createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, batchesCompleted: 0,
}

function importBatch(itemCount: number, batchIndex = 0) {
  return {
    items: Array.from({ length: itemCount }, (_v, i) => ({ externalId: `r-${batchIndex}-${i}`, action: 'create' as const, data: {} })),
    cursor: `cursor-${batchIndex}`, hasMore: false, batchIndex,
  }
}

describe('scratch: does the cancellation poll overlap the engine EM write window?', () => {
  beforeEach(() => { jest.clearAllMocks(); mockGetIntegration.mockReturnValue({ providerKey: 'excel' }) })
  afterEach(() => { jest.useRealTimers() })

  it('records whether isCancellationRequested fires while commitBatchProgress is in flight', async () => {
    jest.useFakeTimers()
    let commitInFlight = false
    const pollsDuringCommit: number[] = []

    const isCancellationRequested = jest.fn(async () => {
      if (commitInFlight) pollsDuringCommit.push(Date.now())
      return false
    })
    const progressService = {
      startJob: jest.fn(async () => undefined),
      isCancellationRequested,
      getJob: jest.fn(async () => null),
      updateProgress: jest.fn(async () => undefined),
      completeJob: jest.fn(async () => undefined),
      failJob: jest.fn(async () => undefined),
      markCancelled: jest.fn(async () => undefined),
      touchJobHeartbeat: jest.fn(async () => undefined),
    } as unknown as ProgressService

    const syncRunService = {
      getRun: jest.fn(async () => baseImportRun),
      markStatus: jest.fn(async (_r: string, status: string) => ({ ...baseImportRun, status })),
      // Stands in for withAtomicFlush(em, ..., { transaction: true }): the shared
      // EntityManager is inside em.begin()/em.commit() for this whole window.
      commitBatchProgress: jest.fn(async () => {
        commitInFlight = true
        await new Promise((resolve) => setTimeout(resolve, 40_000))
        commitInFlight = false
      }),
    } as unknown as SyncRunService

    const adapter = {
      providerKey: 'excel', direction: 'import', supportedEntities: ['customers.person'],
      getMapping: jest.fn(async () => ({ entityType: 'customers.person', matchStrategy: 'externalId', fields: [] })),
      streamImport: jest.fn(async function* () { yield importBatch(1, 0) }),
    } as unknown as DataSyncAdapter

    mockGetDataSyncAdapter.mockReturnValue(adapter)
    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: { resolve: jest.fn(async () => ({})) } as unknown as CredentialsService,
      integrationLogService: { write: jest.fn(async () => undefined) } as unknown as IntegrationLogService,
      progressService,
    })

    const runPromise = engine.runImport('run-hb-1', 100, scope)
    await jest.advanceTimersByTimeAsync(60_000)
    await runPromise

    // eslint-disable-next-line no-console
    console.log('POLLS DURING COMMIT WINDOW:', pollsDuringCommit.length)
    expect(pollsDuringCommit.length).toBe(0)
  })
})
