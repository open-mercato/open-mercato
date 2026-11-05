/** @jest-environment node */

const mockEm = {
  find: jest.fn(async () => []),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET } from '../categories/route'

function request() {
  return new Request('http://localhost/api/catalog/categories?view=manage')
}

describe('catalog categories list — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerApiInterceptors([])
    mockEm.find.mockResolvedValue([])
  })

  it('runs an after interceptor at the real categories route mount', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-a',
      features: ['catalog.categories.view'],
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-a',
      filterIds: ['org-a'],
      allowedIds: ['org-a'],
      tenantId: 'tenant-1',
    })
    registerApiInterceptors([{
      moduleId: 'example',
      interceptors: [{
        id: 'example.catalog.categories.counts',
        targetRoute: 'catalog/categories',
        methods: ['GET'],
        async after() {
          return { merge: { mountedByInterceptor: true } }
        },
      }],
    }])

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ mountedByInterceptor: true })
  })

  it('scopes by tenant only (no org filter) under the "All organizations" scope', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: true,
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    const where = mockEm.find.mock.calls[0][1]
    expect(where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null })
    expect(where).not.toHaveProperty('organizationId')
  })

  it('narrows to the caller\'s visible organizations when restricted', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-a',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-a',
      filterIds: ['org-a'],
      allowedIds: ['org-a'],
      tenantId: 'tenant-1',
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    const where = mockEm.find.mock.calls[0][1]
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      deletedAt: null,
      organizationId: { $in: ['org-a'] },
    })
  })
})
