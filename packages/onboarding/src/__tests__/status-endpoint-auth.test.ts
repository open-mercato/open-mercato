import { OnboardingRequest } from '../modules/onboarding/data/entities'

const findLatestByTenantId = jest.fn()
const sendWorkspaceReadyEmail = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unexpected resolve(${name})`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/url', () => ({
  getSecurityEmailBaseUrl: () => 'https://app.example.com',
  mapSecurityEmailUrlError: () => null,
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findLatestByTenantId,
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail,
}))

import { GET } from '../modules/onboarding/api/get/onboarding/status'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222'

function makeRequest(overrides: Record<string, unknown> = {}) {
  return Object.assign(new OnboardingRequest(), {
    id: 'req-1',
    status: 'completed',
    tenantId: TENANT_ID,
    organizationId: 'org-1',
    preparationCompletedAt: new Date(),
    readyEmailSentAt: new Date(),
    ...overrides,
  })
}

function buildRequest(args: { tenantId: string; cookie?: string }) {
  const headers = new Headers()
  if (args.cookie !== undefined) headers.set('cookie', args.cookie)
  return new Request(`https://app.example.com/api/onboarding/onboarding/status?tenantId=${args.tenantId}`, {
    headers,
  })
}

describe('onboarding status endpoint authorization', () => {
  beforeEach(() => {
    findLatestByTenantId.mockReset()
    sendWorkspaceReadyEmail.mockReset()
    findLatestByTenantId.mockResolvedValue(makeRequest())
  })

  it('returns 403 and does not look up tenant state when no om_login_tenant cookie is present', async () => {
    const res = await GET(buildRequest({ tenantId: TENANT_ID }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Not authorized for this tenant.' })
    expect(findLatestByTenantId).not.toHaveBeenCalled()
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('returns 403 when the om_login_tenant cookie is for a different tenant', async () => {
    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${OTHER_TENANT_ID}` }),
    )
    expect(res.status).toBe(403)
    expect(findLatestByTenantId).not.toHaveBeenCalled()
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('does not trigger the ready email side effect for an unauthorized caller', async () => {
    findLatestByTenantId.mockResolvedValue(
      makeRequest({ readyEmailSentAt: null }),
    )
    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${OTHER_TENANT_ID}` }),
    )
    expect(res.status).toBe(403)
    expect(sendWorkspaceReadyEmail).not.toHaveBeenCalled()
  })

  it('returns the status when the om_login_tenant cookie matches the requested tenant', async () => {
    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `other=foo; om_login_tenant=${TENANT_ID}` }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.tenantId).toBe(TENANT_ID)
    expect(body.ready).toBe(true)
    expect(body.loginUrl).toBe(`https://app.example.com/login?tenant=${TENANT_ID}`)
    expect(findLatestByTenantId).toHaveBeenCalledWith(TENANT_ID)
  })

  it('returns 404 for an authorized caller when no onboarding record exists', async () => {
    findLatestByTenantId.mockResolvedValue(null)
    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )
    expect(res.status).toBe(404)
  })
})
