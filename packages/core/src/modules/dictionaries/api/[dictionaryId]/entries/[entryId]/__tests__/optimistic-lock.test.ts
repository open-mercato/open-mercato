/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const DICTIONARY_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const dictionaryRecord = {
  id: DICTIONARY_ID,
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  deletedAt: null,
}

const entryRecord = {
  id: ENTRY_ID,
  value: 'red',
  label: 'Red',
  color: null,
  icon: null,
  position: 0,
  isDefault: false,
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  createdAt: new Date('2026-05-01T10:00:00.000Z'),
  updatedAt: new Date(CURRENT_VERSION),
}

const mockEm = {
  findOne: jest.fn(),
  fork: jest.fn(() => mockEm),
}

const mockCommandBus = { execute: jest.fn(async () => ({ result: { entryId: ENTRY_ID }, logEntry: null })) }

const context = {
  em: mockEm,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  readableOrganizationIds: [ORG_ID],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
  auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
  container: { resolve: jest.fn((token: string) => (token === 'commandBus' ? mockCommandBus : null)) },
  ctx: {},
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => 'user-1'),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ ...entryRecord, dictionary: dictionaryRecord })),
}))

import { PATCH } from '../route'

function request(headerVersion: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/dictionaries/${DICTIONARY_ID}/entries/${ENTRY_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}

const params = { params: { dictionaryId: DICTIONARY_ID, entryId: ENTRY_ID } }

describe('dictionary entry PATCH optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    entryRecord.updatedAt = new Date(CURRENT_VERSION)
    mockEm.findOne
      .mockResolvedValueOnce(dictionaryRecord)
      .mockResolvedValueOnce(entryRecord)
    mockEm.fork.mockReturnValue(mockEm)
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PATCH(request(STALE_VERSION, { label: 'X' }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it('succeeds when the expected version matches', async () => {
    const res = await PATCH(request(CURRENT_VERSION, { label: 'X' }), params)
    expect(res.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalledWith('dictionaries.entries.update', expect.anything())
  })

  it('is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await PATCH(request(null, { label: 'X' }), params)
    expect(res.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalled()
  })
})
