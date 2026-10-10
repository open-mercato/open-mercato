/** @jest-environment node */
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import {
  AnalyticsFilterTooNarrowError,
  AnalyticsIndividualsDeniedError,
  AnalyticsProcessNotFoundError,
  AnalyticsTimeoutError,
  AnalyticsTooLargeError,
  AnalyticsWindowTooLargeError,
} from '../../lib/analytics/errors'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_A = '22222222-0000-4000-8000-00000000000a'
const ORG_B = '22222222-0000-4000-8000-00000000000b'
const USER_ID = '33333333-0000-4000-8000-000000000001'
const HASH = 'a'.repeat(64)

type Grants = Record<string, string[]>

const reportErrorMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const resolveFeatureCheckContextMock = jest.fn()
const resolveConformanceModelsMock = jest.fn()
const grants: { byOrganization: Grants; superAdmin: boolean } = { byOrganization: {}, superAdmin: false }
const userHasAllFeaturesMock = jest.fn(async (_userId: string, required: string[], scope: { organizationId: string | null }) => {
  if (grants.superAdmin) return true
  return hasAllFeatures(required, grants.byOrganization[scope.organizationId ?? ''] ?? [])
})
const loadAclMock = jest.fn(async (_userId: string, scope: { organizationId: string | null }) => ({
  isSuperAdmin: grants.superAdmin,
  features: grants.byOrganization[scope.organizationId ?? ''] ?? [],
}))
const facade = {
  getSummary: jest.fn(),
  getProcessMap: jest.fn(),
  getVariants: jest.fn(),
  getDurations: jest.fn(),
  getBottlenecks: jest.fn(),
  getRework: jest.fn(),
  getConformance: jest.fn(),
  getBreakdown: jest.fn(),
  listCases: jest.fn(),
  computeRollups: jest.fn(),
  invalidate: jest.fn(),
}
const draftService = {
  validateDraftDefinition: jest.fn(),
  getDefinitionForScope: jest.fn(),
}
const services: { draft: typeof draftService | null } = { draft: draftService }

