import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { decorateServicesAfterList } from '../services/route'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog services route helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('decorates CRUD list payload items with category, media and work requirements', async () => {
    const payload = {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          category_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    }
    ;(findWithDecryption as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          service: '11111111-1111-4111-8111-111111111111',
          fileId: null,
          url: 'https://example.test/service-scope.pdf',
          alt: 'Service scope',
          contentType: 'application/pdf',
          sortOrder: 0,
          isDefault: true,
          metadata: { fileName: 'service-scope.pdf' },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '44444444-4444-4444-8444-444444444444',
          service: { id: '11111111-1111-4111-8111-111111111111' },
          targetType: 'staff_role',
          targetId: '55555555-5555-4555-8555-555555555555',
          labelSnapshot: 'Renewables Designer',
          allocationMode: 'ratio',
          allocationValue: '1.0000',
          sortOrder: 0,
          metadata: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Renewable Energy Services',
          slug: 'renewable-energy-services',
        },
      ])
    const forkedEm = {}
    const ctx = {
      container: { resolve: jest.fn().mockReturnValue({ fork: () => forkedEm }) },
      auth: { orgId: 'org-1', tenantId: 'tenant-1' },
      selectedOrganizationId: 'org-1',
    } as any

    await decorateServicesAfterList(payload, ctx)

    expect(payload.items[0].category).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Renewable Energy Services',
      slug: 'renewable-energy-services',
    })
    expect(payload.items[0].media).toEqual([
      expect.objectContaining({
        id: '33333333-3333-4333-8333-333333333333',
        url: 'https://example.test/service-scope.pdf',
        isDefault: true,
      }),
    ])
    expect(payload.items[0].workRequirements).toEqual([
      expect.objectContaining({
        id: '44444444-4444-4444-8444-444444444444',
        targetType: 'staff_role',
        labelSnapshot: 'Renewables Designer',
        allocationMode: 'ratio',
      }),
    ])
  })
})
