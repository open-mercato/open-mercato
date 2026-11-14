import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type {
  MutationGuard,
  MutationGuardAfterInput,
  MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const adminUserId = '33333333-3333-4333-8333-333333333333'
const targetUserId = '55555555-5555-4555-8555-555555555555'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
}

const rbac = { loadAcl: jest.fn(), userHasAllFeatures: jest.fn(), getGrantedFeatures: jest.fn() }

const container = {
  hasRegistration: (name: string) => name === 'em' || name === 'rbacService',
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const guardValidateMock = jest.fn<Promise<{ ok: boolean; status?: number; body?: Record<string, unknown>; shouldRunAfterSuccess?: boolean; metadata?: Record<string, unknown>; modifiedPayload?: Record<string, unknown> }>, [MutationGuardInput]>()
const guardAfterSuccessMock = jest.fn<Promise<void>, [MutationGuardAfterInput]>()

const testGuard: MutationGuard = {
  id: 'test.dashboards-user-widgets-guard',
  targetEntity: 'dashboards.userWidgets',
  operations: ['update'],
  validate: (input) => guardValidateMock(input),
  afterSuccess: (input) => guardAfterSuccessMock(input),
}

registerMutationGuards([{ moduleId: 'test', guards: [testGuard] }])

const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: jest.fn(async () => [{ metadata: { id: 'sales-summary' } }]),
}))

import { GET, PUT } from '../route'

const foreignTenantId = '66666666-6666-4666-8666-666666666666'
const assignFeature = 'dashboards.admin.assign-widgets'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/dashboards/users/widgets', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildGetRequest(): Request {
  return new Request(`http://localhost/api/dashboards/users/widgets?userId=${targetUserId}`)
}

describe('dashboards user widgets route mutation guard', () => {
  const targetOrgId = '99999999-9999-4999-8999-999999999999'

  beforeEach(() => {
    jest.clearAllMocks()
    em.findOne.mockReset()
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    rbac.userHasAllFeatures.mockResolvedValue(true)
    rbac.getGrantedFeatures.mockResolvedValue([assignFeature])
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    guardValidateMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    guardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('short-circuits the write when a registry mutation guard blocks the request', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    guardValidateMock.mockResolvedValue({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'locked' })
    expect(guardValidateMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKind: 'dashboards.userWidgets', resourceId: targetUserId, operation: 'update' }),
    )
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(guardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('evaluates the guards in the target user scope with the caller identity', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(rbac.getGrantedFeatures).toHaveBeenCalledWith(adminUserId, { tenantId, organizationId: targetOrgId })
    expect(guardValidateMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      organizationId: targetOrgId,
      userId: adminUserId,
      resourceKind: 'dashboards.userWidgets',
      resourceId: targetUserId,
      operation: 'update',
      mutationPayload: { userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] },
    }))
  })

  it('runs the after-success callback in the target user scope after the write is flushed', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(guardAfterSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      organizationId: targetOrgId,
      userId: adminUserId,
      resourceKind: 'dashboards.userWidgets',
      resourceId: targetUserId,
      operation: 'update',
      metadata: { token: 'guard' },
    }))
    expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(guardAfterSuccessMock.mock.invocationCallOrder[0])
  })

  it('runs the after-success callback after removing the override on inherit', async () => {
    const existing = { id: 'rec', userId: targetUserId, tenantId, organizationId: targetOrgId, mode: 'override' }
    const removeFlush = jest.fn().mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: removeFlush })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(existing)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'inherit', widgetIds: [] }))

    expect(response.status).toBe(200)
    expect(guardAfterSuccessMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId, organizationId: targetOrgId }))
    expect(removeFlush.mock.invocationCallOrder[0]).toBeLessThan(guardAfterSuccessMock.mock.invocationCallOrder[0])
  })

  it('persists and returns the widget ids transformed by a guard', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { widgetIds: [] } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, mode: 'override', widgetIds: [] })
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'override', widgetIdsJson: [] }),
    )
  })

  it('drops unknown widget ids introduced by a guard transformation', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { widgetIds: ['sales-summary', 'unknown-widget'] } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: [] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, mode: 'override', widgetIds: ['sales-summary'] })
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ widgetIdsJson: ['sales-summary'] }),
    )
  })

  it('applies a guard transformation of the mode to inherit', async () => {
    const existing = { id: 'rec', userId: targetUserId, tenantId, organizationId: targetOrgId, mode: 'override' }
    const removeFlush = jest.fn().mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: removeFlush })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(existing)
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { mode: 'inherit' } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, mode: 'inherit', widgetIds: [] })
    expect(em.remove).toHaveBeenCalledWith(existing)
    expect(em.create).not.toHaveBeenCalled()
  })

  it('keeps the authorized target user when a guard transforms the user id', async () => {
    const otherUserId = '44444444-4444-4444-8444-444444444444'
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { userId: otherUserId } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.findOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ userId: targetUserId, tenantId, organizationId: targetOrgId }),
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: targetUserId, tenantId, organizationId: targetOrgId }),
    )
  })

  it('rejects an invalid guard transformation without writing', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    guardValidateMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, modifiedPayload: { mode: 'replace' } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(400)
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(guardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('evaluates the guards in the target tenant for a tenant-less superadmin', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId: foreignTenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(guardValidateMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: foreignTenantId,
      organizationId: targetOrgId,
      userId: adminUserId,
    }))
    expect(guardAfterSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: foreignTenantId,
      organizationId: targetOrgId,
    }))
  })
})

