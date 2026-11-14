/** @jest-environment node */

import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'

let mockCacheEnabled = false
const mockCache = { get: jest.fn(), set: jest.fn() }
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  isCrudCacheEnabled: () => mockCacheEnabled,
  resolveCrudCache: () => mockCacheEnabled ? mockCache : null,
}))


// Regression coverage for issue #3175 (deals slice): the deal detail route must
// dispatch its independent post-access enrichment reads in parallel instead of
// awaiting them one after another. The test holds findWithDecryption open until
// two calls are concurrently in flight; the linked person + company reads can
// only both be in flight if the route started them concurrently. A safety timer
// releases the gate so a still-sequential route fails the assertion fast instead
// of hanging on the jest timeout.

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockNormalizeCustomFieldResponse = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockDecryptEntitiesWithFallbackScope = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
}

const mockRbac = {
  userHasAllFeatures: jest.fn(async () => true),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbac
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

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('@open-mercato/shared/lib/custom-fields/normalize', () => ({
  normalizeCustomFieldResponse: jest.fn((...args: unknown[]) => mockNormalizeCustomFieldResponse(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn((...args: unknown[]) => mockDecryptEntitiesWithFallbackScope(...args)),
}))

jest.mock('../../../../lib/dealStageTransitionTable', () => ({
  isMissingDealStageTransitionTable: jest.fn(() => false),
  warnMissingDealStageTransitionTable: jest.fn(),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

const DEAL_ID = '2408107d-0000-4000-8000-000000000020'

function buildDeal() {
  const createdAt = new Date('2026-04-10T08:00:00.000Z')
  return {
    id: DEAL_ID,
    deletedAt: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    title: 'Acme expansion',
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('GET /api/customers/deals/[id] — parallel enrichment (issue #3175)', () => {
  afterEach(() => registerResponseEnrichers([]))
  beforeEach(() => {
    mockCacheEnabled = false
    mockCache.get.mockReset()
    mockCache.set.mockReset()
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockNormalizeCustomFieldResponse.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockDecryptEntitiesWithFallbackScope.mockReset()
    mockEm.findOne.mockReset()
    mockEm.find.mockReset()
    mockEm.count.mockReset()
    mockRbac.userHasAllFeatures.mockReset()
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isApiKey: false, email: null })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ filterIds: ['org-1'], selectedId: 'org-1', tenantId: 'tenant-1' })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockNormalizeCustomFieldResponse.mockReturnValue({})
    mockDecryptEntitiesWithFallbackScope.mockResolvedValue(undefined)
    // First findOneWithDecryption resolves the deal; later ones (viewer/owner) are null.
    mockFindOneWithDecryption
      .mockResolvedValueOnce(buildDeal())
      .mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('dispatches the independent person/company link reads concurrently', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })

    // The linked person + company reads both go through findWithDecryption and are
    // independent of each other. Hold every findWithDecryption open: if the route
    // awaits them serially only one is ever in flight, so the gate never trips and
    // the safety timer below releases it, leaving maxInFlight at 1 (assertion fails).
    mockFindWithDecryption.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (maxInFlight >= 2) releaseGate()
      await gate
      inFlight -= 1
      return []
    })
    const safety = setTimeout(() => releaseGate(), 1500)

    const { GET } = await import('../route')
    const response = await GET(
      new Request(`http://localhost/api/customers/deals/${DEAL_ID}`),
      { params: { id: DEAL_ID } },
    )
    clearTimeout(safety)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal.id).toBe(DEAL_ID)
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
  })

  it('enriches deal cold/cache-hit reads and preserves cached native data', async () => {
    mockCacheEnabled = true
    mockCache.get.mockResolvedValue(null)
    let priority = 'high'
    const enrichOne = jest.fn(async (record: Record<string, unknown>) => ({ ...record, _example: { priority } }))
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.priority', targetEntity: 'customers.deal', timeout: 10, enrichOne }] }])
    const { GET } = await import('../route')
    const request = new Request(`http://localhost/api/customers/deals/${DEAL_ID}`)
    const cold = await GET(request, { params: { id: DEAL_ID } })
    expect(await cold.json()).toMatchObject({ _example: { priority: 'high' }, deal: { _example: { priority: 'high' } } })
    const base = mockCache.set.mock.calls[0][1] as Record<string, unknown>
    expect(base).not.toHaveProperty('_example')
    priority = 'critical'
    mockCache.get.mockResolvedValue(base)
    mockFindOneWithDecryption.mockResolvedValueOnce(buildDeal())
    const hit = await GET(request, { params: { id: DEAL_ID } })
    expect(await hit.json()).toMatchObject({ _example: { priority: 'critical' } })
    expect(base).not.toHaveProperty('_example')
    expect(base.deal).not.toHaveProperty('_example')
    expect(enrichOne).toHaveBeenCalledTimes(2)
  })

  it('propagates critical enricher failures on cache hits instead of falling back to a cold read', async () => {
    mockCacheEnabled = true
    mockCache.get.mockResolvedValue({ deal: { id: DEAL_ID, title: 'Cached' } })
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.critical', targetEntity: 'customers.deal', critical: true, timeout: 10, enrichOne: async () => { throw new Error('[internal] failed') } }] }])
    const { GET } = await import('../route')
    await expect(GET(new Request(`http://localhost/api/customers/deals/${DEAL_ID}`), { params: { id: DEAL_ID } })).rejects.toThrow('[internal] failed')
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
  })

})
