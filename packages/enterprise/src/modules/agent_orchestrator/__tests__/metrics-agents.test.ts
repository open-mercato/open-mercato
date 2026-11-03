/** @jest-environment node */
import { GET, metadata } from '../api/metrics/agents/route'
import { AgentRun, AgentMetricRollup } from '../data/entities'
import { ROLLUP_WINDOW_MS } from '../lib/metrics/metricRollupService'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

/**
 * In-memory EM fake covering the batch route's surface: find with $in +
 * computedAt orderBy (rollups) and the computeAgentMetrics live path (find,
 * count with $in/$gte). Selection logic (rollup-vs-live, key drift, unknown
 * ids) is the route's property; the DB path lives in integration.
 */
function createFakeEm(rows: Map<unknown, Array<Record<string, unknown>>>) {
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!rows.has(entity)) rows.set(entity, [])
    return rows.get(entity)!
  }
  function matchValue(rowValue: unknown, condition: unknown): boolean {
    if (condition === null) return rowValue === null || rowValue === undefined
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>
      if ('$in' in cond) return (cond.$in as unknown[]).includes(rowValue)
      if ('$gte' in cond) {
        const time = rowValue instanceof Date ? rowValue.getTime() : Number.NaN
        return !Number.isNaN(time) && time >= (cond.$gte as Date).getTime()
      }
      if ('$lt' in cond) {
        const time = rowValue instanceof Date ? rowValue.getTime() : Number.NaN
        return !Number.isNaN(time) && time < (cond.$lt as Date).getTime()
      }
    }
    return rowValue === condition
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  }
  function sortRows(
    matched: Array<Record<string, unknown>>,
    orderBy?: Record<string, 'asc' | 'desc'>,
  ): Array<Record<string, unknown>> {
    if (!orderBy) return matched
    const [field, dir] = Object.entries(orderBy)[0]
    return [...matched].sort((left, right) => {
      const a = left[field] instanceof Date ? (left[field] as Date).getTime() : String(left[field]).charCodeAt(0)
      const b = right[field] instanceof Date ? (right[field] as Date).getTime() : String(right[field]).charCodeAt(0)
      return dir === 'asc' ? a - b : b - a
    })
  }
  return {
    fork() {
      return this
    },
    async count(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where)).length
    },
    async find(entity: unknown, where: Record<string, unknown>, opts?: { orderBy?: Record<string, 'asc' | 'desc'> }) {
      return sortRows(storeFor(entity).filter((row) => matches(row, where)), opts?.orderBy)
    },
    async findOne(entity: unknown, where: Record<string, unknown>, opts?: { orderBy?: Record<string, 'asc' | 'desc'> }) {
      return sortRows(storeFor(entity).filter((row) => matches(row, where)), opts?.orderBy)[0] ?? null
    },
  }
}

async function setup(rows: Map<unknown, Array<Record<string, unknown>>>) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT_A, orgId: ORG_A })
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? createFakeEm(rows) : null),
  })
}

function makeRequest(query: string) {
  return new Request(`http://localhost/api/agent_orchestrator/metrics/agents${query}`, { method: 'GET' })
}

function freshRollup(agentId: string, metrics: Record<string, unknown>): Record<string, unknown> {
  const spanMs = ROLLUP_WINDOW_MS['7d']
  const windowEnd = new Date()
  return {
    tenantId: TENANT_A,
    organizationId: ORG_A,
    agentId,
    windowStart: new Date(windowEnd.getTime() - spanMs),
    windowEnd,
    computedAt: new Date(),
    metrics: {
      totalRuns: 0,
      evaluatedRuns: 0,
      evalPassRate: null,
      overrides: 0,
      overrideRate: null,
      avgLatencyMs: null,
      costMinorTotal: 0,
      disposedProposals: 0,
      approveUnchangedRate: null,
      errorRuns: 0,
      errorRate: null,
      p95LatencyMs: null,
      evalPassedRuns: 0,
      ...metrics,
    },
  }
}

describe('GET /api/agent_orchestrator/metrics/agents', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('gates on agents.view (route metadata)', () => {
    expect(metadata.GET.requireFeatures).toEqual(['agent_orchestrator.agents.view'])
  })

  it('serves rollup-preferred items and computes avgCostMinor from the total', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentMetricRollup, [
      freshRollup('agent-a', { totalRuns: 10, errorRate: 0.1, overrideRate: 0.2, evalPassRate: 0.9, avgLatencyMs: 800, costMinorTotal: 500, disposedProposals: 5 }),
    ])
    await setup(rows)

    const res = await GET(makeRequest('?window=7d&ids=agent-a'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.items).toHaveLength(1)
    const item = body.items[0]
    expect(item.agentId).toBe('agent-a')
    expect(item.source).toBe('rollup')
    expect(item.runsTotal).toBe(10)
    expect(item.errorRate).toBeCloseTo(0.1)
    expect(item.overrideRate).toBeCloseTo(0.2)
    expect(item.evalPassRate).toBeCloseTo(0.9)
    expect(item.avgCostMinor).toBeCloseTo(50)
    expect(item.costMinorTotal).toBe(500)
    expect(item.disposedProposals).toBe(5)
  })

  it('falls back to live per agent: unknown ids return zero-run live items, drifted rollups recompute', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    // Pre-upgrade rollup (no errorRate key) → the whole item live-computes.
    const drifted = freshRollup('agent-drift', { totalRuns: 99 }) as { metrics: Record<string, unknown> }
    delete drifted.metrics.errorRuns
    delete drifted.metrics.errorRate
    delete drifted.metrics.p95LatencyMs
    delete drifted.metrics.evalPassedRuns
    rows.set(AgentMetricRollup, [drifted as unknown as Record<string, unknown>])
    rows.set(AgentRun, [
      {
        tenantId: TENANT_A,
        organizationId: ORG_A,
        agentId: 'agent-drift',
        // NOT NULL DEFAULT 'runtime' in the DB; the fake EM applies no defaults.
        source: 'runtime',
        status: 'ok',
        evalPassed: null,
        latencyMs: 100,
        costMinor: 10,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        deletedAt: null,
        id: 'run-1',
      },
    ])
    await setup(rows)

    const res = await GET(makeRequest('?window=7d&ids=agent-drift,agent-unknown'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.items).toHaveLength(2)
    const driftedItem = body.items.find((row: { agentId: string }) => row.agentId === 'agent-drift')
    expect(driftedItem.source).toBe('live')
    expect(driftedItem.runsTotal).toBe(1)
    const unknownItem = body.items.find((row: { agentId: string }) => row.agentId === 'agent-unknown')
    expect(unknownItem.source).toBe('live')
    expect(unknownItem.runsTotal).toBe(0)
  })

  it('is org-scoped: another org rollup never serves this org', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentMetricRollup, [
      { ...freshRollup('agent-a', { totalRuns: 50 }), organizationId: ORG_B },
    ])
    await setup(rows)

    const res = await GET(makeRequest('?window=7d&ids=agent-a'))
    const body = await res.json()
    expect(body.items[0].source).toBe('live')
    expect(body.items[0].runsTotal).toBe(0)
  })

  it('rejects an empty or oversized ids list', async () => {
    await setup(new Map())
    expect((await GET(makeRequest('?window=7d&ids='))).status).toBe(400)
    const many = Array.from({ length: 51 }, (_, i) => `agent-${i}`).join(',')
    expect((await GET(makeRequest(`?window=7d&ids=${many}`))).status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
    expect((await GET(makeRequest('?ids=agent-a'))).status).toBe(401)
  })
})
