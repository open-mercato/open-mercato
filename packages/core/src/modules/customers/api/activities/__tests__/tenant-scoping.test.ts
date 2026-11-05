/** @jest-environment node */

import { CustomerActivity, CustomerInteraction } from '../../../data/entities'
import { PUT, DELETE } from '../route'

const ORG_ID = '123e4567-e89b-41d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'
const FOREIGN_TENANT_ID = '123e4567-e89b-41d3-a456-426614174099'
const ACTIVITY_ID = '123e4567-e89b-41d3-a456-426614174020'

const mockCommandBus = {
  execute: jest.fn(),
}

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return mockCommandBus
    if (name === 'em') return mockEm
    throw new Error(`Unknown dependency: ${name}`)
  }),
}

const mockContext = {
  auth: {
    sub: 'user-1',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
  },
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
  hydrateCanonicalInteractions: jest.fn(),
  loadCustomerSummaries: jest.fn(),
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

describe('activity adapter tenant scoping', () => {
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
  })

  it('scopes resolveCanonicalActivityTargetId lookups by tenantId on PUT', async () => {
    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerInteraction && where.tenantId === TENANT_ID) {
          return { id: ACTIVITY_ID, tenantId: TENANT_ID }
        }
        return null
      },
    )
    mockCommandBus.execute.mockResolvedValue({ ok: true })

    const res = await PUT(
      new Request('http://localhost/api/customers/activities', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ACTIVITY_ID, activityType: 'call' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(mockEm.findOne).toHaveBeenCalledWith(
      CustomerInteraction,
      expect.objectContaining({ id: ACTIVITY_ID, tenantId: TENANT_ID }),
    )
  })

  it('does not find foreign-tenant interactions during PUT resolution', async () => {
    const foreignInteraction = {
      id: ACTIVITY_ID,
      tenantId: FOREIGN_TENANT_ID,
    }

    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (
          ctor === CustomerInteraction &&
          where.tenantId === FOREIGN_TENANT_ID
        ) {
          return foreignInteraction
        }
        return null
      },
    )
    mockCommandBus.execute.mockResolvedValue({ ok: true })

    await PUT(
      new Request('http://localhost/api/customers/activities', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ACTIVITY_ID, activityType: 'call' }),
      }),
    )

    expect(mockEm.findOne).toHaveBeenCalledWith(
      CustomerInteraction,
      expect.objectContaining({ tenantId: TENANT_ID }),
    )
    expect(mockEm.findOne).not.toHaveBeenCalledWith(
      CustomerInteraction,
      expect.objectContaining({ tenantId: FOREIGN_TENANT_ID }),
    )
  })

  it('scopes legacy activity lookup by tenantId on DELETE', async () => {
    mockEm.findOne.mockResolvedValue(null)
    mockCommandBus.execute.mockResolvedValue({ ok: true })

    await DELETE(
      new Request('http://localhost/api/customers/activities', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ACTIVITY_ID }),
      }),
    )

    for (const call of mockEm.findOne.mock.calls) {
      const where = call[1] as Record<string, unknown>
      expect(where.tenantId).toBe(TENANT_ID)
    }
  })
})
