/** @jest-environment node */

import { GET } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const OTHER_TENANT_ID = '123e4567-e89b-12d3-a456-426614174099'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174050'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLoadRoleSidebarPreferences = jest.fn()
const mockLoadRoleSidebarPreferenceUpdatedAt = jest.fn()

const mockEm = { find: jest.fn(), findOne: jest.fn() }

const mockRbacService = { userHasAllFeatures: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'cache') return {}
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ locale: 'en' })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../../../../services/sidebarPreferencesService', () => ({
  loadRoleSidebarPreferences: (...args: unknown[]) => mockLoadRoleSidebarPreferences(...args),
  loadRoleSidebarPreferenceUpdatedAt: (...args: unknown[]) => mockLoadRoleSidebarPreferenceUpdatedAt(...args),
  loadRoleSidebarPreferenceUpdatedAtBatch: jest.fn(),
  loadSidebarPreference: jest.fn(),
  loadSidebarPreferenceUpdatedAt: jest.fn(),
  saveRoleSidebarPreference: jest.fn(),
  saveSidebarPreference: jest.fn(),
}))

function roleReadRequest(): Request {
  return new Request(`http://localhost/api/auth/sidebar/preferences?roleId=${ROLE_ID}`, {
    method: 'GET',
  })
}

describe('findRoleInScope tenant-scoped query (issue #2730)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
    mockLoadRoleSidebarPreferences.mockResolvedValue(new Map())
    mockLoadRoleSidebarPreferenceUpdatedAt.mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('passes a tenant-scoped where clause to the DB query when tenantId is set', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockFindOneWithDecryption.mockResolvedValue({ id: ROLE_ID, name: 'Editor', tenantId: TENANT_ID })

    const res = await GET(roleReadRequest())
    expect(res.status).toBe(200)

    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    const where = mockFindOneWithDecryption.mock.calls[0][2]
    expect(where).toEqual({
      id: ROLE_ID,
      $or: [{ tenantId: TENANT_ID }, { tenantId: null }],
    })
  })

  it('scopes the DB query to global roles only when tenantId is null', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    mockFindOneWithDecryption.mockResolvedValue({ id: ROLE_ID, name: 'Global', tenantId: null })

    const res = await GET(roleReadRequest())
    expect(res.status).toBe(200)

    const where = mockFindOneWithDecryption.mock.calls[0][2]
    expect(where).toEqual({ id: ROLE_ID, tenantId: null })
  })

  it('still rejects a cross-tenant role row as a defense-in-depth post-check', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    // Simulate the DB returning a foreign-tenant row (e.g. if the where clause were later weakened).
    mockFindOneWithDecryption.mockResolvedValue({ id: ROLE_ID, name: 'Foreign', tenantId: OTHER_TENANT_ID })

    const res = await GET(roleReadRequest())
    expect(res.status).toBe(404)
  })
})
