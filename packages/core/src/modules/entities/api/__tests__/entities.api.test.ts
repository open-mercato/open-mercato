/** @jest-environment node */
import { GET } from '../entities'

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
