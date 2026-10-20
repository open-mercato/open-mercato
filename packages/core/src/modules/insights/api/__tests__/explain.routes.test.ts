/** @jest-environment node */
import * as explainRoute from '../explain/route'
import * as descriptorsRoute from '../explain/descriptors/route'
import * as logRoute from '../explain/log/route'
import {
  DEAL_ID,
  ORG_A,
  ORG_B,
  OTHER_ORG_DEAL_ID,
  OTHER_USER_ID,
  TENANT_ID,
  VIEWER_ID,
  buildService,
  historyEntry,
  registerTestExplainConfig,
  resetDeals,
  testExplainConfig,
  type HistoryStore,
} from '../../__tests__/explainTestSupport'
import type { ExplainFieldResponse } from '../../data/validators'

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  detectLocale: jest.fn(async () => 'en'),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

const containerServices: Record<string, unknown> = {}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => containerServices[name],
  })),
}))

const ALL_FEATURES = ['insights.*', 'test.deals.view', 'workflows.instances.view', 'audit_logs.view_tenant', 'audit_logs.view_self']
const EXPLAIN_URL = 'http://localhost/api/insights/explain'

type ScopeShape = { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null; tenantId: string | null }

let granted: string[]
let store: HistoryStore
let scope: ScopeShape
let built: ReturnType<typeof buildService>

async function mocks() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
  return {
    getAuthFromRequest: getAuthFromRequest as jest.Mock,
    resolveFeatureCheckContext: resolveFeatureCheckContext as jest.Mock,
  }
}

function explainUrl(params: Record<string, string>): string {
  return `${EXPLAIN_URL}?${new URLSearchParams(params).toString()}`
}

beforeEach(async () => {
  jest.clearAllMocks()
  registerTestExplainConfig()
  resetDeals()
  granted = ALL_FEATURES
  scope = { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_ID }
  store = {
    entries: [
      historyEntry({ at: '2026-10-08T07:00:00.000Z', from: 'open', to: 'won' }),
      historyEntry({ at: '2026-10-08T06:00:00.000Z', from: 'new', to: 'open', actorUserId: VIEWER_ID }),
      historyEntry({ at: '2026-10-08T06:00:00.000Z', resourceId: OTHER_ORG_DEAL_ID, organizationId: ORG_B, from: 'new', to: 'open' }),
    ],
    scopes: [],
  }
  built = buildService(store, () => granted)
  containerServices.explainService = built.service
  const { getAuthFromRequest, resolveFeatureCheckContext } = await mocks()
  getAuthFromRequest.mockResolvedValue({ sub: VIEWER_ID, tenantId: TENANT_ID, orgId: ORG_A })
  resolveFeatureCheckContext.mockImplementation(async () => ({ organizationId: scope.selectedId, scope, allowedOrganizationIds: scope.allowedIds }))
})

