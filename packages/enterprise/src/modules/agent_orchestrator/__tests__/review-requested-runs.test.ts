import {
  REVIEW_REQUESTED_RUN_ID_LIMIT,
  findReviewRequestedRunIds,
} from '../lib/guardrails/integrity/reviewRequestedRuns'

type CheckRow = {
  agent_run_id: string
  tenant_id: string
  organization_id: string
  kind: string
  result: string
}

type RunRow = {
  id: string
  tenant_id: string
  organization_id: string
  agent_id: string
  status: string
  result_kind: string | null
  agent_type: string | null
  flagged_at: Date | null
  created_at: Date
  deleted_at: Date | null
}

type JoinedRow = Record<string, unknown>
type Condition = { column: string; op: string; value: unknown }

function matches(row: JoinedRow, condition: Condition): boolean {
  const actual = row[condition.column]
  const toComparable = (value: unknown) => (value instanceof Date ? value.getTime() : value)
  switch (condition.op) {
    case '=':
      return actual === condition.value
    case 'in':
      return (condition.value as unknown[]).includes(actual)
    case 'is':
      return actual === condition.value
    case 'is not':
      return actual !== condition.value
    case '>=':
      return (toComparable(actual) as number) >= (toComparable(condition.value) as number)
    case '<':
      return (toComparable(actual) as number) < (toComparable(condition.value) as number)
    default:
      throw new Error(`[internal] unsupported op ${condition.op}`)
  }
}

function createFakeEm(checks: CheckRow[], runs: RunRow[]) {
  const conditions: Condition[] = []
  let limitValue = Number.POSITIVE_INFINITY
  let orderColumn: string | null = null
  let orderDesc = false
  const joined: JoinedRow[] = []
  for (const check of checks) {
    const run = runs.find((candidate) => candidate.id === check.agent_run_id)
    if (!run) continue
    const row: JoinedRow = {}
    for (const [key, value] of Object.entries(check)) row[`agent_guardrail_checks.${key}`] = value
    for (const [key, value] of Object.entries(run)) row[`agent_runs.${key}`] = value
    joined.push(row)
  }
  const builder = {
    selectFrom: jest.fn(() => builder),
    innerJoin: jest.fn(() => builder),
    select: jest.fn(() => builder),
    where: jest.fn((column: string, op: string, value: unknown) => {
      conditions.push({ column, op, value })
      return builder
    }),
    groupBy: jest.fn(() => builder),
    orderBy: jest.fn((column: string, direction: string) => {
      orderColumn = column
      orderDesc = direction === 'desc'
      return builder
    }),
    limit: jest.fn((value: number) => {
      limitValue = value
      return builder
    }),
    execute: jest.fn(async () => {
      const filtered = joined.filter((row) => conditions.every((condition) => matches(row, condition)))
      const seen = new Set<string>()
      const grouped: JoinedRow[] = []
      for (const row of filtered) {
        const id = row['agent_runs.id'] as string
        if (seen.has(id)) continue
        seen.add(id)
        grouped.push(row)
      }
      if (orderColumn) {
        const column = orderColumn
        grouped.sort((left, right) => {
          const delta = (left[column] as Date).getTime() - (right[column] as Date).getTime()
          return orderDesc ? -delta : delta
        })
      }
      return grouped.slice(0, limitValue).map((row) => ({ runId: row['agent_runs.id'] as string }))
    }),
  }
  const em = { getKysely: jest.fn(() => builder) }
  return { em: em as never, builder, conditions }
}

const TENANT = 'tenant-1'
const ORG = 'org-1'

