const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const layoutItemId = '66666666-6666-4666-8666-666666666666'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const rbac = { loadAcl: jest.fn() }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: jest.fn(async () => [{ metadata: { id: 'sales-summary' } }]),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/access', () => ({
  resolveAllowedWidgetIds: jest.fn(async () => ['sales-summary']),
}))

import { PUT } from '../route'

function buildRequest(): Request {
  return new Request('http://localhost/api/dashboards/layout', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0 }] }),
  })
}

describe('dashboards layout route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    em.findOne.mockResolvedValue(null)
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('short-circuits the write when the mutation guard blocks the request', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'conflict' } })

    const response = await PUT(buildRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.layout', resourceId: userId, operation: 'update' }),
    )
    expect(em.flush).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the after-success hook after a successful write', async () => {
    const response = await PUT(buildRequest())

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.layout', resourceId: userId, operation: 'update' }),
    )
  })
})
