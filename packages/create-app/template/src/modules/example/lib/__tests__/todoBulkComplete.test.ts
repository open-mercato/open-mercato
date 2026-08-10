/** @jest-environment node */
/**
 * The decision rules of the bulk-complete operation, isolated from the database.
 *
 * Each of these encodes a rule that is easy to get subtly wrong and impossible to
 * observe from an end-to-end run: which terminal state a partially-failed run
 * reaches, when a second worker is allowed to steal an execution lease, and which
 * durable rows the scheduler dispatcher must republish.
 */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  boundFailedItems,
  canAcquireTodoBulkLease,
  claimTodoBulkOperation,
  classifyTodoBulkFailure,
  createTodoBulkOperationStore,
  needsTodoBulkPublication,
  recordTodoBulkPublication,
  resolveTodoBulkOutcome,
  selectTodoBulkOperationsToPublish,
} from '../todoBulkComplete'

const NOW = new Date('2026-08-04T12:00:00.000Z')
const EARLIER = new Date('2026-08-04T11:59:00.000Z')
const LATER = new Date('2026-08-04T12:01:00.000Z')
const SCOPE = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  userId: '00000000-0000-4000-8000-0000000000b1',
}

describe('resolveTodoBulkOutcome', () => {
  it('completes a run where every item succeeded', () => {
    const outcome = resolveTodoBulkOutcome({ succeededCount: 3, failedItems: [], cancelled: false })

    expect(outcome.terminal).toBe('completed')
    expect(outcome.summary).toEqual({ affectedCount: 3, failedCount: 0, failedItems: [] })
  })

  it('completes a mixed run and reports which items failed', () => {
    const outcome = resolveTodoBulkOutcome({
      succeededCount: 2,
      failedItems: [{ id: 'todo-3', code: 'conflict' }],
      cancelled: false,
    })

    expect(outcome.terminal).toBe('completed')
    expect(outcome.summary).toEqual({
      affectedCount: 2,
      failedCount: 1,
      failedItems: [{ id: 'todo-3', code: 'conflict' }],
    })
  })

  it('fails a run where nothing succeeded and something failed', () => {
    const outcome = resolveTodoBulkOutcome({
      succeededCount: 0,
      failedItems: [{ id: 'todo-1', code: 'error' }, { id: 'todo-2', code: 'not_found' }],
      cancelled: false,
    })

    expect(outcome.terminal).toBe('failed')
    expect(outcome.summary.failedCount).toBe(2)
  })

  it('cancels regardless of how many items already landed', () => {
    const outcome = resolveTodoBulkOutcome({ succeededCount: 5, failedItems: [], cancelled: true })

    expect(outcome.terminal).toBe('cancelled')
    expect(outcome.summary.affectedCount).toBe(5)
  })

  it('reports the true failure count while capping the persisted item list', () => {
    const failedItems = Array.from({ length: 25 }, (_, index) => ({
      id: `todo-${index}`,
      code: 'error',
    }))

    const outcome = resolveTodoBulkOutcome({ succeededCount: 1, failedItems, cancelled: false })

    expect(outcome.summary.failedCount).toBe(25)
    expect(outcome.summary.failedItems).toHaveLength(20)
  })
})

describe('boundFailedItems', () => {
  it('caps the list and keeps only the id and code fields', () => {
    const bounded = boundFailedItems(
      [{ id: 'a', code: 'conflict', detail: 'secret' } as never, { id: 'b', code: 'error' }],
      1,
    )

    expect(bounded).toEqual([{ id: 'a', code: 'conflict' }])
  })
})

describe('classifyTodoBulkFailure', () => {
  it('maps an optimistic-lock conflict to a stable code', () => {
    expect(classifyTodoBulkFailure(new CrudHttpError(409, { error: 'conflict' }))).toBe('conflict')
  })

  it('maps a missing record to a stable code', () => {
    expect(classifyTodoBulkFailure(new CrudHttpError(404, { error: 'gone' }))).toBe('not_found')
  })

  it('never leaks an arbitrary error message into the summary', () => {
    expect(classifyTodoBulkFailure(new Error('connection string user:password@host'))).toBe('error')
  })
})

describe('canAcquireTodoBulkLease', () => {
  it('lets a worker claim an unheld lease', () => {
    expect(canAcquireTodoBulkLease({
      leaseOwner: null,
      leaseExpiresAt: null,
      candidateOwner: 'worker-a',
      now: NOW,
    })).toBe(true)
  })

  it('lets the same worker renew its own lease before it expires', () => {
    expect(canAcquireTodoBulkLease({
      leaseOwner: 'worker-a',
      leaseExpiresAt: LATER,
      candidateOwner: 'worker-a',
      now: NOW,
    })).toBe(true)
  })

  it('refuses a second worker while another lease is still live', () => {
    expect(canAcquireTodoBulkLease({
      leaseOwner: 'worker-a',
      leaseExpiresAt: LATER,
      candidateOwner: 'worker-b',
      now: NOW,
    })).toBe(false)
  })

  it('lets a second worker take over an expired lease', () => {
    expect(canAcquireTodoBulkLease({
      leaseOwner: 'worker-a',
      leaseExpiresAt: EARLIER,
      candidateOwner: 'worker-b',
      now: NOW,
    })).toBe(true)
  })
})

