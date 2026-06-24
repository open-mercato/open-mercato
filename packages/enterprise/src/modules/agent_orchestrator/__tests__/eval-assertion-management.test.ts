import type { EntityManager } from '@mikro-orm/postgresql'
import { seedDefaultEvalAssertions } from '../lib/eval/defaultAssertions'
import { runLlmJudgeForRun, type JudgeFn } from '../lib/eval/llmJudge'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../data/entities'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return actual === expected
}

/**
 * In-memory EM fake covering the surface the seed + judge use
 * (findOne/find/create/persist/flush). Mirrors the fakes in
 * trace-ingestion-service.test.ts / llm-judge.test.ts.
 */
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

const passingJudge: JudgeFn = async () => ({ passed: true, score: 0.88, feedback: 'helpful and on-task' })

function run() {
  return { id: 'run-1', ...SCOPE, agentId: 'deals.health_check', output: { kind: 'informative', data: { ok: true } }, evalPassed: true }
}

describe('eval assertion management (F9)', () => {
  describe('seedDefaultEvalAssertions — llm_judge example', () => {
    it('seeds the disabled llm_judge_helpfulness example with a rubric config', async () => {
      const { em, storeFor } = createFakeEm({})
      await seedDefaultEvalAssertions(em, SCOPE)

      const assertions = storeFor(AgentEvalAssertion)
      const judge = assertions.find((a) => a.key === 'llm_judge_helpfulness')
      expect(judge).toBeDefined()
      expect(judge!.type).toBe('llm_judge')
      expect(judge!.severity).toBe('warn')
      expect(judge!.enabled).toBe(false)
      expect(judge!.appliesTo).toBe('*')
      expect((judge!.config as { rubric?: string }).rubric).toEqual(expect.any(String))
    })

    it('is idempotent — re-seeding does not duplicate the example', async () => {
      const { em, storeFor } = createFakeEm({})
      await seedDefaultEvalAssertions(em, SCOPE)
      await seedDefaultEvalAssertions(em, SCOPE)

      const judges = storeFor(AgentEvalAssertion).filter((a) => a.key === 'llm_judge_helpfulness')
      expect(judges).toHaveLength(1)
    })
  })

  describe('create → enable → judge path', () => {
    it('does NOT judge while the seeded llm_judge assertion stays disabled', async () => {
      const { em, storeFor } = createFakeEm({})
      await seedDefaultEvalAssertions(em, SCOPE)
      storeFor(AgentRun).push(run())

      const result = await runLlmJudgeForRun(em, SCOPE, 'run-1', passingJudge)

      expect(result).toEqual({ judged: 0, skipped: 0 })
      expect(storeFor(AgentEvalResult)).toHaveLength(0)
    })

    it('judges the run once the seeded llm_judge assertion is enabled, writing a warn result', async () => {
      const { em, storeFor } = createFakeEm({})
      await seedDefaultEvalAssertions(em, SCOPE)
      storeFor(AgentRun).push(run())

      // Simulate the engineer flipping `enabled` via the CRUD route.
      const judge = storeFor(AgentEvalAssertion).find((a) => a.key === 'llm_judge_helpfulness')!
      judge.enabled = true

      const result = await runLlmJudgeForRun(em, SCOPE, 'run-1', passingJudge)

      expect(result).toEqual({ judged: 1, skipped: 0 })
      const results = storeFor(AgentEvalResult)
      expect(results).toHaveLength(1)
      expect(results[0].assertionKey).toBe('llm_judge_helpfulness')
      expect(results[0].severity).toBe('warn')
      expect(results[0].passed).toBe(true)
      expect(results[0].evidence).toEqual({ feedback: 'helpful and on-task' })
      // The judge never flips the run's gate verdict.
      expect(storeFor(AgentRun)[0].evalPassed).toBe(true)
    })
  })
})
