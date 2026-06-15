/** @jest-environment node */
import { GET, POST } from '../entities'
import { isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    isSuperAdmin: false,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({
    customers: { customer_person: 'customers:customer_person' },
  }),
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  isSystemEntitySelectable: (id: string) => id === 'customers:customer_person',
}))

jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  isOrmBackedSystemEntityId: jest.fn(),
}))

describe('GET /api/entities/entities — overlay merge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // second em.find (for field definitions) returns empty
    mockEm.find.mockResolvedValue([])
  })

  it('preserves source: code for a generated entity that has a CustomEntity overlay', async () => {
    // First em.find returns a CustomEntity overlay for the code-sourced entity
    mockEm.find.mockResolvedValueOnce([
      {
        entityId: 'customers:customer_person',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        label: 'Custom Label',
        description: 'Overridden description',
        defaultEditor: 'markdown',
        showInSidebar: false,
        isActive: true,
      },
    ])

    const response = await GET(new Request('http://x/api/entities/entities'))
    expect(response.status).toBe(200)

    const json = await response.json()
    const item = json.items.find((i: { entityId: string }) => i.entityId === 'customers:customer_person')
    expect(item).toBeDefined()
    expect(item.source).toBe('code')
    expect(item.label).toBe('Custom Label')
    expect(item.description).toBe('Overridden description')
    expect(item.defaultEditor).toBe('markdown')
  })

  it('reports source: code for a generated entity with no overlay', async () => {
    mockEm.find.mockResolvedValueOnce([])

    const response = await GET(new Request('http://x/api/entities/entities'))
    expect(response.status).toBe(200)

    const json = await response.json()
    const item = json.items.find((i: { entityId: string }) => i.entityId === 'customers:customer_person')
    expect(item).toBeDefined()
    expect(item.source).toBe('code')
  })
})

describe('POST /api/entities/entities — system-entity metadata overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.findOne.mockResolvedValue(null)
    mockEm.create.mockImplementation((_cls: unknown, data: Record<string, unknown>) => ({ ...data }))
  })

  const post = (body: Record<string, unknown>) =>
    POST(new Request('http://x/api/entities/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

  it('persists a metadata-only overlay for an ORM-backed system entity instead of returning 400', async () => {
    // Pre-#3106 this returned 400 "System entities cannot be registered as custom entities";
    // with the read classifier hardened, the overlay row is inert for storage and is allowed.
    ;(isOrmBackedSystemEntityId as jest.Mock).mockReturnValue(true)

    const response = await post({
      entityId: 'customers:customer_person_profile',
      label: 'Person profile',
      description: 'Overlay description',
      defaultEditor: 'markdown',
      // Both of the following MUST be ignored/forced for a system entity:
      labelField: 'should_be_ignored',
      showInSidebar: true,
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(mockEm.flush).toHaveBeenCalled()

    const persisted = mockEm.persist.mock.calls[0][0]
    expect(persisted.label).toBe('Person profile')
    expect(persisted.description).toBe('Overlay description')
    expect(persisted.defaultEditor).toBe('markdown')
    // System overlays never surface a sidebar entry and never relabel record routing.
    expect(persisted.showInSidebar).toBe(false)
    expect(persisted.labelField ?? null).toBeNull()
  })

  it('persists full fields (incl. showInSidebar/labelField) for a genuine custom entity', async () => {
    ;(isOrmBackedSystemEntityId as jest.Mock).mockReturnValue(false)

    const response = await post({
      entityId: 'my_module:thing',
      label: 'Thing',
      defaultEditor: 'htmlRichText',
      labelField: 'name',
      showInSidebar: true,
    })

    expect(response.status).toBe(200)
    const persisted = mockEm.persist.mock.calls[0][0]
    expect(persisted.showInSidebar).toBe(true)
    expect(persisted.labelField).toBe('name')
    expect(persisted.defaultEditor).toBe('htmlRichText')
  })
})
