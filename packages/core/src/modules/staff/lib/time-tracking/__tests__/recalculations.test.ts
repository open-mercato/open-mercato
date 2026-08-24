/** @jest-environment node */
/**
 * EP-51 — the recalculation registry and the job shell that runs it.
 *
 * Two behaviours carry the "additive only" promise and are pinned here:
 *
 *  1. A job with no `hookIds` resolves to the built-in rounding pass alone. That
 *     is what the settings route enqueues, so a contributed hook cannot attach
 *     itself to the retro-rounding button a tenant pressed.
 *  2. An unknown id throws instead of being skipped. A backfill that quietly did
 *     nothing is worse than one that refused to start.
 */

import {
  BUILT_IN_RECALCULATION_ID,
  emptyRecalculationSummary,
  listTimeTrackingRecalculations,
  registerTimeTrackingRecalculation,
  resolveTimeTrackingRecalculations,
  timeTrackingRecalculationIds,
  type TimeTrackingRecalculationContext,
  type TimeTrackingRecalculationSummary,
} from '../recalculations'
import { runTimeTrackingRecalculations } from '../recalculationRunner'

// Importing the rounding module is what registers the built-in.
import '../reapplyRounding'

const SCOPE = { tenantId: 'tenant-1', organizationIds: ['org-1'], userId: 'user-1' }

function summaryWith(overrides: Partial<TimeTrackingRecalculationSummary>): TimeTrackingRecalculationSummary {
  return { ...emptyRecalculationSummary(), ...overrides }
}

type ProgressCalls = {
  startJob: jest.Mock
  updateProgress: jest.Mock
  completeJob: jest.Mock
  markCancelled: jest.Mock
  failJob: jest.Mock
  isCancellationRequested: jest.Mock
}

function buildContainer(progress: ProgressCalls) {
  return {
    resolve: (name: string) => {
      if (name === 'progressService') return progress
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  } as unknown as TimeTrackingRecalculationContext['container']
}

function buildProgress(cancelAfter = Number.POSITIVE_INFINITY): ProgressCalls {
  let checks = 0
  return {
    startJob: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => {
      checks += 1
      return checks > cancelAfter
    }),
  }
}

describe('time-tracking recalculation registry', () => {
  it('registers the retro-rounding pass as its built-in', () => {
    expect(timeTrackingRecalculationIds()).toContain(BUILT_IN_RECALCULATION_ID)
    const builtIn = listTimeTrackingRecalculations().find((hook) => hook.id === BUILT_IN_RECALCULATION_ID)
    expect(builtIn?.labelKey).toBe('staff.time_tracking.settings.retro.jobName')
  })

  it('orders the built-in last so a contribution is always considered first', () => {
    const dispose = registerTimeTrackingRecalculation({
      id: 'test.recalculation.ordering',
      labelKey: 'test.ordering',
      run: async () => emptyRecalculationSummary(),
    })
    try {
      const ids = timeTrackingRecalculationIds()
      expect(ids.indexOf('test.recalculation.ordering')).toBeLessThan(ids.indexOf(BUILT_IN_RECALCULATION_ID))
    } finally {
      dispose()
    }
    expect(timeTrackingRecalculationIds()).not.toContain('test.recalculation.ordering')
  })

  it('resolves an empty request to the built-in alone', () => {
    const dispose = registerTimeTrackingRecalculation({
      id: 'test.recalculation.not-implicit',
      labelKey: 'test.notImplicit',
      run: async () => emptyRecalculationSummary(),
    })
    try {
      expect(resolveTimeTrackingRecalculations(null).map((hook) => hook.id)).toEqual([
        BUILT_IN_RECALCULATION_ID,
      ])
      expect(resolveTimeTrackingRecalculations([]).map((hook) => hook.id)).toEqual([
        BUILT_IN_RECALCULATION_ID,
      ])
    } finally {
      dispose()
    }
  })

  it('refuses an unknown id rather than skipping it', () => {
    expect(() => resolveTimeTrackingRecalculations(['nope.not.registered'])).toThrow(/unknown/i)
  })

  it('de-duplicates a repeated id', () => {
    expect(
      resolveTimeTrackingRecalculations([BUILT_IN_RECALCULATION_ID, BUILT_IN_RECALCULATION_ID]).map(
        (hook) => hook.id,
      ),
    ).toEqual([BUILT_IN_RECALCULATION_ID])
  })

  it('rejects a registration with no run function', () => {
    expect(() =>
      registerTimeTrackingRecalculation({
        id: 'test.recalculation.broken',
        labelKey: 'test.broken',
      } as never),
    ).toThrow(/run\(\)/)
  })
})

