const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const entityType = 'catalog:catalog_product'
const entityId = '44444444-4444-4444-8444-444444444444'
const rowId = '55555555-5555-4555-8555-555555555555'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const resolveTranslationTargetFieldsMock = jest.fn()

const db = {
  selectFrom: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  selectAll: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  executeTakeFirst: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const context = {
  container,
  auth: { tenantId, sub: userId },
  db,
  organizationId,
  tenantId,
  commandCtx: {
    container,
    auth: { tenantId, sub: userId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: null,
  },
}

jest.mock('@open-mercato/core/modules/translations/api/context', () => ({
  resolveTranslationsRouteContext: jest.fn(async () => context),
  requireTranslationFeatures: jest.fn(async () => undefined),
  resolveTranslationsActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/core/modules/translations/lib/target-access', () => ({
  ...jest.requireActual('@open-mercato/core/modules/translations/lib/target-access'),
  resolveTranslationTargetFields: (...args: unknown[]) => resolveTranslationTargetFieldsMock(...args),
}))

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GET, PUT, DELETE } from '../route'

const makePutRequest = () =>
  new Request(`http://localhost/api/translations/${entityType}/${entityId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ en: { title: 'Hello' } }),
  })

const makeDeleteRequest = () =>
  new Request(`http://localhost/api/translations/${entityType}/${entityId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  })

const routeParams = { params: { entityType, entityId } }

describe('translations entity write routes mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveTranslationTargetFieldsMock.mockResolvedValue(new Set(['title']))
    db.selectFrom.mockReturnThis()
    db.select.mockReturnThis()
    db.selectAll.mockReturnThis()
    db.where.mockReturnThis()
    db.executeTakeFirst.mockResolvedValue({
      id: rowId,
      entity_type: entityType,
      entity_id: entityId,
      translations: { en: { title: 'Hello' } },
      created_at: new Date('2026-04-11T08:00:00.000Z'),
      updated_at: new Date('2026-04-11T08:00:00.000Z'),
    })
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { rowId }, logEntry: null })
  })

  it.each([
    { method: 'GET', handle: GET, action: 'view' },
    { method: 'PUT', handle: PUT, action: 'manage' },
    { method: 'DELETE', handle: DELETE, action: 'manage' },
  ])('checks target access before processing a $method request', async ({ method, handle, action }) => {
    resolveTranslationTargetFieldsMock.mockRejectedValue(new CrudHttpError(403, { error: 'Forbidden' }))
    const request = new Request('http://localhost/api/translations', { method })

    expect((await handle(request, routeParams)).status).toBe(403)
    expect(resolveTranslationTargetFieldsMock).toHaveBeenCalledWith(context, entityType, entityId, action)
    expect(db.selectFrom).not.toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects unregistered fields before calling the mutation guard or writing', async () => {
    resolveTranslationTargetFieldsMock.mockResolvedValue(new Set(['description']))

    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'unregistered_translation_field' })
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('only returns registered fields from existing translation rows', async () => {
    db.executeTakeFirst.mockResolvedValue({
      entity_type: entityType,
      entity_id: entityId,
      translations: { en: { title: 'A title', subtitle: 'An unregistered subtitle' }, fr: {} },
    })

    const response = await GET(new Request('http://localhost/api/translations'), routeParams)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.translations).toEqual({ en: { title: 'A title' }, fr: {} })
  })

  it('runs the mutation guard and after-success hook when saving translations (PUT)', async () => {
    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'update',
        requestMethod: 'PUT',
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledTimes(1)
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'update',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('skips the after-success hook when the guard does not request it (PUT)', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false, metadata: null })

    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledTimes(1)
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('aborts the save before mutating when the guard blocks the write (PUT)', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Conflict' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the mutation guard and after-success hook when deleting translations (DELETE)', async () => {
    const response = await DELETE(makeDeleteRequest(), routeParams)

    expect(response.status).toBe(204)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'delete',
        requestMethod: 'DELETE',
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledTimes(1)
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'delete',
      }),
    )
  })

  it('aborts the delete before mutating when the guard blocks the write (DELETE)', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    const response = await DELETE(makeDeleteRequest(), routeParams)

    expect(response.status).toBe(409)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
  it('surfaces the status and body of an interceptor rejection that carries one (PUT)', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(
      new CommandInterceptorError('Translation blocked by policy', {
        status: 422,
        body: { error: 'Translation blocked by policy', locale: 'de' },
      }),
    )

    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Translation blocked by policy',
      locale: 'de',
    })
  })

  it('keeps the generic 500 when an interceptor rejection carries no status (PUT)', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))

    const response = await PUT(makePutRequest(), routeParams)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
