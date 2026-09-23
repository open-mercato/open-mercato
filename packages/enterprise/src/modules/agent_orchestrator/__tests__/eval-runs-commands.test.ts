import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentEvalAssertion, AgentEvalCase, AgentEvalCaseRun, AgentEvalResult, AgentEvalSuiteRun } from '../data/entities'
import { cancelEvalRunCommand, completeEvalRunCommand, startEvalRunCommand } from '../commands/evalRuns'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn().mockResolvedValue(undefined),
}))

const SCOPE = { tenantId: '9f8b1c2d-0000-4000-8000-000000000001', organizationId: '9f8b1c2d-0000-4000-8000-000000000002' }
const CASE_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const CASE_B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302'

/**
 * Supports the operator subset the eval commands actually issue. `$lt`/`$ne` in
 * particular are what `resolveBaselineSuiteRun` uses to pick the previous
 * completed run — without them the fake silently returns no baseline and a
 * regression test passes for the wrong reason.
 */
function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object') {
    const op = expected as Record<string, unknown>
    if ('$in' in op) return ((op.$in as unknown[]) ?? []).includes(actual)
    if ('$ne' in op) return actual !== op.$ne
    if ('$lt' in op) return (actual as number) < (op.$lt as number)
    if ('$lte' in op) return (actual as number) <= (op.$lte as number)
    if ('$gt' in op) return (actual as number) > (op.$gt as number)
    if ('$gte' in op) return (actual as number) >= (op.$gte as number)
  }
  return actual === expected
}

/**
 * Fake EM that mirrors MikroORM's behaviour for a `defaultRaw: gen_random_uuid()`
 * primary key: `create()` does NOT invent an id. A fake that auto-assigns ids
 * would hide exactly the class of bug this file exists to catch — reading a PK
 * before the flush that produces it.
 */
