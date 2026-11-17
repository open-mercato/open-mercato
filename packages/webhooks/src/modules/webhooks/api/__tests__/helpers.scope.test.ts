import { resolveWebhookRequestScope } from '../helpers'

const resolveContainerValue = jest.fn()
const createRequestContainerMock = jest.fn(async () => ({ resolve: resolveContainerValue }))
const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => createRequestContainerMock(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (request: Request) => getAuthFromRequestMock(request),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (input: unknown) => resolveOrganizationScopeForRequestMock(input),
}))

describe('resolveWebhookRequestScope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-home' })
  })

  it('denies an explicit empty organization scope before resolving the entity manager', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: [],
      allowedIds: [],
    })

    await expect(resolveWebhookRequestScope(new Request('http://localhost/api/webhooks'))).rejects.toEqual(
      expect.objectContaining({ status: 403, body: { error: 'Forbidden' } }),
    )
    expect(resolveContainerValue).not.toHaveBeenCalled()
  })
})
