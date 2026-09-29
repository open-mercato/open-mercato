/** @jest-environment node */

import { CustomerActivity } from '../../../data/entities'
import { GET } from '../route'

const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'
const ORG_1 = '123e4567-e89b-41d3-a456-426614174001'

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

let mockContext: Record<string, unknown> = {}

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

describe('activities GET organization scoping', () => {
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

    jest.requireMock('../../../lib/interactionReadModel').hydrateCanonicalInteractions
      .mockImplementation(async () => [])
  })

  it('returns empty results and does NOT query all orgs when non-superadmin has organizationIds = null', async () => {
    mockContext = {
      auth: {
        sub: 'user-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: null,
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: null,
        allowedIds: [ORG_1],
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: null },
        organizationScope: { selectedId: null, filterIds: null, allowedIds: [ORG_1], tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: null,
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)

    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })

  it('returns empty results and does NOT query all orgs when non-superadmin has organizationIds = []', async () => {
    mockContext = {
      auth: {
        sub: 'user-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: [],
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: [],
        allowedIds: [ORG_1],
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: null },
        organizationScope: { selectedId: null, filterIds: [], allowedIds: [ORG_1], tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: [],
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)

    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })

  it('allows tenant-wide query when user is superadmin and organizationIds is null', async () => {
    mockContext = {
      auth: {
        sub: 'superadmin-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: true,
      },
      em: mockEm,
      organizationIds: null,
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: null,
        allowedIds: null,
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'superadmin-1', tenantId: TENANT_ID, orgId: null, isSuperAdmin: true },
        organizationScope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: null,
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)

    const legacyCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerActivity,
    )
    expect(legacyCall).toBeDefined()
    const where = legacyCall![1] as Record<string, unknown>
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toBeUndefined()
  })

  it('allows tenant-wide query when user has unrestricted scope (allowedIds === null) and organizationIds is null', async () => {
    mockContext = {
      auth: {
        sub: 'user-unrestricted',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: null,
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: null,
        allowedIds: null,
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-unrestricted', tenantId: TENANT_ID, orgId: null },
        organizationScope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: null,
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)

    const legacyCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerActivity,
    )
    expect(legacyCall).toBeDefined()
    const where = legacyCall![1] as Record<string, unknown>
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toBeUndefined()
  })

  it('applies organizationId filter when organizationIds is provided', async () => {
    mockContext = {
      auth: {
        sub: 'user-1',
        tenantId: TENANT_ID,
        orgId: ORG_1,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: [ORG_1],
      selectedOrganizationId: ORG_1,
      scope: {
        selectedId: ORG_1,
        filterIds: [ORG_1],
        allowedIds: [ORG_1],
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_1 },
        organizationScope: { selectedId: ORG_1, filterIds: [ORG_1], allowedIds: [ORG_1], tenantId: TENANT_ID },
        selectedOrganizationId: ORG_1,
        organizationIds: [ORG_1],
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)

    const legacyCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerActivity,
    )
    expect(legacyCall).toBeDefined()
    const where = legacyCall![1] as Record<string, unknown>
    expect(where.organizationId).toEqual({ $in: [ORG_1] })
  })

  it('returns empty results in unified mode when non-superadmin has organizationIds = null', async () => {
    const { resolveCustomerInteractionFeatureFlags } = jest.requireMock(
      '../../../lib/interactionFeatureFlags',
    )
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({
      unified: true,
      legacyAdapters: true,
      externalSync: false,
    })

    mockContext = {
      auth: {
        sub: 'user-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: null,
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: null,
        allowedIds: [ORG_1],
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: null },
        organizationScope: { selectedId: null, filterIds: null, allowedIds: [ORG_1], tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: null,
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)

    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })

  it('allows tenant-wide query when superadmin has organizationIds = [] (empty filterIds from stale scope)', async () => {
    mockContext = {
      auth: {
        sub: 'superadmin-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: true,
      },
      em: mockEm,
      organizationIds: [],
      selectedOrganizationId: null,
      scope: {
        selectedId: null,
        filterIds: [],
        allowedIds: null,
        tenantId: TENANT_ID,
      },
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'superadmin-1', tenantId: TENANT_ID, orgId: null, isSuperAdmin: true },
        organizationScope: { selectedId: null, filterIds: [], allowedIds: null, tenantId: TENANT_ID },
        selectedOrganizationId: null,
        organizationIds: [],
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)

    const legacyCall = mockEm.findAndCount.mock.calls.find(
      (args) => args[0] === CustomerActivity,
    )
    expect(legacyCall).toBeDefined()
    const where = legacyCall![1] as Record<string, unknown>
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toBeUndefined()
  })

  it('returns empty results when scope is absent and organizationIds is null (scope shape omitted)', async () => {
    mockContext = {
      auth: {
        sub: 'user-1',
        tenantId: TENANT_ID,
        orgId: null,
        isSuperAdmin: false,
      },
      em: mockEm,
      organizationIds: null,
      selectedOrganizationId: null,
      scope: undefined as unknown as null,
      container: mockContainer,
      commandContext: {
        container: mockContainer,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: null },
        organizationScope: undefined as unknown as null,
        selectedOrganizationId: null,
        organizationIds: null,
        request: undefined,
      },
    }

    const res = await GET(new Request('http://localhost/api/customers/activities?page=1&pageSize=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)

    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })
})
