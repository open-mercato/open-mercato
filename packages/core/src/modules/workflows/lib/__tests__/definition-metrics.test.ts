/**
 * Per-definition KPI arithmetic (spec §8.5) — the pure half.
 *
 * The percentile cases are deliberately the bulk of this file: p95 over a small
 * sample is where a naive implementation is wrong, and every rollup row this
 * module writes is a small sample.
 */

import {
  EMPTY_DEFINITION_METRICS,
  WORKFLOW_ROLLUP_BUCKET_MS,
  WORKFLOW_ROLLUP_WINDOW_KEYS,
  WORKFLOW_TERMINAL_STATUSES,
  buildDefinitionMetrics,
  floorToRollupBucket,
  meanOf,
  percentileOf,
  rateOf,
  runDurationMs,
  taskMetDeadline,
} from '../metrics/definition-metrics'

describe('percentileOf', () => {
  test('returns null for an empty sample rather than 0', () => {
    // 0ms and "nothing ran" are opposite facts; a KPI card must be able to
    // tell them apart.
    expect(percentileOf([], 0.95)).toBeNull()
    expect(percentileOf([], 0.5)).toBeNull()
  })

  test('a one-element sample is its own p50 and p95', () => {
    expect(percentileOf([42], 0.5)).toBe(42)
    expect(percentileOf([42], 0.95)).toBe(42)
  })

  test('p95 of a 20-element sample is the 19th smallest, not the largest', () => {
    // ceil(0.95 * 20) - 1 = 18, i.e. the 19th value. The classic off-by-one
    // here returns index 19 (the max) and quietly reports the worst run as the
    // 95th percentile of every run.
    const values = Array.from({ length: 20 }, (_unused, index) => (index + 1) * 10)
    expect(percentileOf(values, 0.95)).toBe(190)
    expect(values[values.length - 1]).toBe(200)
  })

  test('p95 never indexes past the end of a tiny sample', () => {
    for (let size = 1; size <= 10; size += 1) {
      const values = Array.from({ length: size }, (_unused, index) => index)
      const result = percentileOf(values, 0.95)
      expect(result).not.toBeNull()
      expect(result).toBeLessThanOrEqual(size - 1)
      expect(result).toBeGreaterThanOrEqual(0)
    }
  })

  test('returns a value that is actually in the sample (nearest rank, not interpolation)', () => {
    const values = [1, 2, 100]
    const result = percentileOf(values, 0.95)
    expect(values).toContain(result)
  })

  test('does not depend on the input order and does not mutate the input', () => {
    const values = [500, 10, 300, 20, 400]
    const snapshot = [...values]
    expect(percentileOf(values, 0.5)).toBe(300)
    expect(percentileOf([...values].reverse(), 0.5)).toBe(300)
    expect(values).toEqual(snapshot)
  })

  test('sorts numerically, not lexicographically', () => {
    // The default Array#sort comparator would order these as 10, 100, 9.
    expect(percentileOf([9, 10, 100], 0.5)).toBe(10)
  })

  test('p50 of an even-sized sample takes the lower middle', () => {
    expect(percentileOf([10, 20, 30, 40], 0.5)).toBe(20)
  })
})

describe('meanOf and rateOf', () => {
  test('mean is null when empty and rounds to whole milliseconds', () => {
    expect(meanOf([])).toBeNull()
    expect(meanOf([10, 11])).toBe(11)
    expect(meanOf([1, 2, 4])).toBe(2)
  })

  test('a rate over a zero denominator is null, never 0', () => {
    expect(rateOf(0, 0)).toBeNull()
    expect(rateOf(3, 0)).toBeNull()
    expect(rateOf(0, 4)).toBe(0)
    expect(rateOf(3, 4)).toBe(0.75)
  })
})

describe('runDurationMs', () => {
  const startedAt = new Date('2026-07-01T10:00:00.000Z')

  test('measures the wall clock between start and the terminal instant', () => {
    expect(runDurationMs({ status: 'COMPLETED', startedAt, terminalAt: new Date('2026-07-01T10:00:05.000Z') })).toBe(5000)
  })

  test('is null when either end is missing', () => {
    expect(runDurationMs({ status: 'COMPLETED', startedAt: null, terminalAt: new Date() })).toBeNull()
    expect(runDurationMs({ status: 'COMPLETED', startedAt, terminalAt: null })).toBeNull()
  })

  test('refuses an inverted pair rather than contributing a negative sample', () => {
    expect(
      runDurationMs({ status: 'COMPLETED', startedAt, terminalAt: new Date('2026-07-01T09:59:00.000Z') }),
    ).toBeNull()
  })
})

describe('taskMetDeadline', () => {
  const dueDate = new Date('2026-07-01T12:00:00.000Z')

  test('landing exactly on the deadline is a hit, not a breach', () => {
    expect(taskMetDeadline({ dueDate, completedAt: dueDate })).toBe(true)
  })

  test('a minute late is a breach', () => {
    expect(taskMetDeadline({ dueDate, completedAt: new Date('2026-07-01T12:01:00.000Z') })).toBe(false)
  })

  test('a task with no deadline is never counted as a hit', () => {
    expect(taskMetDeadline({ dueDate: null, completedAt: new Date() })).toBe(false)
  })
})

