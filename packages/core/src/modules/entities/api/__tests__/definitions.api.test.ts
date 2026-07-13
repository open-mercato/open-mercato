/** @jest-environment node */
import { DELETE, GET, POST } from '../definitions'

const installCustomEntitiesFromModulesMock = jest.fn(async () => ({
  processed: 1,
  synchronized: 1,
  skipped: 0,
  fieldChanges: 1,
}))

const loadEntityFieldsetConfigsMock = jest.fn(async () => new Map())
const mockRbac = { userHasAllFeatures: jest.fn() }
const mockResolveOrganizationScopeForRequest = jest.fn(async () => ({ tenantId: 'tenant-1', selectedId: 'org-1' }))

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((_entity: unknown, data: unknown) => ({ ...(data as Record<string, unknown>) })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockCache = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'cache') return mockCache
      if (key === 'rbacService') return mockRbac
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('../../lib/fieldsets', () => ({
  loadEntityFieldsetConfigs: (...args: unknown[]) => loadEntityFieldsetConfigsMock(...args),
  CustomFieldsetDefinition: class {},
}))

jest.mock('../../lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: (...args: unknown[]) => installCustomEntitiesFromModulesMock(...args),
}))

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  DictionaryEntry: 'DictionaryEntry',
}))

jest.mock('@open-mercato/core/modules/currencies/data/entities', () => ({
  Currency: 'Currency',
}))

describe('entities/definitions API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1' })
  })

  it('synchronizes module-backed definitions for requested entities when the caller can manage definitions', async () => {
    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_interaction'),
    )

    expect(response.status).toBe(200)
    expect(installCustomEntitiesFromModulesMock).toHaveBeenCalledWith(
      mockEm,
      mockCache,
      expect.objectContaining({
        tenantIds: ['tenant-1'],
        entityIds: ['customers:customer_interaction'],
        includeGlobal: true,
        createOnly: true,
      }),
    )
  })

  it('includes defaultValue from configJson in the normalized response', async () => {
    // First em.find call returns active definitions, second returns tombstones (empty)
    mockEm.find
      .mockResolvedValueOnce([
        {
          key: 'status',
          kind: 'dictionary',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          updatedAt: new Date(),
          configJson: {
            label: 'Status',
            dictionaryId: 'dict-1',
            defaultValue: 'customer',
          },
        },
        {
          key: 'is_vip',
          kind: 'boolean',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          updatedAt: new Date(),
          configJson: {
            label: 'VIP',
            defaultValue: true,
          },
        },
        {
          key: 'notes',
          kind: 'text',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          updatedAt: new Date(),
          configJson: {
            label: 'Notes',
            // no defaultValue
          },
        },
      ])
      .mockResolvedValueOnce([]) // tombstones

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_person'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    const items = body.items as Array<Record<string, unknown>>
    const status = items.find((i) => i.key === 'status')
    const isVip = items.find((i) => i.key === 'is_vip')
    const notes = items.find((i) => i.key === 'notes')

    expect(status?.defaultValue).toBe('customer')
    expect(isVip?.defaultValue).toBe(true)
    expect(notes?.defaultValue).toBeUndefined()
  })

  it('passes phone defaultCountryIso2 from configJson into the normalized response (#62)', async () => {
    mockEm.find
      .mockResolvedValueOnce([
        {
          key: 'work_phone',
          kind: 'phone',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          updatedAt: new Date(),
          configJson: {
            label: 'Work phone',
            defaultCountryIso2: 'PL',
          },
        },
        {
          key: 'mobile_phone',
          kind: 'phone',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          updatedAt: new Date(),
          configJson: {
            label: 'Mobile phone',
            // no defaultCountryIso2 configured
          },
        },
      ])
      .mockResolvedValueOnce([]) // tombstones

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_person'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    const items = body.items as Array<Record<string, unknown>>
    const work = items.find((i) => i.key === 'work_phone')
    const mobile = items.find((i) => i.key === 'mobile_phone')

    expect(work?.kind).toBe('phone')
    expect(work?.defaultCountryIso2).toBe('PL')
    expect(mobile?.defaultCountryIso2).toBeUndefined()
  })

  it('hides inherited definitions that have a scoped tombstone', async () => {
    mockEm.find
      .mockResolvedValueOnce([
        {
          key: 'estimated_seats',
          kind: 'integer',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'estimated_seats',
          kind: 'integer',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          deletedAt: new Date('2026-06-26T00:00:00.000Z'),
          updatedAt: new Date('2026-06-26T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_person'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([])
  })

  it('does not hide inherited definitions with another organization tombstone', async () => {
    mockEm.find
      .mockResolvedValueOnce([
        {
          key: 'estimated_seats',
          kind: 'integer',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'estimated_seats',
          kind: 'integer',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: 'org-2',
          deletedAt: new Date('2026-06-26T00:00:00.000Z'),
          updatedAt: new Date('2026-06-26T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_person'),
    )

    expect(response.status).toBe(200)
    expect(mockEm.find.mock.calls[1][1].$and[1].$or).toEqual([
      { organizationId: 'org-1' },
      { organizationId: null },
    ])
    const body = await response.json()
    expect(body.items).toEqual([
      expect.objectContaining({
        key: 'estimated_seats',
        label: 'Estimated seats',
      }),
    ])
  })

  it('keeps public definition reads in the auth tenant when selected scope points at another tenant', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({ tenantId: 'tenant-2', selectedId: 'org-2' })
    mockEm.find
      .mockResolvedValueOnce([
        {
          key: 'implementation_complexity',
          kind: 'text',
          entityId: 'customers:customer_person',
          tenantId: 'tenant-1',
          organizationId: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          configJson: { label: 'Implementation complexity' },
        },
      ])
      .mockResolvedValueOnce([])

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_person'),
    )

    expect(response.status).toBe(200)
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['entities.definitions.manage'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockEm.find.mock.calls[0][1].$and[0].$or).toEqual([
      { tenantId: 'tenant-1' },
      { tenantId: null },
    ])
    expect(mockEm.find.mock.calls[0][1].$and[1].$or).toEqual([
      { organizationId: 'org-1' },
      { organizationId: null },
    ])
    const body = await response.json()
    expect(body.items).toEqual([
      expect.objectContaining({
        key: 'implementation_complexity',
        label: 'Implementation complexity',
      }),
    ])
  })

  it('does not synchronize module-backed definitions for callers without manage permission', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_interaction'),
    )

    expect(response.status).toBe(200)
    expect(installCustomEntitiesFromModulesMock).not.toHaveBeenCalled()
  })
})

