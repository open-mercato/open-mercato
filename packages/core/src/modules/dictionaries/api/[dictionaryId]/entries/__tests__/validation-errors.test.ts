const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  flush: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const context = {
  container,
  ctx: {
    container,
    auth: { tenantId, sub: userId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: null,
  },
  auth: { tenantId, sub: userId },
  em,
  organizationId,
  tenantId,
  readableOrganizationIds: [organizationId],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(),
  runCrudMutationGuardAfterSuccess: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) => emInstance.find(entity, filters),
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) => emInstance.findOne(entity, filters),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: async (req: Request, fallback: unknown) => {
    try { return await req.json() } catch { return fallback }
  },
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn(async (_tenant: unknown, fn: () => unknown) => fn()),
}))

import { GET as listEntries, POST as createEntry } from '../route'
import { PATCH as updateEntry } from '../[entryId]/route'
import { POST as reorderEntries } from '../reorder/route'
import { POST as setDefaultEntry } from '../set-default/route'

function jsonRequest(url: string, method: string, body: string): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  })
}

async function expectValidationError(response: Response) {
  expect(response.status).toBe(400)
  const body = await response.json()
  expect(body.error).toBe('Invalid input')
  expect(Array.isArray(body.details)).toBe(true)
  expect(body.details.length).toBeGreaterThan(0)
}

describe('dictionary entry routes return 400 for invalid input', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.findOne.mockResolvedValue({
      id: dictionaryId,
      organizationId,
      tenantId,
      deletedAt: null,
      updatedAt: new Date('2026-04-11T08:00:00.000Z'),
    })
    em.find.mockResolvedValue([])
  })

  it('rejects a non-uuid dictionaryId on list', async () => {
    const response = await listEntries(
      new Request('http://localhost/api/dictionaries/not-a-uuid/entries'),
      { params: { dictionaryId: 'not-a-uuid' } },
    )
    await expectValidationError(response)
  })

  it('rejects a non-uuid dictionaryId on create', async () => {
    const response = await createEntry(
      jsonRequest('http://localhost/api/dictionaries/not-a-uuid/entries', 'POST', JSON.stringify({ value: 'x' })),
      { params: { dictionaryId: 'not-a-uuid' } },
    )
    await expectValidationError(response)
  })

  it('rejects an empty value on create', async () => {
    const response = await createEntry(
      jsonRequest(`http://localhost/api/dictionaries/${dictionaryId}/entries`, 'POST', JSON.stringify({ value: '' })),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects a non-JSON body on create', async () => {
    const response = await createEntry(
      jsonRequest(`http://localhost/api/dictionaries/${dictionaryId}/entries`, 'POST', '{ not json'),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects an invalid color on create', async () => {
    const response = await createEntry(
      jsonRequest(
        `http://localhost/api/dictionaries/${dictionaryId}/entries`,
        'POST',
        JSON.stringify({ value: 'ok', color: 'notacolor' }),
      ),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects an invalid payload on update', async () => {
    const response = await updateEntry(
      jsonRequest(
        `http://localhost/api/dictionaries/${dictionaryId}/entries/${entryId}`,
        'PATCH',
        JSON.stringify({ value: '' }),
      ),
      { params: { dictionaryId, entryId } },
    )
    await expectValidationError(response)
  })

  it('rejects an empty payload on reorder', async () => {
    const response = await reorderEntries(
      jsonRequest(`http://localhost/api/dictionaries/${dictionaryId}/entries/reorder`, 'POST', JSON.stringify({})),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects a negative position on reorder', async () => {
    const response = await reorderEntries(
      jsonRequest(
        `http://localhost/api/dictionaries/${dictionaryId}/entries/reorder`,
        'POST',
        JSON.stringify({ entries: [{ id: entryId, position: -1 }] }),
      ),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects an empty payload on set-default', async () => {
    const response = await setDefaultEntry(
      jsonRequest(`http://localhost/api/dictionaries/${dictionaryId}/entries/set-default`, 'POST', JSON.stringify({})),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })

  it('rejects a non-uuid entryId on set-default', async () => {
    const response = await setDefaultEntry(
      jsonRequest(
        `http://localhost/api/dictionaries/${dictionaryId}/entries/set-default`,
        'POST',
        JSON.stringify({ entryId: 'not-a-uuid' }),
      ),
      { params: { dictionaryId } },
    )
    await expectValidationError(response)
  })
})