describe('buildDefinitionMetrics', () => {
  const startedAt = new Date('2026-07-01T10:00:00.000Z')
  function run(status: string, durationMs: number) {
    return { status, startedAt, terminalAt: new Date(startedAt.getTime() + durationMs) }
  }

  test('an empty window reports zeros for counts and null for every rate', () => {
    const metrics = buildDefinitionMetrics({ runsStarted: 0, terminalRuns: [], completedTasks: [] })
    expect(metrics).toEqual(EMPTY_DEFINITION_METRICS)
  })

  test('classifies terminal runs and derives the success rate over them', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 10,
      terminalRuns: [run('COMPLETED', 1000), run('COMPLETED', 2000), run('FAILED', 500), run('CANCELLED', 100)],
      completedTasks: [],
    })

    expect(metrics.runsStarted).toBe(10)
    expect(metrics.runsTerminal).toBe(4)
    expect(metrics.runsCompleted).toBe(2)
    expect(metrics.runsFailed).toBe(1)
    expect(metrics.runsCancelled).toBe(1)
    expect(metrics.successRate).toBe(0.5)
  })

  test('runsStarted and runsTerminal are independent — a long-running window is not a failure', () => {
    // 10 runs started, 1 terminated. Dividing completions by STARTS would paint
    // a healthy long-running process as a 10% success rate.
    const metrics = buildDefinitionMetrics({
      runsStarted: 10,
      terminalRuns: [run('COMPLETED', 1000)],
      completedTasks: [],
    })
    expect(metrics.successRate).toBe(1)
    expect(metrics.runsTerminal).toBe(1)
  })

  test('a run with no usable duration is counted but does not enter the percentile sample', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 2,
      terminalRuns: [run('COMPLETED', 1000), { status: 'COMPLETED', startedAt: null, terminalAt: new Date() }],
      completedTasks: [],
    })

    expect(metrics.runsTerminal).toBe(2)
    expect(metrics.durationSampleCount).toBe(1)
    expect(metrics.p95DurationMs).toBe(1000)
  })

  test('reports the SLA denominator beside the hit rate and ignores deadline-less tasks', () => {
    const dueDate = new Date('2026-07-01T12:00:00.000Z')
    const metrics = buildDefinitionMetrics({
      runsStarted: 0,
      terminalRuns: [],
      completedTasks: [
        { dueDate, completedAt: new Date('2026-07-01T11:00:00.000Z') },
        { dueDate, completedAt: new Date('2026-07-01T13:00:00.000Z') },
        { dueDate: null, completedAt: new Date('2026-07-01T13:00:00.000Z') },
      ],
    })

    expect(metrics.tasksWithDeadline).toBe(2)
    expect(metrics.tasksMetDeadline).toBe(1)
    expect(metrics.taskSlaHitRate).toBe(0.5)
  })

  test('no task carried a deadline ⇒ the SLA rate is null, not 0%', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 0,
      terminalRuns: [],
      completedTasks: [{ dueDate: null, completedAt: new Date() }],
    })
    expect(metrics.tasksWithDeadline).toBe(0)
    expect(metrics.taskSlaHitRate).toBeNull()
  })

  test('an unknown terminal status is counted in runsTerminal but classified as none of the three', () => {
    // COMPENSATED reaches this function only if the engine ever starts writing
    // a terminal timestamp for it; until then it must not silently inflate the
    // failure count.
    const metrics = buildDefinitionMetrics({
      runsStarted: 1,
      terminalRuns: [run('COMPENSATED', 1000)],
      completedTasks: [],
    })
    expect(metrics.runsTerminal).toBe(1)
    expect(metrics.runsCompleted + metrics.runsFailed + metrics.runsCancelled).toBe(0)
  })

  test('is pure — the same input yields a deeply equal result every time', () => {
    const input = {
      runsStarted: 3,
      terminalRuns: [run('COMPLETED', 1000), run('FAILED', 2000)],
      completedTasks: [],
    }
    expect(buildDefinitionMetrics(input)).toEqual(buildDefinitionMetrics(input))
  })
})

describe('rollup bucketing', () => {
  test('snaps a timestamp down to the bucket grid', () => {
    const base = Date.UTC(2026, 6, 1, 10, 0, 0)
    expect(floorToRollupBucket(base)).toBe(base)
    expect(floorToRollupBucket(base + 1)).toBe(base)
    expect(floorToRollupBucket(base + WORKFLOW_ROLLUP_BUCKET_MS - 1)).toBe(base)
    expect(floorToRollupBucket(base + WORKFLOW_ROLLUP_BUCKET_MS)).toBe(base + WORKFLOW_ROLLUP_BUCKET_MS)
  })

  test('every instant in one bucket floors to the same value — the idempotency anchor', () => {
    const base = Date.UTC(2026, 6, 1, 10, 0, 0)
    const samples = [0, 1, 1000, 60_000, WORKFLOW_ROLLUP_BUCKET_MS - 1]
    const floored = samples.map((offset) => floorToRollupBucket(base + offset))
    expect(new Set(floored).size).toBe(1)
  })
})

describe('vocabulary', () => {
  test('COMPENSATED is a terminal status now that the engine stamps its timestamp', () => {
    // It was deliberately absent while `compensation-handler` wrote no terminal
    // timestamp: counting a run the window query can never match would have
    // been a claim the rollup could not keep. The run-outcome write now stamps
    // `completedAt` on the compensating path, so it belongs here.
    expect([...WORKFLOW_TERMINAL_STATUSES]).toEqual([
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'COMPENSATED',
    ])
  })

  test('the window vocabulary mirrors the agent rollup', () => {
    expect(WORKFLOW_ROLLUP_WINDOW_KEYS).toEqual(['24h', '7d', '30d'])
  })
})
