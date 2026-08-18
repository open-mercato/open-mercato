/** @jest-environment node */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncRun } from '../../data/entities'
import { createSyncRunService } from '../sync-run-service'
import { getSyncQueue } from '../queue'

// `getSyncQueue` memoizes its queues, so the hook is only handed over on the first call per queue
// name. Record it here rather than reading it back off the mock's call list, which the per-test
// reset clears.
const mockRegisteredHooks = new Map<string, unknown>()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn((name: string, options?: { onJobAbandoned?: unknown }) => {
    mockRegisteredHooks.set(name, options?.onJobAbandoned)
    return { name, strategy: 'async' }
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findAndCountWithDecryption: jest.fn().mockResolvedValue([[], 0]),
}))

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

type AbandonedHook = (payload: unknown, info: { jobId: string | null; reason: string }) => Promise<void>

const createRequestContainerMock = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>

function abandonedHookFor(queueName: string): AbandonedHook | undefined {
  getSyncQueue(queueName)
  return mockRegisteredHooks.get(queueName) as AbandonedHook | undefined
}

function abandonedJob(payload: unknown) {
  return { id: 'job-1', payload, createdAt: new Date(0).toISOString() }
}

function stubRunService(markStatus: jest.Mock) {
  createRequestContainerMock.mockResolvedValue({
    resolve: (name: string) => {
      if (name !== 'dataSyncRunService') throw new Error(`[internal] unexpected resolve: ${name}`)
      return { markStatus }
    },
  } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
}

describe('data_sync queue — abandoned job repair', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Which queues receive the callback is asserted in `queue.test.ts`, next to the rest of the
  // resumable-queue policy. These cover what the callback itself does once it fires.
  it('marks the run failed with the reason the queue reported', async () => {
    const markStatus = jest.fn(async () => null)
    stubRunService(markStatus)

    const hook = abandonedHookFor('data-sync-import')!
    await hook(abandonedJob({ runId: 'run-1', batchSize: 100, scope: { ...SCOPE, userId: null } }), {
      jobId: 'job-1',
      reason: 'job stalled more than allowable limit',
    })

    expect(markStatus).toHaveBeenCalledWith(
      'run-1',
      'failed',
      SCOPE,
      "the queue abandoned this run's job without running it: job stalled more than allowable limit",
    )
  })

  it('does nothing when the payload carries no run id or no tenant scope', async () => {
    const markStatus = jest.fn(async () => null)
    stubRunService(markStatus)

    const hook = abandonedHookFor('data-sync-import')!
    await hook(abandonedJob({ progressJobId: 'progress-1', scope: SCOPE }), { jobId: 'job-1', reason: 'stalled' })
    await hook(abandonedJob({ runId: 'run-1' }), { jobId: 'job-1', reason: 'stalled' })
    await hook(undefined, { jobId: null, reason: 'stalled' })

    expect(markStatus).not.toHaveBeenCalled()
    expect(createRequestContainerMock).not.toHaveBeenCalled()
  })

  it('leaves a run that already finished in its terminal state', async () => {
    const em = { flush: jest.fn().mockResolvedValue(undefined) }
    const run = { id: 'run-1', status: 'completed' as const, lastError: null }
    ;(findOneWithDecryption as jest.Mock).mockImplementation((_em: unknown, entity: unknown) =>
      Promise.resolve(entity === SyncRun ? run : null),
    )
    const runService = createSyncRunService(em as never)
    createRequestContainerMock.mockResolvedValue({
      resolve: () => runService,
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)

    const hook = abandonedHookFor('data-sync-import')!
    await hook(abandonedJob({ runId: 'run-1', scope: SCOPE }), {
      jobId: 'job-1',
      reason: 'job stalled more than allowable limit',
    })

    expect(run.status).toBe('completed')
    expect(run.lastError).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
