/** @jest-environment node */

import { GET } from '../route'

const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'
const ORG_1 = '123e4567-e89b-41d3-a456-426614174001'

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: jest.fn() }
    if (name === 'em') return mockEm
    if (name === 'queryEngine') return { query: jest.fn() }
    throw new Error(`Unknown dependency: ${name}`)
  }),
}

let mockContext: Record<string, unknown> = {}

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(),
}))

jest.mock('../../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(async () => mockContext),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

function setFlags(overrides?: { unified?: boolean }) {
  const { resolveCustomerInteractionFeatureFlags } = jest.requireMock(
    '../../../../lib/interactionFeatureFlags',
  )
  resolveCustomerInteractionFeatureFlags.mockResolvedValue({
    unified: overrides?.unified ?? false,
    legacyAdapters: true,
    externalSync: false,
  })
}

function buildContext(input: {
  organizationIds: string[] | null
  isSuperAdmin?: boolean
  allowedIds?: string[] | null
  omitScope?: boolean
}) {
  const isSuperAdmin = input.isSuperAdmin === true
  const allowedIds = input.omitScope
    ? undefined
    : (Object.prototype.hasOwnProperty.call(input, 'allowedIds')
        ? input.allowedIds
        : (isSuperAdmin ? null : [ORG_1]))
  const scope = input.omitScope
    ? undefined
    : {
        selectedId: input.organizationIds?.[0] ?? null,
        filterIds: input.organizationIds,
        allowedIds,
        tenantId: TENANT_ID,
      }
  return {
    auth: {
      sub: isSuperAdmin ? 'superadmin-1' : 'user-1',
      tenantId: TENANT_ID,
      orgId: input.organizationIds?.[0] ?? null,
      isSuperAdmin,
    },
    em: mockEm,
    organizationIds: input.organizationIds,
    selectedOrganizationId: input.organizationIds?.[0] ?? null,
    scope,
    container: mockContainer,
    commandContext: {
      container: mockContainer,
      auth: {
        sub: isSuperAdmin ? 'superadmin-1' : 'user-1',
        tenantId: TENANT_ID,
        orgId: input.organizationIds?.[0] ?? null,
        isSuperAdmin,
      },
      organizationScope: scope,
      selectedOrganizationId: input.organizationIds?.[0] ?? null,
      organizationIds: input.organizationIds,
      request: undefined,
    },
  }
}

function expectNoQueries() {
  expect(mockEm.find).not.toHaveBeenCalled()
  expect(mockEm.findAndCount).not.toHaveBeenCalled()
  expect(mockEm.count).not.toHaveBeenCalled()
}

function expectTenantWideQueries() {
  const calls = [...mockEm.find.mock.calls, ...mockEm.findAndCount.mock.calls]
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) {
    const where = call[1] as Record<string, unknown>
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toBeUndefined()
  }
}

describe('interactions/tasks GET organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setFlags()
    mockEm.find.mockImplementation(async () => [])
    mockEm.findAndCount.mockImplementation(async () => [[], 0])
    mockEm.count.mockImplementation(async () => 0)
  })

  it.each([
    { label: 'organizationIds = null', organizationIds: null as string[] | null },
    { label: 'organizationIds = []', organizationIds: [] as string[] },
  ])('returns empty and does not query when restricted has $label', async ({ organizationIds }) => {
    mockContext = buildContext({ organizationIds })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 })
    expectNoQueries()
  })

  it('returns empty in unified mode when restricted has organizationIds = null', async () => {
    setFlags({ unified: true })
    mockContext = buildContext({ organizationIds: null })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expectNoQueries()
  })

  it('returns empty when scope is omitted and organizationIds is null', async () => {
    mockContext = buildContext({ organizationIds: null, omitScope: true })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expectNoQueries()
  })

  it('allows tenant-wide query when superadmin has organizationIds = null', async () => {
    mockContext = buildContext({ organizationIds: null, isSuperAdmin: true, allowedIds: null })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    expectTenantWideQueries()
  })

  it('allows tenant-wide query when unrestricted non-superadmin has organizationIds = null', async () => {
    mockContext = buildContext({
      organizationIds: null,
      isSuperAdmin: false,
      allowedIds: null,
    })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    expectTenantWideQueries()
  })

  it('allows tenant-wide query when superadmin has organizationIds = []', async () => {
    mockContext = buildContext({ organizationIds: [], isSuperAdmin: true, allowedIds: null })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)
    expectTenantWideQueries()
  })

  it('applies organizationId filter when organizationIds is provided', async () => {
    mockContext = buildContext({ organizationIds: [ORG_1] })

    const res = await GET(
      new Request('http://localhost/api/customers/interactions/tasks?page=1&pageSize=50'),
    )
    expect(res.status).toBe(200)

    const calls = [...mockEm.find.mock.calls, ...mockEm.findAndCount.mock.calls]
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect((call[1] as Record<string, unknown>).organizationId).toEqual({ $in: [ORG_1] })
    }
  })
})
