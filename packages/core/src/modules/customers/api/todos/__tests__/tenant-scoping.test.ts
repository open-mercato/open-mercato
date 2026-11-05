/** @jest-environment node */

import { CustomerInteraction, CustomerTodoLink } from '../../../data/entities'
import { PUT, DELETE } from '../route'

const ORG_ID = '123e4567-e89b-41d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'
const LINK_ID = '123e4567-e89b-41d3-a456-426614174012'
const TODO_ID = '123e4567-e89b-41d3-a456-426614174013'
const ENTITY_ID = '123e4567-e89b-41d3-a456-426614174011'

const mockCommandBus = { execute: jest.fn() }
const mockQueryEngine = {}
const mockEm = { find: jest.fn(), findOne: jest.fn() }

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return mockCommandBus
    if (name === 'queryEngine') return mockQueryEngine
    if (name === 'em') return mockEm
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
  hydrateCanonicalInteractions: jest.fn(),
  loadCustomerSummaries: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('../../../lib/todoCompatibility', () => ({
  resolveLegacyTodoDetails: jest.fn(),
  mapLegacyTodoLinkToRow: jest.fn(),
  mapInteractionRecordToTodoRow: jest.fn(),
  normalizeTodoSearch: jest.fn(),
  sortTodoRows: jest.fn((rows: unknown[]) => rows),
  filterTodoRows: jest.fn((rows: unknown[]) => rows),
  paginateTodoRows: jest.fn((rows: unknown[]) => ({
    items: rows,
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  })),
  listLegacyTodoRows: jest.fn(),
  listCanonicalTodoRows: jest.fn(),
}))

describe('todo adapter tenant scoping', () => {
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

    const { resolveLegacyTodoDetails } = jest.requireMock(
      '../../../lib/todoCompatibility',
    )
    resolveLegacyTodoDetails.mockResolvedValue(new Map())
  })

  it('scopes findLegacyTodoLink by tenantId on PUT', async () => {
    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerInteraction && where.tenantId === TENANT_ID) {
          return { id: TODO_ID, tenantId: TENANT_ID }
        }
        return null
      },
    )
    mockCommandBus.execute.mockResolvedValue({ ok: true })

    await PUT(
      new Request('http://localhost/api/customers/todos', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: TODO_ID, title: 'Updated' }),
      }),
    )

    expect(mockEm.findOne).toHaveBeenCalledWith(
      CustomerInteraction,
      expect.objectContaining({ id: TODO_ID, tenantId: TENANT_ID }),
    )
  })

  it('scopes legacy link lookup by tenantId on DELETE', async () => {
    const legacyLink = {
      id: LINK_ID,
      todoId: TODO_ID,
      todoSource: 'example:todo',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      createdAt: new Date(),
      entity: { id: ENTITY_ID },
    }

    mockEm.findOne.mockImplementation(
      async (ctor: unknown, where: Record<string, unknown>) => {
        if (ctor === CustomerInteraction) return null
        if (ctor === CustomerTodoLink && where.tenantId === TENANT_ID) {
          return legacyLink
        }
        return null
      },
    )
    mockCommandBus.execute
      .mockResolvedValueOnce({ interactionId: TODO_ID })
      .mockResolvedValueOnce({ ok: true })

    await DELETE(
      new Request('http://localhost/api/customers/todos', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: LINK_ID }),
      }),
    )

    for (const call of mockEm.findOne.mock.calls) {
      const where = call[1] as Record<string, unknown>
      expect(where.tenantId).toBe(TENANT_ID)
    }
  })

  it('does not find foreign-tenant todo links', async () => {
    mockEm.findOne.mockResolvedValue(null)
    mockCommandBus.execute.mockResolvedValue({ ok: true })

    await DELETE(
      new Request('http://localhost/api/customers/todos', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: LINK_ID }),
      }),
    )

    expect(mockEm.findOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ tenantId: TENANT_ID }),
    )

    for (const call of mockEm.findOne.mock.calls) {
      const where = call[1] as Record<string, unknown>
      expect(where.tenantId).toBe(TENANT_ID)
    }
  })
})
