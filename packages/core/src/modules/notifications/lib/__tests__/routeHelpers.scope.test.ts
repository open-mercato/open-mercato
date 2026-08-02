const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const childOrganizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'

const container = { resolve: jest.fn() }
const ctx = {
  container,
  auth: { sub: userId, tenantId, orgId: organizationId },
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

import { resolveNotificationContext } from '../routeHelpers'

describe('resolveNotificationContext organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})
