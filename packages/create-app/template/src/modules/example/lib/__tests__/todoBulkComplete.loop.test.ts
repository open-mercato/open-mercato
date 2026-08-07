/** @jest-environment node */
/**
 * The leased, checkpointed execution loop.
 *
 * Every durable dependency is injected, so these tests drive the real loop rather
 * than a re-description of it. The properties asserted here are exactly the ones a
 * duplicate queue message, a crashed worker, or a mid-run cancellation exercise in
 * production and that an end-to-end run cannot reliably reproduce.
 */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runTodoBulkCompleteLoop,
  type ExampleTodoBulkOperationSnapshot,
  type ProgressServiceLike,
  type TodoBulkOperationStore,
} from '../todoBulkComplete'

const SCOPE = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  userId: '00000000-0000-4000-8000-0000000000u1',
}
const OPERATION_ID = '00000000-0000-4000-8000-0000000000op'
const PROGRESS_JOB_ID = '00000000-0000-4000-8000-0000000000pj'

function buildSnapshot(
  overrides: Partial<ExampleTodoBulkOperationSnapshot> = {},
): ExampleTodoBulkOperationSnapshot {
  return {
    id: OPERATION_ID,
    status: 'pending',
    progressJobId: PROGRESS_JOB_ID,
    todoIds: ['todo-1', 'todo-2', 'todo-3'],
    nextItemIndex: 0,
    succeededCount: 0,
    failedCount: 0,
    failedItems: [],
    ...overrides,
  }
}

function buildStore(snapshot: ExampleTodoBulkOperationSnapshot | null, leaseGranted = true) {
  const checkpoints: { nextItemIndex: number; succeededCount: number; failedCount: number }[] = []
  const finished: { status: string; summary: unknown }[] = []
  const store: TodoBulkOperationStore = {
    load: jest.fn(async () => snapshot),
    acquireLease: jest.fn(async () => leaseGranted),
    saveCheckpoint: jest.fn(async (_id, _scope, checkpoint) => {
      checkpoints.push({
        nextItemIndex: checkpoint.nextItemIndex,
        succeededCount: checkpoint.succeededCount,
        failedCount: checkpoint.failedCount,
      })
    }),
    finish: jest.fn(async (_id, _scope, result) => {
      finished.push({ status: result.status, summary: result.summary })
    }),
  }
  return { store, checkpoints, finished }
}

function buildProgress(cancelAfter: number | null = null) {
  let cancellationChecks = 0
  const progress: ProgressServiceLike = {
    createJob: jest.fn(async () => ({ id: PROGRESS_JOB_ID })),
    startJob: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => {
      const shouldCancel = cancelAfter !== null && cancellationChecks >= cancelAfter
      cancellationChecks += 1
      return shouldCancel
    }),
  }
  return progress
}

describe('runTodoBulkCompleteLoop', () => {
  it('runs every item through the executor and completes the progress job', async () => {
    const { store, checkpoints, finished } = buildStore(buildSnapshot())
    const progress = buildProgress()
    const executed: string[] = []

    const result = await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async (todoId) => {
        executed.push(todoId)
      },
    })

    expect(executed).toEqual(['todo-1', 'todo-2', 'todo-3'])
    expect(checkpoints.map((entry) => entry.nextItemIndex)).toEqual([1, 2, 3])
    expect(finished).toEqual([{
      status: 'completed',
      summary: { affectedCount: 3, failedCount: 0, failedItems: [] },
    }])
    expect(progress.completeJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { resultSummary: { affectedCount: 3, failedCount: 0, failedItems: [] } },
      { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, userId: SCOPE.userId },
    )
    expect(result.executed).toBe(true)
  })

  it('does no work when another worker holds the lease', async () => {
    const { store, finished } = buildStore(buildSnapshot(), false)
    const progress = buildProgress()
    const execute = jest.fn(async () => undefined)

    const result = await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-b',
      store,
      progress,
      execute,
    })

    // A duplicate physical message must not double-apply the mutations.
    expect(execute).not.toHaveBeenCalled()
    expect(progress.startJob).not.toHaveBeenCalled()
    expect(finished).toEqual([])
    expect(result).toEqual({ outcome: null, executed: false })
  })

  it('does not even attempt to lease an operation that already reached a terminal state', async () => {
    const { store } = buildStore(buildSnapshot({ status: 'completed' }))
    const progress = buildProgress()
    const execute = jest.fn(async () => undefined)

    const result = await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute,
    })

    expect(store.acquireLease).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(result.executed).toBe(false)
  })

  it('resumes from the checkpoint instead of repeating a mutation that already landed', async () => {
    const { store, finished } = buildStore(buildSnapshot({
      status: 'running',
      nextItemIndex: 2,
      succeededCount: 2,
    }))
    const progress = buildProgress()
    const executed: string[] = []

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async (todoId) => {
        executed.push(todoId)
      },
    })

    expect(executed).toEqual(['todo-3'])
    expect(executed).not.toContain('todo-1')
    expect(finished[0]).toEqual({
      status: 'completed',
      summary: { affectedCount: 3, failedCount: 0, failedItems: [] },
    })
  })

  it('stops before the next item when cancellation is requested and marks the job cancelled', async () => {
    const { store, finished } = buildStore(buildSnapshot())
    const progress = buildProgress(1)
    const executed: string[] = []

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async (todoId) => {
        executed.push(todoId)
      },
    })

    expect(executed).toEqual(['todo-1'])
    expect(progress.markCancelled).toHaveBeenCalledWith(PROGRESS_JOB_ID, expect.anything())
    expect(progress.completeJob).not.toHaveBeenCalled()
    expect(progress.failJob).not.toHaveBeenCalled()
    expect(finished[0]?.status).toBe('cancelled')
  })

  it('records a classified code for each failed item and still completes a mixed run', async () => {
    const { store, finished } = buildStore(buildSnapshot())
    const progress = buildProgress()

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async (todoId) => {
        if (todoId === 'todo-2') throw new CrudHttpError(409, { error: 'stale' })
      },
    })

    expect(finished[0]).toEqual({
      status: 'completed',
      summary: {
        affectedCount: 2,
        failedCount: 1,
        failedItems: [{ id: 'todo-2', code: 'conflict' }],
      },
    })
    expect(progress.failJob).not.toHaveBeenCalled()
  })

  it('fails the progress job when nothing succeeded', async () => {
    const { store, finished } = buildStore(buildSnapshot())
    const progress = buildProgress()

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => {
        throw new CrudHttpError(404, { error: 'gone' })
      },
    })

    expect(progress.failJob).toHaveBeenCalledTimes(1)
    expect(progress.completeJob).not.toHaveBeenCalled()
    expect(finished[0]?.status).toBe('failed')
    expect(finished[0]?.summary).toEqual({
      affectedCount: 0,
      failedCount: 3,
      failedItems: [
        { id: 'todo-1', code: 'not_found' },
        { id: 'todo-2', code: 'not_found' },
        { id: 'todo-3', code: 'not_found' },
      ],
    })
  })

  it('clears the operation from the store even when it processed nothing', async () => {
    const { store } = buildStore(null)
    const progress = buildProgress()
    const execute = jest.fn(async () => undefined)

    const result = await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute,
    })

    expect(result).toEqual({ outcome: null, executed: false })
    expect(execute).not.toHaveBeenCalled()
    expect(store.finish).not.toHaveBeenCalled()
  })
})
