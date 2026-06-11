import { OnboardingRequest } from '../modules/onboarding/data/entities'

const findLatestByTenantId = jest.fn()
const sendWorkspaceReadyEmail = jest.fn()
const assertAllowedAppOrigin = jest.fn()
const markCompleted = jest.fn()
const claimPreparation = jest.fn()
const releasePreparationLease = jest.fn()
const enqueueOnboardingPreparation = jest.fn()

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  return {
    ...actual,
    after: (callback: () => unknown) => {
      void callback()
    },
  }
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unexpected resolve(${name})`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/url', () => ({
  assertAllowedAppOrigin: (...args: unknown[]) => assertAllowedAppOrigin(...args),
  mapSecurityEmailUrlError: (error: unknown) => {
    if (error instanceof Error && error.message === 'origin rejected') {
      return { status: 400, body: { error: 'Invalid request origin' } }
    }
    return null
  },
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    findLatestByTenantId,
    markCompleted,
    claimPreparation,
    releasePreparationLease,
  })),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail,
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning', () => ({
  resolveProvisioningIds: (request: OnboardingRequest) => {
    if (!request.tenantId || !request.organizationId || !request.userId) return null
    return {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      userId: request.userId,
    }
  },
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/preparation-queue', () => ({
  enqueueOnboardingPreparation: (...args: unknown[]) => enqueueOnboardingPreparation(...args),
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
    assertAllowedAppOrigin.mockReset()
    markCompleted.mockReset()
    claimPreparation.mockReset()
    releasePreparationLease.mockReset()
    enqueueOnboardingPreparation.mockReset()
    markCompleted.mockImplementation(async (request: OnboardingRequest, data: {
      tenantId: string
      organizationId: string
      userId: string
    }) => {
      request.status = 'completed'
      request.tenantId = data.tenantId
      request.organizationId = data.organizationId
      request.userId = data.userId
      request.completedAt = new Date()
      request.processingStartedAt = null
    })
    claimPreparation.mockImplementation(async (request: OnboardingRequest, startedAt: Date) => {
      request.processingStartedAt = startedAt
      return true
    })
    releasePreparationLease.mockImplementation(async (request: OnboardingRequest) => {
      request.processingStartedAt = null
      return true
    })
    enqueueOnboardingPreparation.mockResolvedValue('job-1')
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
    expect(body.loginUrl).toBe(`/login?tenant=${TENANT_ID}`)
    expect(findLatestByTenantId).toHaveBeenCalledWith(TENANT_ID)
    expect(assertAllowedAppOrigin).toHaveBeenCalledTimes(1)
  })

  it('rejects a matched cookie when the request origin is not allowed', async () => {
    assertAllowedAppOrigin.mockImplementation(() => {
      throw new Error('origin rejected')
    })

    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'Invalid request origin' })
    expect(findLatestByTenantId).not.toHaveBeenCalled()
  })

  it('returns 404 for an authorized caller when no onboarding record exists', async () => {
    findLatestByTenantId.mockResolvedValue(null)
    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )
    expect(res.status).toBe(404)
  })

  it('leaves a fresh processing request owned by the active verifier', async () => {
    const request = makeRequest({
      status: 'processing',
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      completedAt: null,
      preparationCompletedAt: null,
      processingStartedAt: new Date(),
    })
    findLatestByTenantId.mockResolvedValue(request)

    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('processing')
    expect(body.ready).toBe(false)
    expect(markCompleted).not.toHaveBeenCalled()
    expect(claimPreparation).not.toHaveBeenCalled()
    expect(enqueueOnboardingPreparation).not.toHaveBeenCalled()
  })

  it('recovers an interrupted stale processing request that already has provisioned ids', async () => {
    const request = makeRequest({
      status: 'processing',
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      completedAt: null,
      preparationCompletedAt: null,
      processingStartedAt: new Date(Date.now() - 20 * 60 * 1000),
    })
    findLatestByTenantId.mockResolvedValue(request)

    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('completed')
    expect(body.ready).toBe(false)
    expect(markCompleted).toHaveBeenCalledWith(request, {
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
    })
  })

  it('claims deferred preparation before enqueueing it from a status poll', async () => {
    const request = makeRequest({
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      preparationCompletedAt: null,
      processingStartedAt: null,
    })
    findLatestByTenantId.mockResolvedValue(request)

    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )

    expect(res.status).toBe(200)
    expect(claimPreparation).toHaveBeenCalledTimes(1)
    expect(enqueueOnboardingPreparation).toHaveBeenCalledTimes(1)
    expect(enqueueOnboardingPreparation).toHaveBeenCalledWith({
      requestId: request.id,
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
    })
  })

  it('does not schedule deferred preparation when another poll already owns the claim', async () => {
    claimPreparation.mockResolvedValue(false)
    findLatestByTenantId.mockResolvedValue(
      makeRequest({
        tenantId: TENANT_ID,
        organizationId: '44444444-4444-4444-8444-444444444444',
        userId: '55555555-5555-4555-8555-555555555555',
        preparationCompletedAt: null,
        processingStartedAt: new Date(),
      }),
    )

    const res = await GET(
      buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` }),
    )

    expect(res.status).toBe(200)
    expect(claimPreparation).toHaveBeenCalledTimes(1)
    expect(enqueueOnboardingPreparation).not.toHaveBeenCalled()
  })

  it('releases the preparation claim when queue enqueue fails', async () => {
    enqueueOnboardingPreparation.mockRejectedValue(new Error('queue unavailable'))
    const request = makeRequest({
      tenantId: TENANT_ID,
      organizationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      preparationCompletedAt: null,
      processingStartedAt: null,
    })
    findLatestByTenantId.mockResolvedValue(request)

    await expect(
      GET(buildRequest({ tenantId: TENANT_ID, cookie: `om_login_tenant=${TENANT_ID}` })),
    ).rejects.toThrow('queue unavailable')

    expect(claimPreparation).toHaveBeenCalledTimes(1)
    expect(releasePreparationLease).toHaveBeenCalledTimes(1)
    expect(releasePreparationLease.mock.calls[0][0]).toBe(request)
  })
})