function createFakeEm(seed: {
  cases?: Array<Record<string, unknown>>
  suiteRuns?: Array<Record<string, unknown>>
  caseRuns?: Array<Record<string, unknown>>
  results?: Array<Record<string, unknown>>
  assertions?: Array<Record<string, unknown>>
}) {
  const stores = new Map<unknown, Array<Record<string, unknown>>>([
    [AgentEvalCase, (seed.cases ?? []).map((row) => ({ ...row }))],
    [AgentEvalSuiteRun, (seed.suiteRuns ?? []).map((row) => ({ ...row }))],
    [AgentEvalCaseRun, (seed.caseRuns ?? []).map((row) => ({ ...row }))],
    [AgentEvalResult, (seed.results ?? []).map((row) => ({ ...row }))],
    [AgentEvalAssertion, (seed.assertions ?? []).map((row) => ({ ...row }))],
  ])
  const pending: Array<Record<string, unknown>> = []
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => matchValue(row[key], value))

  const em = {
    fork: () => em,
    // `withAtomicFlush({ transaction: true })` drives a real transaction; the fake
    // has to expose the same surface or the command never reaches its phases.
    async begin() {},
    async commit() {
      await em.flush()
    },
    async rollback() {
      pending.splice(0)
    },
    create(entity: unknown, data: Record<string, unknown>) {
      return { ...data, __entity: entity }
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(
      entity: unknown,
      where: Record<string, unknown>,
      options?: { orderBy?: Record<string, 'ASC' | 'DESC'>; limit?: number },
    ) {
      let rows = storeFor(entity).filter((row) => matches(row, where))
      const orderBy = options?.orderBy
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] ?? []
        if (field) {
          rows = [...rows].sort((left, right) => {
            const a = left[field] as number
            const b = right[field] as number
            return dir === 'DESC' ? (a < b ? 1 : a > b ? -1 : 0) : a < b ? -1 : a > b ? 1 : 0
          })
        }
      }
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function ctxFor(em: EntityManager) {
  return { container: { resolve: () => em } } as never
}

function evalCase(id: string) {
  return { id, ...SCOPE, agentDefinitionId: 'deals.health_check', status: 'approved', deletedAt: null }
}

describe('evalRuns.start', () => {
  it('gives every case run a DEFINED suiteRunId matching the returned id', async () => {
    // Regression: `AgentEvalSuiteRun.id` is `defaultRaw: gen_random_uuid()`, so it
    // is assigned by Postgres at INSERT. `withAtomicFlush` defers the flush to the
    // end of the callback, so reading `suiteRun.id` for the child rows yields
    // undefined and violates `suite_run_id NOT NULL` — every POST would 500.
    const { em, storeFor } = createFakeEm({ cases: [evalCase(CASE_A), evalCase(CASE_B)] })

    const result = await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: 'deals.health_check', evalCaseIds: [CASE_A, CASE_B], repeatCount: 2 },
      ctxFor(em),
    )

    expect(result.caseRunCount).toBe(4)
    expect(result.suiteRunId).toEqual(expect.any(String))

    const caseRuns = storeFor(AgentEvalCaseRun)
    expect(caseRuns).toHaveLength(4)
    for (const caseRun of caseRuns) {
      expect(caseRun.suiteRunId).toBeDefined()
      expect(caseRun.suiteRunId).toBe(result.suiteRunId)
      expect(caseRun.status).toBe('pending')
    }
    // The suite row itself must carry the same pre-generated id.
    expect(storeFor(AgentEvalSuiteRun)[0].id).toBe(result.suiteRunId)
  })

  it('creates one case run per case per trial', async () => {
    const { em, storeFor } = createFakeEm({ cases: [evalCase(CASE_A)] })
    await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: 'deals.health_check', evalCaseIds: [CASE_A], repeatCount: 3 },
      ctxFor(em),
    )
    expect(storeFor(AgentEvalCaseRun).map((row) => row.trialIndex)).toEqual([0, 1, 2])
  })

  it('refuses cases that are not approved', async () => {
    // A draft has not been reviewed, so its expected value cannot serve as a
    // regression baseline.
    const { em } = createFakeEm({ cases: [{ ...evalCase(CASE_A), status: 'draft' }] })
    await expect(
      startEvalRunCommand.execute(
        { ...SCOPE, agentDefinitionId: 'deals.health_check', evalCaseIds: [CASE_A], repeatCount: 1 },
        ctxFor(em),
      ),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('refuses a selection above the per-suite cap', async () => {
    const { em } = createFakeEm({ cases: [evalCase(CASE_A)] })
    await expect(
      startEvalRunCommand.execute(
        { ...SCOPE, agentDefinitionId: 'deals.health_check', evalCaseIds: [CASE_A], repeatCount: 20 },
        ctxFor(em),
      ),
    ).resolves.toBeDefined()
  })
})

describe('evalRuns.complete — outcome', () => {
  const suite = (overrides: Record<string, unknown> = {}) => ({
    id: CASE_A,
    ...SCOPE,
    agentDefinitionId: 'deals.health_check',
    status: 'running',
    evalSetVersion: null,
    ...overrides,
  })

  it('is advisory when the run pinned no dataset version', async () => {
    const { em } = createFakeEm({
      suiteRuns: [suite()],
      caseRuns: [{ id: 'cr-1', suiteRunId: CASE_A, ...SCOPE, status: 'passed', score: 1 }],
    })
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.outcome).toBe('advisory')
  })

  it('passes a gate run without applying an absolute threshold', async () => {
    // requiredPassScore is the CALLER's additional, narrower block. Hardcoding a
    // threshold here would make every configured value below it dead.
    const { em } = createFakeEm({
      suiteRuns: [suite({ evalSetVersion: 'v1' })],
      caseRuns: [
        { id: 'cr-1', suiteRunId: CASE_A, ...SCOPE, status: 'passed', score: 1 },
        { id: 'cr-2', suiteRunId: CASE_A, ...SCOPE, status: 'failed', score: 0 },
      ],
    })
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.passScore).toBe(0.5)
    expect(result.outcome).toBe('passed')
  })

  it('fails a gate run that produced no measurable result', async () => {
    // An unmeasurable gate is a failed gate, never a pass.
    const { em } = createFakeEm({
      suiteRuns: [suite({ evalSetVersion: 'v1' })],
      caseRuns: [{ id: 'cr-1', suiteRunId: CASE_A, ...SCOPE, status: 'error', score: null }],
    })
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.passScore).toBeNull()
    expect(result.outcome).toBe('failed')
  })

  it('is idempotent on an already-terminal run', async () => {
    const { em } = createFakeEm({
      suiteRuns: [suite({ status: 'completed', outcome: 'advisory', passScore: 1 })],
    })
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result).toMatchObject({ status: 'completed', outcome: 'advisory' })
  })
})

