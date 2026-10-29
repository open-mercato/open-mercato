/** @jest-environment node */

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const invitationId = '66666666-6666-4666-8666-666666666666'
const staffUserId = '44444444-4444-4444-8444-444444444444'
const mockGetAuthFromRequest = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetGrantedFeatures = jest.fn()
const mockExecute = jest.fn()
const mockGuards = jest.fn()
const mockAfterSuccess = jest.fn()
const mockResolveScope = jest.fn()
const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures, getGrantedFeatures: mockGetGrantedFeatures }
    if (name === 'commandBus') return { execute: mockExecute }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => mockContainer) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: (...args: unknown[]) => mockGuards(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveScope(...args),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn(), customerInviteIpRateLimitConfig: {}, customerInviteRateLimitConfig: {},
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier', () => ({ readNormalizedEmailFromJsonRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/invitationEmail', () => ({ sendCustomerInvitationEmail: jest.fn() }))

import { DELETE, metadata, openApi } from '../users-invite'

function makeRequest(id: string | null = invitationId) {
  return new Request(`http://localhost/api/customer_accounts/admin/users-invite${id === null ? '' : `?id=${id}`}`, { method: 'DELETE' })
}

describe('admin invitation cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: staffUserId, tenantId, orgId: organizationId })
    mockResolveScope.mockImplementation(async ({ auth }: { auth: { tenantId: string | null; orgId: string | null } }) => ({
      tenantId: auth.tenantId, selectedId: auth.orgId, allowedIds: auth.orgId ? [auth.orgId] : [], filterIds: auth.orgId ? [auth.orgId] : [],
    }))
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetGrantedFeatures.mockResolvedValue(['customer_accounts.*'])
    mockExecute.mockResolvedValue({ result: { cancelled: true } })
    mockGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })
  })

  it.each([true, false])('returns a neutral response for cancelled=%s', async (cancelled) => {
    mockExecute.mockResolvedValue({ result: { cancelled } })
    const response = await DELETE(makeRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockExecute).toHaveBeenCalledWith('customer_accounts.invitation.cancel', expect.objectContaining({
      input: { id: invitationId },
      ctx: expect.objectContaining({ auth: { sub: staffUserId, tenantId, orgId: organizationId } }),
    }))
    expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it.each([null, { sub: staffUserId, tenantId: null, orgId: organizationId }, { sub: staffUserId, tenantId, orgId: null }])('rejects missing authentication or scope', async (auth) => {
    mockGetAuthFromRequest.mockResolvedValue(auth)
    expect((await DELETE(makeRequest())).status).toBe(auth ? 403 : 401)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockGuards).not.toHaveBeenCalled()
  })

  it('requires the existing invite feature', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)
    expect((await DELETE(makeRequest())).status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(staffUserId, ['customer_accounts.invite'], { tenantId, organizationId })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('uses the validated selected organization for authorization, guards, and command context', async () => {
    const selectedId = '77777777-7777-4777-8777-777777777777'
    const organizationScope = { tenantId, selectedId, allowedIds: [organizationId, selectedId], filterIds: [selectedId] }
    mockResolveScope.mockResolvedValue(organizationScope)
    const request = new Request(`http://localhost/api/customer_accounts/admin/users-invite?id=${invitationId}`, {
      method: 'DELETE', headers: { cookie: `om_selected_org=${selectedId}` },
    })
    expect((await DELETE(request)).status).toBe(200)
    expect(mockResolveScope).toHaveBeenCalledWith({ container: mockContainer, auth: { sub: staffUserId, tenantId, orgId: organizationId }, request })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(staffUserId, ['customer_accounts.invite'], { tenantId, organizationId: selectedId })
    expect(mockGuards).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ tenantId, organizationId: selectedId }),
    }))
    expect(mockExecute).toHaveBeenCalledWith('customer_accounts.invitation.cancel', expect.objectContaining({
      ctx: expect.objectContaining({ organizationScope, selectedOrganizationId: selectedId, organizationIds: [selectedId] }),
    }))
  })

  it('rejects an explicit invalid selection instead of falling back to the home organization', async () => {
    mockResolveScope.mockResolvedValue({ tenantId, selectedId: organizationId, allowedIds: [organizationId], filterIds: [organizationId], selectionRejected: true })
    expect((await DELETE(makeRequest())).status).toBe(403)
    expect(mockGuards).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an all-organizations selection without a concrete write scope', async () => {
    mockResolveScope.mockResolvedValue({ tenantId, selectedId: null, allowedIds: null, filterIds: null })
    expect((await DELETE(makeRequest())).status).toBe(403)
    expect(mockGuards).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it.each([null, 'invalid'])('rejects malformed or missing invitation identifiers', async (id) => {
    expect((await DELETE(makeRequest(id))).status).toBe(400)
    expect(mockGuards).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('passes scope and actual granted features to every mutation guard', async () => {
    await DELETE(makeRequest())
    expect(mockGuards).toHaveBeenCalledWith(expect.objectContaining({
      auth: { userId: staffUserId, tenantId, organizationId, userFeatures: ['customer_accounts.*'] },
      input: { resourceKind: 'customer_accounts.customer_user_invitation', resourceId: invitationId, operation: 'update', mutationPayload: { id: invitationId } },
    }))
  })

  it('returns guard failures without invoking the command or callbacks', async () => {
    mockGuards.mockResolvedValue({ ok: false, response: Response.json({ error: 'locked' }, { status: 409 }) })
    const response = await DELETE(makeRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'locked' })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('rejects guard transformations that change the guarded record', async () => {
    mockGuards.mockResolvedValue({ ok: true, modifiedPayload: { id: staffUserId }, runAfterSuccess: mockAfterSuccess })
    expect((await DELETE(makeRequest())).status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('does not run success callbacks on a failed command', async () => {
    mockExecute.mockRejectedValue(new Error('[internal] command failed'))
    await expect(DELETE(makeRequest())).rejects.toThrow('[internal] command failed')
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it('declares the staff guard and documents the additive method', () => {
    expect(metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['customer_accounts.invite'] })
    expect(openApi.methods?.DELETE?.responses).toEqual(expect.arrayContaining([expect.objectContaining({ status: 200 })]))
  })
})
