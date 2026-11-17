/** @jest-environment node */
import { GET } from '../api/metrics/overview/route'
import { AgentRun, AgentProposal, AgentCorrection, AgentMetricRollup } from '../data/entities'
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
 * In-memory EntityManager fake covering the surface the overview route uses:
 * count with equality/$in/$gte/null matching, find/findOne with a minimal
 * createdAt/computedAt orderBy. Aggregation, rollup-vs-live selection and org
 * scoping are properties of the route; the DB-backed path lives in integration.
 */
function createFakeEm(rows: Map<unknown, Array<Record<string, unknown>>>, options?: { p95?: number | null }) {
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!rows.has(entity)) rows.set(entity, [])
    return rows.get(entity)!
  }
  function matchValue(rowValue: unknown, condition: unknown): boolean {
    if (condition === null) return rowValue === null || rowValue === undefined
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>
      if ('$in' in cond) return (cond.$in as unknown[]).includes(rowValue)
      if ('$ne' in cond) {
        if (cond.$ne === null) return rowValue !== null && rowValue !== undefined
        return rowValue !== cond.$ne
      }
      if ('$gte' in cond) {
        const time = rowValue instanceof Date ? rowValue.getTime() : Number.NaN
        return !Number.isNaN(time) && time >= (cond.$gte as Date).getTime()
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
      const a = (left[field] as Date).getTime()
      const b = (right[field] as Date).getTime()
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
    getConnection() {
      // The route's org-level p95 uses a raw percentile_cont query; the fake
      // returns a canned value (aggregation itself is Postgres's job).
      return {
        async execute() {
          return [{ p95: options?.p95 ?? null }]
        },
      }
    },
  }
}

async function setup(rows: Map<unknown, Array<Record<string, unknown>>>, options?: { p95?: number | null }) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT_A, orgId: ORG_A })
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => (token === 'em' ? createFakeEm(rows, options) : null),
  })
}

function makeRequest(window?: string) {
  const query = window ? `?window=${window}` : ''
  return new Request(`http://localhost/api/agent_orchestrator/metrics/overview${query}`, { method: 'GET' })
}

function proposal(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: TENANT_A,
    organizationId: ORG_A,
    agentId: 'deals.health_check',
    // NOT NULL DEFAULT 'runtime' in the DB; the fake EM applies no entity
    // defaults. The cockpit filters on it so eval replays — which produce
    // permanently-pending proposals — cannot inflate the operator backlog.
    source: 'runtime',
    disposition: 'pending',
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    deletedAt: null,
    ...overrides,
  }
}

function run(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: TENANT_A,
    organizationId: ORG_A,
    agentId: 'deals.health_check',
    source: 'runtime',
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    deletedAt: null,
    ...overrides,
  }
}

function freshRollup(
  agentId: string,
  totalRuns: number,
  windowKey: '24h' | '7d' | '30d',
  extraMetrics?: Record<string, unknown>,
): Record<string, unknown> {
  const spanMs = ROLLUP_WINDOW_MS[windowKey]
  const windowEnd = new Date()
  return {
    tenantId: TENANT_A,
    organizationId: ORG_A,
    agentId,
    windowStart: new Date(windowEnd.getTime() - spanMs),
    windowEnd,
    computedAt: new Date(),
    metrics: {
      totalRuns,
      evaluatedRuns: 0,
      evalPassRate: null,
      overrides: 0,
      overrideRate: null,
      avgLatencyMs: null,
      costMinorTotal: 0,
      disposedProposals: 0,
      approveUnchangedRate: null,
      ...extraMetrics,
    },
  }
}