describe('needsTodoBulkPublication', () => {
  it('republishes a row that was never delivered to the queue', () => {
    expect(needsTodoBulkPublication({
      status: 'pending',
      publishedAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      now: NOW,
    })).toBe(true)
  })

  it('leaves a published row with a live lease alone', () => {
    expect(needsTodoBulkPublication({
      status: 'running',
      publishedAt: EARLIER,
      leaseOwner: 'worker-a',
      leaseExpiresAt: LATER,
      now: NOW,
    })).toBe(false)
  })

  it('republishes a row whose worker died and let the lease expire', () => {
    expect(needsTodoBulkPublication({
      status: 'running',
      publishedAt: EARLIER,
      leaseOwner: 'worker-a',
      leaseExpiresAt: EARLIER,
      now: NOW,
    })).toBe(true)
  })

  it('never republishes a terminal row', () => {
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(needsTodoBulkPublication({
        status,
        publishedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        now: NOW,
      })).toBe(false)
    }
  })
})

describe('selectTodoBulkOperationsToPublish', () => {
  it('returns only the rows the dispatcher must act on', () => {
    const rows = [
      { id: 'never-published', status: 'pending', publishedAt: null },
      { id: 'in-flight', status: 'running', publishedAt: EARLIER, leaseOwner: 'w', leaseExpiresAt: LATER },
      { id: 'abandoned', status: 'running', publishedAt: EARLIER, leaseOwner: 'w', leaseExpiresAt: EARLIER },
      { id: 'done', status: 'completed', publishedAt: EARLIER },
    ]

    expect(selectTodoBulkOperationsToPublish(rows, NOW).map((row) => row.id))
      .toEqual(['never-published', 'abandoned'])
  })
})

describe('claimTodoBulkOperation', () => {
  function buildFailingEntityManager(winner: { id: string; progressJobId: string } | null = null) {
    const findOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    const fork = {
      findOne,
      create: jest.fn((_entity, data) => ({ id: 'operation-created', ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => { throw new Error('operation insert failed') }),
    }
    const em = { fork: jest.fn(() => fork) } as unknown as EntityManager
    return { em, findOne }
  }

  it('cancels the optimistic progress job when operation persistence fails without a winner', async () => {
    const { em } = buildFailingEntityManager()
    const markCancelled = jest.fn(async () => undefined)

    await expect(claimTodoBulkOperation({
      em,
      progress: { createJob: jest.fn(async () => ({ id: 'progress-created' })), markCancelled } as never,
      scope: SCOPE,
      idempotencyKey: '00000000-0000-4000-8000-0000000000c1',
      todoIds: ['00000000-0000-4000-8000-0000000000d1'],
    })).rejects.toThrow('operation insert failed')

    expect(markCancelled).toHaveBeenCalledWith('progress-created', SCOPE)
  })

  it('cancels the losing progress job before returning an idempotency winner', async () => {
    const winner = { id: 'operation-winner', progressJobId: 'progress-winner' }
    const { em } = buildFailingEntityManager(winner)
    const markCancelled = jest.fn(async () => undefined)

    await expect(claimTodoBulkOperation({
      em,
      progress: { createJob: jest.fn(async () => ({ id: 'progress-loser' })), markCancelled } as never,
      scope: SCOPE,
      idempotencyKey: '00000000-0000-4000-8000-0000000000c1',
      todoIds: ['00000000-0000-4000-8000-0000000000d1'],
    })).resolves.toEqual({
      operationId: 'operation-winner',
      progressJobId: 'progress-winner',
      created: false,
    })

    expect(markCancelled).toHaveBeenCalledWith('progress-loser', SCOPE)
  })
})

describe('recordTodoBulkPublication', () => {
  it('increments the durable attempt counter for both successful and failed publications', async () => {
    const nativeUpdate = jest.fn(async () => 1)
    const em = { fork: jest.fn(() => ({ nativeUpdate })) } as unknown as EntityManager

    await recordTodoBulkPublication({
      em,
      operationId: '00000000-0000-4000-8000-0000000000e1',
      scope: SCOPE,
      published: false,
    })
    await recordTodoBulkPublication({
      em,
      operationId: '00000000-0000-4000-8000-0000000000e1',
      scope: SCOPE,
      published: true,
    })

    expect(nativeUpdate).toHaveBeenCalledTimes(2)
    for (const call of nativeUpdate.mock.calls) {
      const patch = call[2] as Record<string, unknown>
      expect((patch.publishAttempts as { sql: string }).sql).toBe('publish_attempts + 1')
    }
    expect(nativeUpdate.mock.calls[0]?.[2]).not.toHaveProperty('publishedAt')
    expect(nativeUpdate.mock.calls[1]?.[2]).toHaveProperty('publishedAt')
  })
})

describe('createTodoBulkOperationStore', () => {
  it('fences lease renewal, checkpoints, and terminal writes by the current owner', async () => {
    const nativeUpdate = jest.fn(async () => 1)
    const em = { fork: jest.fn(() => ({ nativeUpdate })) } as unknown as EntityManager
    const store = createTodoBulkOperationStore(em)
    const operationId = '00000000-0000-4000-8000-0000000000e1'

    await store.renewLease(operationId, SCOPE, 'worker-a', LATER)
    await store.saveCheckpoint(operationId, SCOPE, 'worker-a', {
      nextItemIndex: 1,
      succeededCount: 1,
      failedCount: 0,
      failedItems: [],
      leaseExpiresAt: LATER,
    })
    await store.finish(operationId, SCOPE, 'worker-a', {
      status: 'completed',
      summary: { affectedCount: 1, failedCount: 0, failedItems: [] },
    })

    expect(nativeUpdate).toHaveBeenCalledTimes(3)
    for (const call of nativeUpdate.mock.calls) {
      expect(call[1]).toMatchObject({
        id: operationId,
        tenantId: SCOPE.tenantId,
        organizationId: SCOPE.organizationId,
        status: 'running',
        leaseOwner: 'worker-a',
      })
    }
  })
})
