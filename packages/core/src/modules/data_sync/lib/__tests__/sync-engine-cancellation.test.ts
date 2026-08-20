import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import { STALE_JOB_TIMEOUT_SECONDS } from '../../../progress/lib/progressService'
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

// The cancellation poll shares the heartbeat timer, so a cancel lands one tick after it is
// requested rather than immediately.
const CANCELLATION_TICK_MS = (STALE_JOB_TIMEOUT_SECONDS * 1000) / 4

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
    getJob: jest.fn(async () => null),
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
  syncRunService: SyncRunService
}) {
  mockGetDataSyncAdapter.mockReturnValue(params.adapter)
  return createSyncEngine({
    em: {} as EntityManager,
    syncRunService: params.syncRunService,
    integrationCredentialsService: {
      resolve: jest.fn(async () => ({})),
    } as unknown as CredentialsService,
    integrationLogService: {
      write: jest.fn(async () => undefined),
    } as unknown as IntegrationLogService,
    progressService: params.progressService,
  })
}

/** Resolves when the engine aborts the signal, so the adapter can act mid-batch. */
function whenAborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise<void>(() => {})
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const baseRun = {
  id: 'run-cancel-1',
  integrationId: 'sync_excel',
  entityType: 'customers.person',
  status: 'pending',
  cursor: null,
  progressJobId: 'job-cancel-1',
  createdCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  batchesCompleted: 0,
}

const importRun = { ...baseRun, direction: 'import' }
const exportRun = { ...baseRun, direction: 'export' }

const mapping = {
  entityType: 'customers.person',
  matchStrategy: 'externalId' as const,
  fields: [],
}

function importBatch(batchIndex: number) {
  return {
    items: [{ externalId: `record-${batchIndex}`, action: 'create' as const, data: {} }],
    cursor: `cursor-${batchIndex}`,
    hasMore: true,
    batchIndex,
  }
}

function exportBatch(batchIndex: number) {
  return {
    results: [{ localId: `local-${batchIndex}`, status: 'success' as const }],
    cursor: `cursor-${batchIndex}`,
    hasMore: true,
    batchIndex,
  }
}

function importAdapter(streamImport: DataSyncAdapter['streamImport']): DataSyncAdapter {
  return {
    providerKey: 'excel',
    direction: 'import',
    supportedEntities: ['customers.person'],
    getMapping: jest.fn(async () => mapping),
    streamImport,
  }
}

function exportAdapter(streamExport: DataSyncAdapter['streamExport']): DataSyncAdapter {
  return {
    providerKey: 'excel',
    direction: 'export',
    supportedEntities: ['customers.person'],
    getMapping: jest.fn(async () => mapping),
    streamExport,
  }
}