describe('GET /api/agent_orchestrator/metrics/overview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('aggregates fresh rollup rows across agents and reports source=rollup', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentMetricRollup, [
      freshRollup('agent-a', 12, '7d'),
      freshRollup('agent-b', 8, '7d'),
      freshRollup('agent-a', 99, '30d'),
    ])
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    rows.set(AgentProposal, [
      proposal({ disposition: 'pending', createdAt: twoHoursAgo }),
      proposal({ disposition: 'pending' }),
      proposal({ disposition: 'auto_approved' }),
      proposal({ disposition: 'approved' }),
      proposal({ disposition: 'edited' }),
      proposal({ disposition: 'rejected' }),
    ])
    await setup(rows)

    const res = await GET(makeRequest('7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.window).toBe('7d')
    expect(body.source).toBe('rollup')
    expect(body.runsTotal).toBe(20)
    expect(body.pendingCount).toBe(2)
    expect(body.oldestPendingAt).toBe(twoHoursAgo.toISOString())
    expect(body.dispositionCounts).toEqual({
      pending: 2,
      auto_approved: 1,
      approved: 1,
      edited: 1,
      rejected: 1,
    })
    expect(body.autoApproveRate).toBeCloseTo(1 / 4)
  })

  it('falls back to live indexed aggregates when no rollup matches the window', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentMetricRollup, [freshRollup('agent-a', 99, '30d')])
    rows.set(AgentRun, [
      run({}),
      run({}),
      run({ createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }),
    ])
    rows.set(AgentProposal, [
      proposal({ disposition: 'auto_approved' }),
      proposal({ disposition: 'rejected' }),
    ])
    await setup(rows)

    const res = await GET(makeRequest('7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.source).toBe('live')
    expect(body.runsTotal).toBe(2)
    expect(body.pendingCount).toBe(0)
    expect(body.autoApproveRate).toBeCloseTo(1 / 2)
  })

  it('returns zeros and null markers when the org has no data', async () => {
    await setup(new Map())

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.window).toBe('7d')
    expect(body.source).toBe('live')
    expect(body.runsTotal).toBe(0)
    expect(body.pendingCount).toBe(0)
    expect(body.oldestPendingAt).toBeNull()
    expect(body.autoApproveRate).toBeNull()
    expect(body.dispositionCounts).toEqual({
      pending: 0,
      auto_approved: 0,
      approved: 0,
      edited: 0,
      rejected: 0,
    })
  })

  it('is org-scoped: rows in another org never leak into the aggregates', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentProposal, [
      proposal({ disposition: 'pending' }),
      proposal({ disposition: 'pending', organizationId: ORG_B }),
      proposal({ disposition: 'auto_approved', organizationId: ORG_B }),
    ])
    rows.set(AgentRun, [run({}), run({ organizationId: ORG_B })])
    rows.set(AgentMetricRollup, [
      { ...freshRollup('agent-b', 50, '7d'), organizationId: ORG_B, tenantId: TENANT_A },
    ])
    await setup(rows)

    const res = await GET(makeRequest('7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.source).toBe('live')
    expect(body.runsTotal).toBe(1)
    expect(body.pendingCount).toBe(1)
    expect(body.autoApproveRate).toBeNull()
    expect(body.dispositionCounts.pending).toBe(1)
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('serves the traces block from fresh rollup count sums (source=rollup) plus live p95', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentMetricRollup, [
      freshRollup('agent-a', 10, '7d', { errorRuns: 2, evaluatedRuns: 4, evalPassedRuns: 3 }),
      freshRollup('agent-b', 10, '7d', { errorRuns: 0, evaluatedRuns: 6, evalPassedRuns: 6 }),
    ])
    rows.set(AgentCorrection, [
      { tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      { tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      // Outside the 7d window — must not count.
      { tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    ])
    await setup(rows, { p95: 4200 })

    const res = await GET(makeRequest('7d'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.traces.source).toBe('rollup')
    expect(body.traces.errorRate).toBeCloseTo(2 / 20)
    expect(body.traces.evalPassRate).toBeCloseTo(9 / 10)
    expect(body.traces.p95LatencyMs).toBe(4200)
    expect(body.correctionsCount).toBe(2)
  })

  it('rollup key drift: rows without the additive keys force a live traces block while runsTotal stays rollup', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    // Pre-upgrade rollup row: totalRuns present, no errorRuns/evalPassedRuns.
    rows.set(AgentMetricRollup, [freshRollup('agent-a', 5, '7d')])
    rows.set(AgentRun, [
      run({ status: 'ok', evalPassed: true }),
      run({ status: 'error', evalPassed: false }),
    ])
    await setup(rows, { p95: 100 })

    const res = await GET(makeRequest('7d'))
    const body = await res.json()

    expect(body.source).toBe('rollup')
    expect(body.runsTotal).toBe(5)
    expect(body.traces.source).toBe('live')
    // Live fallback computes from the run rows, not the drifted rollup.
    expect(body.traces.errorRate).toBeCloseTo(1 / 5)
    expect(body.traces.evalPassRate).toBeCloseTo(1 / 2)
  })

  it('live traces block when no rollup exists at all', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>()
    rows.set(AgentRun, [
      run({ status: 'ok', evalPassed: true }),
      run({ status: 'ok', evalPassed: null }),
      run({ status: 'error', evalPassed: false }),
    ])
    await setup(rows, { p95: null })

    const res = await GET(makeRequest('7d'))
    const body = await res.json()

    expect(body.traces.source).toBe('live')
    expect(body.traces.errorRate).toBeCloseTo(1 / 3)
    expect(body.traces.evalPassRate).toBeCloseTo(1 / 2)
    expect(body.traces.p95LatencyMs).toBeNull()
    expect(body.correctionsCount).toBe(0)
  })
})