function run(id: string, overrides: Partial<RunRow> = {}): RunRow {
  return {
    id,
    tenant_id: TENANT,
    organization_id: ORG,
    agent_id: 'agent.other',
    status: 'ok',
    result_kind: 'research',
    agent_type: null,
    flagged_at: null,
    created_at: new Date('2026-11-10T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  }
}

function warnCheck(runId: string, overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    agent_run_id: runId,
    tenant_id: TENANT,
    organization_id: ORG,
    kind: 'abstain_or_review',
    result: 'warn',
    ...overrides,
  }
}

describe('findReviewRequestedRunIds', () => {
  it('does not let more than the cap of other-agent checks crowd out the filtered agent run', async () => {
    const runs: RunRow[] = []
    const checks: CheckRow[] = []
    const targetRun = run('run-target', { agent_id: 'agent.x', created_at: new Date('2026-11-01T00:00:00Z') })
    runs.push(targetRun)
    checks.push(warnCheck(targetRun.id))
    for (let index = 0; index < REVIEW_REQUESTED_RUN_ID_LIMIT + 100; index += 1) {
      const other = run(`run-other-${index}`, { created_at: new Date(Date.UTC(2026, 10, 5, 0, 0, index)) })
      runs.push(other)
      checks.push(warnCheck(other.id))
    }
    const { em } = createFakeEm(checks, runs)

    const ids = await findReviewRequestedRunIds(em, {
      tenantId: TENANT,
      organizationIds: [ORG],
      agentId: 'agent.x',
      createdBefore: new Date('2026-11-02T00:00:00Z'),
    })

    expect(ids).toEqual(['run-target'])
  })

  it('applies run-side filters and returns each run once, newest first', async () => {
    const runs = [
      run('run-old', { agent_id: 'agent.x', created_at: new Date('2026-11-01T00:00:00Z') }),
      run('run-new', { agent_id: 'agent.x', created_at: new Date('2026-11-03T00:00:00Z') }),
      run('run-too-new', { agent_id: 'agent.x', created_at: new Date('2026-11-09T00:00:00Z') }),
      run('run-deleted', { agent_id: 'agent.x', deleted_at: new Date('2026-11-04T00:00:00Z') }),
      run('run-pass', { agent_id: 'agent.x' }),
    ]
    const checks = [
      warnCheck('run-old'),
      warnCheck('run-new'),
      warnCheck('run-new'),
      warnCheck('run-too-new'),
      warnCheck('run-deleted'),
      warnCheck('run-pass', { result: 'pass' }),
    ]
    const { em } = createFakeEm(checks, runs)

    const ids = await findReviewRequestedRunIds(em, {
      tenantId: TENANT,
      organizationIds: [ORG],
      agentId: 'agent.x',
      createdBefore: new Date('2026-11-05T00:00:00Z'),
    })

    expect(ids).toEqual(['run-new', 'run-old'])
  })

  it('scopes both tables to the caller tenant and organizations', async () => {
    const runs = [
      run('run-mine', { agent_id: 'agent.x' }),
      run('run-other-org', { agent_id: 'agent.x', organization_id: 'org-2' }),
      run('run-other-tenant', { agent_id: 'agent.x', tenant_id: 'tenant-2' }),
      run('run-mixed', { agent_id: 'agent.x', organization_id: 'org-2' }),
    ]
    const checks = [
      warnCheck('run-mine'),
      warnCheck('run-other-org', { organization_id: 'org-2' }),
      warnCheck('run-other-tenant', { tenant_id: 'tenant-2' }),
      warnCheck('run-mixed'),
    ]
    const { em, conditions } = createFakeEm(checks, runs)

    const ids = await findReviewRequestedRunIds(em, { tenantId: TENANT, organizationIds: [ORG], agentId: 'agent.x' })

    expect(ids).toEqual(['run-mine'])
    expect(conditions).toEqual(
      expect.arrayContaining([
        { column: 'agent_guardrail_checks.tenant_id', op: '=', value: TENANT },
        { column: 'agent_runs.tenant_id', op: '=', value: TENANT },
        { column: 'agent_guardrail_checks.organization_id', op: 'in', value: [ORG] },
        { column: 'agent_runs.organization_id', op: 'in', value: [ORG] },
      ]),
    )
  })

  it('stays tenant-scoped when the caller may see every organization', async () => {
    const { em, conditions, builder } = createFakeEm([], [])
    await findReviewRequestedRunIds(em, { tenantId: TENANT, organizationIds: null })
    const columns = conditions.map((condition) => condition.column)
    expect(columns).toContain('agent_guardrail_checks.tenant_id')
    expect(columns).toContain('agent_runs.tenant_id')
    expect(columns).not.toContain('agent_guardrail_checks.organization_id')
    expect(columns).not.toContain('agent_runs.organization_id')
    expect(builder.limit).toHaveBeenCalledWith(REVIEW_REQUESTED_RUN_ID_LIMIT)
  })

  it('returns nothing without a tenant or with an empty organization scope', async () => {
    const { em, builder } = createFakeEm([], [])
    expect(await findReviewRequestedRunIds(em, { tenantId: null, organizationIds: null })).toEqual([])
    expect(await findReviewRequestedRunIds(em, { tenantId: TENANT, organizationIds: [] })).toEqual([])
    expect(builder.execute).not.toHaveBeenCalled()
  })
})

describe('runs route needs-review facet', () => {
  const findReviewRequestedRunIdsMock = jest.fn(async () => ['run-target'])
  let capturedBuildFilters:
    | ((query: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>)
    | null = null

  beforeAll(async () => {
    jest.resetModules()
    jest.doMock('@open-mercato/shared/lib/crud/factory', () => ({
      makeCrudRoute: (config: { list: { buildFilters: typeof capturedBuildFilters } }) => {
        capturedBuildFilters = config.list.buildFilters
        return { GET: jest.fn() }
      },
    }))
    jest.doMock('../lib/guardrails/integrity/reviewRequestedRuns', () => ({
      findReviewRequestedRunIds: (...args: unknown[]) => findReviewRequestedRunIdsMock(...(args as [])),
    }))
    await import('../api/runs/route')
  })

  afterAll(() => {
    jest.dontMock('@open-mercato/shared/lib/crud/factory')
    jest.dontMock('../lib/guardrails/integrity/reviewRequestedRuns')
  })

  it('passes the agent and created-before filters to the review-requested lookup', async () => {
    const fork = jest.fn(() => ({ forked: true }))
    const ctx = {
      container: { resolve: jest.fn(() => ({ fork })) },
      auth: { tenantId: TENANT },
      organizationIds: [ORG],
    }
    const createdBefore = '2026-11-02T00:00:00.000Z'

    const filters = await capturedBuildFilters!(
      { filter: 'needs-review', agentId: 'agent.x', createdBefore, status: 'ok' },
      ctx,
    )

    expect(findReviewRequestedRunIdsMock).toHaveBeenCalledWith(
      { forked: true },
      expect.objectContaining({
        tenantId: TENANT,
        organizationIds: [ORG],
        agentId: 'agent.x',
        status: 'ok',
        createdBefore: new Date(createdBefore),
      }),
    )
    expect(filters.agent_id).toEqual({ $eq: 'agent.x' })
    expect(filters.$or).toEqual(expect.arrayContaining([{ id: { $in: ['run-target'] } }]))
  })
})
