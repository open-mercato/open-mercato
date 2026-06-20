/** @jest-environment node */
import { GET, POST } from '../entities'
import { OPTIMISTIC_LOCK_HEADER_NAME, OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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
  SYSTEM_ENTITY_RECORDS_BLOCKED_CODE: 'system_entity_records_blocked',
  isOrmBackedSystemEntityId: () => false,
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

  it('returns updatedAt (ISO string) for a custom entity so the form can derive the lock header', async () => {
    const updatedAt = new Date('2026-06-16T08:00:00.000Z')
    mockEm.find.mockResolvedValueOnce([
      {
        entityId: 'customers:customer_person',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        label: 'Custom Label',
        description: 'desc',
        isActive: true,
        updatedAt,
      },
    ])

    const response = await GET(new Request('http://x/api/entities/entities'))
    expect(response.status).toBe(200)

    const json = await response.json()
    const item = json.items.find((i: { entityId: string }) => i.entityId === 'customers:customer_person')
    expect(item).toBeDefined()
    expect(item.updatedAt).toBe('2026-06-16T08:00:00.000Z')
  })
})

describe('POST /api/entities/entities — optimistic locking', () => {
  const entityId = 'example:calendar_entity'
  const currentUpdatedAt = new Date('2026-06-16T08:00:00.000Z')

  function buildRequest(expectedHeader?: string): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (expectedHeader) headers[OPTIMISTIC_LOCK_HEADER_NAME] = expectedHeader
    return new Request('http://x/api/entities/entities', {
      method: 'POST',
      headers,
      body: JSON.stringify({ entityId, label: 'Updated label', description: 'Version B' }),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockEm.findOne.mockResolvedValue({
      id: 'ent-1',
      entityId,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      label: 'Old label',
      description: 'Version A',
      isActive: true,
      updatedAt: currentUpdatedAt,
    })
  })

  it('returns 409 with the conflict code when a stale lock header is sent', async () => {
    const response = await POST(buildRequest('2026-06-16T07:00:00.000Z'))
    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    // Stale save must not persist the overwrite
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('saves when the lock header matches the current version', async () => {
    const response = await POST(buildRequest('2026-06-16T08:00:00.000Z'))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('saves when no lock header is present (strictly additive — legacy clients)', async () => {
    const response = await POST(buildRequest())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(mockEm.flush).toHaveBeenCalled()
  })
})
