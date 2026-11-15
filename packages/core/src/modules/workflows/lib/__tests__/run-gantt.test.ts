/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { buildRunGantt, COLLAPSE_FACTOR, MIN_COLLAPSIBLE_MS } from '../run-gantt'
import type { RunStepInstanceInput } from '../run-execution'

const BASE = Date.parse('2026-07-29T10:00:00.000Z')

function step(
  stepId: string,
  offsetSeconds: number,
  durationSeconds: number | null,
  overrides: Partial<RunStepInstanceInput> = {}
): RunStepInstanceInput {
  return {
    id: `si-${stepId}-${offsetSeconds}`,
    stepId,
    stepName: stepId,
    stepType: 'AUTOMATED',
    status: durationSeconds === null ? 'ACTIVE' : 'COMPLETED',
    enteredAt: new Date(BASE + offsetSeconds * 1000).toISOString(),
    exitedAt: durationSeconds === null ? null : new Date(BASE + (offsetSeconds + durationSeconds) * 1000).toISOString(),
    ...overrides,
  }
}

describe('buildRunGantt — basics', () => {
  test('an empty run produces an empty model rather than throwing', () => {
    const model = buildRunGantt({ stepInstances: [] })
    expect(model.bars).toEqual([])
    expect(model.laneCount).toBe(0)
    expect(model.totalDurationMs).toBe(0)
  })

  test('a step with no entry timestamp is skipped — it never started', () => {
    const model = buildRunGantt({
      stepInstances: [{ stepId: 'never', status: 'PENDING', enteredAt: null }],
    })
    expect(model.bars).toEqual([])
  })

  test('bars carry the TRUE duration, ordered by start time', () => {
    const model = buildRunGantt({
      stepInstances: [step('b', 10, 5), step('a', 0, 2)],
    })
    expect(model.bars.map((bar) => bar.stepId)).toEqual(['a', 'b'])
    expect(model.bars[0].durationMs).toBe(2000)
    expect(model.bars[1].durationMs).toBe(5000)
  })

  test('an unfinished step is measured against the injected clock and flagged running', () => {
    const model = buildRunGantt({
      stepInstances: [step('waiting', 0, null)],
      now: BASE + 30_000,
    })
    expect(model.bars[0].running).toBe(true)
    expect(model.bars[0].durationMs).toBe(30_000)
  })

  test('the axis starts at the instance start even when the first step began later', () => {
    const model = buildRunGantt({
      stepInstances: [step('late', 60, 5)],
      instanceStartedAt: new Date(BASE).toISOString(),
    })
    expect(model.startMs).toBe(BASE)
    expect(model.bars[0].offsetRatio).toBeGreaterThan(0)
  })
})

