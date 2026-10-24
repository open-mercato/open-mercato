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

const rbac = { loadAcl: jest.fn() }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
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
  beforeEach(() => {
    jest.clearAllMocks()
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValue({ id: targetUserId, tenantId })
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId, orgId: organizationId })
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('short-circuits the write when the mutation guard blocks the request', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'conflict' } })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.userWidgets', resourceId: targetUserId, operation: 'update' }),
    )
    expect(em.flush).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the after-success hook after a successful write', async () => {
    em.findOne.mockResolvedValueOnce({ id: targetUserId, tenantId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.userWidgets', resourceId: targetUserId, operation: 'update' }),
    )
  })
})

describe('dashboards user widgets route tenant ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId })
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('rejects a null-tenant non-superadmin write instead of writing across tenants', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: adminUserId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: targetUserId, tenantId: foreignTenantId })

    const response = await PUT(buildRequest({ userId: targetUserId, mode: 'override', widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(403)
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
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
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false, metadata: null })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
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
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
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
