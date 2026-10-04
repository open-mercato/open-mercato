/** @jest-environment node */
import { GET, POST, openApi } from '@open-mercato/core/modules/entities/api/encryption'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

// Deterministic version instants. The optimistic-lock check is a pure ISO-string
// equality compare of two version tokens (see optimistic-lock-command.ts) — it
// never reads the wall clock — so only the relative ordering (older < newer)
// matters, never the absolute calendar value. Anchored to a fixed historical
// instant so these can never read as a near-future "timebomb" date.
const CURRENT_VERSION = new Date('2020-01-02T12:00:00.000Z')
const STALE_VERSION = new Date('2020-01-01T08:00:00.000Z')

const mockMapRepo = {
  find: jest.fn(),
}
const mockEm = {
  getRepository: () => mockMapRepo,
}
const mockUpsertCanonicalEncryptionMap = jest.fn(async () => ({ id: 'saved-map', updatedAt: CURRENT_VERSION }))

function makeMap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    entityId: 'auth:user',
    tenantId: 't-1',
    organizationId: 'o-1',
    fieldsJson: [],
    isActive: true,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    updatedAt: CURRENT_VERSION,
    deletedAt: null,
    ...overrides,
  }
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

jest.mock('@open-mercato/core/modules/entities/lib/encryption-maps', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/entities/lib/encryption-maps')
  return {
    ...actual,
    upsertCanonicalEncryptionMap: (...args: unknown[]) => mockUpsertCanonicalEncryptionMap(...args),
  }
})

