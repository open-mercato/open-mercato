/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const PREF_ID = '123e4567-e89b-12d3-a456-426614174070'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockGetAuthFromRequest = jest.fn()
const mockLoadSidebarPreferenceUpdatedAt = jest.fn()
const mockSaveSidebarPreference = jest.fn()
const mockLoadRoleSidebarPreferences = jest.fn()
const mockLoadRoleSidebarPreferenceUpdatedAt = jest.fn()
const mockSaveRoleSidebarPreference = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  nativeDelete: jest.fn(),
  flush: jest.fn(),
  begin: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
}

const mockRbacService = {
  userHasAllFeatures: jest.fn(),
}

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

jest.mock('../../../../services/sidebarPreferencesService', () => ({
  loadSidebarPreferenceUpdatedAt: (...args: unknown[]) => mockLoadSidebarPreferenceUpdatedAt(...args),
  saveSidebarPreference: (...args: unknown[]) => mockSaveSidebarPreference(...args),
  loadRoleSidebarPreferences: (...args: unknown[]) => mockLoadRoleSidebarPreferences(...args),
  loadRoleSidebarPreferenceUpdatedAt: (...args: unknown[]) => mockLoadRoleSidebarPreferenceUpdatedAt(...args),
  saveRoleSidebarPreference: (...args: unknown[]) => mockSaveRoleSidebarPreference(...args),
  loadSidebarPreference: jest.fn(),
}))

function putRequest(headerVersion: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/auth/sidebar/preferences', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      groupOrder: ['catalog', 'sales'],
      groupLabels: {},
      itemLabels: {},
      hiddenItems: [],
      itemOrder: {},
    }),
  })
}

describe('sidebar preferences optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    // No `auth.sidebar.manage` feature → user scope only, no role queries.
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    mockLoadSidebarPreferenceUpdatedAt.mockResolvedValue({
      id: PREF_ID,
      updatedAt: new Date(CURRENT_VERSION),
    })
    mockSaveSidebarPreference.mockResolvedValue({
      version: 1,
      groupOrder: ['catalog', 'sales'],
      groupLabels: {},
      itemLabels: {},
      hiddenItems: [],
      itemOrder: {},
    })
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(putRequest(STALE_VERSION))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockSaveSidebarPreference).not.toHaveBeenCalled()
  })

  it('saves when the expected version matches', async () => {
    const res = await PUT(putRequest(CURRENT_VERSION))
    expect(res.status).toBe(200)
    expect(mockSaveSidebarPreference).toHaveBeenCalledTimes(1)
  })

  it('is a no-op (no 409) when the client sends no expected-version header (strictly additive)', async () => {
    const res = await PUT(putRequest(null))
    expect(res.status).toBe(200)
    expect(mockSaveSidebarPreference).toHaveBeenCalledTimes(1)
  })
})
