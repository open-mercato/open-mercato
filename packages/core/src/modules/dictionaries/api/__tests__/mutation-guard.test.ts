/** @jest-environment node */

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

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

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
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { POST as createDictionary } from '../route'
import { PATCH as updateDictionary, DELETE as deleteDictionary } from '../[dictionaryId]/route'

function makeDictionaryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: dictionaryId,
    key: 'colors',
    name: 'Colors',
    description: null,
    isSystem: false,
    isActive: true,
    managerVisibility: 'all',
    entrySortMode: 'label_asc',
    organizationId,
    tenantId,
    deletedAt: null as Date | null,
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  }
}

describe('dictionary custom write routes mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('runs the mutation guard lifecycle when creating a dictionary', async () => {
    em.findOne.mockResolvedValueOnce(null)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: dictionaryId, ...data }))

    const response = await createDictionary(
      new Request('http://localhost/api/dictionaries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'colors', name: 'Colors' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'dictionaries.dictionary',
        operation: 'create',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.dictionary', operation: 'create' }),
    )
  })

  it('blocks dictionary creation when the guard rejects the mutation', async () => {
    em.findOne.mockResolvedValueOnce(null)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: dictionaryId, ...data }))
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await createDictionary(
      new Request('http://localhost/api/dictionaries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'colors', name: 'Colors' }),
      }),
    )

    expect(response.status).toBe(423)
    expect(em.flush).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the mutation guard lifecycle when updating a dictionary', async () => {
    const dictionary = makeDictionaryRecord()
    em.findOne.mockResolvedValueOnce(dictionary).mockResolvedValueOnce(null)

    const response = await updateDictionary(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'renamed', name: 'Renamed' }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(200)
    expect(dictionary).toMatchObject({ key: 'renamed', name: 'Renamed' })
    expect(em.flush).toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.dictionary', resourceId: dictionaryId, operation: 'update' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.dictionary', resourceId: dictionaryId, operation: 'update' }),
    )
  })

  it('blocks dictionary update when the guard rejects the mutation', async () => {
    em.findOne.mockResolvedValueOnce(makeDictionaryRecord())
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await updateDictionary(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(423)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('runs the mutation guard lifecycle when deleting a dictionary', async () => {
    const dictionary = makeDictionaryRecord()
    em.findOne.mockResolvedValueOnce(dictionary)

    const response = await deleteDictionary(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}`, { method: 'DELETE' }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(200)
    expect(dictionary).toMatchObject({ isActive: false, deletedAt: expect.any(Date) })
    expect(em.flush).toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.dictionary', resourceId: dictionaryId, operation: 'delete' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.dictionary', resourceId: dictionaryId, operation: 'delete' }),
    )
  })

  it('blocks dictionary deletion when the guard rejects the mutation', async () => {
    em.findOne.mockResolvedValueOnce(makeDictionaryRecord())
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await deleteDictionary(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}`, { method: 'DELETE' }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(423)
    expect(em.flush).not.toHaveBeenCalled()
  })

  describe.each([
    { key: 'sales.order_status', isSystem: true, error: 'System dictionary keys cannot be changed and system dictionaries cannot be disabled or deleted.' },
    { key: 'currency', isSystem: false, error: 'The currency dictionary cannot be modified or deleted.' },
    { key: 'currencies', isSystem: true, error: 'The currency dictionary cannot be modified or deleted.' },
  ])('protected dictionary $key', ({ key, isSystem, error }) => {
    it.each([
      { operation: 'update', method: 'PATCH', handler: updateDictionary, payload: { key: 'renamed', name: 'Renamed' } },
      { operation: 'update', method: 'PATCH', handler: updateDictionary, payload: { isActive: false } },
      { operation: 'delete', method: 'DELETE', handler: deleteDictionary, payload: undefined },
    ])('returns 400 for a protected $method mutation ($payload)', async ({ operation, method, handler, payload }) => {
      const original = makeDictionaryRecord({ key, isSystem })
      const dictionary = { ...original }
      em.findOne.mockResolvedValueOnce(dictionary)

      const response = await handler(
        new Request(`http://localhost/api/dictionaries/${dictionaryId}`, { method, body: JSON.stringify(payload) }),
        { params: { dictionaryId } },
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error })
      expect(dictionary).toEqual(original)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(container, expect.objectContaining({ operation }))
      expect(em.flush).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })
  })

  it.each(['sales.order_status', 'legacy.SystemKey', 'currency'])('updates descriptive settings for %s', async (key) => {
    const dictionary = makeDictionaryRecord({ key, isSystem: key !== 'currency' })
    em.findOne.mockResolvedValueOnce(dictionary)

    const response = await updateDictionary(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ key, name: 'Renamed', description: 'Updated', entrySortMode: 'value_asc' }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(200)
    expect(dictionary).toMatchObject({ key, name: 'Renamed', description: 'Updated', entrySortMode: 'value_asc' })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledTimes(1)
  })
})
