/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const personId = '33333333-3333-4333-8333-333333333333'
const companyId = '44444444-4444-4444-8444-444444444444'

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const em = {
  fork: jest.fn(),
}

const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return em
    throw new Error(`[internal] Unexpected container token: ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: '55555555-5555-4555-8555-555555555555',
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../../../../../lib/personCompanyLinkTable', () => ({
  withActiveCustomerPersonCompanyLinkFilter: jest.fn(async () => ({ active: true })),
  filterActivePersonCompanyLinks: jest.fn((links: unknown[]) => links),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => ({ error: jest.fn() })),
}))

import { GET } from '../route'

function buildDeal(
  id: string,
  status: string,
  valueAmount: string,
  createdAt: string,
) {
  return {
    id,
    status,
    title: id,
    valueAmount,
    valueCurrency: 'PLN',
    deletedAt: null,
    createdAt: new Date(createdAt),
  }
}

describe('GET /api/customers/people/[id]/companies/enriched deal status vocabulary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)

    const person = {
      id: personId,
      kind: 'person',
      tenantId,
      organizationId,
    }
    const company = {
      id: companyId,
      displayName: 'Acme Corp',
      status: null,
      lifecycleStage: null,
      temperature: null,
      renewalQuarter: null,
    }
    const personCompanyLinks = [{ id: 'link-1', isPrimary: true, company }]
    const dealLinks = [
      { company, deal: buildDeal('won-by-ui', 'win', '200', '2026-01-10T00:00:00.000Z') },
      { company, deal: buildDeal('won-by-ai', 'won', '500', '2026-01-11T00:00:00.000Z') },
      { company, deal: buildDeal('lost-by-ui', 'loose', '300', '2026-01-12T00:00:00.000Z') },
      { company, deal: buildDeal('lost-by-ai', 'lost', '400', '2026-01-13T00:00:00.000Z') },
      { company, deal: buildDeal('closed', 'closed', '600', '2026-01-14T00:00:00.000Z') },
      { company, deal: buildDeal('tenant-stage', 'awaiting_legal_signoff', '100', '2026-01-09T00:00:00.000Z') },
    ]

    mockFindOneWithDecryption.mockResolvedValue(person)
    mockFindWithDecryption
      .mockResolvedValueOnce(personCompanyLinks)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(dealLinks)
      .mockResolvedValueOnce([])
  })

  it('excludes every closed spelling from activeDeal and includes both won spellings in CLV', async () => {
    const response = await GET(
      new Request(`http://localhost/api/customers/people/${personId}/companies/enriched`),
      { params: { id: personId } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].activeDeal).toEqual({
      title: 'tenant-stage',
      valueAmount: '100',
      valueCurrency: 'PLN',
    })
    expect(body.items[0].clv).toEqual({ amount: 700, currency: 'PLN' })
  })
})
