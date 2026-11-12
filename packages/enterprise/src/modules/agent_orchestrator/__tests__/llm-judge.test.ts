import type { EntityManager } from '@mikro-orm/postgresql'
import { runLlmJudgeForRun, type JudgeFn } from '../lib/eval/llmJudge'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../data/entities'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return actual === expected
}

function createFakeEm(seed: {
  runs?: Array<Record<string, unknown>>
  assertions?: Array<Record<string, unknown>>
  results?: Array<Record<string, unknown>>
}) {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  stores.set(AgentRun, (seed.runs ?? []).map((r) => ({ ...r })))
  stores.set(AgentEvalAssertion, (seed.assertions ?? []).map((a) => ({ ...a })))
  stores.set(AgentEvalResult, (seed.results ?? []).map((r) => ({ ...r })))
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const em = {
    create: (entity: unknown, data: Record<string, unknown>) => ({ ...data, __entity: entity }),
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

const passingJudge: JudgeFn = async () => ({ passed: true, score: 0.9, feedback: 'looks good' })

function run() {
  return { id: 'run-1', ...SCOPE, agentId: 'a', output: { ok: true }, evalPassed: true }
}
function judgeAssertion(key: string) {
  return {
    id: `assert-${key}`,
    ...SCOPE,
    key,
    appliesTo: '*',
    type: 'llm_judge',
    enabled: true,
    deletedAt: null,
    severity: 'warn',
    config: { rubric: 'be helpful' },
  }
}

describe('runLlmJudgeForRun', () => {
  it('writes a warn result per llm_judge assertion and never touches evalPassed', async () => {
    const { em, storeFor } = createFakeEm({ runs: [run()], assertions: [judgeAssertion('faithfulness')] })
    const result = await runLlmJudgeForRun(em, SCOPE, 'run-1', passingJudge)

    expect(result).toEqual({ judged: 1, skipped: 0 })
    const results = storeFor(AgentEvalResult)
    expect(results).toHaveLength(1)
    expect(results[0].severity).toBe('warn')
    expect(results[0].assertionKey).toBe('faithfulness')
    expect(results[0].evidence).toEqual({ feedback: 'looks good' })
    // The judge never changes the run's gate verdict.
    expect(storeFor(AgentRun)[0].evalPassed).toBe(true)
  })

  it('is idempotent — an already-judged assertion is skipped', async () => {
    const { em, storeFor } = createFakeEm({
      runs: [run()],
      assertions: [judgeAssertion('faithfulness')],
      results: [{ id: 'pre', ...SCOPE, agentRunId: 'run-1', assertionId: 'assert-faithfulness', severity: 'warn', passed: true }],
    })
    const result = await runLlmJudgeForRun(em, SCOPE, 'run-1', passingJudge)
    expect(result).toEqual({ judged: 0, skipped: 1 })
    expect(storeFor(AgentEvalResult)).toHaveLength(1) // no new result appended
  })

  it('no-ops when the agent has no llm_judge assertions', async () => {
    const { em } = createFakeEm({ runs: [run()], assertions: [] })
    expect(await runLlmJudgeForRun(em, SCOPE, 'run-1', passingJudge)).toEqual({ judged: 0, skipped: 0 })
  })
})