describe('data sync engine cancellation reaches the adapter mid-batch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('runImport', () => {
    it('finalizes cancelled when a signal-honouring adapter returns without yielding', async () => {
      const entered = makeDeferred()
      const adapter = importAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        if (signal?.aborted) return
        yield importBatch(0)
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runImport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(syncRunService.commitBatchProgress as jest.Mock).not.toHaveBeenCalled()
      expect(progressService.markCancelled).toHaveBeenCalledWith('job-cancel-1', expect.objectContaining({ tenantId: 'tenant-1' }))
      expect(progressService.completeJob).not.toHaveBeenCalled()
      expect(mockEmitDataSyncEvent).toHaveBeenCalledWith('data_sync.run.cancelled', expect.objectContaining({ runId: 'run-cancel-1' }))
    })

    it('aborts the signal while a batch is still in flight', async () => {
      const entered = makeDeferred()
      let abortedMidBatch = false
      const adapter = importAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        if (signal?.aborted) {
          abortedMidBatch = true
          return
        }
        yield importBatch(0)
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runImport('run-cancel-1', 100, createScope())
      await entered.promise
      expect(abortedMidBatch).toBe(false)

      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(abortedMidBatch).toBe(true)
      expect(progressService.isCancellationRequested).toHaveBeenCalledWith('job-cancel-1', 'tenant-1', 'org-1')
    })

    it('still cancels between batches when the adapter ignores the signal', async () => {
      const yielded: number[] = []
      const adapter = importAdapter(async function* () {
        for (const batchIndex of [0, 1, 2]) {
          yielded.push(batchIndex)
          yield importBatch(batchIndex)
        }
      })
      const answers = [false, true]
      let call = 0
      const progressService = createProgressService({
        isCancellationRequested: jest.fn(async () => answers[call++] ?? true),
      })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      await engine.runImport('run-cancel-1', 100, createScope())

      expect(yielded).toEqual([0, 1])
      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledTimes(1)
      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledWith(
        'run-cancel-1',
        expect.anything(),
        'cursor-0',
        expect.anything(),
        expect.anything(),
      )
      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(progressService.completeJob).not.toHaveBeenCalled()
    })

    it('reports completed when the stream drains after its final batch and the cancel lands during the last read', async () => {
      // An adapter that ignores the signal and reports hasMore: false has delivered everything it
      // had. Calling that cancelled would tell the operator a complete sync was partial and leave a
      // finished run resumable.
      const adapter = importAdapter(async function* () {
        yield { ...importBatch(0), hasMore: false }
        await new Promise((resolve) => setTimeout(resolve, 30_000))
      })
      let call = 0
      const progressService = createProgressService({
        isCancellationRequested: jest.fn(async () => call++ > 0),
      })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runImport('run-cancel-1', 100, createScope())
      await jest.advanceTimersByTimeAsync(30_000)
      await running

      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledTimes(1)
      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'completed', expect.anything(), undefined)
      expect(progressService.completeJob).toHaveBeenCalled()
      expect(progressService.markCancelled).not.toHaveBeenCalled()
    })

    it('reports failed, not cancelled, when an unrelated error coincides with the cancel', async () => {
      const entered = makeDeferred()
      const adapter = importAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        throw new Error('upstream 500')
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runImport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'failed', expect.anything(), 'upstream 500')
      expect(progressService.failJob).toHaveBeenCalled()
      expect(progressService.markCancelled).not.toHaveBeenCalled()
    })

    it('reports cancelled when a signal-honouring adapter rejects with an AbortError', async () => {
      const entered = makeDeferred()
      const adapter = importAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        const abortError = new Error('The operation was aborted')
        abortError.name = 'AbortError'
        throw abortError
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(importRun)
      const engine = buildEngine({ run: importRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runImport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(progressService.markCancelled).toHaveBeenCalled()
      expect(progressService.failJob).not.toHaveBeenCalled()
    })
  })

  describe('runExport', () => {
    it('finalizes cancelled when a signal-honouring adapter returns without yielding', async () => {
      const entered = makeDeferred()
      const adapter = exportAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        if (signal?.aborted) return
        yield exportBatch(0)
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runExport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(syncRunService.commitBatchProgress as jest.Mock).not.toHaveBeenCalled()
      expect(progressService.markCancelled).toHaveBeenCalledWith('job-cancel-1', expect.objectContaining({ tenantId: 'tenant-1' }))
      expect(progressService.completeJob).not.toHaveBeenCalled()
      expect(mockEmitDataSyncEvent).toHaveBeenCalledWith('data_sync.run.cancelled', expect.objectContaining({ runId: 'run-cancel-1' }))
    })

    it('aborts the signal while a batch is still in flight', async () => {
      const entered = makeDeferred()
      let abortedMidBatch = false
      const adapter = exportAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        if (signal?.aborted) {
          abortedMidBatch = true
          return
        }
        yield exportBatch(0)
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runExport('run-cancel-1', 100, createScope())
      await entered.promise
      expect(abortedMidBatch).toBe(false)

      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(abortedMidBatch).toBe(true)
      expect(progressService.isCancellationRequested).toHaveBeenCalledWith('job-cancel-1', 'tenant-1', 'org-1')
    })

    it('still cancels between batches when the adapter ignores the signal', async () => {
      const yielded: number[] = []
      const adapter = exportAdapter(async function* () {
        for (const batchIndex of [0, 1, 2]) {
          yielded.push(batchIndex)
          yield exportBatch(batchIndex)
        }
      })
      const answers = [false, true]
      let call = 0
      const progressService = createProgressService({
        isCancellationRequested: jest.fn(async () => answers[call++] ?? true),
      })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      await engine.runExport('run-cancel-1', 100, createScope())

      expect(yielded).toEqual([0, 1])
      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledTimes(1)
      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledWith(
        'run-cancel-1',
        expect.anything(),
        'cursor-0',
        expect.anything(),
        expect.anything(),
      )
      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(progressService.completeJob).not.toHaveBeenCalled()
    })

    it('reports completed when the stream drains after its final batch and the cancel lands during the last read', async () => {
      const adapter = exportAdapter(async function* () {
        yield { ...exportBatch(0), hasMore: false }
        await new Promise((resolve) => setTimeout(resolve, 30_000))
      })
      let call = 0
      const progressService = createProgressService({
        isCancellationRequested: jest.fn(async () => call++ > 0),
      })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runExport('run-cancel-1', 100, createScope())
      await jest.advanceTimersByTimeAsync(30_000)
      await running

      expect(syncRunService.commitBatchProgress as jest.Mock).toHaveBeenCalledTimes(1)
      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'completed', expect.anything(), undefined)
      expect(progressService.completeJob).toHaveBeenCalled()
      expect(progressService.markCancelled).not.toHaveBeenCalled()
    })

    it('reports failed, not cancelled, when an unrelated error coincides with the cancel', async () => {
      const entered = makeDeferred()
      const adapter = exportAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        throw new Error('upstream 500')
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runExport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'failed', expect.anything(), 'upstream 500')
      expect(progressService.failJob).toHaveBeenCalled()
      expect(progressService.markCancelled).not.toHaveBeenCalled()
    })

    it('reports cancelled when a signal-honouring adapter rejects with an AbortError', async () => {
      const entered = makeDeferred()
      const adapter = exportAdapter(async function* ({ signal }) {
        entered.resolve()
        await whenAborted(signal)
        const abortError = new Error('The operation was aborted')
        abortError.name = 'AbortError'
        throw abortError
      })
      const progressService = createProgressService({ isCancellationRequested: jest.fn(async () => true) })
      const syncRunService = createSyncRunService(exportRun)
      const engine = buildEngine({ run: exportRun, adapter, progressService, syncRunService })

      jest.useFakeTimers()
      const running = engine.runExport('run-cancel-1', 100, createScope())
      await entered.promise
      await jest.advanceTimersByTimeAsync(CANCELLATION_TICK_MS)
      await running

      expect(syncRunService.markStatus as jest.Mock).toHaveBeenLastCalledWith('run-cancel-1', 'cancelled', expect.anything(), undefined)
      expect(progressService.markCancelled).toHaveBeenCalled()
      expect(progressService.failJob).not.toHaveBeenCalled()
    })
  })
})
