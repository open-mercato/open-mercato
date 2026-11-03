/**
 * A workflow step may last 90 days: the WAIT activity must never hand a delay
 * past Node's 2^31 ms timer ceiling to `setTimeout`, which fires such a timer
 * after 1 ms and lets the run carry on as if it had waited.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const enqueueMock = jest.fn().mockResolvedValue('job-long-wait')

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
}))

jest.mock('../event-logger', () => ({
  logWorkflowEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const stub = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => stub }
  return { createLogger: () => stub }
})

import { executeActivities, executeWait, type ActivityContext, type ActivityDefinition } from '../activity-executor'
import { MAX_INLINE_WAIT_MS, MAX_TIMER_DELAY_MS, assertInProcessWaitDelay } from '../duration'
import type { WorkflowInstance } from '../../data/entities'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

const em = { flush: jest.fn(), persist: jest.fn() } as unknown as EntityManager
const container = { resolve: jest.fn() } as unknown as AwilixContainer

function makeContext(overrides: Partial<WorkflowInstance> = {}): ActivityContext {
  return {
    workflowInstance: {
      id: 'instance-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      context: {},
      isDryRun: false,
      ...overrides,
    } as WorkflowInstance,
    workflowContext: {},
    userId: 'user-1',
  }
}

function wait(activityId: string, duration: string): ActivityDefinition {
  return { activityId, activityName: activityId, activityType: 'WAIT', config: { duration } }
}

const followUpActivity: ActivityDefinition = {
  activityId: 'notify',
  activityName: 'notify',
  activityType: 'EMIT_EVENT',
  config: { eventName: 'example.waited', payload: {} },
}

describe('90-day WAIT activity', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('a synchronous 90-day WAIT ending a transition is handed to the queue with its full delay', async () => {
    const results = await executeActivities(em, container, [wait('hold', 'P90D')], makeContext(), {
      queueLongInlineWaits: true,
    })

    expect(results).toEqual([
      expect.objectContaining({ activityId: 'hold', success: true, async: true, jobId: 'job-long-wait' }),
    ])
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][1]).toEqual({ delayMs: NINETY_DAYS_MS })
  })

  test('a 90-day WAIT that cannot be queued fails loudly instead of resolving after 1 ms', async () => {
    const results = await executeActivities(em, container, [wait('hold', 'P90D')], makeContext())

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('cannot be slept in-process')
  })

  test('a 90-day WAIT followed by another activity is refused, so nothing runs before it elapses', async () => {
    const results = await executeActivities(
      em,
      container,
      [wait('hold', 'P90D'), followUpActivity],
      makeContext(),
      { queueLongInlineWaits: true }
    )

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(expect.objectContaining({ activityId: 'hold', success: false }))
  })

  test('a short WAIT still sleeps inline', async () => {
    const pending = executeActivities(em, container, [wait('pause', 'PT30S')], makeContext(), {
      queueLongInlineWaits: true,
    })
    await jest.advanceTimersByTimeAsync(30_000)
    const results = await pending

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(results[0]).toEqual(expect.objectContaining({ success: true, async: false }))
    expect(results[0].output).toEqual({ waited: true, durationMs: 30_000 })
  })

  test('a dry run never queues a long WAIT', async () => {
    const results = await executeActivities(
      em,
      container,
      [wait('hold', 'P90D')],
      makeContext({ isDryRun: true }),
      { queueLongInlineWaits: true }
    )

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(results[0]).toEqual(expect.objectContaining({ success: true, async: false }))
  })

  test('executeWait refuses a delay past the timer ceiling', async () => {
    await expect(executeWait({ duration: 'P90D' })).rejects.toThrow('cannot be slept in-process')
  })

  test('the inline threshold sits well under the timer ceiling', () => {
    expect(MAX_INLINE_WAIT_MS).toBeLessThan(MAX_TIMER_DELAY_MS)
    expect(assertInProcessWaitDelay(MAX_TIMER_DELAY_MS)).toBe(MAX_TIMER_DELAY_MS)
    expect(() => assertInProcessWaitDelay(MAX_TIMER_DELAY_MS + 1)).toThrow()
  })
})
