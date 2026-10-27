/** @jest-environment node */

// Regression for issue #4667: `activeDeals` / `wonDeals` tested for `won` / `lost` / `closed`,
// a vocabulary no writer persists. A deal closed through useDealClosure (`win` / `lost`) was
// therefore still reported as active, and completedDealsCount / ltvValue read 0.

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

const COMPANY_ID = '2408107d-0000-4000-8000-000000004667'

type DealRow = {
  id: string
  status: string | null
  valueAmount: string | null
  valueCurrency: string | null
}

function buildDeal(row: DealRow) {
  return {
    ...row,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
    createdAt: new Date('2026-01-10T10:00:00.000Z'),
  }
}

function mockCompany() {
  mockFindOneWithDecryption
    .mockResolvedValueOnce({
      id: COMPANY_ID,
      kind: 'company',
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      companyProfile: null,
      displayName: 'Acme Corp',
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
      createdAt: new Date('2026-01-01T08:00:00.000Z'),
      updatedAt: new Date('2026-01-01T08:00:00.000Z'),
    })
    .mockResolvedValueOnce(null)
}

function mockDealLinks(deals: DealRow[]) {
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }) => {
    if (entity?.name === 'CustomerDealCompanyLink') {
      return deals.map((deal, index) => ({ id: `link-${index}`, deal: buildDeal(deal) }))
    }
    return []
  })
}

async function fetchKpis() {
  const { GET } = await import('../route')
  const response = await GET(
    new Request(`http://localhost/api/customers/companies/${COMPANY_ID}`),
    { params: { id: COMPANY_ID } },
  )
  const body = await response.json()
  expect(response.status).toBe(200)
  return body.kpis
}

describe('GET /api/customers/companies/[id] — deal KPI status vocabulary (#4667)', () => {
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

  it('reports a deal closed through useDealClosure as won, not active', async () => {
    mockCompany()
    mockDealLinks([
      { id: 'deal-won', status: 'win', valueAmount: '4000', valueCurrency: 'PLN' },
      { id: 'deal-lost', status: 'loose', valueAmount: '2500', valueCurrency: 'PLN' },
    ])

    const kpis = await fetchKpis()

    expect(kpis.activeDealsCount).toBe(0)
    expect(kpis.activeDealsValue).toBeNull()
    expect(kpis.completedDealsCount).toBe(1)
    expect(kpis.ltvValue).toBe(4000)
  })

  it('also recognises the won/lost spelling the AI stage tool persists', async () => {
    mockCompany()
    mockDealLinks([
      { id: 'deal-won', status: 'won', valueAmount: '1200', valueCurrency: 'PLN' },
      { id: 'deal-lost', status: 'lost', valueAmount: '800', valueCurrency: 'PLN' },
      { id: 'deal-closed', status: 'closed', valueAmount: '300', valueCurrency: 'PLN' },
    ])

    const kpis = await fetchKpis()

    expect(kpis.activeDealsCount).toBe(0)
    expect(kpis.completedDealsCount).toBe(1)
    expect(kpis.ltvValue).toBe(1200)
  })

  it('keeps open and tenant-specific statuses in the active pipeline', async () => {
    mockCompany()
    mockDealLinks([
      { id: 'deal-open', status: 'negotiations', valueAmount: '1000', valueCurrency: 'PLN' },
      { id: 'deal-tenant-stage', status: 'awaiting_legal_signoff', valueAmount: '700', valueCurrency: 'PLN' },
      { id: 'deal-no-status', status: null, valueAmount: '300', valueCurrency: 'PLN' },
      { id: 'deal-won', status: 'win', valueAmount: '4000', valueCurrency: 'PLN' },
    ])

    const kpis = await fetchKpis()

    expect(kpis.activeDealsCount).toBe(3)
    expect(kpis.activeDealsValue).toBe(2000)
    expect(kpis.completedDealsCount).toBe(1)
    expect(kpis.ltvValue).toBe(4000)
  })

  it('leaves ltv null when nothing has been won yet', async () => {
    mockCompany()
    mockDealLinks([
      { id: 'deal-open', status: 'open', valueAmount: '500', valueCurrency: 'PLN' },
      { id: 'deal-lost', status: 'loose', valueAmount: '900', valueCurrency: 'PLN' },
    ])

    const kpis = await fetchKpis()

    expect(kpis.activeDealsCount).toBe(1)
    expect(kpis.completedDealsCount).toBe(0)
    expect(kpis.ltvValue).toBeNull()
  })
})
