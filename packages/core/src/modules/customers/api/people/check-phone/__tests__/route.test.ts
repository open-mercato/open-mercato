/** @jest-environment node */

const mockFindWithDecryption = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

function createQueryBuilderStub() {
  const queryBuilder: Record<string, unknown> = {}
  queryBuilder.select = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.where = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.andWhere = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.limit = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.getSingleResult = jest.fn().mockResolvedValue(null)
  return queryBuilder
}

function createEntityManagerStub() {
  const queryBuilder = createQueryBuilderStub()
  return {
    createQueryBuilder: jest.fn(() => queryBuilder),
    queryBuilder,
  }
}

describe('customers people check-phone route', () => {
  let GET: (req: Request) => Promise<Response>

  beforeAll(async () => {
    ;({ GET } = await import('../route'))
  })

  beforeEach(() => {
    mockFindWithDecryption.mockReset()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockCreateRequestContainer.mockReset()

    const em = createEntityManagerStub()
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => em),
    })
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      orgId: 'org-1',
      userId: 'user-1',
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: [],
    })
  })

  const requestFor = (digits: string | null) =>
    new Request(
      `http://localhost/api/customers/people/check-phone${
        digits === null ? '' : `?digits=${encodeURIComponent(digits)}`
      }`,
    )

  it('matches an existing contact through the decryption path when tenant encryption is on', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      {
        id: 'person-1',
        displayName: 'Ada Lovelace',
        primaryPhone: '+1 (415) 555-0148',
      },
    ])

    const response = await GET(requestFor('14155550148'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      match: { id: 'person-1', displayName: 'Ada Lovelace' },
    })
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('returns no match when none of the scoped contacts carry the requested digits', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      {
        id: 'person-2',
        displayName: 'Grace Hopper',
        primaryPhone: '+1 212 555 0100',
      },
    ])

    const response = await GET(requestFor('14155550148'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ match: null })
  })

  it('narrows the candidate query to the allowed organizations and the caller tenant', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      selectedId: 'org-1',
      filterIds: ['org-2', 'org-3'],
    })
    mockFindWithDecryption.mockResolvedValueOnce([])

    const response = await GET(requestFor('9999'))

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        kind: 'person',
        deletedAt: null,
        primaryPhone: { $ne: null },
        tenantId: 'tenant-1',
        organizationId: { $in: ['org-1', 'org-2', 'org-3'] },
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('short-circuits malformed digit queries without querying or authenticating', async () => {
    const response = await GET(requestFor('123'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ match: null })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockGetAuthFromRequest).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)

    const response = await GET(requestFor('14155550148'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('returns no match when neither the resolved scope nor the actor org is usable', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      orgId: null,
      userId: 'user-1',
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({})

    const response = await GET(requestFor('14155550148'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ match: null })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
