const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'

const em = {
  find: jest.fn(),
}

const userHasAllFeaturesMock = jest.fn(async () => true)
const resolveDictionariesRouteContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: (...args: unknown[]) => resolveDictionariesRouteContextMock(...args),
}))

import { GET, metadata } from '../route'
import { CUSTOMER_DICTIONARY_READ_FEATURES } from '../../context'

describe('customer currency dictionary route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userHasAllFeaturesMock.mockResolvedValue(true)
    resolveDictionariesRouteContextMock.mockResolvedValue({
      auth: { sub: userId, tenantId, orgId: organizationId },
      container: {
        resolve: (token: string) => (token === 'rbacService' ? { userHasAllFeatures: userHasAllFeaturesMock } : undefined),
      },
      em,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId],
      translate: (_key: string, fallback?: string) => fallback ?? 'error',
    })
  })

  it('requires only authentication in GET metadata', () => {
    expect(metadata.GET).toEqual({ requireAuth: true })
  })

  it.each([
    'customers.deals.view',
    'customers.companies.view',
    'customers.people.view',
    'customers.settings.manage',
  ])('allows %s to read the currency dictionary', async (grantedFeature) => {
    userHasAllFeaturesMock.mockImplementation(async (_actor: string, required: string[]) => required[0] === grantedFeature)
    em.find
      .mockResolvedValueOnce([{ id: dictionaryId, organizationId }])
      .mockResolvedValueOnce([{ id: entryId, value: 'USD', label: 'US Dollar' }])

    const response = await GET(new Request('http://localhost/api/customers/dictionaries/currency'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: dictionaryId,
      entries: [{ id: entryId, value: 'USD', label: 'US Dollar' }],
    })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(userId, [grantedFeature], { tenantId, organizationId })
  })

  it('denies callers without any customer dictionary read feature before querying the database', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)

    const response = await GET(new Request('http://localhost/api/customers/dictionaries/currency'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      requiredFeatures: [...CUSTOMER_DICTIONARY_READ_FEATURES],
    })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('fails closed with 403 when rbacService or actor subject is missing', async () => {
    resolveDictionariesRouteContextMock.mockResolvedValueOnce({
      auth: { tenantId, orgId: organizationId },
      container: { resolve: () => undefined },
      em,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId],
      translate: (_key: string, fallback?: string) => fallback ?? 'error',
    })

    const response = await GET(new Request('http://localhost/api/customers/dictionaries/currency'))

    expect(response.status).toBe(403)
    expect(em.find).not.toHaveBeenCalled()
  })
})
