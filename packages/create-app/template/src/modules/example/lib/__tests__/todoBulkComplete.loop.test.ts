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
    renewLease: jest.fn(async () => true),
    saveCheckpoint: jest.fn(async (_id, _scope, _owner, checkpoint) => {
      checkpoints.push({
        nextItemIndex: checkpoint.nextItemIndex,
        succeededCount: checkpoint.succeededCount,
        failedCount: checkpoint.failedCount,
      })
      return true
    }),
    finish: jest.fn(async (_id, _scope, _owner, result) => {
      finished.push({ status: result.status, summary: result.summary })
      return true
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

/**
 * Waits for a heartbeat-driven condition instead of sleeping for a fixed slice of
 * wall-clock time.
 *
 * The heartbeat runs on a real `setInterval`, so a fixed sleep asserts the runner's
 * scheduling latency as much as the loop's behavior: under a loaded CI worker the
 * 20ms budget elapsed with zero interval ticks delivered and the assertion read a
 * single (initial) renewal. Polling keeps the property under test — that the
 * heartbeat renews the lease *while* an item is still executing — and drops the
 * dependency on how promptly the event loop gets to the timer.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('[internal] timed out waiting for the expected condition')
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
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

  it('reconciles a terminal operation with its progress job without leasing or executing it', async () => {
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
    expect(progress.completeJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { resultSummary: { affectedCount: 0, failedCount: 0, failedItems: [] } },
      { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, userId: SCOPE.userId },
    )
    expect(result.executed).toBe(false)
  })

  it('finalizes progress before making the operation terminal so a failed progress write stays recoverable', async () => {
    const { store } = buildStore(buildSnapshot({ todoIds: [] }))
    const progress = buildProgress()
    const order: string[] = []
    jest.mocked(progress.completeJob).mockImplementation(async () => {
      order.push('progress')
      return undefined
    })
    jest.mocked(store.finish).mockImplementation(async () => {
      order.push('operation')
      return true
    })

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => undefined,
    })

    expect(order).toEqual(['progress', 'operation'])
  })

  it('retries terminal progress reconciliation after a transient failure', async () => {
    const { store } = buildStore(buildSnapshot({ status: 'completed', succeededCount: 2 }))
    const progress = buildProgress()
    jest.mocked(progress.completeJob)
      .mockRejectedValueOnce(new Error('progress unavailable'))
      .mockResolvedValueOnce(undefined)
    const input = {
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => undefined,
    }

    await expect(runTodoBulkCompleteLoop(input)).rejects.toThrow('progress unavailable')
    await expect(runTodoBulkCompleteLoop(input)).resolves.toEqual({ outcome: null, executed: false })

    expect(progress.completeJob).toHaveBeenCalledTimes(2)
    expect(store.acquireLease).not.toHaveBeenCalled()
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

  it('renews the lease while one item is still executing', async () => {
    const { store } = buildStore(buildSnapshot({ todoIds: ['todo-1'] }))
    const progress = buildProgress()
    let releaseExecution: (() => void) | null = null
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve
    })

    const running = runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => executionReleased,
      leaseTtlMs: 30,
      leaseHeartbeatMs: 5,
    })

    await waitFor(() => jest.mocked(store.renewLease).mock.calls.length > 1)
    expect(jest.mocked(store.renewLease).mock.calls.length).toBeGreaterThan(1)
    releaseExecution?.()
    await running
  })

  it('stops without checkpointing when the lease heartbeat reports a new owner', async () => {
    const { store } = buildStore(buildSnapshot({ todoIds: ['todo-1'] }))
    const progress = buildProgress()
    jest.mocked(store.renewLease)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    let releaseExecution: (() => void) | null = null
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve
    })

    const running = runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => executionReleased,
      leaseTtlMs: 30,
      leaseHeartbeatMs: 5,
    })

    await waitFor(() => jest.mocked(store.renewLease).mock.calls.length > 1)
    releaseExecution?.()
    await expect(running).resolves.toEqual({ outcome: null, executed: true })
    expect(store.saveCheckpoint).not.toHaveBeenCalled()
    expect(store.finish).not.toHaveBeenCalled()
  })

  it('passes the lease owner into every checkpoint and terminal write', async () => {
    const { store } = buildStore(buildSnapshot({ todoIds: ['todo-1'] }))

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress: buildProgress(),
      execute: async () => undefined,
    })

    expect(store.saveCheckpoint).toHaveBeenCalledWith(
      OPERATION_ID,
      SCOPE,
      'worker-a',
      expect.objectContaining({ nextItemIndex: 1 }),
    )
    expect(store.finish).toHaveBeenCalledWith(
      OPERATION_ID,
      SCOPE,
      'worker-a',
      expect.objectContaining({ status: 'completed' }),
    )
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
    expect(progress.failJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      {
        errorMessage: 'example.todos.bulkComplete.allFailed',
        resultSummary: {
          affectedCount: 0,
          failedCount: 3,
          failedItems: [
            { id: 'todo-1', code: 'not_found' },
            { id: 'todo-2', code: 'not_found' },
            { id: 'todo-3', code: 'not_found' },
          ],
        },
      },
      { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, userId: SCOPE.userId },
    )
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

  it('keeps the exact failure count when a fresh run exceeds the bounded failure list', async () => {
    const todoIds = Array.from({ length: 25 }, (_, index) => `todo-${index + 1}`)
    const expectedFailedItems = todoIds.slice(0, 20).map((id) => ({ id, code: 'error' }))
    const { store, finished } = buildStore(buildSnapshot({ todoIds }))
    const progress = buildProgress()

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => {
        throw new Error('failed')
      },
    })

    const summary = { affectedCount: 0, failedCount: 25, failedItems: expectedFailedItems }
    expect(finished[0]).toEqual({ status: 'failed', summary })
    expect(progress.failJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { errorMessage: 'example.todos.bulkComplete.allFailed', resultSummary: summary },
      { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, userId: SCOPE.userId },
    )
  })

  it('preserves the exact persisted failure count when resuming from a bounded checkpoint', async () => {
    const failedTodoIds = Array.from({ length: 25 }, (_, index) => `todo-${index + 1}`)
    const failedItems = failedTodoIds.slice(0, 20).map((id) => ({ id, code: 'error' }))
    const todoIds = [...failedTodoIds, 'todo-26']
    const { store, finished } = buildStore(buildSnapshot({
      status: 'running',
      todoIds,
      nextItemIndex: 25,
      failedCount: 25,
      failedItems,
    }))
    const progress = buildProgress()

    await runTodoBulkCompleteLoop({
      operationId: OPERATION_ID,
      scope: SCOPE,
      leaseOwner: 'worker-a',
      store,
      progress,
      execute: async () => undefined,
    })

    const summary = { affectedCount: 1, failedCount: 25, failedItems }
    expect(finished[0]).toEqual({ status: 'completed', summary })
    expect(progress.completeJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { resultSummary: summary },
      { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, userId: SCOPE.userId },
    )
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