describe('entities/definitions POST — defaultValue validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockEm.findOne.mockResolvedValue(null)
    mockEm.find.mockResolvedValue([])
  })

  const makeRequest = (body: Record<string, unknown>) =>
    new Request('http://x/api/entities/definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('rejects a string defaultValue on a boolean field', async () => {
    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'is_vip',
        kind: 'boolean',
        configJson: { label: 'VIP', defaultValue: 'yes' },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('boolean')
  })

  it('rejects a string defaultValue on an integer field', async () => {
    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'priority',
        kind: 'integer',
        configJson: { label: 'Priority', defaultValue: 'high' },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('integer')
  })

  it('rejects a select defaultValue that does not match configured options', async () => {
    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'severity',
        kind: 'select',
        configJson: {
          label: 'Severity',
          options: ['low', 'medium', 'high'],
          defaultValue: 'critical',
        },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('options')
  })

  it('accepts a valid boolean defaultValue of false', async () => {
    const mockDef = { kind: 'boolean', configJson: {}, isActive: true, updatedAt: new Date() }
    mockEm.findOne.mockResolvedValue(mockDef)

    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'newsletter_opt_in',
        kind: 'boolean',
        configJson: { label: 'Newsletter', defaultValue: false },
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })

  it('rejects a dictionary defaultValue that does not match any entry', async () => {
    // findOne returns null for both the existing field def lookup AND the entry lookup
    mockEm.findOne.mockResolvedValue(null)

    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'status',
        kind: 'dictionary',
        configJson: { label: 'Status', dictionaryId: 'a0000000-0000-4000-8000-000000000001', defaultValue: 'nonexistent_token' },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('does not match any entry')
  })

  it('accepts a dictionary defaultValue when the entry exists', async () => {
    // First findOne: existing field def (null = new), second: dictionary entry (found)
    mockEm.findOne
      .mockResolvedValueOnce(null) // no existing field def
      .mockResolvedValueOnce({ id: 'entry-1', value: 'customer', label: 'Customer' }) // dictionary entry found

    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'status',
        kind: 'dictionary',
        configJson: { label: 'Status', dictionaryId: 'a0000000-0000-4000-8000-000000000001', defaultValue: 'customer' },
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })

  it('rejects a currency defaultValue that does not match any currency', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'preferred_currency',
        kind: 'currency',
        configJson: { label: 'Currency', defaultValue: 'FAKE' },
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('does not match any available currency')
  })

  it('accepts a currency defaultValue when the currency exists', async () => {
    mockEm.findOne
      .mockResolvedValueOnce(null) // no existing field def
      .mockResolvedValueOnce({ id: 'cur-1', code: 'USD', name: 'US Dollar' }) // currency found

    const response = await POST(
      makeRequest({
        entityId: 'customers:customer_person',
        key: 'preferred_currency',
        kind: 'currency',
        configJson: { label: 'Currency', defaultValue: 'USD' },
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })
})

describe('entities/definitions DELETE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)
  })

  const makeDeleteRequest = (body: Record<string, unknown>) =>
    new Request('http://x/api/entities/definitions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('creates a scoped tombstone when deleting an inherited definition', async () => {
    const inherited = {
      entityId: 'customers:customer_deal',
      key: 'estimated_seats',
      kind: 'integer',
      tenantId: 'tenant-1',
      organizationId: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      configJson: { label: 'Estimated seats/licenses' },
    }
    mockEm.findOne.mockResolvedValueOnce(null)
    mockEm.find.mockResolvedValueOnce([inherited])

    const response = await DELETE(makeDeleteRequest({
      entityId: 'customers:customer_deal',
      key: 'estimated_seats',
    }))

    expect(response.status).toBe(200)
    expect(mockEm.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: 'customers:customer_deal',
        key: 'estimated_seats',
        kind: 'integer',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        isActive: false,
        deletedAt: expect.any(Date),
      }),
    )
    expect(mockEm.persist).toHaveBeenCalledWith(expect.objectContaining({
      key: 'estimated_seats',
      isActive: false,
      deletedAt: expect.any(Date),
    }))
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
  })

  it('still returns 404 when neither scoped nor inherited definition exists', async () => {
    mockEm.findOne.mockResolvedValueOnce(null)
    mockEm.find.mockResolvedValueOnce([])

    const response = await DELETE(makeDeleteRequest({
      entityId: 'customers:customer_deal',
      key: 'missing_key',
    }))

    expect(response.status).toBe(404)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
  })
})
