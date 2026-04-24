/** @jest-environment node */

import { CustomerActivity, CustomerInteraction } from '../../../data/entities'
import { GET } from '../route'

const ORG_ID = '123e4567-e89b-41d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'

const mockCommandBus = { execute: jest.fn() }
const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return mockCommandBus
    if (name === 'em') return mockEm
    if (name === 'queryEngine') return { query: jest.fn() }
    throw new Error(`Unknown dependency: ${name}`)
  }),
}

const mockContext = {
  auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
  em: mockEm,
  organizationIds: [ORG_ID],
  selectedOrganizationId: ORG_ID,
  container: mockContainer,
  commandContext: {
    container: mockContainer,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: undefined,
  },
}

jest.mock('../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(),
}))

jest.mock('../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(async () => mockContext),
}))

jest.mock('../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('../../../lib/interactionCompatibility', () => ({
  mapInteractionRecordToActivitySummary: jest.fn(),
  CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE: 'adapter:activity',
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

describe('activities merged GET pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    const { resolveCustomerInteractionFeatureFlags } = jest.requireMock(
      '../../../lib/interactionFeatureFlags',
    )
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({
      unified: false,
      legacyAdapters: true,
      externalSync: false,
    })

    mockEm.findAndCount.mockImplementation(async () => [[], 0])
    mockEm.find.mockImplementation(async () => [])
    mockEm.count.mockImplementation(async () => 0)
  })

  it('uses bounded DB-side paginated fetches for both sources in non-unified mode', async () => {
    await GET(new Request('http://localhost/api/customers/activities?page=2&pageSize=50'))

    const legacyCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerActivity,
    )
    const canonicalCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerInteraction,
    )

    expect(legacyCall).toBeDefined()
    expect(canonicalCall).toBeDefined()

    const legacyOptions = legacyCall![2] as Record<string, unknown>
    const canonicalOptions = canonicalCall![2] as Record<string, unknown>

    expect(typeof legacyOptions.limit).toBe('number')
    expect(legacyOptions.limit as number).toBeGreaterThan(0)
    expect(legacyOptions.limit as number).toBeLessThanOrEqual(2000)
    expect(legacyOptions.offset).toBe(0)

    expect(typeof canonicalOptions.limit).toBe('number')
    expect(canonicalOptions.limit as number).toBeGreaterThan(0)
    expect(canonicalOptions.limit as number).toBeLessThanOrEqual(2000)
    expect(canonicalOptions.offset).toBe(0)
  })

  it('does not fall back to unbounded em.find for either source', async () => {
    await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))

    for (const call of mockEm.find.mock.calls) {
      const entity = call[0]
      expect(entity).not.toBe(CustomerActivity)
      expect(entity).not.toBe(CustomerInteraction)
    }
  })
})
