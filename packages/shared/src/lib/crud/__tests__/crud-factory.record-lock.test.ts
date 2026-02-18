import {
  readCrudRecordLockHeaders,
  releaseCrudRecordLockAfterSuccess,
  validateCrudRecordLock,
} from '@open-mercato/shared/lib/crud/record-locking'

describe('crud record-lock helpers', () => {
  test('readCrudRecordLockHeaders parses supported headers', () => {
    const headers = new Headers({
      'x-om-record-lock-kind': 'sales.quote',
      'x-om-record-lock-resource-id': '10000000-0000-4000-8000-000000000001',
      'x-om-record-lock-token': '20000000-0000-4000-8000-000000000001',
      'x-om-record-lock-base-log-id': '30000000-0000-4000-8000-000000000001',
      'x-om-record-lock-resolution': 'accept_mine',
      'x-om-record-lock-conflict-id': '40000000-0000-4000-8000-000000000001',
    })

    expect(readCrudRecordLockHeaders(headers)).toEqual({
      resourceKind: 'sales.quote',
      resourceId: '10000000-0000-4000-8000-000000000001',
      token: '20000000-0000-4000-8000-000000000001',
      baseLogId: '30000000-0000-4000-8000-000000000001',
      resolution: 'accept_mine',
      conflictId: '40000000-0000-4000-8000-000000000001',
    })
  })

  test('validateCrudRecordLock returns null when service is not registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('missing')
      },
    } as any

    const result = await validateCrudRecordLock(container, {
      tenantId: '50000000-0000-4000-8000-000000000001',
      organizationId: null,
      userId: '60000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '10000000-0000-4000-8000-000000000001',
      method: 'PUT',
      headers: {},
    })

    expect(result).toBeNull()
  })

  test('validate/release delegate to recordLockService when available', async () => {
    const validateMutation = jest.fn().mockResolvedValue({
      ok: true,
      shouldReleaseOnSuccess: true,
    })
    const releaseAfterMutation = jest.fn().mockResolvedValue(undefined)

    const container = {
      resolve: jest.fn().mockReturnValue({
        validateMutation,
        releaseAfterMutation,
      }),
    } as any

    const validation = await validateCrudRecordLock(container, {
      tenantId: '50000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '60000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '10000000-0000-4000-8000-000000000001',
      method: 'PUT',
      headers: { resolution: 'normal' },
    })

    expect(validation).toEqual({
      ok: true,
      shouldReleaseOnSuccess: true,
    })

    await releaseCrudRecordLockAfterSuccess(container, {
      tenantId: '50000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '60000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '10000000-0000-4000-8000-000000000001',
      token: '20000000-0000-4000-8000-000000000001',
      reason: 'saved',
    })

    expect(validateMutation).toHaveBeenCalledTimes(1)
    expect(releaseAfterMutation).toHaveBeenCalledTimes(1)
  })
})
