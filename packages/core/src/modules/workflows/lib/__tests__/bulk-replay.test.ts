/** @jest-environment node */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'

const executeWorkflow = jest.fn(async () => ({ status: 'RUNNING' }))
const completeWorkflow = jest.fn(async () => undefined)

jest.mock('../workflow-executor', () => ({
  executeWorkflow: (...args: unknown[]) => executeWorkflow(...(args as [])),
  completeWorkflow: (...args: unknown[]) => completeWorkflow(...(args as [])),
}))

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })),
}))

import { canApplyBulkReplay, runBulkReplay } from '../bulk-replay'
import { WorkflowInstance } from '../../data/entities'

type FakeInstance = {
  id: string
  status: string
  tenantId: string
  organizationId: string
  retryCount: number
  errorMessage: string | null
  errorDetails: unknown
  metadata: Record<string, unknown> | null
  updatedAt: Date
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function makeInstance(id: string, status: string, metadata: Record<string, unknown> | null = null): FakeInstance {
  return {
    id,
    status,
    tenantId: SCOPE.tenantId,
    organizationId: SCOPE.organizationId,
    retryCount: 0,
    errorMessage: 'boom',
    errorDetails: { stack: 'x' },
    metadata,
    updatedAt: new Date(0),
  }
}

function makeHarness(instances: FakeInstance[]) {
  const byId = new Map(instances.map((row) => [row.id, row]))
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    const found = byId.get(where.id as string)
    if (!found) return null
    if (where.tenantId !== found.tenantId || where.organizationId !== found.organizationId) return null
    return found
  })
  const em = { findOne, flush: jest.fn(async () => undefined) }
  const progressService = {
    startJob: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
  }
  const container = {
    resolve: (name: string) => (name === 'em' ? em : name === 'progressService' ? progressService : null),
  }
  return { container, em, progressService, findOne }
}

describe('canApplyBulkReplay', () => {
  test('retry targets the failed and the parked, mirroring the single-instance route', () => {
    expect(canApplyBulkReplay('retry', 'FAILED')).toBe(true)
    expect(canApplyBulkReplay('retry', 'PAUSED')).toBe(true)
    expect(canApplyBulkReplay('retry', 'COMPLETED')).toBe(false)
    expect(canApplyBulkReplay('retry', 'CANCELLED')).toBe(false)
  })

  test('cancel targets only what is still in flight', () => {
    expect(canApplyBulkReplay('cancel', 'RUNNING')).toBe(true)
    expect(canApplyBulkReplay('cancel', 'PAUSED')).toBe(true)
    expect(canApplyBulkReplay('cancel', 'WAITING_FOR_ACTIVITIES')).toBe(true)
    expect(canApplyBulkReplay('cancel', 'COMPLETED')).toBe(false)
    expect(canApplyBulkReplay('cancel', 'FAILED')).toBe(false)
  })
})

describe('runBulkReplay', () => {
  beforeEach(() => {
    executeWorkflow.mockClear()
    completeWorkflow.mockClear()
    executeWorkflow.mockImplementation(async () => ({ status: 'RUNNING' }))
  })

  test('replays every eligible instance and reports the summary', async () => {
    const harness = makeHarness([makeInstance('a', 'FAILED'), makeInstance('b', 'FAILED')])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a', 'b'],
      scope: SCOPE,
    })

    expect(summary).toEqual({
      action: 'retry',
      requestedCount: 2,
      affectedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    })
    expect(executeWorkflow).toHaveBeenCalledTimes(2)
  })

  test('clears the attention marker so a replayed instance leaves the failure queue', async () => {
    const parked = makeInstance('a', 'PAUSED', { attention: { reason: 'failureQueue', at: 'x' }, labels: { k: 'v' } })
    const harness = makeHarness([parked])

    await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a'],
      scope: SCOPE,
    })

    expect(parked.metadata).toEqual({ attention: null, labels: { k: 'v' } })
    expect(parked.status).toBe('RUNNING')
    expect(parked.retryCount).toBe(1)
    expect(parked.errorMessage).toBeNull()
  })

  test('skips an instance whose status the action cannot act on', async () => {
    const harness = makeHarness([makeInstance('a', 'COMPLETED')])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a'],
      scope: SCOPE,
    })

    expect(summary.skippedCount).toBe(1)
    expect(summary.affectedCount).toBe(0)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  test('skips an id that resolves to nothing under the caller scope, never acting on it', async () => {
    const foreign = makeInstance('a', 'FAILED')
    foreign.tenantId = 'other-tenant'
    const harness = makeHarness([foreign])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a'],
      scope: SCOPE,
    })

    expect(summary.skippedCount).toBe(1)
    expect(executeWorkflow).not.toHaveBeenCalled()
    expect(harness.findOne).toHaveBeenCalledWith(
      WorkflowInstance,
      expect.objectContaining({ tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId })
    )
  })

  test('one failing instance does not abort the batch — that is the point of triage', async () => {
    executeWorkflow.mockImplementationOnce(async () => {
      throw new Error('still broken')
    })
    const harness = makeHarness([makeInstance('a', 'FAILED'), makeInstance('b', 'FAILED')])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a', 'b'],
      scope: SCOPE,
    })

    expect(summary.failedCount).toBe(1)
    expect(summary.affectedCount).toBe(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(2)
  })

  test('cancel routes through the executor rather than writing the status directly', async () => {
    const harness = makeHarness([makeInstance('a', 'RUNNING')])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'cancel',
      ids: ['a'],
      scope: SCOPE,
    })

    expect(summary.affectedCount).toBe(1)
    expect(completeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'a', 'CANCELLED')
  })

  test('reports progress per instance and completes the job with the summary', async () => {
    const harness = makeHarness([makeInstance('a', 'FAILED'), makeInstance('b', 'FAILED')])

    await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a', 'b'],
      scope: SCOPE,
    })

    expect(harness.progressService.startJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ tenantId: SCOPE.tenantId }))
    // One initial zero call plus one per instance.
    expect(harness.progressService.updateProgress).toHaveBeenCalledTimes(3)
    expect(harness.progressService.completeJob).toHaveBeenCalledWith(
      'job-1',
      { resultSummary: expect.objectContaining({ affectedCount: 2 }) },
      expect.anything()
    )
  })

  test('completes the job even when every instance failed, so the top bar never hangs', async () => {
    executeWorkflow.mockImplementation(async () => {
      throw new Error('nope')
    })
    const harness = makeHarness([makeInstance('a', 'FAILED')])

    const summary = await runBulkReplay({
      container: harness.container as never,
      progressJobId: 'job-1',
      action: 'retry',
      ids: ['a'],
      scope: SCOPE,
    })

    expect(summary.failedCount).toBe(1)
    expect(harness.progressService.completeJob).toHaveBeenCalled()
  })
})