describe('runTimeTrackingRecalculations', () => {
  it('runs the requested hooks in order under one progress job', async () => {
    const order: string[] = []
    const first = registerTimeTrackingRecalculation({
      id: 'test.recalculation.first',
      labelKey: 'test.first',
      run: async (ctx: TimeTrackingRecalculationContext) => {
        order.push('first')
        await ctx.report.setTotal(4)
        await ctx.report.advance(4)
        return summaryWith({ totalCount: 4, processedCount: 4, updatedCount: 3, unchangedCount: 1 })
      },
    })
    const second = registerTimeTrackingRecalculation({
      id: 'test.recalculation.second',
      labelKey: 'test.second',
      run: async (ctx: TimeTrackingRecalculationContext) => {
        order.push('second')
        await ctx.report.setTotal(2)
        await ctx.report.advance(2)
        return summaryWith({ totalCount: 2, processedCount: 2, skippedCount: 2 })
      },
    })
    const progress = buildProgress()
    try {
      const summary = await runTimeTrackingRecalculations({
        container: buildContainer(progress),
        progressJobId: 'job-1',
        scope: SCOPE,
        hookIds: ['test.recalculation.first', 'test.recalculation.second'],
      })
      expect(order).toEqual(['first', 'second'])
      expect(summary.totalCount).toBe(6)
      expect(summary.processedCount).toBe(6)
      expect(summary.updatedCount).toBe(3)
      expect(summary.skippedCount).toBe(2)
      expect(summary.hooks.map((hook) => hook.id)).toEqual([
        'test.recalculation.first',
        'test.recalculation.second',
      ])
      expect(progress.startJob).toHaveBeenCalledTimes(1)
      expect(progress.completeJob).toHaveBeenCalledTimes(1)
      expect(progress.markCancelled).not.toHaveBeenCalled()
    } finally {
      first()
      second()
    }
  })

  it('stops at the first cancelled hook and marks the job cancelled', async () => {
    const ran: string[] = []
    const first = registerTimeTrackingRecalculation({
      id: 'test.recalculation.cancels',
      labelKey: 'test.cancels',
      run: async () => {
        ran.push('cancels')
        return summaryWith({ totalCount: 1, processedCount: 1, cancelled: true })
      },
    })
    const second = registerTimeTrackingRecalculation({
      id: 'test.recalculation.never',
      labelKey: 'test.never',
      run: async () => {
        ran.push('never')
        return emptyRecalculationSummary()
      },
    })
    const progress = buildProgress()
    try {
      const summary = await runTimeTrackingRecalculations({
        container: buildContainer(progress),
        progressJobId: 'job-2',
        scope: SCOPE,
        hookIds: ['test.recalculation.cancels', 'test.recalculation.never'],
      })
      expect(ran).toEqual(['cancels'])
      expect(summary.cancelled).toBe(true)
      expect(progress.markCancelled).toHaveBeenCalledTimes(1)
      expect(progress.completeJob).not.toHaveBeenCalled()
    } finally {
      first()
      second()
    }
  })

  /**
   * The worker owns `failJob`; the runner must not write the failure a second
   * time, and must not complete a job whose hook threw.
   */
  it('rethrows a hook failure without completing or failing the job itself', async () => {
    const dispose = registerTimeTrackingRecalculation({
      id: 'test.recalculation.throws',
      labelKey: 'test.throws',
      run: async () => {
        throw new Error('[internal] boom')
      },
    })
    const progress = buildProgress()
    try {
      await expect(
        runTimeTrackingRecalculations({
          container: buildContainer(progress),
          progressJobId: 'job-3',
          scope: SCOPE,
          hookIds: ['test.recalculation.throws'],
        }),
      ).rejects.toThrow('[internal] boom')
      expect(progress.completeJob).not.toHaveBeenCalled()
      expect(progress.failJob).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })
})
