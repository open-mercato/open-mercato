/** @jest-environment node */

const mockEm = {
  findAndCount: jest.fn(async () => [[], 0]),
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

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET } from '../tags/route'

function request() {
  return new Request('http://localhost/api/catalog/tags')
}

describe('catalog tags list — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.findAndCount.mockResolvedValue([[], 0])
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
    const where = mockEm.findAndCount.mock.calls[0][1]
    expect(where).toEqual({ tenantId: 'tenant-1' })
    expect(where).not.toHaveProperty('organizationId')
  })

  it('narrows to the caller\'s visible organizations when restricted', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-a',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: ['org-a', 'org-b'],
      allowedIds: ['org-a', 'org-b'],
      tenantId: 'tenant-1',
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    const where = mockEm.findAndCount.mock.calls[0][1]
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: { $in: ['org-a', 'org-b'] },
    })
  })
})
