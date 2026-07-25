/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const DICTIONARY_ID = '44444444-4444-4444-8444-444444444444'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const dictionaryRecord = {
  id: DICTIONARY_ID,
  key: 'colors',
  name: 'Colors',
  description: null,
  isSystem: false,
  isActive: true,
  managerVisibility: 'all',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  deletedAt: null as Date | null,
  createdAt: new Date('2026-05-01T10:00:00.000Z'),
  updatedAt: new Date(CURRENT_VERSION),
}

const mockEm = {
  findOne: jest.fn(async () => dictionaryRecord),
  flush: jest.fn(async () => undefined),
}

const context = {
  em: mockEm,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  readableOrganizationIds: [ORG_ID],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
  auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
  container: { resolve: jest.fn() },
  ctx: {},
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => 'user-1'),
}))

import { DELETE } from '../route'

function request(headerVersion: string | null) {
  const headers: Record<string, string> = {}
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/dictionaries/${DICTIONARY_ID}`, {
    method: 'DELETE',
    headers,
  })
}

const params = { params: { dictionaryId: DICTIONARY_ID } }

describe('dictionary DELETE optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    dictionaryRecord.deletedAt = null
    dictionaryRecord.isActive = true
    dictionaryRecord.updatedAt = new Date(CURRENT_VERSION)
    mockEm.findOne.mockResolvedValue(dictionaryRecord)
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await DELETE(request(STALE_VERSION), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('succeeds when the expected version matches', async () => {
    const res = await DELETE(request(CURRENT_VERSION), params)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await DELETE(request(null), params)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })
})