describe('entities/encryption API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGuardService = null
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('returns empty map when none exists', async () => {
    mockMapRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ entityId: 'auth:user', fields: [], updatedAt: null })
  })

  it('returns the map version token from the read path', async () => {
    const updatedAt = CURRENT_VERSION
    mockMapRepo.find.mockResolvedValueOnce([makeMap({
      fieldsJson: [{ field: 'email', hashField: 'email_hash' }],
      updatedAt,
    })])
    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.updatedAt).toBe(updatedAt.toISOString())
  })

  it('returns the deterministic active-field union when legacy duplicates exist', async () => {
    mockMapRepo.find.mockResolvedValueOnce([
      makeMap({
        id: 'newer',
        createdAt: new Date('2020-01-02T00:00:00.000Z'),
        updatedAt: new Date('2020-01-03T00:00:00.000Z'),
        fieldsJson: [{ field: 'phone' }, { field: 'email', hashField: 'email_hash' }],
      }),
      makeMap({
        id: 'oldest',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        updatedAt: CURRENT_VERSION,
        fieldsJson: [{ field: 'email' }, { field: 'display_name' }],
      }),
    ])

    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))

    await expect(res.json()).resolves.toMatchObject({
      fields: [
        { field: 'email', hashField: 'email_hash' },
        { field: 'display_name', hashField: null },
        { field: 'phone', hashField: null },
      ],
      isActive: true,
      updatedAt: CURRENT_VERSION.toISOString(),
    })
  })

  it('reads the map from the request-selected organization', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't-1',
      selectedId: 'o-2',
      filterIds: ['o-2'],
      allowedIds: ['o-1', 'o-2'],
    })
    mockMapRepo.find.mockResolvedValueOnce([makeMap({
      id: 'm-2',
      entityId: 'example:todo',
      organizationId: 'o-2',
      fieldsJson: [{ field: 'notes' }],
    })])
    const request = new Request('http://x/api/entities/encryption?entityId=example:todo', {
      headers: { cookie: 'om_selected_org=o-2' },
    })

    const res = await GET(request)

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({ request }))
    expect(mockMapRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'example:todo',
        tenantId: 't-1',
        organizationId: 'o-2',
      }),
      expect.objectContaining({ orderBy: { createdAt: 'asc', id: 'asc' } }),
    )
    await expect(res.json()).resolves.toMatchObject({ organizationId: 'o-2', fields: [{ field: 'notes' }] })
  })

  it('creates map on POST and invalidates cache', async () => {
    mockMapRepo.find.mockResolvedValue([])
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(mockUpsertCanonicalEncryptionMap).toHaveBeenCalledWith(mockEm, {
      entityId: 'auth:user',
      tenantId: 't-1',
      organizationId: 'o-1',
      fields: payload.fields,
      isActive: true,
    })
    expect(mockEncSvc.invalidateMap).toHaveBeenCalledWith('auth:user', 't-1', 'o-1')
  })

  it('returns a safe failure and never reports success when invalidation fails', async () => {
    mockGuardService = {
      validateMutation: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })),
      afterMutationSuccess: jest.fn(async () => {}),
    }
    mockMapRepo.find.mockResolvedValue([])
    mockEncSvc.invalidateMap.mockRejectedValueOnce(new Error('redis://cache-user:secret@internal-cache'))
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] }

    const response = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(503)
    const json = await response.json()
    expect(json).toEqual({
      error: 'The encryption policy update could not be finalized.',
      code: 'encryption_map_invalidation_failed',
    })
    expect(JSON.stringify(json)).not.toContain('cache-user')
    expect(JSON.stringify(json)).not.toContain('secret')
    expect(mockUpsertCanonicalEncryptionMap).toHaveBeenCalled()
    expect(mockGuardService.afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('documents the safe invalidation failure response in OpenAPI', () => {
    const response = openApi.methods.POST?.responses?.find((entry) => entry.status === 503)

    expect(response?.description).toBe('Encryption policy invalidation failed')
    expect(response?.schema?.safeParse({
      error: 'The encryption policy update could not be finalized.',
      code: 'encryption_map_invalidation_failed',
    }).success).toBe(true)
  })

  it('creates and invalidates the map in the request-selected organization', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't-1',
      selectedId: 'o-2',
      filterIds: ['o-2'],
      allowedIds: ['o-1', 'o-2'],
    })
    mockMapRepo.find.mockResolvedValue([])
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
    expect(mockMapRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'example:todo',
      tenantId: 't-1',
      organizationId: 'o-2',
    }), expect.anything())
    expect(mockUpsertCanonicalEncryptionMap).toHaveBeenCalledWith(mockEm, expect.objectContaining({
      entityId: 'example:todo',
      tenantId: 't-1',
      organizationId: 'o-2',
    }))
    expect(mockEncSvc.invalidateMap).toHaveBeenCalledWith('example:todo', 't-1', 'o-2')
  })

  it('rejects a write when the explicitly selected organization is unavailable', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      tenantId: 't-1',
      selectedId: 'o-1',
      filterIds: ['o-1'],
      allowedIds: ['o-1'],
      selectionRejected: true,
    })
    const payload = { entityId: 'example:todo', fields: [{ field: 'notes' }] }

    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        cookie: 'om_selected_org=unavailable-org',
      },
    }))

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ code: 'organization_selection_invalid' })
    expect(mockMapRepo.find).not.toHaveBeenCalled()
    expect(mockUpsertCanonicalEncryptionMap).not.toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).not.toHaveBeenCalled()
  })

  it('documents the unavailable selected-organization response in OpenAPI', () => {
    const response = openApi.methods.POST?.responses?.find((entry) => entry.status === 422)

    expect(response?.description).toBe('Selected organization is unavailable')
    expect(response?.schema?.safeParse({
      error: 'Selected organization is unavailable',
      code: 'organization_selection_invalid',
    }).success).toBe(true)
    expect(response?.schema?.safeParse({
      error: 'Selected organization is unavailable',
      code: 'unexpected_code',
    }).success).toBe(false)
  })

  it('rejects a stale write to an existing map with a 409 conflict', async () => {
    const current = CURRENT_VERSION
    mockMapRepo.find.mockResolvedValue([makeMap({ updatedAt: current })])
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
    expect(mockUpsertCanonicalEncryptionMap).not.toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).not.toHaveBeenCalled()
  })

  it('persists when the expected version matches the current map version', async () => {
    const current = CURRENT_VERSION
    const existing = makeMap({ updatedAt: current })
    mockMapRepo.find.mockResolvedValue([existing])
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
    expect(mockUpsertCanonicalEncryptionMap).toHaveBeenCalledWith(mockEm, expect.objectContaining({
      fields: payload.fields,
    }))
  })

  it('blocks the write when the mutation guard rejects it', async () => {
    mockGuardService = {
      validateMutation: jest.fn(async () => ({ ok: false, status: 403, body: { error: 'blocked' } })),
      afterMutationSuccess: jest.fn(async () => {}),
    }
    mockMapRepo.find.mockResolvedValue([])
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
    expect(mockUpsertCanonicalEncryptionMap).not.toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).not.toHaveBeenCalled()
  })

  it('runs the mutation-guard after-success hook on a successful write', async () => {
    mockGuardService = {
      validateMutation: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { trace: 'x' } })),
      afterMutationSuccess: jest.fn(async () => {}),
    }
    mockMapRepo.find.mockResolvedValue([])
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
