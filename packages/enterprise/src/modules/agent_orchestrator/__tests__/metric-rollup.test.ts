import type { EntityManager } from '@mikro-orm/postgresql'
import {
  writeRollupsForOrg,
  ROLLUP_WINDOW_MS,
} from '../lib/metrics/metricRollupService'
import { AgentRun, AgentCorrection, AgentProposal, AgentMetricRollup } from '../data/entities'
import type { AgentMetricRollupMetrics } from '../data/validators'

/**
 * In-memory EntityManager fake covering the surface the rollup service uses
 * (find with fields/orderBy, count with $in/$gte/$lt/$gt, findOne, create,
 * persist, flush). Idempotency (upsert per (org, agent, windowStart)) and the
 * aggregation math are properties of writeRollupsForOrg/computeAgentMetrics, so a
 * fake EM exercises them without a DB; the DB-backed path lives in integration.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending = new Set<Record<string, unknown>>()
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchValue(rowValue: unknown, condition: unknown): boolean {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>
      if ('$in' in cond) return (cond.$in as unknown[]).includes(rowValue)
      if ('$gte' in cond || '$lt' in cond || '$gt' in cond) {
        const time = (rowValue as Date)?.getTime?.() ?? Number(rowValue)
        if ('$gte' in cond && time < (cond.$gte as Date).getTime()) return false
        if ('$lt' in cond && time >= (cond.$lt as Date).getTime()) return false
        if ('$gt' in cond && time <= (cond.$gt as Date).getTime()) return false
        return true
      }
    }
    if (rowValue instanceof Date && condition instanceof Date) {
      return rowValue.getTime() === condition.getTime()
    }
    return rowValue === condition
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  }

  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.add(row)
      return em
    },
    async flush() {
      for (const row of Array.from(pending)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
      pending.clear()
    },
    async findOne(entity: unknown, where: Record<string, unknown>, _opts?: unknown) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>, _opts?: unknown) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    async count(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where)).length
    },
  }
  return { em: em as unknown as EntityManager, stores, storeFor }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const AGENT = 'deals.health_check'

function seed(storeFor: (entity: unknown) => Array<Record<string, unknown>>) {
  const now = Date.now()
  const recent = new Date(now - 60 * 60 * 1000)
  // 4 runs in the last hour: 3 evaluated (2 pass, 1 fail), latencies + cost.
  const runs = [
    { id: 'run-1', status: 'ok', evalPassed: true, latencyMs: 100, costMinor: 10 },
    { id: 'run-2', status: 'ok', evalPassed: true, latencyMs: 200, costMinor: 20 },
    { id: 'run-3', status: 'error', evalPassed: false, latencyMs: 300, costMinor: 30 },
    { id: 'run-4', status: 'ok', evalPassed: null, latencyMs: null, costMinor: null },
  ]
  for (const run of runs) {
    storeFor(AgentRun).push({
      __entity: AgentRun,
      ...SCOPE,
      agentId: AGENT,
      // The column is NOT NULL DEFAULT 'runtime' in the DB; the fake EM applies no
      // entity defaults, so fixtures must state it. Production metrics filter it:
      // eval replays write real runs and must not skew the agent's dashboards.
      source: 'runtime',
      createdAt: recent,
      deletedAt: null,
      ...run,
    })
  }
  // 1 correction against run-3 → overrides = 1.
  storeFor(AgentCorrection).push({
    __entity: AgentCorrection,
    ...SCOPE,
    agentRunId: 'run-3',
    createdAt: recent,
  })
  // 3 proposals: 2 approved (unchanged), 1 edited (changed).
  for (const disposition of ['approved', 'auto_approved', 'edited']) {
    storeFor(AgentProposal).push({
      __entity: AgentProposal,
      ...SCOPE,
      agentId: AGENT,
      createdAt: recent,
      disposition,
    })
  }
}

describe('writeRollupsForOrg', () => {
  it('writes a rollup per canonical window with correct metrics', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    const result = await writeRollupsForOrg(em, SCOPE)

    // One rollup per canonical window (the seeded agent is the only one).
    expect(result.written).toBe(Object.keys(ROLLUP_WINDOW_MS).length)
    const rollups = storeFor(AgentMetricRollup)
    expect(rollups).toHaveLength(Object.keys(ROLLUP_WINDOW_MS).length)

    const row = rollups.find((r) => r.agentId === AGENT)!
    expect(row.tenantId).toBe(SCOPE.tenantId)
    expect(row.organizationId).toBe(SCOPE.organizationId)
    const metrics = row.metrics as AgentMetricRollupMetrics
    expect(metrics.totalRuns).toBe(4)
    expect(metrics.evaluatedRuns).toBe(3)
    expect(metrics.evalPassRate).toBeCloseTo(2 / 3)
    expect(metrics.overrides).toBe(1)
    expect(metrics.overrideRate).toBeCloseTo(1 / 4)
    expect(metrics.avgLatencyMs).toBeCloseTo((100 + 200 + 300) / 3)
    expect(metrics.costMinorTotal).toBe(60)
    expect(metrics.disposedProposals).toBe(3)
    expect(metrics.approveUnchangedRate).toBeCloseTo(2 / 3)
    // Additive observability keys (data-honesty pass): counts stored alongside
    // rates so org-level readers can aggregate across agents.
    expect(metrics.errorRuns).toBe(1)
    expect(metrics.errorRate).toBeCloseTo(1 / 4)
    expect(metrics.evalPassedRuns).toBe(2)
    expect(metrics.p95LatencyMs).toBe(300)
  })

  it('is idempotent: re-running the same interval does not duplicate rows', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    await writeRollupsForOrg(em, SCOPE)
    const afterFirst = storeFor(AgentMetricRollup).length
    await writeRollupsForOrg(em, SCOPE)
    const afterSecond = storeFor(AgentMetricRollup).length

    expect(afterFirst).toBe(Object.keys(ROLLUP_WINDOW_MS).length)
    expect(afterSecond).toBe(afterFirst)

    // Each (org, agent, windowStart) appears exactly once.
    const keys = storeFor(AgentMetricRollup).map(
      (r) => `${r.organizationId}|${r.agentId}|${(r.windowStart as Date).getTime()}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})
