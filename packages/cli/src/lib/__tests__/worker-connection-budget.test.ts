import {
  planWorkerConcurrency,
  resolveWorkerConnectionBudget,
} from '../worker-connection-budget'

describe('resolveWorkerConnectionBudget', () => {
  it('defaults to the pool max when no override is set', () => {
    expect(resolveWorkerConnectionBudget({} as NodeJS.ProcessEnv, 20)).toBe(20)
  })

  it('honors a positive OM_WORKERS_DB_CONNECTION_BUDGET override', () => {
    expect(
      resolveWorkerConnectionBudget(
        { OM_WORKERS_DB_CONNECTION_BUDGET: '8' } as unknown as NodeJS.ProcessEnv,
        20,
      ),
    ).toBe(8)
  })

  it('falls back to the pool max for non-numeric or non-positive overrides', () => {
    for (const value of ['0', '-3', 'abc', '']) {
      expect(
        resolveWorkerConnectionBudget(
          { OM_WORKERS_DB_CONNECTION_BUDGET: value } as unknown as NodeJS.ProcessEnv,
          16,
        ),
      ).toBe(16)
    }
  })

  it('clamps an invalid pool max to at least 1', () => {
    expect(resolveWorkerConnectionBudget({} as NodeJS.ProcessEnv, 0)).toBe(1)
    expect(resolveWorkerConnectionBudget({} as NodeJS.ProcessEnv, Number.NaN)).toBe(1)
  })
})

describe('planWorkerConcurrency', () => {
  it('passes concurrency through untouched when it fits the budget', () => {
    const plan = planWorkerConcurrency(
      [
        { queue: 'events', concurrency: 5 },
        { queue: 'vector-indexing', concurrency: 2 },
        { queue: 'fulltext-indexing', concurrency: 2 },
      ],
      20,
    )
    expect(plan.clamped).toBe(false)
    expect(plan.totalEffective).toBe(9)
    expect(plan.entries.map((entry) => entry.effective)).toEqual([5, 2, 2])
  })

  it('scales down to exactly the budget when over-subscribed', () => {
    const plan = planWorkerConcurrency(
      [
        { queue: 'events', concurrency: 10 },
        { queue: 'vector-indexing', concurrency: 10 },
        { queue: 'fulltext-indexing', concurrency: 10 },
      ],
      12,
    )
    expect(plan.clamped).toBe(true)
    expect(plan.belowQueueFloor).toBe(false)
    expect(plan.totalEffective).toBe(12)
    for (const entry of plan.entries) {
      expect(entry.effective).toBeGreaterThanOrEqual(1)
      expect(entry.effective).toBeLessThanOrEqual(entry.requested)
    }
  })

  it('keeps a floor of 1 per queue and never exceeds the request', () => {
    const plan = planWorkerConcurrency(
      [
        { queue: 'events', concurrency: 16 },
        { queue: 'vector-indexing', concurrency: 2 },
        { queue: 'fulltext-indexing', concurrency: 2 },
      ],
      6,
    )
    const byQueue = Object.fromEntries(plan.entries.map((entry) => [entry.queue, entry.effective]))
    expect(byQueue['vector-indexing']).toBeGreaterThanOrEqual(1)
    expect(byQueue['fulltext-indexing']).toBeGreaterThanOrEqual(1)
    // The largest requester absorbs most of the remaining budget.
    expect(byQueue['events']).toBeGreaterThan(byQueue['vector-indexing'])
    expect(plan.totalEffective).toBe(6)
  })

  it('flags belowQueueFloor when the budget is smaller than the queue count', () => {
    const plan = planWorkerConcurrency(
      [
        { queue: 'a', concurrency: 4 },
        { queue: 'b', concurrency: 4 },
        { queue: 'c', concurrency: 4 },
      ],
      2,
    )
    expect(plan.clamped).toBe(true)
    expect(plan.belowQueueFloor).toBe(true)
    // Floor of 1 wins even though it exceeds the budget.
    expect(plan.entries.every((entry) => entry.effective === 1)).toBe(true)
    expect(plan.totalEffective).toBe(3)
  })

  it('treats zero/negative requested concurrency as a floor of 1', () => {
    const plan = planWorkerConcurrency(
      [
        { queue: 'events', concurrency: 0 },
        { queue: 'vector-indexing', concurrency: -5 },
      ],
      20,
    )
    expect(plan.entries.map((entry) => entry.requested)).toEqual([1, 1])
    expect(plan.totalEffective).toBe(2)
    expect(plan.clamped).toBe(false)
  })
})
