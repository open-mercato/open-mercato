/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const tableId = 'customers.deals'
const ROLE_ID = '44444444-4444-4444-8444-444444444444'
const saveUserPerspectiveMock = jest.fn()
const saveRolePerspectivesMock = jest.fn()
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
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { find: jest.fn(async () => [{ id: ROLE_ID }]), findOne: jest.fn() }
      if (name === 'rbacService') return { userHasAllFeatures: jest.fn(async () => true) }
      return {}
    }),
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
  saveRolePerspectives: (...args: unknown[]) => saveRolePerspectivesMock(...args),
  clearRolePerspectives: jest.fn(),
}))

import { POST } from '../route'

function postClone(createOnly: boolean | undefined) {
  return POST(
    new Request(`http://localhost/api/perspectives/${encodeURIComponent(tableId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Pipeline (copy)',
        settings: {},
        applyToRoles: [ROLE_ID],
        ...(createOnly === undefined ? {} : { createOnly }),
      }),
    }),
    { params: { tableId } },
  )
}

describe('POST /api/perspectives/[tableId] createOnly role phase (#8632)', () => {
  beforeEach(() => {
    saveUserPerspectiveMock.mockReset()
    saveRolePerspectivesMock.mockReset()
    translateMock.mockClear()
    saveUserPerspectiveMock.mockResolvedValue({ id: 'personal-1', name: 'Pipeline (copy)' })
    saveRolePerspectivesMock.mockResolvedValue([])
  })

  it('forwards createOnly to the role phase', async () => {
    const response = await postClone(true)
    expect(response.status).toBe(200)
    expect(saveRolePerspectivesMock).toHaveBeenCalledTimes(1)
    expect(saveRolePerspectivesMock.mock.calls[0][2]).toMatchObject({ createOnly: true })
  })

  it('does not enable createOnly for the role phase when the client did not request it', async () => {
    await postClone(undefined)
    expect(saveRolePerspectivesMock.mock.calls[0][2]).toMatchObject({ createOnly: false })
  })

  it('returns a translated 409 duplicate_name when a target role already has the copy name', async () => {
    saveRolePerspectivesMock.mockRejectedValue(
      new CrudHttpError(409, { error: 'A view with this name already exists.', code: 'duplicate_name' }),
    )
    const response = await postClone(true)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '[ui.perspectives.error.nameExists] A view with this name already exists.',
      code: 'duplicate_name',
    })
  })
})
