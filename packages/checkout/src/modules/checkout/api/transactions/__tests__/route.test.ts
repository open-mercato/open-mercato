/** @jest-environment node */

import { GET } from '../route'
import { CheckoutTransaction } from '../../../data/entities'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockFindEntityIdsBySearchTokens = jest.fn(async () => ({ matched: false, reason: 'no-tokens' as const }))

jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => mockFindEntityIdsBySearchTokens(...(args as [])),
}))

const mockEm = { getKysely: jest.fn(() => ({})) }
const auth = { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' }

jest.mock('../../helpers', () => ({
  requireAdminContext: jest.fn(async () => ({ auth, container: {}, em: mockEm, commandBus: {} })),
  userHasCheckoutFeature: jest.fn(async () => true),
  handleCheckoutRouteError: (error: unknown) => {
    throw error
  },
}))

function makeRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/checkout/transactions')
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  return new Request(url.toString(), { method: 'GET' })
}

function capturedWhere(): Record<string, unknown> {
  return mockFindAndCountWithDecryption.mock.calls[0][2] as Record<string, unknown>
}

describe('GET /api/checkout/transactions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindAndCountWithDecryption.mockResolvedValue([[], 0])
    mockFindWithDecryption.mockResolvedValue([])
    mockFindEntityIdsBySearchTokens.mockResolvedValue({ matched: false, reason: 'no-tokens' } as never)
  })

  it('applies no search predicate when no term is supplied', async () => {
    await GET(makeRequest())

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CheckoutTransaction,
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      expect.any(Object),
      expect.any(Object),
    )
    expect(mockFindEntityIdsBySearchTokens).not.toHaveBeenCalled()
  })

  it('keeps the escaped ILIKE predicates for the PII columns', async () => {
    await GET(makeRequest({ search: '100%_off' }))

    expect(capturedWhere().$or).toEqual([
      { email: { $ilike: '%100\\%\\_off%' } },
      { firstName: { $ilike: '%100\\%\\_off%' } },
      { lastName: { $ilike: '%100\\%\\_off%' } },
    ])
  })

  it('unions the encrypted-column token matches into the search predicate', async () => {
    mockFindEntityIdsBySearchTokens.mockResolvedValueOnce({
      matched: true,
      ids: ['tx-1', 'tx-2'],
    } as never)

    await GET(makeRequest({ search: 'ada@example.com' }))

    expect(mockFindEntityIdsBySearchTokens).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'checkout:checkout_transaction',
      query: 'ada@example.com',
      fields: ['email', 'first_name', 'last_name'],
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    }))
    expect(capturedWhere().$or).toContainEqual({ id: { $in: ['tx-1', 'tx-2'] } })
  })

  it('never emits an ILIKE against the uuid id column', async () => {
    await GET(makeRequest({ search: 'abc' }))

    const or = capturedWhere().$or as Array<Record<string, unknown>>
    expect(or.some((clause) => 'id' in clause)).toBe(false)
  })

  it('matches a uuid search term against the id column exactly', async () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    await GET(makeRequest({ search: id }))

    expect(capturedWhere().$or).toContainEqual({ id })
  })

  it('keeps link and status filters alongside the search predicate', async () => {
    await GET(makeRequest({ search: 'ada', status: 'completed', linkId: 'link-1' }))

    expect(capturedWhere()).toMatchObject({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      status: 'completed',
      linkId: 'link-1',
    })
  })
})
