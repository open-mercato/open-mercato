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

import { PATCH } from '../route'

function request(headerVersion: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/dictionaries/${DICTIONARY_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}

describe('dictionary PATCH optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    dictionaryRecord.updatedAt = new Date(CURRENT_VERSION)
    mockEm.findOne.mockResolvedValue(dictionaryRecord)
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PATCH(request(STALE_VERSION, { name: 'X' }), { params: { dictionaryId: DICTIONARY_ID } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('succeeds when the expected version matches', async () => {
    const res = await PATCH(request(CURRENT_VERSION, { name: 'X' }), { params: { dictionaryId: DICTIONARY_ID } })
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await PATCH(request(null, { name: 'X' }), { params: { dictionaryId: DICTIONARY_ID } })
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('does not 500 when the manager resubmits an unchanged namespaced (dotted) key (#9)', async () => {
    dictionaryRecord.key = 'resources.activity-types'
    const res = await PATCH(
      request(CURRENT_VERSION, { key: 'resources.activity-types', name: 'Renamed' }),
      { params: { dictionaryId: DICTIONARY_ID } },
    )
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
    dictionaryRecord.key = 'colors'
  })

  it('rejects a changed key that violates the strict format with 400, not 500', async () => {
    const res = await PATCH(
      request(CURRENT_VERSION, { key: 'not.a.valid.new.key', name: 'Renamed' }),
      { params: { dictionaryId: DICTIONARY_ID } },
    )
    expect(res.status).toBe(400)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})