describe('buildRunGantt — collapsed waits', () => {
  test('a short uniform run is not compressed at all', () => {
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 1), step('b', 1, 1), step('c', 2, 1)],
    })
    expect(model.collapsedSegments).toEqual([])
    expect(model.collapsedDurationMs).toBe(0)
  })

  test('a three-day approval no longer flattens the second-scale work around it', () => {
    const threeDays = 3 * 24 * 60 * 60
    const model = buildRunGantt({
      stepInstances: [
        step('validate', 0, 1),
        step('approve', 1, threeDays, { stepType: 'USER_TASK' }),
        step('ship', 1 + threeDays, 1),
      ],
    })

    expect(model.totalDurationMs).toBe((2 + threeDays) * 1000)
    expect(model.collapsedSegments.length).toBeGreaterThan(0)
    // Without compression the two 1s steps render at 0.0004% of the axis.
    // With it they are visible.
    const validate = model.bars.find((bar) => bar.stepId === 'validate')!
    const ship = model.bars.find((bar) => bar.stepId === 'ship')!
    expect(validate.widthRatio).toBeGreaterThan(0.05)
    expect(ship.widthRatio).toBeGreaterThan(0.05)
  })

  test('the compressed bar still reports its real elapsed time', () => {
    const threeDays = 3 * 24 * 60 * 60
    const model = buildRunGantt({
      stepInstances: [step('validate', 0, 1), step('approve', 1, threeDays), step('ship', 1 + threeDays, 1)],
    })
    const approve = model.bars.find((bar) => bar.stepId === 'approve')!
    expect(approve.durationMs).toBe(threeDays * 1000)
    expect(approve.spansCollapsedWait).toBe(true)
  })

  test('collapsedDurationMs reports what the chart is hiding', () => {
    const oneHour = 3600
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 1), step('wait', 1, oneHour), step('b', 1 + oneHour, 1)],
    })
    expect(model.collapsedDurationMs).toBeGreaterThan(0)
    expect(model.collapsedDurationMs).toBeLessThan(oneHour * 1000)
  })

  test('time stays monotonic across the compressed axis', () => {
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 1), step('wait', 1, 100_000), step('b', 100_001, 1)],
    })
    const offsets = model.bars.map((bar) => bar.offsetRatio)
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index]).toBeGreaterThanOrEqual(offsets[index - 1])
    }
    const last = model.bars[model.bars.length - 1]
    expect(last.offsetRatio + last.widthRatio).toBeLessThanOrEqual(1.000001)
  })

  test('a slice below the absolute floor is never compressed, however uneven the run', () => {
    // Every slice here is sub-second, so the derived threshold is clamped to
    // MIN_COLLAPSIBLE_MS and nothing collapses.
    const model = buildRunGantt({
      stepInstances: [
        { id: 'a', stepId: 'a', status: 'COMPLETED', enteredAt: new Date(BASE).toISOString(), exitedAt: new Date(BASE + 1).toISOString() },
        { id: 'b', stepId: 'b', status: 'COMPLETED', enteredAt: new Date(BASE + 1).toISOString(), exitedAt: new Date(BASE + 900).toISOString() },
      ],
    })
    expect(MIN_COLLAPSIBLE_MS).toBe(1000)
    expect(model.collapsedSegments).toEqual([])
  })

  test('the collapse factor is conservative enough to leave a merely slow step alone', () => {
    expect(COLLAPSE_FACTOR).toBeGreaterThanOrEqual(4)
    // Three equal 10s steps: no slice exceeds 4x the median, so nothing collapses.
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 10), step('b', 10, 10), step('c', 20, 10)],
    })
    expect(model.collapsedSegments).toEqual([])
  })
})

describe('buildRunGantt — lanes', () => {
  test('sequential steps share one lane', () => {
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 5), step('b', 5, 5), step('c', 10, 5)],
    })
    expect(model.laneCount).toBe(1)
    expect(model.bars.every((bar) => bar.lane === 0)).toBe(true)
  })

  test('overlapping steps in the same token get separate lanes', () => {
    const model = buildRunGantt({
      stepInstances: [step('a', 0, 10), step('b', 2, 10)],
    })
    expect(model.laneCount).toBe(2)
    expect(new Set(model.bars.map((bar) => bar.lane)).size).toBe(2)
  })

  test('each parallel branch reads as its own band rather than being scattered', () => {
    const model = buildRunGantt({
      stepInstances: [
        step('fork', 0, 1),
        step('left-1', 1, 2, { branchInstanceId: 'branch-left' }),
        step('right-1', 1, 2, { branchInstanceId: 'branch-right' }),
        step('left-2', 3, 2, { branchInstanceId: 'branch-left' }),
        step('right-2', 3, 2, { branchInstanceId: 'branch-right' }),
      ],
    })

    const laneOf = (stepId: string) => model.bars.find((bar) => bar.stepId === stepId)!.lane
    expect(laneOf('left-1')).toBe(laneOf('left-2'))
    expect(laneOf('right-1')).toBe(laneOf('right-2'))
    expect(laneOf('left-1')).not.toBe(laneOf('right-1'))
    expect(laneOf('fork')).not.toBe(laneOf('left-1'))
  })
})
