/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const tableId = 'customers.deals'
const saveUserPerspectiveMock = jest.fn()
const translateMock = jest.fn((key: string, fallback: string) => `[${key}] ${fallback}`)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: '33333333-3333-4333-8333-333333333333',
    tenantId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    roles: [],
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((name: string) => (name === 'em' ? { find: jest.fn(), findOne: jest.fn() } : {})),
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: translateMock })),
}))

jest.mock('@open-mercato/core/modules/perspectives/services/perspectiveService', () => ({
  loadPerspectivesState: jest.fn(),
  saveUserPerspective: (...args: unknown[]) => saveUserPerspectiveMock(...args),
  saveRolePerspectives: jest.fn(),
  clearRolePerspectives: jest.fn(),
}))

import { POST } from '../route'

function postSave() {
  return POST(
    new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pipeline', settings: {}, createOnly: true }),
    }),
    { params: { tableId } },
  )
}

describe('POST /api/perspectives/[tableId] duplicate_name response', () => {
  beforeEach(() => {
    saveUserPerspectiveMock.mockReset()
    translateMock.mockClear()
  })

  it('returns a translated 409 duplicate_name when the service rejects a taken name', async () => {
    saveUserPerspectiveMock.mockRejectedValue(
      new CrudHttpError(409, { error: 'A view with this name already exists.', code: 'duplicate_name' }),
    )

    const response = await postSave()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '[ui.perspectives.error.nameExists] A view with this name already exists.',
      code: 'duplicate_name',
    })
  })

  it('returns the same translated 409 when the unique index rejects a concurrent create', async () => {
    saveUserPerspectiveMock.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }))

    const response = await postSave()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '[ui.perspectives.error.nameExists] A view with this name already exists.',
      code: 'duplicate_name',
    })
  })

  it('passes other service errors through unchanged', async () => {
    saveUserPerspectiveMock.mockRejectedValue(
      new CrudHttpError(409, { error: 'Record changed', code: 'record_conflict' }),
    )

    const response = await postSave()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Record changed', code: 'record_conflict' })
    expect(translateMock).not.toHaveBeenCalled()
  })

  it('returns a translated not-found refusal for a scoped lookup miss instead of throwing500', async () => {
    saveUserPerspectiveMock.mockRejectedValue(Object.assign(new Error('Perspective not found'), { code: 'NOT_FOUND' }))

    const response = await postSave()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: '[api.errors.notFound] Not Found', code: 'NOT_FOUND' })
  })

})