describe('dashboards user widgets route tenant ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId })
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.userHasAllFeatures.mockResolvedValue(true)
    rbac.getGrantedFeatures.mockResolvedValue([assignFeature])
    guardValidateMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    guardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('rejects a null-tenant non-superadmin write instead of writing across tenants', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: targetUserId, tenantId: foreignTenantId })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(403)
    expect(guardValidateMock).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a null-tenant non-superadmin read of a foreign user', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: targetUserId, tenantId: foreignTenantId })

    const response = await GET(buildGetRequest())

    expect(response.status).toBe(403)
  })

  it('keeps rejecting a tenant-scoped caller targeting a foreign user', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: targetUserId, tenantId: foreignTenantId })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('still lets a superadmin with no tenant scope assign widgets across tenants', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId: foreignTenantId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
  })
})

describe('dashboards user widgets route target record scope', () => {
  const targetOrgId = '77777777-7777-4777-8777-777777777777'
  const foreignOrgId = '88888888-8888-4888-8888-888888888888'

  beforeEach(() => {
    jest.clearAllMocks()
    em.findOne.mockReset()
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.userHasAllFeatures.mockResolvedValue(true)
    rbac.getGrantedFeatures.mockResolvedValue([assignFeature])
    guardValidateMock.mockResolvedValue({ ok: true })
    guardAfterSuccessMock.mockResolvedValue(undefined)
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId })
  })

  it('stores a tenant admin override under the target user organization', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.findOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ userId: targetUserId, tenantId, organizationId: targetOrgId }),
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: targetUserId, tenantId, organizationId: targetOrgId, mode: 'override' }),
    )
  })

  it('stores a tenant-less superadmin override under the target user tenant and organization', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId: foreignTenantId, organizationId: foreignOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: foreignTenantId, organizationId: foreignOrgId }),
    )
  })

  it('clears the override stored under the target user scope when switching back to inherit', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    const existing = { id: 'rec', userId: targetUserId, tenantId, organizationId: targetOrgId, mode: 'override' }
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(existing)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'inherit', widgetIds: [] }))

    expect(response.status).toBe(200)
    expect(em.findOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ userId: targetUserId, tenantId, organizationId: targetOrgId }),
    )
    expect(em.remove).toHaveBeenCalledWith(existing)
  })

  it('reads the override back from the target user scope', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.find.mockResolvedValue([])
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === targetUserId) return { id: targetUserId, tenantId, organizationId: targetOrgId }
      if (where.userId === targetUserId && where.tenantId === tenantId && where.organizationId === targetOrgId) {
        return { id: 'rec', mode: 'override', widgetIdsJson: ['sales-summary'] }
      }
      return null
    })

    const response = await GET(buildGetRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(expect.objectContaining({
      mode: 'override',
      hasCustom: true,
      widgetIds: ['sales-summary'],
      scope: { tenantId, organizationId: targetOrgId },
    }))
    expect(rbac.loadAcl).toHaveBeenLastCalledWith(targetUserId, { tenantId, organizationId: targetOrgId })
  })

  it('rejects a write for a same-tenant user in an organization outside the caller visibility', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(403)
    expect(guardValidateMock).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a read for a same-tenant user in an organization outside the caller visibility', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })

    const response = await GET(buildGetRequest())

    expect(response.status).toBe(403)
  })

  it('allows a write for a user in a visible sibling organization', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId, targetOrgId],
      allowedIds: [organizationId, targetOrgId],
      tenantId,
    })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId, organizationId: targetOrgId }),
    )
  })

  it('does not consult organization visibility for a superadmin caller', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(resolveOrganizationScopeForRequestMock).not.toHaveBeenCalled()
  })
})

describe('dashboards user widgets route target-organization feature grant', () => {
  const targetOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  beforeEach(() => {
    jest.clearAllMocks()
    em.findOne.mockReset()
    em.flush.mockResolvedValue(undefined)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    rbac.getGrantedFeatures.mockResolvedValue([assignFeature])
    rbac.userHasAllFeatures.mockImplementation(
      async (_userId: string, _required: string[], scope: { tenantId: string | null; organizationId: string | null }) =>
        scope.tenantId === tenantId && scope.organizationId === organizationId,
    )
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId, targetOrgId],
      allowedIds: [organizationId, targetOrgId],
      tenantId,
    })
    guardValidateMock.mockResolvedValue({ ok: true })
    guardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('rejects a read when the assign feature is granted only in the caller organization', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })

    const response = await GET(buildGetRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(adminUserId, [assignFeature], { tenantId, organizationId: targetOrgId })
    expect(em.findOne).toHaveBeenCalledTimes(1)
  })

  it('rejects a write when the assign feature is granted only in the caller organization', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: targetOrgId })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(adminUserId, [assignFeature], { tenantId, organizationId: targetOrgId })
    expect(guardValidateMock).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows a read and a write when the assign feature is granted in the target organization', async () => {
    em.find.mockResolvedValue([])
    em.findOne.mockResolvedValue(null)
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId })

    const readResponse = await GET(buildGetRequest())
    expect(readResponse.status).toBe(200)

    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId })
    const writeResponse = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(writeResponse.status).toBe(200)
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId, organizationId }),
    )
  })
})
