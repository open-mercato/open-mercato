/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'

const dictionaryRecord = {
  id: dictionaryId,
  organizationId,
  tenantId,
  deletedAt: null as Date | null,
}

const entryRecord = {
  id: entryId,
  value: 'red',
  label: 'Red',
  color: null,
  icon: null,
  position: 0,
  isDefault: false,
  organizationId,
  tenantId,
  createdAt: new Date('2026-05-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
}

const em = {
  findOne: jest.fn(),
  fork: jest.fn(),
}

const commandBusExecuteMock = jest.fn()
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    return null
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ ...entryRecord, dictionary: dictionaryRecord })),
  findWithDecryption: jest.fn(async () => []),
}))

import { POST as createEntry } from '../route'
import { PATCH as updateEntry, DELETE as deleteEntry } from '../[entryId]/route'

const entryParams = { params: { dictionaryId, entryId } }

describe('dictionary entry write routes mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { entryId }, logEntry: null })
  })

  it('runs the mutation guard lifecycle when creating an entry', async () => {
    const response = await createEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'red', label: 'Red' }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(201)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('dictionaries.entries.create', expect.anything())
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', operation: 'create' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', resourceId: entryId, operation: 'create' }),
    )
  })

  it('blocks entry creation when the guard rejects the mutation', async () => {
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await createEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'red', label: 'Red' }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('runs the mutation guard lifecycle when updating an entry', async () => {
    em.findOne.mockResolvedValueOnce(dictionaryRecord).mockResolvedValueOnce(entryRecord)

    const response = await updateEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Renamed' }),
      }),
      entryParams,
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('dictionaries.entries.update', expect.anything())
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', resourceId: entryId, operation: 'update' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', resourceId: entryId, operation: 'update' }),
    )
  })

  it('blocks entry update when the guard rejects the mutation', async () => {
    em.findOne.mockResolvedValueOnce(dictionaryRecord).mockResolvedValueOnce(entryRecord)
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await updateEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Renamed' }),
      }),
      entryParams,
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('runs the mutation guard lifecycle when deleting an entry', async () => {
    em.findOne.mockResolvedValueOnce(dictionaryRecord).mockResolvedValueOnce(entryRecord)

    const response = await deleteEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/${entryId}`, { method: 'DELETE' }),
      entryParams,
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('dictionaries.entries.delete', expect.anything())
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', resourceId: entryId, operation: 'delete' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dictionaries.entry', resourceId: entryId, operation: 'delete' }),
    )
  })

  it('blocks entry deletion when the guard rejects the mutation', async () => {
    em.findOne.mockResolvedValueOnce(dictionaryRecord).mockResolvedValueOnce(entryRecord)
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await deleteEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/${entryId}`, { method: 'DELETE' }),
      entryParams,
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })
})