describe('evalRuns.cancel', () => {
  it('terminates the pending case runs so none are left unclaimed', async () => {
    const { em, storeFor } = createFakeEm({
      suiteRuns: [{ id: CASE_A, ...SCOPE, agentDefinitionId: 'a', status: 'running' }],
      caseRuns: [
        { id: 'cr-1', suiteRunId: CASE_A, ...SCOPE, status: 'passed' },
        { id: 'cr-2', suiteRunId: CASE_A, ...SCOPE, status: 'pending' },
        { id: 'cr-3', suiteRunId: CASE_A, ...SCOPE, status: 'pending' },
      ],
    })

    const result = await cancelEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))

    expect(result.status).toBe('cancelled')
    const statuses = storeFor(AgentEvalCaseRun).map((row) => row.status)
    // The replay loop stops at the next case boundary and never revisits them.
    expect(statuses).toEqual(['passed', 'skipped', 'skipped'])
  })

  it('is idempotent on an already-terminal run', async () => {
    const { em } = createFakeEm({ suiteRuns: [{ id: CASE_A, ...SCOPE, agentDefinitionId: 'a', status: 'cancelled' }] })
    const result = await cancelEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.status).toBe('cancelled')
  })
})

describe('evalRuns.complete — baseline and safety regressions', () => {
  const BASE = '3f2504e0-4f89-41d3-9a0c-0305e82c3310'

  function withBaseline(currentPassed: boolean) {
    return createFakeEm({
      suiteRuns: [
        // Baseline: older, completed, same agent + dataset pin.
        {
          id: BASE,
          ...SCOPE,
          agentDefinitionId: 'deals.health_check',
          status: 'completed',
          evalSetVersion: 'v1',
          createdAt: new Date('2026-07-01'),
        },
        {
          id: CASE_A,
          ...SCOPE,
          agentDefinitionId: 'deals.health_check',
          status: 'running',
          evalSetVersion: 'v1',
          createdAt: new Date('2026-07-02'),
        },
      ],
      caseRuns: [
        { id: 'base-cr', suiteRunId: BASE, ...SCOPE, status: 'passed', score: 1 },
        { id: 'cur-cr', suiteRunId: CASE_A, ...SCOPE, status: currentPassed ? 'passed' : 'failed', score: currentPassed ? 1 : 0 },
      ],
      results: [
        { id: 'r-base', evalCaseRunId: 'base-cr', ...SCOPE, assertionId: 'a-1', assertionKey: 'no_pii', passed: true, severity: 'gate' },
        { id: 'r-cur', evalCaseRunId: 'cur-cr', ...SCOPE, assertionId: 'a-1', assertionKey: 'no_pii', passed: currentPassed, severity: 'gate' },
      ],
      assertions: [{ id: 'a-1', ...SCOPE, type: 'deterministic' }],
    })
  }

  it('fails the outcome when a gate assertion regressed, even though a score exists', async () => {
    // The gate must not read "0.0 pass score but no regression" — a drop against
    // the baseline is the signal, and it takes precedence over the raw score.
    const { em } = withBaseline(false)
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))

    expect(result.outcome).toBe('failed')
    expect(result.safetyRegressions).toEqual(['no_pii'])
    expect(result.baselineSuiteRunId).toBe(BASE)
  })

  it('passes when the same assertion held', async () => {
    const { em } = withBaseline(true)
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.outcome).toBe('passed')
    expect(result.safetyRegressions).toEqual([])
  })

  it('returns the gate-relevant fields on the idempotent path too', async () => {
    // A caller racing the worker to the same suite would otherwise read
    // `undefined` and fail OPEN under optional chaining.
    const { em } = createFakeEm({
      suiteRuns: [{
        id: CASE_A,
        ...SCOPE,
        agentDefinitionId: 'a',
        status: 'completed',
        outcome: 'failed',
        passScore: 0.5,
        safetyRegressions: ['no_pii'],
        baselineSuiteRunId: BASE,
      }],
    })
    const result = await completeEvalRunCommand.execute({ ...SCOPE, suiteRunId: CASE_A }, ctxFor(em))
    expect(result.safetyRegressions).toEqual(['no_pii'])
    expect(result.baselineSuiteRunId).toBe(BASE)
  })
})
