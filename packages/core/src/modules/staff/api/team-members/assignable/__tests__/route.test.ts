/** @jest-environment node */

const mockFindWithDecryption = jest.fn()
const mockResolveCustomersRequestContext = jest.fn()
const mockResolveAuthActorId = jest.fn(() => 'user-actor')
const mockUserHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/core/modules/customers/lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn((...args: unknown[]) =>
    mockResolveCustomersRequestContext(...args),
  ),
  resolveAuthActorId: jest.fn((...args: unknown[]) => mockResolveAuthActorId(...args)),
}))

describe('staff assignable team-members route', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
    mockResolveCustomersRequestContext.mockReset()
    mockResolveAuthActorId.mockReset()
    mockResolveAuthActorId.mockReturnValue('user-actor')
    mockUserHasAllFeatures.mockReset()
    mockResolveCustomersRequestContext.mockResolvedValue({
      container: {
        resolve: (token: string) => {
          if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
          return null
        },
      },
      em: {},
      auth: {
        sub: 'user-actor',
        tenantId: 'tenant-1',
        orgId: 'org-1',
      },
      selectedOrganizationId: 'org-1',
    })
  })

  it('allows customer role managers to load assignable staff without staff.view', async () => {
    mockUserHasAllFeatures.mockResolvedValueOnce(true)
    mockFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: '11111111-1111-1111-1111-111111111111',
          displayName: 'Ada Lovelace',
          userId: '22222222-2222-2222-2222-222222222222',
          teamId: '33333333-3333-3333-3333-333333333333',
        },
        {
          id: '44444444-4444-4444-4444-444444444444',
          displayName: 'No User',
          userId: null,
          teamId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-2222-2222-222222222222',
          email: 'ada@example.com',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'Sales',
        },
      ])

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/staff/team-members/assignable?pageSize=10&search=Ada'),
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'user-actor',
      ['customers.roles.manage'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(body.items).toEqual([
      {
        id: '11111111-1111-1111-1111-111111111111',
        teamMemberId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        teamName: 'Sales',
        user: {
          id: '22222222-2222-2222-2222-222222222222',
          email: 'ada@example.com',
        },
        team: {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'Sales',
        },
      },
    ])
  })

  it('also accepts callers with customers.activities.manage when roles.manage is absent', async () => {
    mockUserHasAllFeatures
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockFindWithDecryption
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/staff/team-members/assignable'),
    )
    expect(response.status).toBe(200)
    expect(mockUserHasAllFeatures).toHaveBeenNthCalledWith(
      2,
      'user-actor',
      ['customers.activities.manage'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('returns 403 when the user cannot manage customer roles or activities', async () => {
    mockUserHasAllFeatures
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/assignable'))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      error: 'Insufficient permissions to load assignable staff.',
    })
  })

  it('returns 400 when no organization is selected', async () => {
    mockResolveCustomersRequestContext.mockResolvedValueOnce({
      container: { resolve: () => undefined },
      em: {},
      auth: { sub: 'user-actor', tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/staff/team-members/assignable'))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ error: 'Organization context is required' })
  })
})
