/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const entityId = '66666666-6666-4666-8666-666666666666'
const tagId = '77777777-7777-4777-8777-777777777777'
const assignmentId = '88888888-8888-4888-8888-888888888888'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()

const commandBus = { execute: commandBusExecuteMock }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return commandBus
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { POST } from '../route'

const assignRequest = () =>
  new Request('http://localhost/api/customers/tags/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tagId, entityId }),
  })

describe('customers tags assign route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { assignmentId }, logEntry: null })
  })

  it('runs the guard before assign and the after-success hook on success', async () => {
    const response = await POST(assignRequest())

    expect(response.status).toBe(201)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.tagAssignment',
        resourceId: entityId,
        operation: 'custom',
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith('customers.tags.assign', expect.anything())
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
  })

  it('short-circuits assign when the guard blocks the mutation', async () => {
    validateCrudMutationGuardMock.mockResolvedValueOnce({ ok: false, status: 423, body: { error: 'locked' } })

    const response = await POST(assignRequest())

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