describe('insights explain routes — contract', () => {
  it('declares auth and feature metadata plus OpenAPI docs on every route', () => {
    for (const route of [explainRoute, descriptorsRoute, logRoute]) {
      expect(route.metadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.explain.view'] } })
      expect(route.openApi.methods.GET).toBeDefined()
    }
  })
})

describe('GET /api/insights/explain', () => {
  it('explains a field and resolves scope with the resource features', async () => {
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' })))
    const body = await res.json() as ExplainFieldResponse

    expect(res.status).toBe(200)
    expect(body.verdict).toBe('explained')
    const { resolveFeatureCheckContext } = await mocks()
    expect(resolveFeatureCheckContext).toHaveBeenCalledWith(expect.objectContaining({
      requiredFeatures: ['insights.explain.view', 'test.deals.view'],
    }))
    expect(built.actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationIds: [ORG_A],
    }))
  })

  it('returns byte-identical 404 bodies for unknown kinds, missing records, other organizations and missing features', async () => {
    const responses = [
      await explainRoute.GET(new Request(explainUrl({ resourceKind: 'unknown.kind', resourceId: DEAL_ID, field: 'status' }))),
      await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: '44444444-0000-4000-8000-0000000000ff', field: 'status' }))),
      await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status' }))),
    ]
    granted = ['insights.explain.view']
    responses.push(await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' }))))

    const bodies = await Promise.all(responses.map((res) => res.text()))
    expect(responses.map((res) => res.status)).toEqual([404, 404, 404, 404])
    expect(new Set(bodies)).toEqual(new Set(['{"error":"not_found"}']))
  })

  it.each([
    ['a missing resourceKind', { resourceId: DEAL_ID }],
    ['a limit above 100', { resourceKind: 'test.deal', resourceId: DEAL_ID, limit: '500' }],
    ['a malformed cursor', { resourceKind: 'test.deal', resourceId: DEAL_ID, before: 'yesterday' }],
    ['an impossible cursor date', { resourceKind: 'test.deal', resourceId: DEAL_ID, before: `2026-02-31T00:00:00Z_${DEAL_ID}` }],
    ['an out-of-range cursor hour', { resourceKind: 'test.deal', resourceId: DEAL_ID, before: `2026-10-08T24:00:00Z_${DEAL_ID}` }],
  ])('returns 400 invalid_query for %s', async (_label, params) => {
    const res = await explainRoute.GET(new Request(explainUrl(params as Record<string, string>)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_query')
  })

  it('returns 400 unknown_field for an undeclared field', async () => {
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'secret' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown_field' })
  })

  it('returns 401 without auth and 403 without a resolved tenant', async () => {
    const { getAuthFromRequest } = await mocks()
    getAuthFromRequest.mockResolvedValueOnce(null)
    const unauthenticated = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID })))
    expect(unauthenticated.status).toBe(401)

    getAuthFromRequest.mockResolvedValueOnce({ sub: VIEWER_ID, tenantId: null, orgId: null })
    scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
    const tenantless = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID })))
    expect(tenantless.status).toBe(403)
    expect(built.actionLogService.findFieldHistory).not.toHaveBeenCalled()
  })

  it('reads tenant-wide for an unrestricted viewer with all organizations selected', async () => {
    scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status' })))

    expect(res.status).toBe(200)
    expect(built.actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: null }))
  })

  it('limits a restricted viewer with all organizations selected to the allowed organizations', async () => {
    scope = { selectedId: null, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_ID }
    const allowed = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' })))
    const denied = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status' })))

    expect(allowed.status).toBe(200)
    expect(built.actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: [ORG_A] }))
    expect(denied.status).toBe(404)
  })

  it('returns 404 for an explicitly empty organization scope', async () => {
    scope = { selectedId: null, filterIds: [], allowedIds: [], tenantId: TENANT_ID }
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' })))

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error":"not_found"}')
    expect(built.actionLogService.findFieldHistory).not.toHaveBeenCalled()
  })

  it('redacts other actors and past values for a view_self viewer', async () => {
    granted = ALL_FEATURES.filter((feature) => feature !== 'audit_logs.view_tenant')
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' })))
    const body = await res.json() as ExplainFieldResponse

    expect(body.chain[0].actor).toEqual(expect.objectContaining({ id: null, redacted: true }))
    expect(body.chain[0].to).toEqual(expect.objectContaining({ value: null, redacted: true }))
    expect(body.chain[1].to).toEqual(expect.objectContaining({ value: 'open', redacted: false }))
    expect(body.current.value).toBe('won')
    expect(JSON.stringify(body)).not.toContain(OTHER_USER_ID)
  })

  it('returns 500 with a generic body when the service fails', async () => {
    containerServices.explainService = { explain: jest.fn(async () => { throw new Error('boom') }) }
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID })))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
  })

  it('reports a loader failure exactly once, at the route boundary', async () => {
    const config = testExplainConfig()
    const [resource] = config.resources ?? []
    registerTestExplainConfig({
      ...config,
      resources: [{ ...resource, loadCurrent: async () => { throw new Error('[internal] loader down') } }],
    })
    reportErrorMock.mockClear()
    const res = await explainRoute.GET(new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' })))

    expect(res.status).toBe(500)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.explain_failed' }))
  })

  it('resolves the organization scope with the resource features on a fresh view of the request', async () => {
    const req = new Request(explainUrl({ resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status' }))
    await explainRoute.GET(req)
    const { resolveFeatureCheckContext } = await mocks()
    const [call] = resolveFeatureCheckContext.mock.calls
    const { request } = call[0] as { request: { headers: Headers } }

    expect(request).not.toBe(req)
    expect(request.headers).toBe(req.headers)
  })
})

describe('GET /api/insights/explain/descriptors', () => {
  it('returns descriptors filtered by the caller features', async () => {
    const res = await descriptorsRoute.GET(new Request('http://localhost/api/insights/explain/descriptors'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.resources.map((resource: { resourceKind: string }) => resource.resourceKind)).toEqual(['test.deal'])
    expect(body.resources[0].fields.map((field: { key: string }) => field.key)).toEqual(['status'])
  })
})

describe('GET /api/insights/explain/log', () => {
  it('explains a visible audit entry', async () => {
    const res = await logRoute.GET(new Request(`http://localhost/api/insights/explain/log?logId=${store.entries[0].logId}`))
    expect(res.status).toBe(200)
    expect((await res.json()).logId).toBe(store.entries[0].logId)
  })

  it('re-resolves the scope with the owning resource features before loading the record', async () => {
    const res = await logRoute.GET(new Request(`http://localhost/api/insights/explain/log?logId=${store.entries[0].logId}`))
    const { resolveFeatureCheckContext } = await mocks()

    expect(res.status).toBe(200)
    expect(resolveFeatureCheckContext).toHaveBeenCalledWith(expect.objectContaining({ requiredFeatures: ['insights.explain.view'] }))
    expect(resolveFeatureCheckContext).toHaveBeenCalledWith(expect.objectContaining({ requiredFeatures: ['insights.explain.view', 'test.deals.view'] }))
  })

  it('returns 404 when the re-resolved scope excludes the entry organization', async () => {
    const { resolveFeatureCheckContext } = await mocks()
    resolveFeatureCheckContext.mockImplementation(async (params: { requiredFeatures?: string[] }) => {
      const ownerScope = (params.requiredFeatures ?? []).includes('test.deals.view')
      const resolved = ownerScope
        ? { selectedId: null, filterIds: [ORG_B], allowedIds: [ORG_B], tenantId: TENANT_ID }
        : { selectedId: null, filterIds: [ORG_A, ORG_B], allowedIds: [ORG_A, ORG_B], tenantId: TENANT_ID }
      return { organizationId: null, scope: resolved, allowedOrganizationIds: resolved.allowedIds }
    })
    const res = await logRoute.GET(new Request(`http://localhost/api/insights/explain/log?logId=${store.entries[0].logId}`))

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error":"not_found"}')
  })

  it('returns 400 for a malformed log id and an identical 404 for out-of-scope entries', async () => {
    const malformed = await logRoute.GET(new Request('http://localhost/api/insights/explain/log?logId=abc'))
    expect(malformed.status).toBe(400)

    const otherOrg = await logRoute.GET(new Request(`http://localhost/api/insights/explain/log?logId=${store.entries[2].logId}`))
    const missing = await logRoute.GET(new Request('http://localhost/api/insights/explain/log?logId=77777777-0000-4000-8000-0000000fffff'))
    expect([otherOrg.status, missing.status]).toEqual([404, 404])
    expect(await otherOrg.text()).toBe(await missing.text())
  })
})
