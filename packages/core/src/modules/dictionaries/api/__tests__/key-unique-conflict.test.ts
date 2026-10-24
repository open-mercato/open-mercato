/** @jest-environment node */

import { UniqueConstraintViolationException } from '@mikro-orm/core'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
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
  auth: { tenantId, sub: userId, orgId: organizationId },
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
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false, metadata: null })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

import { POST as createDictionary } from '../route'
import { PATCH as updateDictionary } from '../[dictionaryId]/route'

function uniqueViolation(constraint: string) {
  const driverError = Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint },
  )
  return new UniqueConstraintViolationException(driverError)
}

function uniqueKeyViolation() {
  return uniqueViolation('dictionaries_scope_key_unique')
}

function postDictionary(body: Record<string, unknown>) {
  return createDictionary(
    new Request('http://localhost/api/dictionaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function patchDictionary(body: Record<string, unknown>) {
  return updateDictionary(
    new Request(`http://localhost/api/dictionaries/${dictionaryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { dictionaryId } },
  )
}

describe('dictionary key unique-constraint conflicts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: dictionaryId, ...data }))
  })

  it('answers POST with the duplicate-key 409 when the insert loses a race on the key', async () => {
    em.findOne.mockResolvedValue(null)
    em.flush.mockRejectedValue(uniqueKeyViolation())

    const response = await postDictionary({ key: 'colors', name: 'Colors' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'A dictionary with this key already exists' })
  })

  it('keeps answering POST with 500 for other write failures', async () => {
    em.findOne.mockResolvedValue(null)
    em.flush.mockRejectedValue(new Error('connection lost'))

    const response = await postDictionary({ key: 'colors', name: 'Colors' })

    expect(response.status).toBe(500)
  })

  it('keeps answering POST with 500 for a unique violation on another constraint', async () => {
    em.findOne.mockResolvedValue(null)
    em.flush.mockRejectedValue(uniqueViolation('some_other_unique'))

    const response = await postDictionary({ key: 'colors', name: 'Colors' })

    expect(response.status).toBe(500)
  })

  it('answers a PATCH key rename with the duplicate-key 409 when the rename loses a race on the key', async () => {
    const record = {
      id: dictionaryId,
      key: 'colors',
      name: 'Colors',
      description: null,
      isSystem: false,
      isActive: true,
      managerVisibility: 'default',
      organizationId,
      tenantId,
      deletedAt: null,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    }
    em.findOne.mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) =>
      filter.id === dictionaryId ? record : null,
    )
    em.flush.mockRejectedValue(uniqueKeyViolation())

    const response = await patchDictionary({ key: 'shades' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'A dictionary with this key already exists' })
  })
})
