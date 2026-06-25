const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const tagId = '44444444-4444-4444-8444-444444444444'
const resourceId = '55555555-5555-4555-8555-555555555555'
const assignmentId = '66666666-6666-4666-8666-666666666666'

const commandBusExecuteMock = jest.fn()
const commandBus = {
  execute: (...args: unknown[]) => commandBusExecuteMock(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return commandBus
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { POST as assignResourceTag } from '../assign/route'
import { POST as unassignResourceTag } from '../unassign/route'

function buildTagRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-om-test-lock': 'expected-version',
    },
    body: JSON.stringify({ tagId, resourceId }),
  })
}

describe('resources resource tag assignment routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({
      ok: true,
      shouldRunAfterSuccess: true,
      metadata: { lockToken: 'guard-token' },
    })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({
      result: { assignmentId },
      logEntry: null,
    })
  })

  it('blocks resource tag assignment before executing the command when the mutation guard rejects it', async () => {
    validateCrudMutationGuardMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: 'Resource is locked' },
    })

    const response = await assignResourceTag(buildTagRequest('/api/resources/resources/tags/assign'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Resource is locked' })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'resources.resourceTagAssignment',
        resourceId,
        operation: 'custom',
        requestMethod: 'POST',
        mutationPayload: expect.objectContaining({
          tenantId,
          organizationId,
          tagId,
          resourceId,
        }),
      }),
    )
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the mutation guard after-success hook after resource tag unassignment succeeds', async () => {
    const response = await unassignResourceTag(buildTagRequest('/api/resources/resources/tags/unassign'))

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'resources.resourceTags.unassign',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId,
          organizationId,
          tagId,
          resourceId,
        }),
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'resources.resourceTagAssignment',
        resourceId,
        operation: 'custom',
        requestMethod: 'POST',
        metadata: { lockToken: 'guard-token' },
      }),
    )
  })
})
