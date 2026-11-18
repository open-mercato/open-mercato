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
const mockEmit = jest.fn()
let mockRealInvitationService: CustomerInvitationService | undefined
const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures, getGrantedFeatures: mockGetGrantedFeatures }
    if (name === 'commandBus') return { execute: mockExecute }
    if (name === 'customerInvitationService') return mockRealInvitationService
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

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({ emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args) }))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CancelInvitationInput } from '../../../data/validators'
import { CustomerInvitationService } from '../../../services/customerInvitationService'
import { cancelInvitationCommand } from '../../../commands/invitations'
import { DELETE, metadata, openApi } from '../users-invite'

function makeRequest(id: string | null = invitationId) {
  return new Request(`http://localhost/api/customer_accounts/admin/users-invite${id === null ? '' : `?id=${id}`}`, { method: 'DELETE' })
}

describe('admin invitation cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRealInvitationService = undefined
    mockEmit.mockResolvedValue(undefined)
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

  it.each(['77777777-7777-4777-8777-777777777777', '__all__', 'invalid'])('keeps the authenticated invitation scope when the selection cookie is %s', async (selectedId) => {
    const request = new Request(`http://localhost/api/customer_accounts/admin/users-invite?id=${invitationId}`, {
      method: 'DELETE', headers: { cookie: `om_selected_org=${selectedId}` },
    })
    mockResolveScope.mockResolvedValue({ tenantId, selectedId, allowedIds: [organizationId, selectedId], filterIds: [selectedId] })
    expect((await DELETE(request)).status).toBe(200)
    expect(mockResolveScope).not.toHaveBeenCalled()
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(staffUserId, ['customer_accounts.invite'], { tenantId, organizationId })
    expect(mockGuards).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ tenantId, organizationId }),
    }))
    expect(mockExecute).toHaveBeenCalledWith('customer_accounts.invitation.cancel', expect.objectContaining({
      ctx: expect.objectContaining({ selectedOrganizationId: organizationId, organizationIds: [organizationId] }),
    }))
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
      input: { resourceKind: 'customer_accounts:customer_user_invitation', resourceId: invitationId, operation: 'update', mutationPayload: { id: invitationId } },
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

  it('keeps a differing selection cookie out of the real guard, command, service, event, and audit scope', async () => {
    const selectedId = '77777777-7777-4777-8777-777777777777'
    const row = { id: invitationId, tenantId, organizationId, cancelledAt: null as Date | null }
    const nativeUpdate = jest.fn(async (_entity: unknown, where: { id: string; tenantId: string; organizationId: string }, update: { cancelledAt: Date }) => {
      if (where.id !== row.id || where.tenantId !== row.tenantId || where.organizationId !== row.organizationId) return 0
      row.cancelledAt = update.cancelledAt
      return 1
    })
    mockRealInvitationService = new CustomerInvitationService({ nativeUpdate } as unknown as EntityManager)
    mockResolveScope.mockResolvedValue({ tenantId, selectedId, allowedIds: [organizationId, selectedId], filterIds: [selectedId] })
    const { runRouteMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/route-mutation-guard')>('@open-mercato/shared/lib/crud/route-mutation-guard')
    mockGuards.mockImplementationOnce(runRouteMutationGuards)
    mockExecute.mockImplementationOnce(async (_command: string, { input, ctx }: { input: CancelInvitationInput; ctx: CommandRuntimeContext }) => {
      const result = await cancelInvitationCommand.execute(input, ctx)
      const log = await cancelInvitationCommand.buildLog?.({ input, result, ctx, snapshots: {} })
      expect(log).toMatchObject({ tenantId, organizationId, resourceKind: 'customer_accounts:customer_user_invitation', resourceId: invitationId, replayable: false })
      return { result }
    })
    const request = new Request(`http://localhost/api/customer_accounts/admin/users-invite?id=${invitationId}`, { method: 'DELETE', headers: { cookie: `om_selected_org=${selectedId}` } })
    expect((await DELETE(request)).status).toBe(200)
    expect(row.cancelledAt).toBeInstanceOf(Date)
    expect(nativeUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: invitationId, tenantId, organizationId }), { cancelledAt: expect.any(Date) })
    expect(mockEmit).toHaveBeenCalledWith('customer_accounts.invitation.cancelled', { invitationId, tenantId, organizationId })
    expect(mockUserHasAllFeatures.mock.calls.every((call) => call[2].organizationId === organizationId)).toBe(true)
    expect(mockGuards).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.objectContaining({ tenantId, organizationId }), input: expect.objectContaining({ resourceKind: 'customer_accounts:customer_user_invitation' }) }))
  })

  it('runs a registered invitation guard before the cancellation command', async () => {
    const { registerMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/mutation-guard-store')>('@open-mercato/shared/lib/crud/mutation-guard-store')
    const { runRouteMutationGuards } = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/route-mutation-guard')>('@open-mercato/shared/lib/crud/route-mutation-guard')
    const validate = jest.fn(async () => ({ ok: false, status: 409, body: { error: 'invitation locked' } }))
    registerMutationGuards([{ moduleId: 'customer_accounts', guards: [{
      id: 'customer_accounts.invitation-test', targetEntity: 'customer_accounts:customer_user_invitation', operations: ['update'], validate,
    }] }])
    mockGuards.mockImplementationOnce(runRouteMutationGuards)
    try {
      const response = await DELETE(makeRequest())
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'invitation locked' })
      expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: invitationId, tenantId, organizationId }))
      expect(mockExecute).not.toHaveBeenCalled()
      expect(mockAfterSuccess).not.toHaveBeenCalled()
    } finally {
      registerMutationGuards([])
    }
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
