import { CustomerInteraction, CustomerTodoLink } from '../../../data/entities'
import { DELETE, GET, POST } from '../route'

const ORG_ID = '123e4567-e89b-41d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'
const ENTITY_ID = '123e4567-e89b-41d3-a456-426614174011'
const LINK_ID = '123e4567-e89b-41d3-a456-426614174012'
const TODO_ID = '123e4567-e89b-41d3-a456-426614174013'

const mockCommandBus = {
  execute: jest.fn(),
}

const mockQueryEngine = {}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return mockCommandBus
    if (name === 'queryEngine') return mockQueryEngine
    if (name === 'em') return mockEm
    throw new Error(`Unknown dependency: ${name}`)
  }),
}

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
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
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
    },
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
}))

describe('customers todos adapter route', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    const { resolveCustomerInteractionFeatureFlags } = jest.requireMock('../../../lib/interactionFeatureFlags')
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({
      unified: false,
      legacyAdapters: true,
      externalSync: false,
    })

    const { resolveLegacyTodoDetails, mapLegacyTodoLinkToRow, mapInteractionRecordToTodoRow } =
      jest.requireMock('../../../lib/todoCompatibility')
    resolveLegacyTodoDetails.mockResolvedValue(new Map())
    mapLegacyTodoLinkToRow.mockImplementation(() => ({
      id: LINK_ID,
      todoId: TODO_ID,
      todoSource: 'example:todo',
      todoTitle: 'Legacy task',
      todoIsDone: false,
      todoPriority: null,
      todoSeverity: null,
      todoDescription: null,
      todoDueAt: null,
      todoCustomValues: null,
      todoOrganizationId: ORG_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      createdAt: '2026-01-01T10:00:00.000Z',
      customer: {
        id: ENTITY_ID,
        displayName: 'Acme Corp',
        kind: 'company',
      },
    }))
    mapInteractionRecordToTodoRow.mockImplementation(() => ({
      id: TODO_ID,
      todoId: TODO_ID,
      todoSource: 'customers:interaction',
      todoTitle: 'Canonical task',
      todoIsDone: false,
      todoPriority: null,
      todoSeverity: null,
      todoDescription: null,
      todoDueAt: null,
      todoCustomValues: null,
      todoOrganizationId: null,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      createdAt: '2026-01-02T10:00:00.000Z',
      customer: {
        id: ENTITY_ID,
        displayName: 'Acme Corp',
        kind: 'company',
      },
    }))

    const { hydrateCanonicalInteractions, loadCustomerSummaries } =
      jest.requireMock('../../../lib/interactionReadModel')
    hydrateCanonicalInteractions.mockResolvedValue([
      {
        id: TODO_ID,
        entityId: ENTITY_ID,
        interactionType: 'task',
        title: 'Canonical task',
        status: 'planned',
        source: 'adapter:todo',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
      },
    ])
    loadCustomerSummaries.mockResolvedValue(
      new Map([
        [
          ENTITY_ID,
          {
            id: ENTITY_ID,
            displayName: 'Acme Corp',
            kind: 'company',
          },
        ],
      ]),
    )
  })

  it('merges canonical adapter todos over legacy rows and returns deprecation headers', async () => {
    const legacyLink = {
      id: LINK_ID,
      todoId: TODO_ID,
      todoSource: 'example:todo',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      entity: {
        id: ENTITY_ID,
        displayName: 'Acme Corp',
        kind: 'company',
      },
    }
    const canonicalInteraction = {
      id: TODO_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      interactionType: 'task',
      source: 'adapter:todo',
      deletedAt: null,
    }

    mockEm.find.mockImplementation(async (ctor: unknown) => {
      if (ctor === CustomerTodoLink) return [legacyLink]
      if (ctor === CustomerInteraction) return [canonicalInteraction]
      return []
    })

    const res = await GET(new Request(`http://localhost/api/customers/todos?entityId=${ENTITY_ID}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Deprecation')).toBe('true')

    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: TODO_ID,
      todoId: TODO_ID,
      todoTitle: 'Canonical task',
      todoSource: 'customers:interaction',
    })
  })

  it('delegates POST to canonical interactions and returns adapter headers', async () => {
    mockCommandBus.execute.mockResolvedValueOnce({ interactionId: TODO_ID })

    const res = await POST(
      new Request('http://localhost/api/customers/todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: ENTITY_ID,
          title: 'Create adapter task',
          todoCustom: { priority: 3 },
        }),
      }),
    )

    expect(res.status).toBe(201)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'customers.interactions.create',
      expect.objectContaining({
        input: expect.objectContaining({
          entityId: ENTITY_ID,
          interactionType: 'task',
          title: 'Create adapter task',
          source: 'adapter:todo',
          customValues: expect.objectContaining({
            priority: 3,
          }),
          priority: 3,
        }),
      }),
    )
  })

  it('forwards todoCustom values to the canonical task create command', async () => {
    mockCommandBus.execute.mockResolvedValueOnce({ interactionId: TODO_ID })

    await POST(
      new Request('http://localhost/api/customers/todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: ENTITY_ID,
          title: 'Create adapter task with due date',
          todoCustom: {
            due_at: '2026-04-10T15:00:00.000Z',
            description: 'legacy due date check',
            priority: 3,
          },
        }),
      }),
    )

    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'customers.interactions.create',
      expect.objectContaining({
        input: expect.objectContaining({
          customValues: expect.objectContaining({
            due_at: '2026-04-10T15:00:00.000Z',
            description: 'legacy due date check',
            priority: 3,
          }),
          body: 'legacy due date check',
          scheduledAt: '2026-04-10T15:00:00.000Z',
          priority: 3,
        }),
      }),
    )
  })

  it('bridges legacy link deletion through canonical interactions when unified mode is off', async () => {
    const legacyLink = {
      id: LINK_ID,
      todoId: TODO_ID,
      todoSource: 'example:todo',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      entity: {
        id: ENTITY_ID,
        displayName: 'Acme Corp',
        kind: 'company',
      },
    }

    mockEm.findOne.mockImplementation(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerInteraction) return null
      if (ctor === CustomerTodoLink && where.id === LINK_ID) return legacyLink
      return null
    })
    mockCommandBus.execute
      .mockResolvedValueOnce({ interactionId: TODO_ID })
      .mockResolvedValueOnce({ ok: true })

    const res = await DELETE(
      new Request('http://localhost/api/customers/todos', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: LINK_ID }),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(mockCommandBus.execute).toHaveBeenNthCalledWith(
      1,
      'customers.interactions.create',
      expect.objectContaining({
        input: expect.objectContaining({
          id: TODO_ID,
          entityId: ENTITY_ID,
          interactionType: 'task',
          source: 'adapter:todo',
        }),
      }),
    )
    expect(mockCommandBus.execute).toHaveBeenNthCalledWith(
      2,
      'customers.interactions.delete',
      expect.objectContaining({
        input: { id: TODO_ID },
      }),
    )
  })

  it('returns 410 when legacy adapters are disabled', async () => {
    const { resolveCustomerInteractionFeatureFlags } = jest.requireMock('../../../lib/interactionFeatureFlags')
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({
      unified: true,
      legacyAdapters: false,
      externalSync: false,
    })

    const res = await GET(new Request(`http://localhost/api/customers/todos?entityId=${ENTITY_ID}`))

    expect(res.status).toBe(410)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(mockEm.find).not.toHaveBeenCalled()
  })

  it('blocks writes when legacy adapters are disabled', async () => {
    const { resolveCustomerInteractionFeatureFlags } = jest.requireMock('../../../lib/interactionFeatureFlags')
    resolveCustomerInteractionFeatureFlags.mockResolvedValue({
      unified: true,
      legacyAdapters: false,
      externalSync: false,
    })

    const res = await POST(
      new Request('http://localhost/api/customers/todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: ENTITY_ID,
          title: 'Create adapter task',
        }),
      }),
    )

    expect(res.status).toBe(410)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})
