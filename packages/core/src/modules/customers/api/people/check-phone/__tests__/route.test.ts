/** @jest-environment node */

const mockFindWithDecryption = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockIsTenantDataEncryptionEnabled = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: (...args: unknown[]) =>
    mockIsTenantDataEncryptionEnabled(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

function createEntityManagerStub(fastMatch: Record<string, unknown> | null) {
  const queryBuilder: Record<string, unknown> = {}
  queryBuilder.select = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.where = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.andWhere = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.limit = jest.fn().mockReturnValue(queryBuilder)
  queryBuilder.getSingleResult = jest.fn(async () => fastMatch)
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
    mockIsTenantDataEncryptionEnabled.mockReset()

    // Encryption enabled is the effective default (unset TENANT_DATA_ENCRYPTION
    // resolves to true), so the decrypted fallback path is the baseline.
    mockIsTenantDataEncryptionEnabled.mockReturnValue(true)

    const em = createEntityManagerStub(null)
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

  function useFastPathMatch(fastMatch: Record<string, unknown>) {
    mockIsTenantDataEncryptionEnabled.mockReturnValue(false)
    const em = createEntityManagerStub(fastMatch)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => em),
    })
    return em
  }

  const requestFor = (digits: string | null) =>
    new Request(
      `http://localhost/api/customers/people/check-phone${
        digits === null ? '' : `?digits=${encodeURIComponent(digits)}`
      }`,
    )

  it('matches a contact whose decrypted phone normalizes to the requested digits', async () => {
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
    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        kind: 'person',
        deletedAt: null,
        primaryPhone: { $ne: null },
        tenantId: 'tenant-1',
        organizationId: { $in: ['org-1'] },
      }),
      {
        limit: 500,
        orderBy: { createdAt: 'DESC' },
        fields: ['id', 'displayName', 'primaryPhone', 'tenantId', 'organizationId'],
      },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('narrows the candidate scan to every allowed organization', async () => {
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
        organizationId: { $in: ['org-1', 'org-2', 'org-3'] },
      }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('runs the SQL fast path only when tenant data encryption is disabled', async () => {
    const em = useFastPathMatch({ id: 'person-9', displayName: 'Grace Hopper' })

    const response = await GET(requestFor('14155550148'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      match: { id: 'person-9', displayName: 'Grace Hopper' },
    })
    expect(em.createQueryBuilder).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('skips the SQL probe and resolves through the decrypted scan while tenant data encryption is enabled', async () => {
    const em = createEntityManagerStub({ id: 'person-cipher', displayName: 'Ciphertext Row' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => em),
    })
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
    expect(em.createQueryBuilder).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('returns no match when neither the SQL path nor the decrypted scan matches', async () => {
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
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('short-circuits malformed digit queries without querying or authenticating', async () => {
    const em = createEntityManagerStub(null)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => em),
    })

    const response = await GET(requestFor('123'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ match: null })
    expect(em.createQueryBuilder).not.toHaveBeenCalled()
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
