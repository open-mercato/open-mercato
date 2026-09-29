/** @jest-environment node */

const mockEm = {
  find: jest.fn(),
}

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
}

const mockRbac = {
  loadAcl: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    isSuperAdmin: false,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'cache') return mockCache
      if (key === 'rbacService') return mockRbac
      return null
    },
  })),
}))

import { GET, metadata } from '../sidebar-entities'

describe('GET /api/entities/sidebar-entities ACL', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCache.get.mockResolvedValue(null)
    mockCache.set.mockResolvedValue(undefined)
    mockEm.find.mockResolvedValue([
      {
        entityId: 'user:vendors',
        label: 'Vendors',
        accessRestricted: false,
      },
      {
        entityId: 'hr:salaries',
        label: 'Salaries',
        accessRestricted: true,
      },
    ])
    mockRbac.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['entities.records.view'],
      organizations: null,
    })
  })

  it('requires custom-entity record view access', () => {
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['entities.records.view'],
    })
  })

  it('hides restricted entities from a coarse records reader', async () => {
    const response = await GET(new Request('http://x/api/entities/sidebar-entities'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{
        entityId: 'user:vendors',
        label: 'Vendors',
        href: '/backend/entities/user/user%3Avendors/records',
      }],
    })
  })

  it('shows a restricted entity when its per-entity view feature is granted', async () => {
    mockRbac.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['entities.records.view', 'entities.records.hr:salaries.view'],
      organizations: null,
    })

    const response = await GET(new Request('http://x/api/entities/sidebar-entities'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          entityId: 'user:vendors',
          label: 'Vendors',
          href: '/backend/entities/user/user%3Avendors/records',
        },
        {
          entityId: 'hr:salaries',
          label: 'Salaries',
          href: '/backend/entities/user/hr%3Asalaries/records',
        },
      ],
    })
  })

  it('re-filters cached candidates for the current caller ACL', async () => {
    mockCache.get.mockResolvedValue({
      candidates: [{
        entityId: 'hr:salaries',
        label: 'Salaries',
        href: '/backend/entities/user/hr%3Asalaries/records',
        accessRestricted: true,
      }],
    })

    const response = await GET(new Request('http://x/api/entities/sidebar-entities'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(mockEm.find).not.toHaveBeenCalled()
  })
})
