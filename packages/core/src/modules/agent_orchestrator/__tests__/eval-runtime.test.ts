import type { EntityManager } from '@mikro-orm/postgresql'
import { evaluateRun } from '../lib/eval/evalRuntimeService'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../data/entities'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return actual === expected
}

/** Fake EM seeded with rows; supports findOne/find ($in), create/persist/flush. */
function createFakeEm(seed: { runs?: Array<Record<string, unknown>>; assertions?: Array<Record<string, unknown>> }) {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  stores.set(AgentRun, (seed.runs ?? []).map((r) => ({ ...r })))
  stores.set(AgentEvalAssertion, (seed.assertions ?? []).map((a) => ({ ...a })))
  stores.set(AgentEvalResult, [])
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      return { ...data, __entity: entity }
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function run(overrides: Record<string, unknown> = {}) {
  return { id: 'run-1', ...SCOPE, agentId: 'a', status: 'ok', output: { ok: true }, confidence: 0.9, ...overrides }
}
function assertion(overrides: Record<string, unknown>) {
  return {
    id: `assert-${overrides.key}`,
    ...SCOPE,
    appliesTo: '*',
    type: 'deterministic',
    enabled: true,
    deletedAt: null,
    config: null,
    ...overrides,
  }
}

describe('evaluateRun', () => {
  it('returns null verdict when no assertions apply', async () => {
    const { em, storeFor } = createFakeEm({ runs: [run()], assertions: [] })
    const result = await evaluateRun(em, SCOPE, 'run-1')
    expect(result).toEqual({ evaluated: 0, evalPassed: null, evalScore: null })
    expect(storeFor(AgentEvalResult)).toHaveLength(0)
  })

  it('passes a gate when output is present and records a result', async () => {
    const { em, storeFor } = createFakeEm({
      runs: [run()],
      assertions: [assertion({ key: 'output_present', severity: 'gate' })],
    })
    const result = await evaluateRun(em, SCOPE, 'run-1')
    expect(result.evalPassed).toBe(true)
    expect(storeFor(AgentEvalResult)).toHaveLength(1)
    expect(storeFor(AgentRun)[0].evalPassed).toBe(true)
  })

  it('fails the run when a gate assertion fails (empty output)', async () => {
    const { em, storeFor } = createFakeEm({
      runs: [run({ output: {} })],
      assertions: [assertion({ key: 'output_present', severity: 'gate' })],
    })
    const result = await evaluateRun(em, SCOPE, 'run-1')
    expect(result.evalPassed).toBe(false)
    expect(storeFor(AgentRun)[0].evalPassed).toBe(false)
  })

  it('never blocks on a failing warn assertion (evalPassed stays null without a gate)', async () => {
    const { em } = createFakeEm({
      runs: [run({ confidence: 0.1 })],
      assertions: [assertion({ key: 'min_confidence', severity: 'warn', config: { threshold: 0.8 } })],
    })
    const result = await evaluateRun(em, SCOPE, 'run-1')
    expect(result.evaluated).toBe(1)
    expect(result.evalPassed).toBeNull() // warn-only → no gate → not blocked
  })

  it('gates independently of a failing warn (gate pass + warn fail → passed)', async () => {
    const { em } = createFakeEm({
      runs: [run({ confidence: 0.1, output: { ok: true } })],
      assertions: [
        assertion({ key: 'output_present', severity: 'gate' }),
        assertion({ key: 'min_confidence', severity: 'warn', config: { threshold: 0.8 } }),
      ],
    })
    const result = await evaluateRun(em, SCOPE, 'run-1')
    expect(result.evalPassed).toBe(true)
    expect(result.evaluated).toBe(2)
  })
})
