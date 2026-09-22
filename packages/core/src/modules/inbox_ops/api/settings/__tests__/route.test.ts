/** @jest-environment node */

const mockEm = {
  flush: jest.fn(async () => undefined),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
    id: 'settings-new',
    workingLanguage: 'en',
    webhookSecret: null,
    updatedAt: null,
    ...data,
  })),
  persist: jest.fn(),
}
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../routeHelpers', () => ({
  resolveRequestContext: jest.fn(async () => ({
    em: mockEm,
    container: { resolve: () => null },
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
  })),
  handleRouteError: jest.fn((err: unknown) => {
    throw err
  }),
}))

jest.mock('../../../lib/cache', () => ({
  resolveCache: jest.fn(() => null),
  createSettingsCacheKey: jest.fn(() => 'key'),
  createSettingsCacheTag: jest.fn(() => 'tag'),
  invalidateSettingsCache: jest.fn(async () => undefined),
  SETTINGS_CACHE_TTL_MS: 1000,
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_t: unknown, fn: () => unknown) => fn()),
}))

import { GET } from '../route'

describe('GET /api/inbox_ops/settings (issue #6232)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('bootstraps a settings row instead of returning null when none exists', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const res = await GET(new Request('http://localhost/api/inbox_ops/settings'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(mockEm.create).toHaveBeenCalledTimes(1)
    expect(mockEm.persist).toHaveBeenCalledTimes(1)
    expect(body.settings).not.toBeNull()
    expect(body.settings.id).toBe('settings-new')
  })

  it('returns the existing row without creating a new one', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'settings-1',
      inboxAddress: 'ops-abc@inbox.mercato.local',
      isActive: true,
      workingLanguage: 'en',
      webhookSecret: null,
      updatedAt: null,
    })

    const res = await GET(new Request('http://localhost/api/inbox_ops/settings'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(mockEm.create).not.toHaveBeenCalled()
    expect(body.settings.id).toBe('settings-1')
  })
})
