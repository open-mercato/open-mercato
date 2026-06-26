/** @jest-environment node */
import { POST } from '../api/agents/[id]/run/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_REAL = '22222222-2222-4222-8222-222222222222'
const ORG_STALE = '284107f1-87d9-4d06-87eb-67bff80bd21b'
const USER = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'deals.health_check'

function makeRequest(body: unknown = { input: { deal: { id: 'deal-1' } } }) {
  return new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: AGENT_ID })

async function setupContainer() {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const run = jest.fn(async () => ({ kind: 'informative', data: { ok: true } }))
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') return { run }
      return null
    },
  })
  return { run }
}

describe('POST /api/agent_orchestrator/agents/:id/run — organization scope (#3629)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('attributes the run to the resolved selected org, not the raw (stale) auth.orgId', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { resolveOrganizationScopeForRequest } = await import(
      '@open-mercato/core/modules/directory/utils/organizationScope'
    )
    // auth.orgId carries a stale/phantom "home" org; the canonical resolver
    // returns the real concretely-selected org.
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT_A, orgId: ORG_STALE })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: ORG_REAL,
      filterIds: [ORG_REAL],
      allowedIds: [ORG_REAL],
      tenantId: TENANT_A,
    })
    const { run } = await setupContainer()

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
    const ctxArg = run.mock.calls[0][2] as { organizationId: string }
    expect(ctxArg.organizationId).toBe(ORG_REAL)
    expect(ctxArg.organizationId).not.toBe(ORG_STALE)
  })

  it('fails closed (400) and never runs the agent when no single org is selected ("All organizations")', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { resolveOrganizationScopeForRequest } = await import(
      '@open-mercato/core/modules/directory/utils/organizationScope'
    )
    // "All organizations" scope: the resolver widens and yields no concrete selection.
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT_A, orgId: null, isSuperAdmin: true })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: TENANT_A,
    })
    const { run } = await setupContainer()

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toMatch(/organization/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
  })
})
