import { resolveRecordLocksApiContext } from '../utils'
import { POST } from '../validate/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  resolveRecordLocksApiContext: jest.fn(),
}))

const target = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  resourceKind: 'customers.person',
  resourceId: '40000000-0000-4000-8000-000000000001',
}

function makeRequest(body: unknown = { resourceKind: target.resourceKind, resourceId: target.resourceId }) {
  return new Request('http://localhost/api/record_locks/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockContext(hasReadScope = true) {
  const canReadTarget = jest.fn<Promise<boolean>, [typeof target]>()
  const validateMutation = jest.fn()
  const fork = jest.fn()
  jest.mocked(resolveRecordLocksApiContext).mockResolvedValue({
    auth: { tenantId: target.tenantId, sub: target.userId },
    organizationId: target.organizationId,
    hasReadScope,
    container: { resolve: () => ({ fork }) },
    recordLockService: { canReadTarget, validateMutation },
  } as never)
  return { canReadTarget, validateMutation, fork }
}

describe('record_locks validate route', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  test('rejects a denied organization scope before consulting the lock service', async () => {
    const { canReadTarget, validateMutation, fork } = mockContext(false)

    const response = await POST(makeRequest())

    expect(response.status).toBe(403)
    expect(canReadTarget).not.toHaveBeenCalled()
    expect(validateMutation).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
  })

  test('rejects malformed input before checking target access', async () => {
    const { canReadTarget, validateMutation } = mockContext()

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(400)
    expect(canReadTarget).not.toHaveBeenCalled()
    expect(validateMutation).not.toHaveBeenCalled()
  })

  test('returns a generic 404 for an unreadable target without opening conflict history', async () => {
    const { canReadTarget, validateMutation, fork } = mockContext()
    canReadTarget.mockResolvedValue(false)

    const response = await POST(makeRequest())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      code: 'record_not_found',
      error: 'record_locks.errors.not_found',
    })
    expect(canReadTarget).toHaveBeenCalledWith(target)
    expect(validateMutation).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
  })

  test('preserves the validation result for an authorized reader', async () => {
    const { canReadTarget, validateMutation } = mockContext()
    canReadTarget.mockResolvedValue(true)
    const result = {
      ok: true,
      enabled: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      shouldReleaseOnSuccess: false,
      lock: null,
      latestActionLogId: null,
    }
    validateMutation.mockResolvedValue(result)

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(validateMutation).toHaveBeenCalledWith({
      ...target,
      method: 'PUT',
      headers: expect.objectContaining({ resourceKind: target.resourceKind, resourceId: target.resourceId }),
      mutationPayload: null,
    })
  })
})
