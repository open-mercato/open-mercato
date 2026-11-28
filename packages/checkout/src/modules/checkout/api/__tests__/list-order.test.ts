/** @jest-environment node */

import { GET as getLinks } from '../links/route'
import { GET as getTemplates } from '../templates/route'
import { GET as getTransactions } from '../transactions/route'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: jest.fn(async () => ({ matched: false, reason: 'no-tokens' as const })),
}))

const mockEm = { getKysely: jest.fn(() => ({})) }
const auth = { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' }

jest.mock('../helpers', () => ({
  requireAdminContext: jest.fn(async () => ({ auth, container: {}, em: mockEm, commandBus: {} })),
  userHasCheckoutFeature: jest.fn(async () => true),
  handleCheckoutRouteError: (error: unknown) => {
    throw error
  },
}))

function capturedOptions(): Record<string, unknown> {
  return mockFindAndCountWithDecryption.mock.calls[0][3] as Record<string, unknown>
}

describe('checkout admin list ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindAndCountWithDecryption.mockResolvedValue([[], 0])
    mockFindWithDecryption.mockResolvedValue([])
  })

  it.each([
    ['transactions', getTransactions],
    ['templates', getTemplates],
    ['links', getLinks],
  ])('GET /api/checkout/%s breaks createdAt ties by id', async (path, handler) => {
    await handler(new Request(`http://localhost/api/checkout/${path}?page=2&pageSize=10`))

    expect(capturedOptions()).toEqual({
      orderBy: { createdAt: 'desc', id: 'desc' },
      offset: 10,
      limit: 10,
    })
    expect(Object.entries(capturedOptions().orderBy as Record<string, unknown>)).toEqual([
      ['createdAt', 'desc'],
      ['id', 'desc'],
    ])
  })
})
