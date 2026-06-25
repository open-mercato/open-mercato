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

    // clearAllMocks() resets call history but not implementations, so restore the
    // jest.mock factory defaults here to keep tests isolated from each other.
    jest.requireMock('../../../lib/interactionReadModel').hydrateCanonicalInteractions
      .mockImplementation(async () => [])
    jest.requireMock('../../../lib/interactionCompatibility').mapInteractionRecordToActivitySummary
      .mockReset()
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

  // Merge-order regression coverage (P2 of #3386). The merged path sorts only on
  // non-encrypted system timestamps, so the #3278 two-phase encrypted-sort does not
  // apply; what matters here is that interleaving two DB-paginated sources stays
  // globally ordered across the page boundary with no duplicate/dropped ids.
  function legacyActivity(id: string, createdAtIso: string) {
    const at = new Date(createdAtIso)
    return {
      id,
      activityType: 'note',
      subject: null,
      body: null,
      occurredAt: at,
      createdAt: at,
      appearanceIcon: null,
      appearanceColor: null,
      entity: 'entity-1',
      authorUserId: null,
      deal: null,
    }
  }

  function canonicalInteraction(id: string, createdAtIso: string) {
    return {
      id,
      interactionType: 'note',
      deletedAt: null,
      occurredAt: createdAtIso,
      createdAt: createdAtIso,
      customValues: null,
    }
  }

  function wireMergedRows(
    legacyRows: ReturnType<typeof legacyActivity>[],
    canonicalRows: ReturnType<typeof canonicalInteraction>[],
  ) {
    mockEm.findAndCount.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerActivity) return [legacyRows, legacyRows.length]
      if (entity === CustomerInteraction) return [canonicalRows, canonicalRows.length]
      return [[], 0]
    })
    mockEm.count.mockImplementation(async () => 0)

    const { hydrateCanonicalInteractions } = jest.requireMock('../../../lib/interactionReadModel')
    hydrateCanonicalInteractions.mockImplementation(
      async ({ interactions }: { interactions: ReturnType<typeof canonicalInteraction>[] }) =>
        interactions,
    )

    const { mapInteractionRecordToActivitySummary } = jest.requireMock(
      '../../../lib/interactionCompatibility',
    )
    mapInteractionRecordToActivitySummary.mockImplementation(
      (row: ReturnType<typeof canonicalInteraction>) => ({
        id: row.id,
        activityType: row.interactionType,
        subject: null,
        body: null,
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        entityId: 'entity-1',
        authorUserId: null,
        dealId: null,
      }),
    )
  }

  async function fetchIds(qs: string): Promise<string[]> {
    const res = await GET(new Request(`http://localhost/api/customers/activities?${qs}`))
    const body = (await res.json()) as { items: { id: string }[] }
    return body.items.map((item) => item.id)
  }

  it('keeps the merged legacy+canonical stream globally ordered across the page boundary', async () => {
    wireMergedRows(
      [
        legacyActivity('L1', '2026-01-01T00:00:00.000Z'),
        legacyActivity('L3', '2026-01-03T00:00:00.000Z'),
        legacyActivity('L5', '2026-01-05T00:00:00.000Z'),
      ],
      [
        canonicalInteraction('C2', '2026-01-02T00:00:00.000Z'),
        canonicalInteraction('C4', '2026-01-04T00:00:00.000Z'),
        canonicalInteraction('C6', '2026-01-06T00:00:00.000Z'),
      ],
    )

    const page1 = await fetchIds('page=1&pageSize=2&sortField=createdAt&sortDir=asc')
    const page2 = await fetchIds('page=2&pageSize=2&sortField=createdAt&sortDir=asc')

    expect(page1).toEqual(['L1', 'C2'])
    expect(page2).toEqual(['L3', 'C4'])
    // No id reappears across the boundary, and the concatenation stays sorted.
    expect(new Set([...page1, ...page2]).size).toBe(4)
    expect([...page1, ...page2]).toEqual(['L1', 'C2', 'L3', 'C4'])
  })

  it('reverses the merged order for descending sort', async () => {
    wireMergedRows(
      [
        legacyActivity('L1', '2026-01-01T00:00:00.000Z'),
        legacyActivity('L5', '2026-01-05T00:00:00.000Z'),
      ],
      [
        canonicalInteraction('C4', '2026-01-04T00:00:00.000Z'),
        canonicalInteraction('C6', '2026-01-06T00:00:00.000Z'),
      ],
    )

    const ids = await fetchIds('page=1&pageSize=2&sortField=createdAt&sortDir=desc')
    expect(ids).toEqual(['C6', 'L5'])
  })

  it('drops legacy items bridged into the canonical stream so they are not duplicated', async () => {
    wireMergedRows(
      [
        legacyActivity('L1', '2026-01-01T00:00:00.000Z'),
        legacyActivity('S1', '2026-01-02T12:00:00.000Z'),
        legacyActivity('L5', '2026-01-05T00:00:00.000Z'),
      ],
      [
        canonicalInteraction('C2', '2026-01-02T00:00:00.000Z'),
        canonicalInteraction('S1', '2026-01-03T12:00:00.000Z'),
        canonicalInteraction('C6', '2026-01-06T00:00:00.000Z'),
      ],
    )

    const ids = await fetchIds('page=1&pageSize=50&sortField=createdAt&sortDir=asc')

    expect(ids.filter((id) => id === 'S1')).toEqual(['S1'])
    expect(ids).toEqual(['L1', 'C2', 'S1', 'L5', 'C6'])
  })
})
