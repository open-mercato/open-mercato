/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/entities/api/encryption'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

// Deterministic version instants. The optimistic-lock check is a pure ISO-string
// equality compare of two version tokens (see optimistic-lock-command.ts) — it
// never reads the wall clock — so only the relative ordering (older < newer)
// matters, never the absolute calendar value. Anchored to a fixed historical
// instant so these can never read as a near-future "timebomb" date.
const CURRENT_VERSION = new Date('2020-01-02T12:00:00.000Z')
const STALE_VERSION = new Date('2020-01-01T08:00:00.000Z')

const mockMapRepo = {
  findOne: jest.fn(),
  create: jest.fn((data) => ({ ...data, updatedAt: CURRENT_VERSION })),
}
const persistFlush = jest.fn(async () => {})
const mockEm = {
  getRepository: () => mockMapRepo,
  persist: jest.fn(() => ({ flush: persistFlush })),
  flush: persistFlush,
}

const mockEncSvc = {
  invalidateMap: jest.fn(async () => {}),
}
const mockResolveOrganizationScopeForRequest = jest.fn(async () => ({
  tenantId: 't-1',
  selectedId: 'o-1',
  filterIds: ['o-1'],
  allowedIds: ['o-1'],
}))

let mockGuardService: any = null

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'tenantEncryptionService') return mockEncSvc
      if (k === 'crudMutationGuardService') {
        if (!mockGuardService) throw new Error('not registered')
        return mockGuardService
      }
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ sub: 'u-1', tenantId: 't-1', orgId: 'o-1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

describe('entities/encryption API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGuardService = null
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('returns empty map when none exists', async () => {
    mockMapRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ entityId: 'auth:user', fields: [], updatedAt: null })
  })

  it('returns the map version token from the read path', async () => {
    const updatedAt = CURRENT_VERSION
    mockMapRepo.findOne.mockResolvedValueOnce({
      id: 'm-1',
      fieldsJson: [{ field: 'email', hashField: 'email_hash' }],
      isActive: true,
      updatedAt,
    })
    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.updatedAt).toBe(updatedAt.toISOString())
  })

  it('reads the map from the request-selected organization', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't-1',
      selectedId: 'o-2',
      filterIds: ['o-2'],
      allowedIds: ['o-1', 'o-2'],
    })
    mockMapRepo.findOne.mockResolvedValueOnce({
      id: 'm-2',
      fieldsJson: [{ field: 'notes' }],
      isActive: true,
      updatedAt: CURRENT_VERSION,
    })
    const request = new Request('http://x/api/entities/encryption?entityId=example:todo', {
      headers: { cookie: 'om_selected_org=o-2' },
    })

    const res = await GET(request)

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({ request }))
    expect(mockMapRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'example:todo',
      tenantId: 't-1',
      organizationId: 'o-2',
    }))
    await expect(res.json()).resolves.toMatchObject({ organizationId: 'o-2', fields: [{ field: 'notes' }] })
  })

  it('creates map on POST and invalidates cache', async () => {
    mockMapRepo.findOne.mockResolvedValue(null)
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(mockMapRepo.create).toHaveBeenCalled()
    expect(mockEm.persist).toHaveBeenCalled()
    expect(persistFlush).toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).toHaveBeenCalledWith('auth:user', 't-1', 'o-1')
  })

  it('creates and invalidates the map in the request-selected organization', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't-1',
      selectedId: 'o-2',
      filterIds: ['o-2'],
      allowedIds: ['o-1', 'o-2'],
    })
    mockMapRepo.findOne.mockResolvedValue(null)
    const payload = { entityId: 'example:todo', fields: [{ field: 'notes' }] }
    const request = new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        cookie: 'om_selected_org=o-2',
      },
    })

    const res = await POST(request)

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({ request }))
    expect(mockMapRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'example:todo',
      tenantId: 't-1',
      organizationId: 'o-2',
    }))
    expect(mockMapRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'example:todo',
      tenantId: 't-1',
      organizationId: 'o-2',
    }))
    expect(mockEncSvc.invalidateMap).toHaveBeenCalledWith('example:todo', 't-1', 'o-2')
  })

  it('rejects a stale write to an existing map with a 409 conflict', async () => {
    const current = CURRENT_VERSION
    mockMapRepo.findOne.mockResolvedValue({
      id: 'm-1',
      fieldsJson: [],
      isActive: true,
      updatedAt: current,
    })
    const stale = STALE_VERSION.toISOString()
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: null }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: stale,
      },
    }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json).toMatchObject({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: current.toISOString(),
      expectedUpdatedAt: stale,
    })
    // Stale write must not persist.
    expect(persistFlush).not.toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).not.toHaveBeenCalled()
  })

  it('persists when the expected version matches the current map version', async () => {
    const current = CURRENT_VERSION
    const existing = { id: 'm-1', fieldsJson: [], isActive: true, updatedAt: current }
    mockMapRepo.findOne.mockResolvedValue(existing)
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: null }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: current.toISOString(),
      },
    }))
    expect(res.status).toBe(200)
    expect(persistFlush).toHaveBeenCalled()
    expect(existing.fieldsJson).toEqual(payload.fields)
  })

  it('blocks the write when the mutation guard rejects it', async () => {
    mockGuardService = {
      validateMutation: jest.fn(async () => ({ ok: false, status: 403, body: { error: 'blocked' } })),
      afterMutationSuccess: jest.fn(async () => {}),
    }
    mockMapRepo.findOne.mockResolvedValue(null)
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: null }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toMatchObject({ error: 'blocked' })
    expect(mockGuardService.validateMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'entities.encryption_map',
        operation: 'create',
        userId: 'u-1',
      }),
    )
    // Guard-blocked write must not persist.
    expect(persistFlush).not.toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).not.toHaveBeenCalled()
  })

  it('runs the mutation-guard after-success hook on a successful write', async () => {
    mockGuardService = {
      validateMutation: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { trace: 'x' } })),
      afterMutationSuccess: jest.fn(async () => {}),
    }
    mockMapRepo.findOne.mockResolvedValue(null)
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: null }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(mockGuardService.afterMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'entities.encryption_map',
        operation: 'create',
        metadata: { trace: 'x' },
      }),
    )
  })
})
