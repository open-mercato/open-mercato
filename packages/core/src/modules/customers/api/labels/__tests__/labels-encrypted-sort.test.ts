const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'

const mockEmFind = jest.fn()
const mockEm: any = { find: mockEmFind }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ filterIds: [orgId], selectedId: orgId })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

const mockDecrypt = jest.fn(async (label: any) => {
  if (typeof label.label === 'string') label.label = label.label.replace(/^cipher:/, '')
})
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn((...args: unknown[]) => mockDecrypt(...args)),
}))

import { GET } from '../route'

function makeLabel(id: string, plaintext: string) {
  return { id, slug: plaintext.toLowerCase(), label: `cipher:${plaintext}`, tenantId, organizationId: orgId, userId: actorId }
}

function makeRequest(qs = '') {
  return new Request(`http://localhost/api/customers/labels${qs ? `?${qs}` : ''}`)
}

const originalEnv = process.env

describe('GET /api/customers/labels — bounded candidate scan + decrypt + in-memory sort (#3386)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, OM_ENCRYPTED_SORT_MAX_ROWS: undefined }
    mockGetAuthFromRequest.mockResolvedValue({ sub: actorId, tenantId, orgId })
    mockDecrypt.mockImplementation(async (label: any) => {
      if (typeof label.label === 'string') label.label = label.label.replace(/^cipher:/, '')
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('sorts decrypted labels alphabetically, not by ciphertext/insertion order', async () => {
    mockEmFind.mockResolvedValueOnce([
      makeLabel('1', 'Charlie'),
      makeLabel('2', 'alpha'),
      makeLabel('3', 'Bravo'),
    ])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.map((item: any) => item.label)).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  test('decrypts every candidate label before sorting/paginating', async () => {
    mockEmFind.mockResolvedValueOnce([
      makeLabel('1', 'Charlie'),
      makeLabel('2', 'alpha'),
      makeLabel('3', 'Bravo'),
    ])

    await GET(makeRequest())
    expect(mockDecrypt).toHaveBeenCalledTimes(3)
  })

  test('passes a limit+id-order clause to em.find when OM_ENCRYPTED_SORT_MAX_ROWS is set', async () => {
    process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '5'
    mockEmFind.mockResolvedValueOnce([])

    await GET(makeRequest())

    const [, , options] = mockEmFind.mock.calls[0]
    expect(options).toEqual({ limit: 5, orderBy: { id: 'asc' } })
  })

  test('does not cap em.find when OM_ENCRYPTED_SORT_MAX_ROWS is unset', async () => {
    mockEmFind.mockResolvedValueOnce([])

    await GET(makeRequest())

    const [, , options] = mockEmFind.mock.calls[0]
    expect(options).toEqual({})
  })

  test('scopes the candidate query to tenant, organization, and actor user', async () => {
    mockEmFind.mockResolvedValueOnce([])

    await GET(makeRequest())

    const [, where] = mockEmFind.mock.calls[0]
    expect(where).toEqual({ tenantId, organizationId: orgId, userId: actorId })
  })

  test('filters by plaintext search after decryption', async () => {
    mockEmFind.mockResolvedValueOnce([
      makeLabel('1', 'Charlie'),
      makeLabel('2', 'alpha'),
      makeLabel('3', 'Bravo'),
    ])

    const res = await GET(makeRequest('search=bra'))
    const body = await res.json()
    expect(body.items.map((item: any) => item.label)).toEqual(['Bravo'])
  })

  test('paginates the sorted, decrypted list', async () => {
    mockEmFind.mockResolvedValueOnce([
      makeLabel('1', 'Charlie'),
      makeLabel('2', 'alpha'),
      makeLabel('3', 'Bravo'),
    ])

    const res = await GET(makeRequest('pageSize=2&page=2'))
    const body = await res.json()
    expect(body.items.map((item: any) => item.label)).toEqual(['Charlie'])
    expect(body.total).toBe(3)
    expect(body.totalPages).toBe(2)
  })
})
