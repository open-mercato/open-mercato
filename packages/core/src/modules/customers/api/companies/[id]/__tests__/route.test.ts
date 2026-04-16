/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockResolveCustomerInteractionFeatureFlags = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockResolveCompanyCustomFieldRouting = jest.fn()
const mockMergeCompanyCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScopeForRequest(args)),
}))

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn((...args: unknown[]) => mockResolveCustomerInteractionFeatureFlags(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('../../../../lib/customFieldRouting', () => ({
  resolveCompanyCustomFieldRouting: jest.fn((...args: unknown[]) => mockResolveCompanyCustomFieldRouting(...args)),
  mergeCompanyCustomFieldValues: jest.fn((...args: unknown[]) => mockMergeCompanyCustomFieldValues(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customer_entity',
      customer_company_profile: 'customer_company_profile',
    },
  },
}), { virtual: true })

describe('GET /api/customers/companies/[id]?include=people', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockResolveCustomerInteractionFeatureFlags.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockResolveCompanyCustomFieldRouting.mockReset()
    mockMergeCompanyCustomFieldValues.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockEm.findOne.mockReset()
    mockEm.find.mockReset()
    mockEm.count.mockReset()
    mockEm.count.mockResolvedValue(0)
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isApiKey: false,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      filterIds: ['org-1'],
      selectedId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockResolveCustomerInteractionFeatureFlags.mockResolvedValue({ unified: false })
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockResolveCompanyCustomFieldRouting.mockResolvedValue({})
    mockMergeCompanyCustomFieldValues.mockReturnValue({})
    mockEm.find.mockResolvedValue([])
  })

  it('returns decrypted linked people in the company detail payload', async () => {
    const createdAt = new Date('2026-04-10T08:00:00.000Z')
    const linkedAt = new Date('2026-04-13T09:15:00.000Z')

    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: '2408107d-0000-4000-8000-000000000000',
        kind: 'company',
        deletedAt: null,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        companyProfile: null,
        displayName: 'Brightside Solar',
        description: null,
        ownerUserId: null,
        primaryEmail: null,
        primaryPhone: null,
        status: null,
        lifecycleStage: null,
        source: null,
        nextInteractionAt: null,
        nextInteractionName: null,
        nextInteractionRefId: null,
        nextInteractionIcon: null,
        nextInteractionColor: null,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      })
      .mockResolvedValueOnce(null)

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }) => {
      if (entity?.name === 'CustomerTagAssignment') {
        return []
      }
      if (entity?.name === 'CustomerPersonCompanyLink') {
        return [
          {
            id: 'link-1',
            createdAt: linkedAt,
            person: {
              id: 'person-1',
              kind: 'person',
              deletedAt: null,
              displayName: 'Ada Lovelace',
              primaryEmail: 'ada@example.com',
              primaryPhone: '+1 555-0100',
              status: 'active',
              lifecycleStage: 'customer',
              source: 'Customer referral',
              temperature: 'warm',
              createdAt,
              organizationId: 'org-1',
              personProfile: {
                id: 'profile-1',
                jobTitle: 'VP Partnerships',
                department: 'Partnerships',
              },
            },
          },
        ]
      }
      if (entity?.name === 'CustomerPersonProfile') {
        return []
      }
      return []
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/companies/2408107d-0000-4000-8000-000000000000?include=people'),
      { params: { id: '2408107d-0000-4000-8000-000000000000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.people).toEqual([
      expect.objectContaining({
        id: 'person-1',
        displayName: 'Ada Lovelace',
        primaryEmail: 'ada@example.com',
        primaryPhone: '+1 555-0100',
        status: 'active',
        lifecycleStage: 'customer',
        jobTitle: 'VP Partnerships',
        department: 'Partnerships',
        source: 'Customer referral',
        temperature: 'warm',
        linkedAt: '2026-04-13T09:15:00.000Z',
      }),
    ])
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.any(Function),
      expect.objectContaining({
        company: '2408107d-0000-4000-8000-000000000000',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      }),
      expect.objectContaining({
        populate: ['person', 'person.personProfile'],
      }),
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )
  })
})
