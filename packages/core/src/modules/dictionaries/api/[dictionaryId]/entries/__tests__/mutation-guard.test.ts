const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'
const previousDefaultId = '66666666-6666-4666-8666-666666666666'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  flush: jest.fn(),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

const context = {
  container: {},
  ctx: {},
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
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { POST as reorderEntries } from '../reorder/route'
import { POST as setDefaultEntry } from '../set-default/route'

describe('dictionary entry custom write routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('runs the mutation guard when reordering entries', async () => {
    em.findOne.mockResolvedValueOnce({ id: dictionaryId, organizationId, tenantId, deletedAt: null })
    em.find.mockResolvedValueOnce([
      { id: entryId, position: 0, updatedAt: new Date('2026-04-11T08:00:00.000Z') },
    ])

    const response = await reorderEntries(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: [{ id: entryId, position: 1 }] }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      context.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      context.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
      }),
    )
  })

  it('runs the mutation guard when setting a default entry', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: dictionaryId, organizationId, tenantId, deletedAt: null })
      .mockResolvedValueOnce({ id: entryId, isDefault: false, updatedAt: new Date('2026-04-11T08:00:00.000Z') })
    em.find.mockResolvedValueOnce([
      { id: previousDefaultId, isDefault: true, updatedAt: new Date('2026-04-11T08:00:00.000Z') },
    ])

    const response = await setDefaultEntry(
      new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries/set-default`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryId }),
      }),
      { params: { dictionaryId } },
    )

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      context.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      context.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
      }),
    )
  })
})
