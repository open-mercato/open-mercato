/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PATCH } from '../route'

const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockSettings = {
  id: 'settings-1',
  inboxAddress: 'inbox@acme.test',
  isActive: true,
  workingLanguage: 'en',
  updatedAt: new Date(CURRENT_VERSION),
}

const mockEm = { flush: jest.fn(async () => undefined) }
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

function patchRequest(headerVersion: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/inbox_ops/settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ workingLanguage: 'de' }),
  })
}

describe('inbox_ops settings optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockSettings.updatedAt = new Date(CURRENT_VERSION)
    ;(mockSettings as { webhookSecret?: string | null }).webhookSecret = null
    mockFindOneWithDecryption.mockResolvedValue(mockSettings)
  })

  it('returns 409 when the expected version is stale', async () => {
    const res = await PATCH(patchRequest(STALE_VERSION))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('saves and returns updatedAt when the expected version matches', async () => {
    const res = await PATCH(patchRequest(CURRENT_VERSION))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.settings.updatedAt).toBe('string')
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) without the expected-version header', async () => {
    const res = await PATCH(patchRequest(null))
    expect(res.status).toBe(200)
  })

  it('sets the per-tenant webhook secret and never echoes the value (issue #2698)', async () => {
    const secret = 'a-strong-per-tenant-secret-1234'
    const req = new Request('http://localhost/api/inbox_ops/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookSecret: secret }),
    })

    const res = await PATCH(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect((mockSettings as { webhookSecret?: string | null }).webhookSecret).toBe(secret)
    expect(body.settings.webhookSecretSet).toBe(true)
    expect(JSON.stringify(body)).not.toContain(secret)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('clears the per-tenant webhook secret when null is provided', async () => {
    ;(mockSettings as { webhookSecret?: string | null }).webhookSecret = 'existing-secret-value-000'
    const req = new Request('http://localhost/api/inbox_ops/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookSecret: null }),
    })

    const res = await PATCH(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect((mockSettings as { webhookSecret?: string | null }).webhookSecret).toBeNull()
    expect(body.settings.webhookSecretSet).toBe(false)
  })
})
