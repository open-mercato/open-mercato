/** @jest-environment node */
// Regression coverage for #3190: the custom PUT/DELETE /api/currencies/fetch-configs
// route never enforced the optimistic-lock header the UI sends, so a stale provider
// edit silently overwrote a concurrent change. The route must load the current
// config, compare its updated_at against the client's expected version, and return
// the standard structured 409 conflict body (no-op when the header is absent).

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const CONFIG_ID = '123e4567-e89b-12d3-a456-426614174050'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const configRecord = {
  id: CONFIG_ID,
  provider: 'ecb',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  isEnabled: true,
  updatedAt: new Date(CURRENT_VERSION),
}

const mockEm = {
  findOne: jest.fn(async () => configRecord),
}

const mockContainer = {
  resolve: jest.fn((token: string) => (token === 'em' ? mockEm : null)),
  dispose: jest.fn(async () => undefined),
}

const mockGetAuthFromRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/currencies/data/entities', () => ({
  CurrencyFetchConfig: class CurrencyFetchConfig {},
}))

jest.mock('@open-mercato/core/modules/currencies/commands/fetch-configs', () => ({
  createFetchConfig: jest.fn(),
  updateFetchConfig: jest.fn(async () => configRecord),
  deleteFetchConfig: jest.fn(async () => undefined),
}))

import { PUT, DELETE } from '@open-mercato/core/modules/currencies/api/fetch-configs/route'
import {
  updateFetchConfig,
  deleteFetchConfig,
} from '@open-mercato/core/modules/currencies/commands/fetch-configs'

function putRequest(headerVersion: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/currencies/fetch-configs', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
}

function deleteRequest(headerVersion: string | null) {
  const headers: Record<string, string> = {}
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/currencies/fetch-configs?id=${CONFIG_ID}`, {
    method: 'DELETE',
    headers,
  })
}

describe('currencies fetch-configs optimistic locking', () => {
  const originalEnv = process.env.OM_OPTIMISTIC_LOCK

  beforeAll(() => {
    process.env.OM_OPTIMISTIC_LOCK = 'all'
  })

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = originalEnv
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockEm.findOne.mockResolvedValue(configRecord)
  })

  describe('PUT', () => {
    it('returns 409 with the structured conflict body when the expected version is stale', async () => {
      const res = await PUT(putRequest(STALE_VERSION, { id: CONFIG_ID, isEnabled: false }) as never)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('optimistic_lock_conflict')
      expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
      expect(body.expectedUpdatedAt).toBe(STALE_VERSION)
      expect(updateFetchConfig).not.toHaveBeenCalled()
    })

    it('updates when the expected version matches', async () => {
      const res = await PUT(putRequest(CURRENT_VERSION, { id: CONFIG_ID, isEnabled: false }) as never)
      expect(res.status).toBe(200)
      expect(updateFetchConfig).toHaveBeenCalledTimes(1)
    })

    it('is a no-op (no 409) when the client sends no expected-version header', async () => {
      const res = await PUT(putRequest(null, { id: CONFIG_ID, isEnabled: false }) as never)
      expect(res.status).toBe(200)
      expect(updateFetchConfig).toHaveBeenCalledTimes(1)
    })
  })

  describe('DELETE', () => {
    it('returns 409 with the structured conflict body when the expected version is stale', async () => {
      const res = await DELETE(deleteRequest(STALE_VERSION) as never)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('optimistic_lock_conflict')
      expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
      expect(body.expectedUpdatedAt).toBe(STALE_VERSION)
      expect(deleteFetchConfig).not.toHaveBeenCalled()
    })

    it('deletes when the expected version matches', async () => {
      const res = await DELETE(deleteRequest(CURRENT_VERSION) as never)
      expect(res.status).toBe(200)
      expect(deleteFetchConfig).toHaveBeenCalledTimes(1)
    })

    it('is a no-op (no 409) when the client sends no expected-version header', async () => {
      const res = await DELETE(deleteRequest(null) as never)
      expect(res.status).toBe(200)
      expect(deleteFetchConfig).toHaveBeenCalledTimes(1)
    })
  })
})