const container = {
  resolve: (name: string): unknown => {
    if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock, loadAcl: loadAclMock }
    if (name === 'workflowDraftService' && services.draft) return services.draft
    if (name === 'em') return { fork: () => ({}) }
    throw new Error(`[internal] unexpected service ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => resolveFeatureCheckContextMock(...args),
}))

jest.mock('../../lib/analytics/index', () => {
  const actual = jest.requireActual('../../lib/analytics/index')
  return { ...actual, createXrayAnalyticsFromContainer: () => facade }
})

jest.mock('../../lib/xrayConformanceModels', () => ({
  resolveXrayConformanceModels: (...args: unknown[]) => resolveConformanceModelsMock(...args),
}))

jest.mock('../../lib/process/registry', () => {
  const actual = jest.requireActual('../../lib/process/registry')
  const field = (key: string) => ({ key, labelKey: `test.fields.${key}`, valueKind: 'dictionary', snapshotPaths: [key], changeKeys: [key] })
  const process = (processKey: string, requiredFeatures: string[]) => ({
    moduleId: 'test',
    processKey,
    labelKey: `${processKey}.label`,
    resourceKind: processKey,
    logResourceKinds: [processKey],
    entityId: 'test:entity',
    requiredFeatures,
    stageFields: [field('status')],
    followupFields: [],
    milestones: [],
    exits: [],
    endStates: [],
  })
  return {
    ...actual,
    getProcessRegistry: () => ({
      ready: true,
      contractHash: 'hash',
      processes: [process('test.deal', ['customers.deals.view']), process('test.order', ['sales.orders.view'])],
      rejected: [],
      actorDimensionProviders: [],
    }),
  }
})

import { GET as processesGet } from '../xray/processes/route'
import { GET as mapGet } from '../xray/[processKey]/map/route'
import { GET as variantsGet } from '../xray/[processKey]/variants/route'
import { GET as bottlenecksGet } from '../xray/[processKey]/bottlenecks/route'
import { GET as reworkGet } from '../xray/[processKey]/rework/route'
import { GET as breakdownGet } from '../xray/[processKey]/breakdown/route'
import { GET as casesGet } from '../xray/[processKey]/cases/route'
import { GET as conformanceGet } from '../xray/[processKey]/conformance/route'
import { GET as durationsGet, metadata as durationsMetadata } from '../xray/[processKey]/durations/route'
import { POST as workflowDraftPost } from '../xray/[processKey]/variants/[hash]/workflow-draft/route'
import { metadata as mapMetadata } from '../xray/[processKey]/map/route'
import { metadata as draftMetadata } from '../xray/[processKey]/variants/[hash]/workflow-draft/route'

type Handler = (req: Request, context: { params: Record<string, string> }) => Promise<Response>

function get(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function call(handler: Handler, req: Request, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await handler(req, { params })
  return { status: response.status, body: await response.json() as Record<string, unknown>, headers: response.headers }
}

function scopeOf(options: { selectedId?: string | null; filterIds?: string[] | null; organizationId?: string | null } = {}) {
  const selectedId = options.selectedId === undefined ? ORG_A : options.selectedId
  return {
    organizationId: options.organizationId === undefined ? selectedId : options.organizationId,
    scope: {
      selectedId,
      filterIds: options.filterIds === undefined ? (selectedId ? [selectedId] : null) : options.filterIds,
      allowedIds: null,
      tenantId: TENANT_ID,
    },
    allowedOrganizationIds: null,
  }
}

function envelope(extra: Record<string, unknown> = {}) {
  return { processKey: 'test.deal', organizationIds: [ORG_A], n: 12, computedThrough: '2026-10-10T10:00:00.000000Z', incomplete: false, ...extra }
}

function lastInput(mock: jest.Mock): Record<string, unknown> {
  const calls = mock.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  grants.byOrganization = { [ORG_A]: ['insights.xray.view', 'customers.deals.view'], [ORG_B]: ['insights.xray.view', 'customers.deals.view'] }
  grants.superAdmin = false
  services.draft = draftService
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_A })
  resolveFeatureCheckContextMock.mockResolvedValue(scopeOf())
  for (const method of Object.values(facade)) method.mockReset()
  facade.getProcessMap.mockResolvedValue(envelope({ nodes: [], edges: [] }))
  facade.getVariants.mockResolvedValue(envelope({ window: { from: 'a', to: 'b', windowKey: '30d', timeZone: 'UTC' }, items: [] }))
  facade.getBottlenecks.mockResolvedValue(envelope({ items: [] }))
  facade.getRework.mockResolvedValue(envelope({ byStage: [] }))
  facade.getBreakdown.mockResolvedValue(envelope({ items: [] }))
  facade.listCases.mockResolvedValue(envelope({ items: [], nextCursor: null }))
  facade.getConformance.mockResolvedValue(envelope({ status: 'ok', models: [] }))
  facade.getDurations.mockResolvedValue(envelope({ includeSyncRun: false, completed: null, open: null, byOrganization: [] }))
  facade.getSummary.mockImplementation(async (input: { processKey: string }) => envelope({ processKey: input.processKey, openCases: null, lowConfidence: false, kAnonymity: 10 }))
})

describe('Process X-Ray analytics routes — access', () => {
  it('declares insights.xray.view with requireAuth on every method', () => {
    expect(mapMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] } })
    expect(draftMetadata).toEqual({ POST: { requireAuth: true, requireFeatures: ['insights.xray.view'] } })
  })

  it('answers 401 without a caller and 403 without a resolved tenant', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce(null)
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).status).toBe(401)
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: USER_ID, tenantId: null, orgId: null })
    resolveFeatureCheckContextMock.mockResolvedValueOnce({ organizationId: null, scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }, allowedOrganizationIds: null })
    const noTenant = await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(noTenant).toEqual(expect.objectContaining({ status: 403, body: expect.objectContaining({ code: 'tenant_required' }) }))
    expect(facade.getProcessMap).not.toHaveBeenCalled()
  })

  it('answers the identical 404 for an unknown process and for a process whose features the caller lacks', async () => {
    const unknown = await call(mapGet, get('/api/insights/xray/test.ghost/map'), { processKey: 'test.ghost' })
    const invisible = await call(mapGet, get('/api/insights/xray/test.order/map'), { processKey: 'test.order' })
    expect(unknown.status).toBe(404)
    expect(invisible.status).toBe(404)
    expect(invisible.body).toEqual(unknown.body)
    expect(unknown.body).toEqual({ error: 'insights.xray.errors.process_not_found', code: 'process_not_found', hint: null })
    expect(resolveFeatureCheckContextMock).toHaveBeenCalledWith(expect.objectContaining({ requiredFeatures: ['insights.xray.view', 'sales.orders.view'] }))
    expect(facade.getProcessMap).not.toHaveBeenCalled()
  })

  it('accepts wildcard grants through the RBAC service (module and global wildcards)', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.*', 'sales.*'] }
    expect((await call(mapGet, get('/api/insights/xray/test.order/map'), { processKey: 'test.order' })).status).toBe(200)
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).status).toBe(404)
    grants.byOrganization = { [ORG_A]: ['*'] }
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).status).toBe(200)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['customers.deals.view', 'insights.xray.view'], { tenantId: TENANT_ID, organizationId: ORG_A })
  })

  it('checks the features in the feature-check organization and never in another one', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.xray.view'], [ORG_B]: ['insights.xray.view', 'customers.deals.view'] }
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).status).toBe(404)
    resolveFeatureCheckContextMock.mockResolvedValueOnce(scopeOf({ selectedId: ORG_B }))
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).status).toBe(200)
    expect(lastInput(facade.getProcessMap).scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_B] })
  })
})

describe('Process X-Ray analytics routes — organization scope and viewer', () => {
  it('reads only the selected organization of a caller restricted to it, never another one', async () => {
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap)).toEqual(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] },
      processKey: 'test.deal',
      window: { windowKey: '30d' },
      filters: {},
    }))
    resolveFeatureCheckContextMock.mockResolvedValueOnce(scopeOf({ selectedId: null, filterIds: [ORG_A], organizationId: ORG_A }))
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap).scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_A] })
    resolveFeatureCheckContextMock.mockResolvedValueOnce(scopeOf({ selectedId: null, filterIds: [], organizationId: null }))
    grants.superAdmin = true
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap).scope).toEqual({ tenantId: TENANT_ID, organizationIds: [] })
  })

  it('goes tenant-wide only for an unrestricted caller without a selection', async () => {
    grants.superAdmin = true
    resolveFeatureCheckContextMock.mockResolvedValueOnce(scopeOf({ selectedId: null, filterIds: null, organizationId: null }))
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap).scope).toEqual({ tenantId: TENANT_ID, organizationIds: null })
    expect(lastInput(facade.getProcessMap).viewer).toEqual({ userId: USER_ID, features: ['*'], canViewIndividuals: true })
  })

  it('passes the granted features and the per-person grant (wildcard-aware) as the viewer', async () => {
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap).viewer).toEqual({ userId: USER_ID, features: ['customers.deals.view', 'insights.xray.view'], canViewIndividuals: false })
    grants.byOrganization[ORG_A] = ['insights.*', 'customers.deals.view']
    await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(lastInput(facade.getProcessMap).viewer).toEqual(expect.objectContaining({ canViewIndividuals: true }))
  })

  it('never lets shared caches store the viewer-scoped result', async () => {
    const response = await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.body).toEqual(expect.objectContaining({ n: 12, computedThrough: expect.any(String), incomplete: false }))
  })
})

describe('Process X-Ray analytics routes — query parsing', () => {
  it('maps windows, time zone and filters onto the facade input', async () => {
    await call(bottlenecksGet, get(`/api/insights/xray/test.deal/bottlenecks?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&timeZone=Europe/Warsaw&causeKinds=user,workflow&actorRoleIds=${ORG_B}&includeSyncRun=true`), { processKey: 'test.deal' })
    expect(lastInput(facade.getBottlenecks)).toEqual(expect.objectContaining({
      window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
      timeZone: 'Europe/Warsaw',
      filters: { causeKinds: ['user', 'workflow'], actorRoleIds: [ORG_B], includeSyncRun: true },
    }))
    await call(reworkGet, get('/api/insights/xray/test.deal/rework?window=7d'), { processKey: 'test.deal' })
    expect(lastInput(facade.getRework)).toEqual(expect.objectContaining({ window: { windowKey: '7d' } }))
    expect(lastInput(facade.getRework)).not.toHaveProperty('timeZone')
  })

  it('refuses malformed queries with 400 before reading anything', async () => {
    for (const query of ['window=1y', 'from=2026-01-01T00:00:00Z', 'window=7d&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z', 'includeSyncRun=perhaps']) {
      const response = await call(mapGet, get(`/api/insights/xray/test.deal/map?${query}`), { processKey: 'test.deal' })
      expect(response).toEqual(expect.objectContaining({ status: 400, body: expect.objectContaining({ code: 'invalid_request' }) }))
    }
    expect(facade.getProcessMap).not.toHaveBeenCalled()
  })

  it('caps the case page size at 100 and forwards the drill-down filters', async () => {
    expect((await call(casesGet, get('/api/insights/xray/test.deal/cases?pageSize=101'), { processKey: 'test.deal' })).status).toBe(400)
    expect((await call(casesGet, get('/api/insights/xray/test.deal/cases?status=open,archived'), { processKey: 'test.deal' })).status).toBe(400)
    await call(casesGet, get(`/api/insights/xray/test.deal/cases?pageSize=100&status=open,completed&variantHash=${HASH}&activityKey=status:won&cursor=abc`), { processKey: 'test.deal' })
    expect(lastInput(facade.listCases)).toEqual(expect.objectContaining({
      pageSize: 100,
      statuses: ['open', 'completed'],
      variantHash: HASH,
      activityKey: 'status:won',
      cursor: 'abc',
    }))
    await call(casesGet, get('/api/insights/xray/test.deal/cases'), { processKey: 'test.deal' })
    expect(lastInput(facade.listCases)).toEqual(expect.objectContaining({ pageSize: 50, cursor: null }))
  })

  it('forwards the variants limit and the breakdown grouping', async () => {
    await call(variantsGet, get('/api/insights/xray/test.deal/variants?limit=5'), { processKey: 'test.deal' })
    expect(lastInput(facade.getVariants)).toEqual(expect.objectContaining({ limit: 5 }))
    expect((await call(variantsGet, get('/api/insights/xray/test.deal/variants?limit=500'), { processKey: 'test.deal' })).status).toBe(400)
    await call(breakdownGet, get('/api/insights/xray/test.deal/breakdown'), { processKey: 'test.deal' })
    expect(lastInput(facade.getBreakdown)).toEqual(expect.objectContaining({ groupBy: 'org' }))
  })
})

describe('Process X-Ray analytics routes — error mapping', () => {
  it.each([
    [new AnalyticsWindowTooLargeError(180), 422, 'window_too_large', 'run_background_analysis'],
    [new AnalyticsTimeoutError(), 422, 'query_timeout', 'run_background_analysis'],
    [new AnalyticsTooLargeError(200_000), 422, 'result_too_large', 'run_background_analysis'],
    [new AnalyticsFilterTooNarrowError(), 422, 'filter_too_narrow', 'widen_actor_filter'],
    [new AnalyticsIndividualsDeniedError('setting_disabled'), 403, 'individuals_denied', null],
  ])('maps %p to its status, code and hint without counts', async (error, status, code, hint) => {
    facade.getProcessMap.mockRejectedValueOnce(error)
    const response = await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(response.status).toBe(status)
    expect(response.body).toEqual({ error: `insights.xray.errors.${code}`, code, hint })
    expect(JSON.stringify(response.body)).not.toMatch(/\d{2,}/)
  })

  it('maps a process unregistered meanwhile to the shared 404 and anything else to a reported 500', async () => {
    facade.getProcessMap.mockRejectedValueOnce(new AnalyticsProcessNotFoundError())
    expect((await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })).body).toEqual({ error: 'insights.xray.errors.process_not_found', code: 'process_not_found', hint: null })
    facade.getProcessMap.mockRejectedValueOnce(new Error('relation does not exist (secret)'))
    const failed = await call(mapGet, get('/api/insights/xray/test.deal/map'), { processKey: 'test.deal' })
    expect(failed).toEqual(expect.objectContaining({ status: 500, body: { error: 'insights.xray.errors.internal_error', code: 'internal_error', hint: null } }))
    expect(JSON.stringify(failed.body)).not.toContain('secret')
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.xray_route_failed', attributes: { route: 'xray.map' } }))
  })

  it('refuses a per-person breakdown with 403 when the library denies it', async () => {
    grants.byOrganization[ORG_A] = ['insights.xray.view', 'insights.xray.view_individuals', 'customers.deals.view']
    facade.getBreakdown.mockRejectedValueOnce(new AnalyticsIndividualsDeniedError('setting_disabled'))
    const response = await call(breakdownGet, get('/api/insights/xray/test.deal/breakdown?groupBy=user'), { processKey: 'test.deal' })
    expect(response).toEqual(expect.objectContaining({ status: 403, body: { error: 'insights.xray.errors.individuals_denied', code: 'individuals_denied', hint: null } }))
    expect(lastInput(facade.getBreakdown)).toEqual(expect.objectContaining({
      groupBy: 'user',
      scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] },
      viewer: expect.objectContaining({ canViewIndividuals: true }),
    }))
  })
})

describe('Process X-Ray analytics routes — per-person scope', () => {
  const VIEW = ['insights.xray.view', 'customers.deals.view']
  const INDIVIDUALS = [...VIEW, 'insights.xray.view_individuals']
  const breakdownPath = '/api/insights/xray/test.deal/breakdown?groupBy=user'

  function narrowingResolver(options: { selectedId: string | null; candidates: string[]; organizationId: string }) {
    return async (params: { requiredFeatures: string[] }) => {
      const filterIds = options.selectedId
        ? [options.selectedId]
        : options.candidates.filter((organizationId) => hasAllFeatures(params.requiredFeatures, grants.byOrganization[organizationId] ?? []))
      return {
        organizationId: options.organizationId,
        scope: { selectedId: options.selectedId, filterIds, allowedIds: null, tenantId: TENANT_ID },
        allowedOrganizationIds: null,
      }
    }
  }

  it('narrows a per-person breakdown to the organizations where the caller holds insights.xray.view_individuals', async () => {
    grants.byOrganization = { [ORG_A]: INDIVIDUALS, [ORG_B]: VIEW }
    resolveFeatureCheckContextMock.mockImplementation(narrowingResolver({ selectedId: null, candidates: [ORG_A, ORG_B], organizationId: ORG_A }))
    const aggregate = await call(breakdownGet, get('/api/insights/xray/test.deal/breakdown?groupBy=org'), { processKey: 'test.deal' })
    expect(aggregate.status).toBe(200)
    expect(lastInput(facade.getBreakdown).scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B] })
    const perPerson = await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })
    expect(perPerson.status).toBe(200)
    expect(facade.getBreakdown).toHaveBeenCalledTimes(2)
    expect(lastInput(facade.getBreakdown)).toEqual(expect.objectContaining({
      groupBy: 'user',
      scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] },
      viewer: expect.objectContaining({ userId: USER_ID, canViewIndividuals: true }),
    }))
    const resolverCalls = resolveFeatureCheckContextMock.mock.calls.slice(-2).map((args) => args[0] as { requiredFeatures: string[]; request: unknown })
    expect(resolverCalls.map((args) => args.requiredFeatures)).toEqual([
      ['customers.deals.view', 'insights.xray.view'],
      ['customers.deals.view', 'insights.xray.view', 'insights.xray.view_individuals'],
    ])
    expect(resolverCalls[1].request).not.toBe(resolverCalls[0].request)
  })

  it('keeps the whole scope only when the feature is held in every organization of it', async () => {
    grants.byOrganization = { [ORG_A]: INDIVIDUALS, [ORG_B]: INDIVIDUALS }
    resolveFeatureCheckContextMock.mockImplementation(narrowingResolver({ selectedId: null, candidates: [ORG_A, ORG_B], organizationId: ORG_A }))
    expect((await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })).status).toBe(200)
    expect(lastInput(facade.getBreakdown).scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B] })
    grants.superAdmin = true
    resolveFeatureCheckContextMock.mockImplementation(async () => scopeOf({ selectedId: null, filterIds: null, organizationId: null }))
    expect((await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })).status).toBe(200)
    expect(lastInput(facade.getBreakdown).scope).toEqual({ tenantId: TENANT_ID, organizationIds: null })
  })

  it('answers 403 individuals_denied without reading when the feature-check organization lacks the feature', async () => {
    grants.byOrganization = { [ORG_A]: VIEW, [ORG_B]: INDIVIDUALS }
    resolveFeatureCheckContextMock.mockImplementation(narrowingResolver({ selectedId: null, candidates: [ORG_A, ORG_B], organizationId: ORG_A }))
    const response = await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })
    expect(response).toEqual(expect.objectContaining({ status: 403, body: { error: 'insights.xray.errors.individuals_denied', code: 'individuals_denied', hint: null } }))
    expect(facade.getBreakdown).not.toHaveBeenCalled()
  })

  it('answers 403 individuals_denied without reading when the selected organization lacks the feature', async () => {
    grants.byOrganization = { [ORG_A]: INDIVIDUALS, [ORG_B]: VIEW }
    resolveFeatureCheckContextMock.mockImplementation(narrowingResolver({ selectedId: ORG_B, candidates: [ORG_A, ORG_B], organizationId: ORG_B }))
    const response = await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })
    expect(response).toEqual(expect.objectContaining({ status: 403, body: expect.objectContaining({ code: 'individuals_denied' }) }))
    expect(facade.getBreakdown).not.toHaveBeenCalled()
  })

  it('answers 403 individuals_denied when no organization of the scope remains', async () => {
    grants.byOrganization = { [ORG_A]: INDIVIDUALS, [ORG_B]: VIEW }
    resolveFeatureCheckContextMock.mockImplementation(async (params: { requiredFeatures: string[] }) => {
      const filterIds = params.requiredFeatures.includes('insights.xray.view_individuals') ? [] : [ORG_B]
      return { organizationId: ORG_A, scope: { selectedId: null, filterIds, allowedIds: null, tenantId: TENANT_ID }, allowedOrganizationIds: null }
    })
    const response = await call(breakdownGet, get(breakdownPath), { processKey: 'test.deal' })
    expect(response).toEqual(expect.objectContaining({ status: 403, body: expect.objectContaining({ code: 'individuals_denied' }) }))
    expect(facade.getBreakdown).not.toHaveBeenCalled()
  })
})

describe('GET /api/insights/xray/processes', () => {
  it('lists only the processes whose features the caller holds, with headline counts per process scope', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.xray.view', 'customers.*'] }
    const response = await call(processesGet as Handler, get('/api/insights/xray/processes?window=7d'), {})
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [expect.objectContaining({ processKey: 'test.deal', labelKey: 'test.deal.label', moduleId: 'test', resourceKind: 'test.deal', n: 12 })],
      n: 12,
      computedThrough: '2026-10-10T10:00:00.000000Z',
      incomplete: false,
    })
    expect(facade.getSummary).toHaveBeenCalledTimes(1)
    expect(lastInput(facade.getSummary)).toEqual(expect.objectContaining({ processKey: 'test.deal', window: { windowKey: '7d' }, scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] } }))
  })

  it('reports the oldest position and incompleteness over the listed processes', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.xray.view', 'customers.deals.view', 'sales.orders.view'] }
    facade.getSummary.mockImplementationOnce(async () => envelope({ computedThrough: '2026-10-10T09:00:00.000000Z' }))
    facade.getSummary.mockImplementationOnce(async () => envelope({ processKey: 'test.order', n: 3 }))
    const listed = await call(processesGet as Handler, get('/api/insights/xray/processes'), {})
    expect(listed.body).toEqual(expect.objectContaining({ n: 15, computedThrough: '2026-10-10T09:00:00.000000Z', incomplete: false }))
    facade.getSummary.mockImplementationOnce(async () => envelope({ computedThrough: null, incomplete: true }))
    const incomplete = await call(processesGet as Handler, get('/api/insights/xray/processes'), {})
    expect(incomplete.body).toEqual(expect.objectContaining({ computedThrough: null, incomplete: true }))
  })

  it('lists nothing (200) without the process features and refuses an invalid window', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.xray.view'] }
    expect((await call(processesGet as Handler, get('/api/insights/xray/processes'), {})).body).toEqual({ items: [], n: 0, computedThrough: null, incomplete: false })
    expect((await call(processesGet as Handler, get('/api/insights/xray/processes?from=2026-01-01T00:00:00Z'), {})).status).toBe(400)
  })
})

describe('GET /api/insights/xray/{processKey}/conformance', () => {
  it('compares with an ad-hoc sequence (order and repeats kept) without touching the workflows module', async () => {
    await call(conformanceGet, get('/api/insights/xray/test.deal/conformance?sequence=created,status:open,status:won,status:open'), { processKey: 'test.deal' })
    const input = lastInput(facade.getConformance)
    expect((input.models as Array<{ steps: string[]; transitions: string[][] }>)[0].transitions).toEqual([['created', 'status:open'], ['status:open', 'status:won'], ['status:won', 'status:open']])
    expect(resolveConformanceModelsMock).not.toHaveBeenCalled()
  })

  it('uses the organizations\' configured workflows and maps a missing model to 422', async () => {
    resolveConformanceModelsMock.mockResolvedValueOnce({ ok: true, models: [{ key: 'workflow:x' }], organizationModelKeys: { [ORG_A]: 'workflow:x' } })
    await call(conformanceGet, get('/api/insights/xray/test.deal/conformance'), { processKey: 'test.deal' })
    expect(resolveConformanceModelsMock).toHaveBeenCalledWith(container, expect.objectContaining({ tenantId: TENANT_ID, organizationIds: [ORG_A] }))
    expect(lastInput(facade.getConformance)).toEqual(expect.objectContaining({ models: [{ key: 'workflow:x' }], organizationModelKeys: { [ORG_A]: 'workflow:x' } }))
    for (const code of ['conformance_model_missing', 'workflows_unavailable', 'too_many_models']) {
      resolveConformanceModelsMock.mockResolvedValueOnce({ ok: false, code })
      expect(await call(conformanceGet, get('/api/insights/xray/test.deal/conformance'), { processKey: 'test.deal' }))
        .toEqual(expect.objectContaining({ status: 422, body: { error: `insights.xray.errors.${code}`, code, hint: null } }))
    }
  })
})

describe('POST /api/insights/xray/{processKey}/variants/{hash}/workflow-draft', () => {
  const draftPath = `/api/insights/xray/test.deal/variants/${HASH}/workflow-draft`
  const params = { processKey: 'test.deal', hash: HASH }

  beforeEach(() => {
    grants.byOrganization[ORG_A] = ['insights.xray.view', 'customers.deals.view', 'customers.deals.manage']
    facade.getVariants.mockResolvedValue(envelope({
      window: { from: 'a', to: 'b', windowKey: '30d', timeZone: 'UTC' },
      items: [{ variantHash: HASH, rawVariantHashes: [], rawVariantHashesTruncated: false, activityKeys: ['created', 'status:open', 'status:won', 'ownerUserId:changed'], cases: 9, share: 0.75, cycleTime: { n: 9, medianMs: 1, p90Ms: null, lowConfidence: true } }],
    }))
    draftService.validateDraftDefinition.mockImplementation(async (payload: unknown) => ({
      ok: true,
      payload,
      commands: [{ commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'] }],
      workflowIdAvailable: true,
    }))
  })

  it('returns a validated, disabled draft built from the visible variant and persists nothing', async () => {
    const response = await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update', window: '90d' }), params)
    expect(response.status).toBe(200)
    expect(lastInput(facade.getVariants)).toEqual(expect.objectContaining({ limit: 100, window: { windowKey: '90d' } }))
    const [payload, scope] = draftService.validateDraftDefinition.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
    expect(payload).toEqual(expect.objectContaining({ enabled: false, lifecycle: 'draft', kind: 'workflow', workflowId: `xray.test.deal.${HASH.slice(0, 12)}` }))
    const definition = payload.definition as { steps: Array<{ stepType: string; activities?: Array<{ activityType: string; config: unknown }> }> }
    const activities = definition.steps.flatMap((step) => step.activities ?? [])
    expect(activities.map((activity) => activity.activityType)).toEqual(['UPDATE_ENTITY', 'UPDATE_ENTITY'])
    expect(activities[1].config).toEqual({ commandId: 'customers.deals.update', input: { id: '{{context.recordId}}', status: 'won' } })
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      persisted: false,
      variantHash: HASH,
      variantCases: 9,
      n: 12,
      computedThrough: '2026-10-10T10:00:00.000000Z',
      incomplete: false,
      activityStepMap: { 'status:open': 'set_status_1', 'status:won': 'set_status_2' },
      skippedActivities: ['created', 'ownerUserId:changed'],
      workflowIdAvailable: true,
    }))
  })

  it('answers 404 for a variant that is not visible and 400 for a malformed hash or body', async () => {
    facade.getVariants.mockResolvedValueOnce(envelope({ window: {}, items: [] }))
    expect((await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update' }), params)).body).toEqual(expect.objectContaining({ code: 'variant_not_found' }))
    expect((await call(workflowDraftPost, post('/api/insights/xray/test.deal/variants/xyz/workflow-draft', { commandId: 'x' }), { processKey: 'test.deal', hash: 'xyz' })).status).toBe(400)
    expect((await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update', surprise: true }), params)).status).toBe(400)
    expect((await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update', inputKeys: { status: 'id' } }), params)).status).toBe(400)
  })

  it('answers 422 without the workflows module, for an inexpressible variant and for an invalid draft', async () => {
    services.draft = null
    expect((await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update' }), params)).body).toEqual(expect.objectContaining({ code: 'workflows_unavailable' }))
    services.draft = draftService
    facade.getVariants.mockResolvedValueOnce(envelope({ window: {}, items: [{ variantHash: HASH, activityKeys: ['created', 'deleted'], cases: 9, share: 1, rawVariantHashes: [], rawVariantHashesTruncated: false, cycleTime: { n: 0, medianMs: null, p90Ms: null, lowConfidence: true } }] }))
    expect((await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update' }), params)).body).toEqual(expect.objectContaining({ code: 'variant_not_draftable' }))
    draftService.validateDraftDefinition.mockResolvedValueOnce({ ok: false, issues: [{ path: 'definition.steps.1.activities.0.config.commandId', code: 'command_not_workflow_safe', message: 'internal' }] })
    const invalid = await call(workflowDraftPost, post(draftPath, { commandId: 'auth.users.delete' }), params)
    expect(invalid).toEqual(expect.objectContaining({ status: 422 }))
    expect(invalid.body).toEqual({
      error: 'insights.xray.errors.workflow_draft_invalid',
      code: 'workflow_draft_invalid',
      hint: null,
      issues: [{ path: 'definition.steps.1.activities.0.config.commandId', code: 'command_not_workflow_safe' }],
    })
  })

  it('answers 403 when the caller lacks the features of the command', async () => {
    grants.byOrganization[ORG_A] = ['insights.xray.view', 'customers.deals.view']
    const response = await call(workflowDraftPost, post(draftPath, { commandId: 'customers.deals.update' }), params)
    expect(response).toEqual(expect.objectContaining({ status: 403, body: expect.objectContaining({ code: 'command_forbidden' }) }))
  })
})

describe('GET /api/insights/xray/{processKey}/durations', () => {
  it('declares insights.xray.view and reads the cycle times through the facade with the caller scope and filters', async () => {
    expect(durationsMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] } })
    const response = await call(durationsGet, get('/api/insights/xray/test.deal/durations?window=7d&causeKinds=user&includeSyncRun=true'), { processKey: 'test.deal' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.body).toEqual(expect.objectContaining({ n: 12, completed: null, open: null }))
    expect(lastInput(facade.getDurations)).toEqual(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] },
      processKey: 'test.deal',
      window: { windowKey: '7d' },
      filters: { causeKinds: ['user'], includeSyncRun: true },
    }))
  })

  it('answers the shared 404 for an invisible process and 400 for a malformed query without reading', async () => {
    const invisible = await call(durationsGet, get('/api/insights/xray/test.order/durations'), { processKey: 'test.order' })
    expect(invisible).toEqual(expect.objectContaining({ status: 404, body: expect.objectContaining({ code: 'process_not_found' }) }))
    const malformed = await call(durationsGet, get('/api/insights/xray/test.deal/durations?includeSyncRun=perhaps'), { processKey: 'test.deal' })
    expect(malformed).toEqual(expect.objectContaining({ status: 400, body: expect.objectContaining({ code: 'invalid_request' }) }))
    expect(facade.getDurations).not.toHaveBeenCalled()
  })

  it('maps analytics refusals (actor filter too narrow) to 422 without counts', async () => {
    facade.getDurations.mockRejectedValueOnce(new AnalyticsFilterTooNarrowError())
    const response = await call(durationsGet, get(`/api/insights/xray/test.deal/durations?actorRoleIds=${ORG_B}`), { processKey: 'test.deal' })
    expect(response).toEqual(expect.objectContaining({ status: 422, body: { error: 'insights.xray.errors.filter_too_narrow', code: 'filter_too_narrow', hint: 'widen_actor_filter' } }))
  })
})
