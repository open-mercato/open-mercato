/** @jest-environment node */

// Route-level regression test for `GET /api/promotions/codes/[id]/generated`: the list is
// offset-paginated, so ordering by `createdAt` alone can repeat or skip rows when several
// generated codes share a timestamp. `id` must stay as the secondary sort key.

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CODE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  fork: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    throw new Error(`[internal] unexpected DI resolve in test: ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: null })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: ORG_ID,
    filterIds: [ORG_ID],
    allowedIds: [ORG_ID],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

type GeneratedRoute = typeof import('../codes/[id]/generated/route')

let listGenerated: GeneratedRoute['GET']

beforeAll(async () => {
  listGenerated = (await import('../codes/[id]/generated/route')).GET
})

describe('GET /api/promotions/codes/[id]/generated', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.findOne.mockResolvedValue({ id: CODE_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
    mockEm.find.mockResolvedValue([])
    mockEm.count.mockResolvedValue(0)
  })

  it('orders by createdAt then id so offset pages stay stable on equal timestamps', async () => {
    const response = await listGenerated(
      new Request(`http://localhost/api/promotions/codes/${CODE_ID}/generated?page=2&pageSize=10`),
      { params: Promise.resolve({ id: CODE_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ codeId: CODE_ID }),
      expect.objectContaining({ orderBy: { createdAt: 'desc', id: 'desc' }, limit: 10, offset: 10 }),
    )
  })
})
