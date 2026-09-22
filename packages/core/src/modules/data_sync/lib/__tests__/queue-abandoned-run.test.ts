/** @jest-environment node */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncRun } from '../../data/entities'
import { createSyncRunService } from '../sync-run-service'
import { failAbandonedRun } from '../abandoned-run'

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

function abandonedHookFor(_queueName: string): AbandonedHook {
  return failAbandonedRun as AbandonedHook
}

function abandonedJob(payload: unknown) {
  return { id: 'job-1', payload, createdAt: new Date(0).toISOString() }
}

function stubContainer(markStatus: jest.Mock, failJob: jest.Mock = jest.fn(async () => ({}))) {
  createRequestContainerMock.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'dataSyncRunService') return { markStatus }
      if (name === 'progressService') return { failJob }
      throw new Error(`[internal] unexpected resolve: ${name}`)
    },
  } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  return { markStatus, failJob }
}

describe('data_sync queue — abandoned job repair', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Where the callback is declared is asserted in `queue.test.ts`; that it reaches the queue the
  // worker actually runs on is asserted in the queue package's worker-runner test. These cover what
  // the callback itself does once it fires.
  it('marks the run failed with the reason the queue reported', async () => {
    const markStatus = jest.fn(async () => null)
    stubContainer(markStatus)

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

  it('fails the run progress job too, with the same reason', async () => {
    const markStatus = jest.fn(async () => ({ id: 'run-1', progressJobId: 'progress-1' }))
    const { failJob } = stubContainer(markStatus)

    const hook = abandonedHookFor('data-sync-import')!
    await hook(abandonedJob({ runId: 'run-1', scope: SCOPE }), {
      jobId: 'job-1',
      reason: 'job stalled more than allowable limit',
    })

    expect(failJob).toHaveBeenCalledWith(
      'progress-1',
      { errorMessage: "the queue abandoned this run's job without running it: job stalled more than allowable limit" },
      SCOPE,
    )
  })

  it('leaves the progress service alone for a run that has no progress job', async () => {
    const markStatus = jest.fn(async () => ({ id: 'run-1', progressJobId: null }))
    const { failJob } = stubContainer(markStatus)

    const hook = abandonedHookFor('data-sync-import')!
    await hook(abandonedJob({ runId: 'run-1', scope: SCOPE }), { jobId: 'job-1', reason: 'stalled' })

    expect(failJob).not.toHaveBeenCalled()
  })

  it('does nothing when the payload carries no run id or no tenant scope', async () => {
    const markStatus = jest.fn(async () => null)
    stubContainer(markStatus)

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
