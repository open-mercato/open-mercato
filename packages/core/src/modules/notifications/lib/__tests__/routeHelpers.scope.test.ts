const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const childOrganizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'

const container = { resolve: jest.fn() }
const resolvedAuth: { sub: string; tenantId?: string | null; orgId?: string | null } = {
  sub: userId,
  tenantId,
  orgId: organizationId,
}
const ctx: {
  container: typeof container
  auth: typeof resolvedAuth
  translate: jest.Mock
} = {
  container,
  auth: { ...resolvedAuth },
  translate: jest.fn(),
}

const resolveRequestContextMock = jest.fn(async () => ({ ctx }))
const resolveOrganizationScopeForRequestMock = jest.fn()
const service = { create: jest.fn() }

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: (...args: unknown[]) => resolveRequestContextMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('../notificationService', () => ({
  resolveNotificationService: () => service,
}))

import {
  requireResolvedNotificationTenantScope,
  resolveNotificationContext,
  TENANT_SCOPE_REQUIRED_ERROR_CODE,
} from '../routeHelpers'

describe('resolveNotificationContext organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ctx.auth = { ...resolvedAuth }
  })

  it('resolves the selected organization and its readable descendants from the request', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId, childOrganizationId],
      allowedIds: null,
      tenantId,
    })
    const request = new Request('https://example.test/api/notifications', {
      headers: { cookie: `om_selected_org=${organizationId}` },
    })

    const result = await resolveNotificationContext(request)

    expect(resolveOrganizationScopeForRequestMock).toHaveBeenCalledWith({
      container,
      auth: ctx.auth,
      request,
    })
    expect(result.scope).toEqual({
      tenantId,
      organizationId,
      organizationIds: [organizationId, childOrganizationId],
      userId,
    })
  })

  it('preserves unrestricted all-organizations scope', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId,
    })

    const result = await resolveNotificationContext(
      new Request('https://example.test/api/notifications', {
        headers: { cookie: 'om_selected_org=__all__' },
      }),
    )

    expect(result.scope).toEqual({
      tenantId,
      organizationId: null,
      organizationIds: null,
      userId,
    })
  })

  // Documents the sentinel the guard keys on: when neither the organization scope nor the auth
  // context yields a tenant, the scope carries `''` — which is not a uuid and would be rejected by
  // the driver on every notification query.
  it.each([
    ['explicit null', null],
    ['omitted', undefined],
    ['empty string', ''],
  ])('falls back to the empty sentinel when the tenant is unresolved (%s)', async (_label, authTenantId) => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: null,
    })
    ctx.auth = authTenantId === undefined
      ? { sub: userId, orgId: organizationId }
      : { sub: userId, tenantId: authTenantId, orgId: organizationId }

    const result = await resolveNotificationContext(
      new Request('https://example.test/api/notifications'),
    )

    expect(result.scope.tenantId).toBe('')
    await expect(requireResolvedNotificationTenantScope(result.scope)).resolves.toEqual(
      expect.objectContaining({ status: 403 }),
    )
  })
})

describe('requireResolvedNotificationTenantScope', () => {
  it.each([
    ['explicit null', { tenantId: null }],
    ['omitted', {}],
    ['empty string', { tenantId: '' }],
  ])('rejects an unresolved tenant (%s) with 403', async (_label, scope) => {
    const response = await requireResolvedNotificationTenantScope(scope)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
    // The code is what lets a client tell an unresolved scope apart from a permission denial,
    // which is otherwise the same status carrying the same shape.
    await expect(response!.json()).resolves.toEqual({
      error: expect.any(String),
      code: TENANT_SCOPE_REQUIRED_ERROR_CODE,
    })
  })

  it('passes a resolved tenant through', async () => {
    await expect(requireResolvedNotificationTenantScope({ tenantId })).resolves.toBeNull()
  })
})
