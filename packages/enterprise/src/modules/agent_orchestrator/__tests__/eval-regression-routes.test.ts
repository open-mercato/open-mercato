/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { GET as compareGET, metadata as compareMetadata } from '../api/eval-runs/compare/route'
import { GET as trendGET, metadata as trendMetadata } from '../api/eval-runs/trend/route'
import { AgentEvalSuiteRun } from '../data/entities'
import { compareSuiteRuns, EvalCompareError } from '../lib/eval/regression/compareSuiteRuns'
import { buildEvalTrend } from '../lib/eval/regression/buildEvalTrend'
import { loadSuiteAgentVersions } from '../lib/eval/regression/suiteAgentVersions'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../lib/eval/regression/compareSuiteRuns', () => {
  const actual = jest.requireActual('../lib/eval/regression/compareSuiteRuns')
  return { ...actual, compareSuiteRuns: jest.fn() }
})

jest.mock('../lib/eval/regression/buildEvalTrend', () => {
  const actual = jest.requireActual('../lib/eval/regression/buildEvalTrend')
  return { ...actual, buildEvalTrend: jest.fn() }
})

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const { findWithDecryption, findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findWithDecryption: jest.Mock
  findOneWithDecryption: jest.Mock
}
const compareSuiteRunsMock = compareSuiteRuns as jest.MockedFunction<typeof compareSuiteRuns>
const buildEvalTrendMock = buildEvalTrend as jest.MockedFunction<typeof buildEvalTrend>
const actualCompare = jest.requireActual('../lib/eval/regression/compareSuiteRuns') as {
  compareSuiteRuns: typeof compareSuiteRuns
}
const actualTrend = jest.requireActual('../lib/eval/regression/buildEvalTrend') as {
  buildEvalTrend: typeof buildEvalTrend
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const BASE_ID = '33333333-3333-4333-8333-333333333333'
const HEAD_ID = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'sales.deal_researcher'
const SCOPE = { tenantId: TENANT, organizationId: ORG }
const forkedEm = { marker: 'forked-em' }

function callCompare(base = BASE_ID, head = HEAD_ID) {
  return compareGET(new Request(`http://localhost/api/agent_orchestrator/eval-runs/compare?base=${base}&head=${head}`))
}

function callTrend(query = `?agentDefinitionId=${AGENT_ID}`) {
  return trendGET(new Request(`http://localhost/api/agent_orchestrator/eval-runs/trend${query}`))
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  createRequestContainer.mockResolvedValue({
    resolve: (key: string) => (key === 'em' ? { fork: () => forkedEm } : null),
  })
})

describe('GET /api/agent_orchestrator/eval-runs/compare', () => {
  it('requires eval.manage', () => {
    expect(compareMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] })
  })

  it('compares within the caller tenant and organization taken from auth', async () => {
    compareSuiteRunsMock.mockResolvedValue({} as Awaited<ReturnType<typeof compareSuiteRuns>>)
    const response = await callCompare()
    expect(response.status).toBe(200)
    expect(compareSuiteRunsMock).toHaveBeenCalledWith(forkedEm, SCOPE, BASE_ID, HEAD_ID)
  })

  it('maps an out-of-scope run to 404 not_found', async () => {
    compareSuiteRunsMock.mockRejectedValue(new EvalCompareError('not_found', 404))
    const response = await callCompare()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found', code: 'not_found' })
  })

  it('returns 401 without auth and 400 without an organization', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    expect((await callCompare()).status).toBe(401)
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'user-1', tenantId: TENANT, orgId: null })
    expect((await callCompare()).status).toBe(400)
    expect(compareSuiteRunsMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/agent_orchestrator/eval-runs/trend', () => {
  it('requires eval.manage', () => {
    expect(trendMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] })
  })

  it('builds the trend within the caller tenant and organization taken from auth', async () => {
    buildEvalTrendMock.mockResolvedValue({ agentDefinitionId: AGENT_ID, points: [], versions: [] })
    const response = await callTrend(`?agentDefinitionId=${AGENT_ID}&evalSetVersion=v1&limit=5`)
    expect(response.status).toBe(200)
    expect(buildEvalTrendMock).toHaveBeenCalledWith(forkedEm, SCOPE, AGENT_ID, { evalSetVersion: 'v1', limit: 5 })
  })

  it('returns 401 without auth and 400 without a tenant', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    expect((await callTrend()).status).toBe(401)
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'user-1', tenantId: null, orgId: ORG })
    expect((await callTrend()).status).toBe(400)
    expect(buildEvalTrendMock).not.toHaveBeenCalled()
  })
})

describe('regression query scoping', () => {
  const em = {} as EntityManager

  it('compareSuiteRuns looks both runs up within the scope and 404s when either is outside it', async () => {
    findOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: { id: string }) =>
      where.id === BASE_ID ? { id: BASE_ID, status: 'completed', agentDefinitionId: AGENT_ID } : null,
    )
    await expect(actualCompare.compareSuiteRuns(em, SCOPE, BASE_ID, HEAD_ID)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, AgentEvalSuiteRun, { id: BASE_ID, ...SCOPE }, undefined, SCOPE)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, AgentEvalSuiteRun, { id: HEAD_ID, ...SCOPE }, undefined, SCOPE)
  })

  it('buildEvalTrend filters completed suite runs by tenant and organization', async () => {
    findWithDecryption.mockResolvedValue([])
    const trend = await actualTrend.buildEvalTrend(em, SCOPE, AGENT_ID, { evalSetVersion: 'v1', limit: 10 })
    expect(trend.points).toEqual([])
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      AgentEvalSuiteRun,
      { tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, status: 'completed', evalSetVersion: 'v1' },
      { orderBy: { createdAt: 'DESC' }, limit: 10 },
      SCOPE,
    )
  })

  it('loadSuiteAgentVersions scopes both joined tables to the tenant and organization', async () => {
    const whereCalls: Array<[string, string, unknown]> = []
    const builder = {
      innerJoin: () => builder,
      select: () => builder,
      distinct: () => builder,
      where: (column: string, operator: string, value: unknown) => {
        whereCalls.push([column, operator, value])
        return builder
      },
      execute: async () => [{ suiteRunId: BASE_ID, agentVersion: 'v1' }],
    }
    const kyselyEm = { getKysely: () => ({ selectFrom: () => builder }) } as unknown as EntityManager
    const versions = await loadSuiteAgentVersions(kyselyEm, SCOPE, [BASE_ID])
    expect(versions.get(BASE_ID)).toEqual(['v1'])
    expect(whereCalls).toEqual(
      expect.arrayContaining([
        ['agent_eval_case_runs.tenant_id', '=', TENANT],
        ['agent_eval_case_runs.organization_id', '=', ORG],
        ['agent_runs.tenant_id', '=', TENANT],
        ['agent_runs.organization_id', '=', ORG],
      ]),
    )
  })
})
